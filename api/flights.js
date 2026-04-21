const AIRPORTS = [
  // Netherlands
  { iata: 'AMS', name: 'Amsterdam Schiphol',   city: 'Amsterdam',  lat: 52.3086, lng:  4.7639 },
  { iata: 'EIN', name: 'Eindhoven Airport',     city: 'Eindhoven',  lat: 51.4501, lng:  5.3742 },
  { iata: 'RTM', name: 'Rotterdam The Hague',   city: 'Rotterdam',  lat: 51.9569, lng:  4.4372 },
  { iata: 'MST', name: 'Maastricht Aachen',     city: 'Maastricht', lat: 50.9117, lng:  5.7701 },
  { iata: 'GRQ', name: 'Groningen Eelde',       city: 'Groningen',  lat: 53.1197, lng:  6.5794 },
  // Belgium
  { iata: 'BRU', name: 'Brussels Airport',      city: 'Brussels',   lat: 50.9010, lng:  4.4844 },
  { iata: 'CRL', name: 'Brussels Charleroi',    city: 'Charleroi',  lat: 50.4592, lng:  4.4538 },
  { iata: 'LGG', name: 'Liège Airport',         city: 'Liège',      lat: 50.6374, lng:  5.4432 },
  // UK
  { iata: 'LHR', name: 'London Heathrow',       city: 'London',     lat: 51.4775, lng: -0.4614 },
  { iata: 'LGW', name: 'London Gatwick',        city: 'London',     lat: 51.1481, lng: -0.1903 },
  { iata: 'STN', name: 'London Stansted',       city: 'London',     lat: 51.8850, lng:  0.2350 },
  { iata: 'LTN', name: 'London Luton',          city: 'London',     lat: 51.8747, lng: -0.3683 },
  // Germany
  { iata: 'DUS', name: 'Düsseldorf Airport',    city: 'Düsseldorf', lat: 51.2895, lng:  6.7668 },
  { iata: 'CGN', name: 'Cologne Bonn Airport',  city: 'Cologne',    lat: 50.8659, lng:  7.1427 },
  { iata: 'FRA', name: 'Frankfurt Airport',     city: 'Frankfurt',  lat: 50.0333, lng:  8.5706 },
  { iata: 'HAM', name: 'Hamburg Airport',       city: 'Hamburg',    lat: 53.6304, lng:  9.9882 },
  { iata: 'BRE', name: 'Bremen Airport',        city: 'Bremen',     lat: 53.0475, lng:  8.7867 },
  // France
  { iata: 'CDG', name: 'Paris Charles de Gaulle', city: 'Paris',   lat: 49.0097, lng:  2.5479 },
  { iata: 'ORY', name: 'Paris Orly',            city: 'Paris',      lat: 48.7262, lng:  2.3652 },
  { iata: 'LIL', name: 'Lille Airport',         city: 'Lille',      lat: 50.5619, lng:  3.0894 },
  // Luxembourg
  { iata: 'LUX', name: 'Luxembourg Airport',    city: 'Luxembourg', lat: 49.6233, lng:  6.2044 },
];

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLng/2)**2;
  return Math.round(R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a)));
}

function nearbyAirports(lat, lng, maxKm = 250, maxCount = 5) {
  return AIRPORTS
    .map(a => ({ ...a, distanceKm: distanceKm(lat, lng, a.lat, a.lng) }))
    .filter(a => a.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, maxCount);
}

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
    return (json?.data?.offers || []).sort((a, b) => parseFloat(a.total_amount) - parseFloat(b.total_amount));
  } catch {
    return [];
  }
}

function formatLeg(slice) {
  if (!slice) return null;
  const seg  = slice.segments?.[0];
  const last = slice.segments?.[slice.segments.length - 1];
  const dur  = slice.duration || '';
  const durationMin = (parseInt(dur.match(/(\d+)H/)?.[1] || 0) * 60) + parseInt(dur.match(/(\d+)M/)?.[1] || 0);
  return {
    departure:       seg?.departing_at || '',
    arrival:         last?.arriving_at || seg?.arriving_at || '',
    origin:          seg?.origin?.iata_code || '',
    originCity:      seg?.origin?.city_name || seg?.origin?.name || '',
    destination:     last?.destination?.iata_code || seg?.destination?.iata_code || '',
    destinationCity: last?.destination?.city_name || last?.destination?.name || '',
    durationMin,
    stops:           (slice.segments?.length || 1) - 1,
    carrier:         seg?.marketing_carrier?.name || '',
    carrierCode:     seg?.marketing_carrier?.iata_code || '',
    logoUrl:         seg?.marketing_carrier?.logo_symbol_url || seg?.marketing_carrier?.logo_lockup_url || '',
  };
}

function formatOffer(offer, org, dest, departDate, passengers, cabin) {
  const total = Math.round(parseFloat(offer.total_amount || 0));
  return {
    id:             offer.id,
    outbound:       formatLeg(offer.slices?.[0]),
    return:         formatLeg(offer.slices?.[1]),
    priceTotal:     total,
    pricePerPerson: Math.round(total / Number(passengers)),
    deepLink:       `https://www.skyscanner.net/transport/flights/${org.iata.toLowerCase()}/${dest.iata.toLowerCase()}/${departDate.replace(/-/g,'')}/?adults=${passengers}&cabinclass=${cabin}`,
  };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const {
    destQuery, departDate, returnDate, passengers = 1, cabin = 'economy',
    userLat, userLng,
    originCode, // set when user explicitly picks an airport
  } = req.body;

  if (!process.env.DUFFEL_TOKEN) return res.status(500).json({ error: 'DUFFEL_TOKEN not configured' });
  if (!destQuery || !departDate) return res.status(400).json({ error: 'destQuery and departDate required' });

  try {
    const dest = await lookupIATA(destQuery);
    if (!dest) return res.status(404).json({ error: `Could not find airport for: ${destQuery}` });

    const effectiveReturn = returnDate ||
      new Date(new Date(departDate).getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Determine which airports to search
    let origins;
    if (originCode) {
      // User picked a specific airport — return top 5 flights from it
      const airport = AIRPORTS.find(a => a.iata === originCode);
      if (!airport) return res.status(400).json({ error: 'Unknown airport code' });
      const offers = await searchFromOrigin(airport, dest, departDate, effectiveReturn, passengers, cabin);
      const flights = offers.slice(0, 5).map(o => formatOffer(o, airport, dest, departDate, passengers, cabin));
      return res.json({ flights, destName: dest.cityName, selectedOrigin: airport });
    } else if (userLat != null && userLng != null) {
      origins = nearbyAirports(parseFloat(userLat), parseFloat(userLng));
    } else {
      // Fallback — default Dutch/Belgian airports
      origins = AIRPORTS.filter(a => ['AMS','EIN','RTM','BRU','CRL'].includes(a.iata));
    }

    // Search all nearby origins in parallel
    const results = await Promise.all(
      origins.map(async org => {
        const offers = await searchFromOrigin(org, dest, departDate, effectiveReturn, passengers, cabin);
        return { org, offers };
      })
    );

    // Build comparison
    const comparison = results
      .map(({ org, offers }) => ({
        origin:        org.iata,
        name:          org.name,
        city:          org.city,
        distanceKm:    org.distanceKm,
        cheapestPP:    offers[0] ? Math.round(parseFloat(offers[0].total_amount) / Number(passengers)) : null,
        cheapestTotal: offers[0] ? Math.round(parseFloat(offers[0].total_amount)) : null,
        available:     offers.length > 0,
      }))
      .sort((a, b) => (a.cheapestPP ?? 999999) - (b.cheapestPP ?? 999999));

    return res.json({
      comparison,
      destName:    dest.cityName,
      returnDate:  effectiveReturn,
    });
  } catch (e) {
    console.error('Flight search error:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
}
