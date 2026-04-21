const ORIGINS = {
  AMS: { iata: 'AMS', name: 'Amsterdam Schiphol' },
  EIN: { iata: 'EIN', name: 'Eindhoven' },
  BRU: { iata: 'BRU', name: 'Brussels' },
  LGW: { iata: 'LGW', name: 'London Gatwick' },
};

function headers() {
  return {
    'Authorization': `Bearer ${process.env.DUFFEL_TOKEN}`,
    'Duffel-Version': 'v2',
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

async function lookupIATA(query) {
  const url = `https://api.duffel.com/places/suggestions?query=${encodeURIComponent(query)}`;
  const r = await fetch(url, { headers: headers() });
  const json = await r.json();
  const hit = json?.data?.find(p => p.type === 'airport') || json?.data?.[0];
  if (!hit) return null;
  return { iata: hit.iata_code, name: hit.name, cityName: hit.city_name || hit.name };
}

async function searchFromOrigin(org, dest, departDate, returnDate, passengers, cabin) {
  const slices = [
    { origin: org.iata, destination: dest.iata, departure_date: departDate },
    { origin: dest.iata, destination: org.iata, departure_date: returnDate },
  ];
  const body = {
    data: {
      slices,
      passengers: Array.from({ length: Number(passengers) }, () => ({ type: 'adult' })),
      cabin_class: cabin,
    },
  };
  try {
    const r = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });
    const json = await r.json();
    return json?.data?.offers || [];
  } catch {
    return [];
  }
}

function formatLeg(slice) {
  if (!slice) return null;
  const seg = slice.segments?.[0];
  const last = slice.segments?.[slice.segments.length - 1];
  const dur = slice.duration || '';
  const durationMin = (parseInt(dur.match(/(\d+)H/)?.[1] || 0) * 60) + parseInt(dur.match(/(\d+)M/)?.[1] || 0);
  return {
    departure:       seg?.departing_at || '',
    arrival:         last?.arriving_at || seg?.arriving_at || '',
    origin:          seg?.origin?.iata_code || '',
    originCity:      seg?.origin?.city_name || seg?.origin?.name || '',
    destination:     last?.destination?.iata_code || seg?.destination?.iata_code || '',
    destinationCity: last?.destination?.city_name || last?.destination?.name || seg?.destination?.city_name || '',
    durationMin,
    stops:           (slice.segments?.length || 1) - 1,
    carrier:         seg?.marketing_carrier?.name || '',
    carrierCode:     seg?.marketing_carrier?.iata_code || '',
    logoUrl:         seg?.marketing_carrier?.logo_symbol_url || seg?.marketing_carrier?.logo_lockup_url || '',
  };
}

function formatOffer(offer, org, dest, departDate, passengers, cabin) {
  const outbound = formatLeg(offer.slices?.[0]);
  const ret      = formatLeg(offer.slices?.[1]);
  const total    = Math.round(parseFloat(offer.total_amount || 0));
  const pp       = Math.round(total / Number(passengers));
  const orgCode  = org.iata.toLowerCase();
  const dstCode  = dest.iata.toLowerCase();
  const dateStr  = departDate.replace(/-/g, '');
  return {
    id:          offer.id,
    outbound,
    return:      ret,
    priceTotal:  total,
    pricePerPerson: pp,
    deepLink:    `https://www.skyscanner.net/transport/flights/${orgCode}/${dstCode}/${dateStr}/?adults=${passengers}&cabinclass=${cabin}`,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { destQuery, departDate, returnDate, passengers = 1, cabin = 'economy' } = req.body;

  if (!process.env.DUFFEL_TOKEN) return res.status(500).json({ error: 'DUFFEL_TOKEN not configured' });
  if (!destQuery || !departDate) return res.status(400).json({ error: 'destQuery and departDate required' });

  try {
    const dest = await lookupIATA(destQuery);
    if (!dest) return res.status(404).json({ error: `Could not find airport for: ${destQuery}` });

    const effectiveReturn = returnDate ||
      new Date(new Date(departDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Search all origins in parallel
    const results = await Promise.all(
      Object.entries(ORIGINS).map(async ([code, org]) => {
        const offers = await searchFromOrigin(org, dest, departDate, effectiveReturn, passengers, cabin);
        const sorted = offers.sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount));
        return { code, org, offers: sorted };
      })
    );

    // Build comparison (cheapest pp per origin)
    const comparison = results
      .map(({ code, org, offers }) => {
        const cheapest = offers[0];
        return {
          origin:       code,
          name:         org.name,
          cheapestPP:   cheapest ? Math.round(parseFloat(cheapest.total_amount) / Number(passengers)) : null,
          cheapestTotal: cheapest ? Math.round(parseFloat(cheapest.total_amount)) : null,
          available:    offers.length > 0,
        };
      })
      .sort((a, b) => (a.cheapestPP ?? 999999) - (b.cheapestPP ?? 999999));

    // Top 5 flights from the cheapest available origin
    const bestResult = results.find(r => r.code === comparison.find(c => c.available)?.origin);
    const flights = (bestResult?.offers || []).slice(0, 5).map(
      offer => formatOffer(offer, bestResult.org, dest, departDate, passengers, cabin)
    );

    return res.json({
      flights,
      comparison,
      destName:   dest.cityName,
      bestOrigin: bestResult?.code,
      returnDate: effectiveReturn,
    });
  } catch (e) {
    console.error('Flight search error:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
}
