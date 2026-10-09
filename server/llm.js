const URL_ = 'https://api.groq.com/openai/v1/chat/completions';
export const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
export async function chatCompletion({ messages, tools }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('The AI model is not configured on this server.');
  const body = { model: MODEL, messages, temperature: 0.3, max_tokens: 2500 };
  if (tools?.length) { body.tools = tools; body.tool_choice = 'auto'; }
  for (let attempt = 0; attempt < 3; attempt++) {
    const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    if (r.status === 429 || r.status >= 500) { await new Promise(res => setTimeout(res, 1500 * (attempt + 1))); continue; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j?.error?.message?.slice(0, 200) || `Model error ${r.status}`);
    return j.choices[0].message;
  }
  throw new Error('The AI model is busy right now. Try again in a moment.');
}
