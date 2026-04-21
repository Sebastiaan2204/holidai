const HOST = 'sky-scrapper.p.rapidapi.com';
const KEY  = process.env.RAPIDAPI_KEY;

const ORIGINS = {
  AMS: { skyId: 'AMS', entityId: '95565060', name: 'Amsterdam Schiphol' },
  EIN: { skyId: 'EIN', entityId: '95565049', name: 'Eindhoven' },
  BRU: { skyId: 'BRU', entityId: '95565057', name: 'Brussels' },
  LGW: { skyId: 'LGW', entityId: '95565051', name: 'London Gatwick' },
};

async function rapidGet(path) {
  const url = `https://${HOST}${path}`;
  console.log('RapidAPI GET:', url);
  const r = await fetch(url, {
    headers: { 'X-RapidAPI-Key': KEY, 'X-RapidAPI-Host': HOST },
  });
  const json = await r.json();
  console.log('RapidAPI status:', r.status, 'response:', JSON.stringify(json).slice(0, 300));
  return json;
}

async function lookupAirport(query) {
  const data = await rapidGet(`/api/v1/flights/searchAirport?query=${encodeURIComponent(query)}&locale=en-US`);
  const hit = data?.data?.[0];
  if (!hit) {
    console.log('Airport not found for:', query, 'full response:', JSON.stringify(data));
    return null;
  }
  console.log('Airport found:', hit.skyId, hit.entityId, hit.presentation?.title);
  return { skyId: hit.skyId, entityId: hit.entityId, name: hit.presentation?.title || query };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { origin = 'AMS', destQuery, departDate, returnDate, passengers = 1, cabin = 'economy' } = req.body;
  console.log('Flight search params:', { origin, destQuery, departDate, returnDate, passengers });

  if (!KEY) {
    console.error('RAPIDAPI_KEY is not set');
    return res.status(500).json({ error: 'RAPIDAPI_KEY not configured' });
  }

  try {
    const dest = await lookupAirport(destQuery);
    if (!dest) return res.status(404).json({ error: `Could not find airport for: ${destQuery}` });

    const org = ORIGINS[origin] || ORIGINS.AMS;

    const params = new URLSearchParams({
      originSkyId:         org.skyId,
      destinationSkyId:    dest.skyId,
      originEntityId:      org.entityId,
      destinationEntityId: dest.entityId,
      date:                departDate,
      cabinClass:          cabin,
      adults:              String(passengers),
      sortBy:              'best',
      currency:            'EUR',
      market:              'en-GB',
      countryCode:         'NL',
    });
    if (returnDate) params.set('returnDate', returnDate);

    const data = await rapidGet(`/api/v2/flights/searchFlights?${params}`);
    const itineraries = data?.data?.itineraries;

    console.log('Itineraries count:', itineraries?.length ?? 'none', 'status:', data?.status, 'message:', data?.message);

    if (!itineraries || itineraries.length === 0) {
      return res.json({ flights: [], destName: dest.name, debug: { status: data?.status, message: data?.message } });
    }

    const flights = itineraries.slice(0, 5).map((it) => {
      const leg     = it.legs[0];
      const carrier = leg.carriers.marketing[0];
      const total   = Math.round(it.price.raw);
      const pp      = Math.round(it.price.raw / passengers);
      const orgCode = org.skyId.toLowerCase();
      const dstCode = dest.skyId.toLowerCase();

      return {
        id:              it.id,
        airline:         carrier.name,
        airlineCode:     carrier.alternateId,
        logoUrl:         carrier.logoUrl,
        origin:          leg.origin.displayCode,
        originCity:      leg.origin.name,
        destination:     leg.destination.displayCode,
        destinationCity: leg.destination.name,
        departure:       leg.departure,
        arrival:         leg.arrival,
        durationMin:     leg.durationInMinutes,
        stops:           leg.stopCount,
        priceTotal:      total,
        pricePerPerson:  pp,
        deepLink:        it.deepLink ||
          `https://www.skyscanner.net/transport/flights/${orgCode}/${dstCode}/${departDate.replace(/-/g,'')}/?adults=${passengers}&cabinclass=${cabin}`,
      };
    });

    return res.json({ flights, destName: dest.name, originName: org.name });
  } catch (e) {
    console.error('Flight search error:', e.message, e.stack);
    return res.status(500).json({ error: e.message });
  }
}
