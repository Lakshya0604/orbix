const URL_ = 'https://api.groq.com/openai/v1/chat/completions';
export const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
// Groq's free tier allows ~8000 tokens per request (input + max output). Keep every request under budget.
const OUT_TOKENS = 1400;
const IN_BUDGET = Number(process.env.LLM_INPUT_BUDGET || 5600);
export const estTokens = o => Math.ceil(JSON.stringify(o).length / 3.3);

const words = s => new Set(String(s).toLowerCase().match(/[a-z0-9]{3,}/g) || []);
function slimSchema(n) { // drop long parameter descriptions and examples, keep names and types
  if (Array.isArray(n)) return n.map(slimSchema);
  if (!n || typeof n !== 'object') return n;
  const o = {};
  for (const [k, v] of Object.entries(n)) { if (k === 'description' && typeof v === 'string') { o[k] = v.slice(0, 60); continue; } if (['examples', 'example', 'default'].includes(k)) continue; o[k] = slimSchema(v); }
  return o;
}
function rankTools(tools, text) {
  const q = words(text);
  return tools.map((t, i) => { const w = words(`${t.function.name.replace(/_/g, ' ')} ${t.function.description}`); let s = 0; for (const x of q) if (w.has(x)) s++; return { t, s, i }; }).sort((a, b) => b.s - a.s || a.i - b.i);
}
export function fit(messages, tools, budget = IN_BUDGET) {
  let msgs = messages.map(m => ({ ...m })); let defs = tools || [];
  const total = () => estTokens(msgs) + estTokens(defs);
  if (total() <= budget) return { messages: msgs, tools: defs };
  // 1. slim tool schemas
  defs = defs.map(t => ({ ...t, function: { ...t.function, description: String(t.function.description).slice(0, 160), parameters: slimSchema(t.function.parameters) } }));
  // 2. shrink older tool outputs
  const lastUser = [...msgs].reverse().find(m => m.role === 'user')?.content || '';
  const shrinkTools = max => { msgs = msgs.map((m, i) => m.role === 'tool' && String(m.content).length > max ? { ...m, content: String(m.content).slice(0, max) + '\n[shortened]' } : m); };
  if (total() > budget) shrinkTools(2500);
  // 3. keep only the most relevant tools, as many as fit
  if (total() > budget && defs.length > 8) {
    const ranked = rankTools(defs, lastUser).map(x => x.t);
    let n = Math.min(ranked.length, 24);
    while (n > 6 && estTokens(msgs) + estTokens(ranked.slice(0, n)) > budget) n -= 2;
    defs = ranked.slice(0, n);
  }
  if (total() > budget) shrinkTools(1200);
  // 4. drop oldest chat history (keep system prompt, the newest turns and any pending tool exchange)
  while (total() > budget && msgs.length > 4) { const i = msgs.findIndex((m, k) => k > 0 && m.role === 'user' && k < msgs.length - 1); if (i < 1) break; msgs.splice(i, 1); while (msgs[i] && msgs[i].role !== 'user' && i < msgs.length - 1) msgs.splice(i, 1); }
  if (total() > budget) shrinkTools(600);
  if (total() > budget && defs.length > 4) defs = defs.slice(0, 4);
  return { messages: msgs, tools: defs };
}

export async function chatCompletion({ messages, tools }) {
  const key = process.env.GROQ_API_KEY;
  if (!key) throw new Error('The AI model is not configured on this server.');
  let budget = IN_BUDGET;
  for (let attempt = 0; attempt < 4; attempt++) {
    const f = fit(messages, tools, budget);
    const body = { model: MODEL, messages: f.messages, temperature: 0.3, max_tokens: OUT_TOKENS };
    if (f.tools?.length) { body.tools = f.tools; body.tool_choice = 'auto'; }
    const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(() => ({}));
    const em = String(j?.error?.message || '');
    if (r.status === 413 || /too large|reduce your m/i.test(em)) { budget = Math.floor(budget * 0.65); continue; } // shrink and retry instead of failing
    if (r.status === 429 || r.status >= 500) { const wait = Math.min(8000, 1500 * (attempt + 1)); await new Promise(res => setTimeout(res, wait)); continue; }
    if (!r.ok) throw new Error(em ? em.slice(0, 200) : `Model error ${r.status}`);
    return j.choices[0].message;
  }
  throw new Error('The AI model is busy right now. Try again in a moment.');
}
