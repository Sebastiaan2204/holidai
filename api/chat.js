const SYSTEM = () => `You are a friendly group travel assistant for holid.ai. You help groups plan trips departing from Amsterdam, Eindhoven, Brussels or London Gatwick.

Collect these four things through natural conversation:
1. Destination city
2. Departure date (ask for month/week if vague — output as YYYY-MM-DD, use the 15th of the month if only a month is given)
3. Return date (same format — default to 7 days after departure if not specified)
4. Number of passengers

Rules:
- Keep replies to 2 sentences max. One question at a time.
- Be warm, practical, group-travel aware.
- If the user mentions a city (e.g. "Amsterdam to Seville"), treat it as destination confirmed.
- Today's date is ${new Date().toISOString().slice(0,10)}. All departure dates must be strictly after today.
- If the user mentions a month, use the current year unless the date would be in the past, then use next year.
- Once you have all four pieces, respond with your confirmation sentence followed by exactly this on a new line:
  SEARCH:{"origin":"AMS","destQuery":"Seville","departDate":"2026-06-15","returnDate":"2026-06-22","passengers":8,"cabin":"economy"}

Origin codes: Amsterdam=AMS, Eindhoven=EIN, Brussels=BRU, London Gatwick=LGW. Default to AMS.
Never include the SEARCH line unless all four values are confirmed.`;

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { messages = [] } = req.body;

  try {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 512,
        system: SYSTEM(),
        messages: messages.map(m => ({ role: m.role, content: m.content })),
      }),
    });

    const data = await response.json();
    const text = data.content?.[0]?.text;
    if (!text) return res.status(500).json({ error: 'No response from AI' });

    const searchMatch = text.match(/SEARCH:(\{[^\n]+\})/);
    if (searchMatch) {
      const searchParams = JSON.parse(searchMatch[1]);
      const reply = text.replace(/SEARCH:[^\n]+/, '').trim();
      return res.json({ reply: reply || 'Let me find flights for your group…', action: 'search_flights', searchParams });
    }

    return res.json({ reply: text });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ error: e.message });
  }
}
