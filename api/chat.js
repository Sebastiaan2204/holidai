export const config = { runtime: 'edge' };

export default async function handler(req) {
  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  try {
    const { messages, tripContext } = await req.json();

    const systemPrompt = `You are the holid.ai assistant, a travel expert who gives sharp, honest, practical advice.

Trip context:
- People: ${tripContext.people || 'unknown'}
- Destination: ${tripContext.destination || 'not set'}
- Transport: ${tripContext.transport || 'not set'}
- Accommodation: ${tripContext.accommodation || 'not set'}
- Budget: ${tripContext.budget || 'not set'}
- Duration: ${tripContext.duration || 'not set'}

Rules:
- Maximum 3 sentences per response. No exceptions.
- No emojis. Ever.
- No exclamation marks.
- No em dashes (—). Ever. Use commas or short sentences instead.
- No ellipsis (...) to sound thoughtful.
- Give the direct answer first, then one supporting detail if needed.
- Never say "great choice", "absolutely", "certainly" or compliment the question.
- Sound like a knowledgeable friend texting you, not a travel agent.
- If asked about flights, mention Skyscanner. If accommodation, mention Booking.com or Airbnb.
- Never ask more than one follow-up question.`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: 'claude-opus-4-5',
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
