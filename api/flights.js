const HOST = 'sky-scrapper.p.rapidapi.com';
const KEY  = process.env.RAPIDAPI_KEY;

const ORIGINS = {
  AMS: { skyId: 'AMS', entityId: '95565060', name: 'Amsterdam Schiphol' },
  EIN: { skyId: 'EIN', entityId: '95565049', name: 'Eindhoven' },
  BRU: { skyId: 'BRU', entityId: '95565057', name: 'Brussels' },
  LGW: { skyId: 'LGW', entityId: '95565051', name: 'London Gatwick' },
};

async function rapidGet(path) {
  const r = await fetch(`https://${HOST}${path}`, {
    headers: { 'X-RapidAPI-Key': KEY, 'X-RapidAPI-Host': HOST },
  });
  return r.json();
}

async function lookupAirport(query) {
  const data = await rapidGet(`/api/v1/flights/searchAirport?query=${encodeURIComponent(query)}&locale=en-US`);
  const hit = data?.data?.[0];
  if (!hit) return null;
  return { skyId: hit.skyId, entityId: hit.entityId, name: hit.presentation?.title || query };
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { origin = 'AMS', destQuery, departDate, returnDate, passengers = 1, cabin = 'economy' } = req.body;

  try {
    const dest = await lookupAirport(destQuery);
    if (!dest) return res.status(404).json({ error: 'Destination airport not found' });

    const org = ORIGINS[origin] || ORIGINS.AMS;
    const qs = new URLSearchParams({
      originSkyId:        org.skyId,
      destinationSkyId:   dest.skyId,
      originEntityId:     org.entityId,
      destinationEntityId:dest.entityId,
      date:               departDate,
      ...(returnDate ? { returnDate } : {}),
      cabinClass:         cabin,
      adults:             String(passengers),
      sortBy:             'best',
      currency:           'EUR',
      market:             'en-GB',
      countryCode:        'NL',
    });

    const data = await rapidGet(`/api/v2/flights/searchFlights?${qs}`);
    const itineraries = data?.data?.itineraries || [];

    const flights = itineraries.slice(0, 5).map((it, i) => {
      const leg     = it.legs[0];
      const carrier = leg.carriers.marketing[0];
      const total   = Math.round(it.price.raw);
      const pp      = Math.round(it.price.raw / passengers);
      const orgCode = org.skyId.toLowerCase();
      const dstCode = dest.skyId.toLowerCase();

      return {
        id:            it.id,
        airline:       carrier.name,
        airlineCode:   carrier.alternateId,
        logoUrl:       carrier.logoUrl,
        origin:        leg.origin.displayCode,
        originCity:    leg.origin.name,
        destination:   leg.destination.displayCode,
        destinationCity: leg.destination.name,
        departure:     leg.departure,
        arrival:       leg.arrival,
        durationMin:   leg.durationInMinutes,
        stops:         leg.stopCount,
        priceTotal:    total,
        pricePerPerson: pp,
        deepLink:      it.deepLink ||
          `https://www.skyscanner.net/transport/flights/${orgCode}/${dstCode}/${departDate.replace(/-/g,'')}/?adults=${passengers}&cabinclass=${cabin}`,
      };
    });

    return res.json({ flights, destName: dest.name, originName: org.name });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
