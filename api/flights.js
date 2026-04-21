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
  console.log('Place lookup:', r.status, JSON.stringify(json).slice(0, 300));
  const hit = json?.data?.find(p => p.type === 'airport') || json?.data?.[0];
  if (!hit) return null;
  return { iata: hit.iata_code, name: hit.name, cityName: hit.city_name || hit.name };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { origin = 'AMS', destQuery, departDate, returnDate, passengers = 1, cabin = 'economy' } = req.body;
  console.log('Flight search:', { origin, destQuery, departDate, returnDate, passengers, cabin });

  if (!process.env.DUFFEL_TOKEN) return res.status(500).json({ error: 'DUFFEL_TOKEN not configured' });

  try {
    const dest = await lookupIATA(destQuery);
    if (!dest) return res.status(404).json({ error: `Could not find airport for: ${destQuery}` });
    console.log('Destination:', dest);

    const org = ORIGINS[origin] || ORIGINS.AMS;

    const slices = [{ origin: org.iata, destination: dest.iata, departure_date: departDate }];
    if (returnDate) slices.push({ origin: dest.iata, destination: org.iata, departure_date: returnDate });

    const body = {
      data: {
        slices,
        passengers: Array.from({ length: Number(passengers) }, () => ({ type: 'adult' })),
        cabin_class: cabin,
      },
    };

    const r = await fetch('https://api.duffel.com/air/offer_requests?return_offers=true', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify(body),
    });

    const json = await r.json();
    console.log('Duffel status:', r.status, 'offers:', json?.data?.offers?.length, 'errors:', JSON.stringify(json?.errors || null));

    if (r.status !== 201 || !json?.data?.offers?.length) {
      return res.json({ flights: [], destName: dest.cityName, debug: json?.errors || json?.meta });
    }

    const orgCode = org.iata.toLowerCase();
    const dstCode = dest.iata.toLowerCase();

    const flights = json.data.offers.slice(0, 5).map((offer) => {
      const slice = offer.slices?.[0];
      const seg   = slice?.segments?.[0];
      const mc    = seg?.marketing_carrier || seg?.operating_carrier || {};
      const total = Math.round(parseFloat(offer.total_amount || 0));
      const pp    = Math.round(total / Number(passengers));

      const dur = slice?.duration || '';
      const durationMin = (parseInt(dur.match(/(\d+)H/)?.[1] || 0) * 60) + parseInt(dur.match(/(\d+)M/)?.[1] || 0);

      return {
        id:              offer.id,
        airline:         mc.name || 'Unknown',
        airlineCode:     mc.iata_code || '',
        logoUrl:         mc.logo_symbol_url || mc.logo_lockup_url || '',
        origin:          seg?.origin?.iata_code || org.iata,
        originCity:      seg?.origin?.city_name || seg?.origin?.name || org.name,
        destination:     seg?.destination?.iata_code || dest.iata,
        destinationCity: seg?.destination?.city_name || seg?.destination?.name || dest.cityName,
        departure:       seg?.departing_at || '',
        arrival:         seg?.arriving_at || '',
        durationMin,
        stops:           (slice?.segments?.length || 1) - 1,
        priceTotal:      total,
        pricePerPerson:  pp,
        deepLink:        `https://www.skyscanner.net/transport/flights/${orgCode}/${dstCode}/${departDate.replace(/-/g,'')}/?adults=${passengers}&cabinclass=${cabin}`,
      };
    });

    return res.json({ flights, destName: dest.cityName, originName: org.name });
  } catch (e) {
    console.error('Flight search error:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
}
