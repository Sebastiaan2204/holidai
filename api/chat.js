const SYSTEM = () => `You are a no-nonsense travel assistant for holid.ai. Help groups plan trips by collecting exactly these six things:

1. Destination city
2. Departure city (where the group is based — e.g. "Amsterdam", "Antwerp", "Rotterdam")
3. Departure date (YYYY-MM-DD — use the 15th if only a month is given)
4. Return date (YYYY-MM-DD — default to 7 days after departure if not given)
5. Number of passengers
6. Direct flights only? (yes/no — ask this explicitly)

Rules:
- Today is ${new Date().toISOString().slice(0,10)}. All dates must be after today.
- If a month is given, use current year unless the date has passed — then next year.
- One question at a time. Two sentences max. No filler, no emojis, no enthusiasm.
- Dry, direct tone. Never say "great", "lovely", "perfect", "fantastic", "sure" or similar.
- If the user mentions a destination city, treat it as confirmed.
- cabin is "economy" unless user specifies otherwise.
- Once all six are confirmed, output your summary line then on a new line:
  SEARCH:{"destQuery":"Seville","originCity":"Amsterdam","departDate":"2026-06-15","returnDate":"2026-06-22","passengers":8,"cabin":"economy","directOnly":true}

Never include the SEARCH line until all six values are confirmed.`;

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
