export const config = { runtime: 'edge' };

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY;

async function supabase(path, method = 'GET', body = null) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'apikey': SUPABASE_KEY,
      'Authorization': `Bearer ${SUPABASE_KEY}`,
      'Prefer': method === 'POST' ? 'return=representation' : 'return=minimal'
    },
    body: body ? JSON.stringify(body) : null
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Supabase error ${res.status}: ${err}`);
  }
  return res.json().catch(() => null);
}

function generateCode() {
  return Math.random().toString(36).substr(2, 6).toUpperCase();
}

export default async function handler(req) {
  const { method } = req;
  const url = new URL(req.url);
  const action = url.searchParams.get('action');

  try {

    // ── CREATE TRIP ──────────────────────────────
    if (method === 'POST' && action === 'create') {
      const { trip, ownerName } = await req.json();
      const code = generateCode();

      // Create the trip
      const [newTrip] = await supabase('trips', 'POST', {
        code,
        destination: trip.destination || null,
        dates: trip.dates || null,
        people: trip.people || null,
        transport: trip.transport || null,
        accommodation: trip.accommodation || null,
        budget: trip.budget || null,
        duration: trip.duration || null,
        status: 'planning'
      });

      // Add the owner as first member
      const colors = [
        { bg: '#FDF0EB', text: '#E8622A' },
        { bg: '#E3F5F0', text: '#1A8A72' },
        { bg: '#EEECFB', text: '#4A3FBF' },
        { bg: '#FBF4E3', text: '#8A6400' }
      ];
      const initials = ownerName ? ownerName.substring(0, 2).toUpperCase() : 'ME';
      await supabase('members', 'POST', {
        trip_id: newTrip.id,
        name: ownerName || 'You',
        initials,
        color_bg: colors[0].bg,
        color_text: colors[0].text,
        calendar_connected: false
      });

      return new Response(JSON.stringify({ code, tripId: newTrip.id }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── GET TRIP ─────────────────────────────────
    if (method === 'GET' && action === 'get') {
      const code = url.searchParams.get('code');
      if (!code) throw new Error('No code provided');

      const trips = await supabase(`trips?code=eq.${code}&select=*`);
      if (!trips || trips.length === 0) {
        return new Response(JSON.stringify({ error: 'Trip not found' }), { status: 404 });
      }
      const trip = trips[0];

      const members = await supabase(`members?trip_id=eq.${trip.id}&select=*`);
      const windows = await supabase(`free_windows?trip_id=eq.${trip.id}&select=*`);

      return new Response(JSON.stringify({ trip, members, windows }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── ADD MEMBER ───────────────────────────────
    if (method === 'POST' && action === 'join') {
      const { code, name } = await req.json();

      const trips = await supabase(`trips?code=eq.${code}&select=id`);
      if (!trips || trips.length === 0) {
        return new Response(JSON.stringify({ error: 'Trip not found' }), { status: 404 });
      }
      const tripId = trips[0].id;

      const existing = await supabase(`members?trip_id=eq.${tripId}&select=id`);
      const colorIdx = Math.min((existing?.length || 0), 3);
      const colors = [
        { bg: '#E3F5F0', text: '#1A8A72' },
        { bg: '#EEECFB', text: '#4A3FBF' },
        { bg: '#FBF4E3', text: '#8A6400' },
        { bg: '#E6F1FB', text: '#0C447C' }
      ];

      const initials = name ? name.substring(0, 2).toUpperCase() : '??';
      const [member] = await supabase('members', 'POST', {
        trip_id: tripId,
        name,
        initials,
        color_bg: colors[colorIdx].bg,
        color_text: colors[colorIdx].text,
        calendar_connected: false
      });

      return new Response(JSON.stringify({ memberId: member.id, tripId }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── UPLOAD CALENDAR ──────────────────────────
    if (method === 'POST' && action === 'calendar') {
      const { memberId, tripId, busyPeriods } = await req.json();

      // Delete old busy periods for this member
      await supabase(`busy_periods?member_id=eq.${memberId}`, 'DELETE');

      // Insert new busy periods (only dates, never event titles)
      if (busyPeriods && busyPeriods.length > 0) {
        await supabase('busy_periods', 'POST',
          busyPeriods.map(p => ({
            member_id: memberId,
            trip_id: tripId,
            date_start: p.start,
            date_end: p.end
          }))
        );
      }

      // Mark member as connected
      await supabase(`members?id=eq.${memberId}`, 'PATCH', {
        calendar_connected: true
      });

      // Recompute free windows for the trip
      const windows = await computeFreeWindows(tripId);

      return new Response(JSON.stringify({ success: true, windows }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    // ── VOTE ─────────────────────────────────────
    if (method === 'POST' && action === 'vote') {
      const { memberId, vote } = await req.json();
      await supabase(`members?id=eq.${memberId}`, 'PATCH', { vote });
      return new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    return new Response('Not found', { status: 404 });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

async function computeFreeWindows(tripId) {
  // Get all members
  const members = await supabase(`members?trip_id=eq.${tripId}&calendar_connected=eq.true&select=id`);
  if (!members || members.length < 2) return [];

  // Get all busy periods
  const busy = await supabase(`busy_periods?trip_id=eq.${tripId}&select=date_start,date_end`);

  // Find 7-day windows in next 6 months where no one is busy
  const windows = [];
  const today = new Date();
  const sixMonths = new Date(today);
  sixMonths.setMonth(sixMonths.getMonth() + 6);

  let d = new Date(today);
  d.setDate(d.getDate() + 7); // start from next week

  while (d < sixMonths && windows.length < 5) {
    const windowEnd = new Date(d);
    windowEnd.setDate(windowEnd.getDate() + 7);

    const isBusy = (busy || []).some(b => {
      const bs = new Date(b.date_start);
      const be = new Date(b.date_end);
      return bs < windowEnd && be > d;
    });

    if (!isBusy) {
      const label = `${d.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })} – ${windowEnd.toLocaleDateString('en-GB', { month: 'short', day: 'numeric' })}`;
      windows.push({
        trip_id: tripId,
        date_start: d.toISOString().split('T')[0],
        date_end: windowEnd.toISOString().split('T')[0],
        nights: 7,
        label,
        price_estimate: '~€200-400/pp',
        price_level: 'mid'
      });

      // Save to DB
      await supabase('free_windows', 'POST', windows[windows.length - 1]);
    }
    d.setDate(d.getDate() + 7);
  }

  return windows;
}
