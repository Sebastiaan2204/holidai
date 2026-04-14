export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { messages, tripContext } = await req.json();

    const systemPrompt = `You are holid.ai, a friendly and smart group travel planning assistant. 
You help groups of friends plan holidays together — finding when everyone is free, suggesting destinations, finding the cheapest flights and accommodation.

Current trip context:
- Number of people: ${tripContext.people || 'unknown'}
- Destination: ${tripContext.destination || 'not decided yet'}
- Transport preference: ${tripContext.transport || 'not specified'}
- Accommodation type: ${tripContext.accommodation || 'not specified'}
- Budget vibe: ${tripContext.budget || 'not specified'}
- Trip duration: ${tripContext.duration || 'not specified'}
- Knows destination: ${tripContext.knowsDest ? 'yes' : 'no'}

Your personality:
- Warm, conversational, and encouraging — like a well-travelled friend
- Concise — keep responses short and to the point
- Always practical — give real, actionable suggestions
- When suggesting destinations, always mention approximate flight time and price range from Amsterdam
- When asked about flights, always recommend searching on Skyscanner for the best prices
- When asked about accommodation, recommend Booking.com for hotels, Airbnb for apartments, Hostelworld for hostels
- Never make up specific prices — give realistic ranges and direct people to booking platforms
- Always factor in the group size and budget vibe when making suggestions

Important rules:
- Keep responses under 100 words unless the user asks for detail
- Never ask more than one question at a time
- Sound human, not like a chatbot
- If someone asks about a specific destination, give genuine local tips
- Always be enthusiastic about travel`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-5-20251001',
        max_tokens: 1024,
        system: systemPrompt,
        messages: messages
      })
    });

    if (!response.ok) {
      const error = await response.text();
      return new Response(JSON.stringify({ error: `API Error ${response.status}: ${error}` }), {
        status: response.status,
        headers: { 'Content-Type': 'application/json' }
      });
    }

    const data = await response.json();
    return new Response(JSON.stringify({ 
      reply: data.content[0].text 
    }), {
      status: 200,
      headers: { 
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*'
      }
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: err.message, stack: err.stack }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' }
    });
  }
}
