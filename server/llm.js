const URL_ = 'https://api.groq.com/openai/v1/chat/completions';
export const MODEL = process.env.GROQ_MODEL || 'openai/gpt-oss-120b';
// Groq's free tier allows ~8000 tokens per request (input + max output). Keep every request under budget.
const OUT_TOKENS = 2400;
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
  return tools.map((t, i) => { const w = words(`${t.function.name.replace(/_/g, ' ')} ${t.function.description}`); let s = t.function.name.startsWith('orbix__') ? 100 : 0; for (const x of q) if (w.has(x)) s++; return { t, s, i }; }).sort((a, b) => b.s - a.s || a.i - b.i);
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
  export const CHAIN = [MODEL, 'openai/gpt-oss-20b', 'meta-llama/llama-4-scout-17b-16e-instruct'];
  const MODELS = CHAIN; let lastErr = '';
  for (let attempt = 0; attempt < 6; attempt++) {
    const f = fit(messages, tools, budget);
    const body = { model: MODELS[Math.min(MODELS.length - 1, Math.floor(attempt / 2))], messages: f.messages, temperature: 0.3, max_tokens: OUT_TOKENS };
    if (/gpt-oss/.test(body.model)) body.reasoning_effort = 'low';
    if (f.tools?.length) { body.tools = f.tools; body.tool_choice = 'auto'; }
    const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
    const j = await r.json().catch(() => ({}));
    const em = String(j?.error?.message || '');
    if (r.status === 413 || /too large|reduce your m/i.test(em)) { budget = Math.floor(budget * 0.65); continue; } // shrink and retry instead of failing
    if (r.status === 429 || r.status >= 500) { lastErr = `${r.status} ${em}`.slice(0, 160); const wait = Math.min(8000, 1500 * (attempt + 1)); await new Promise(res => setTimeout(res, wait)); continue; }
    if (!r.ok) throw new Error(em ? em.slice(0, 200) : `Model error ${r.status}`);
    const m = j.choices[0].message; Object.defineProperty(m, '_model', { value: body.model }); return m;
  }
  console.error('llm busy', lastErr); throw new Error('The AI model is busy right now. Try again in a moment.' + (process.env.LLM_DEBUG ? ' [' + lastErr + ']' : ''));
}

// Photo and video understanding through Groq's free vision models (images only, small request).
const VISION = [process.env.GROQ_VISION_MODEL, 'qwen/qwen3.8-27b', 'meta-llama/llama-4-scout-17b-16e-instruct', 'meta-llama/llama-4-maverick-17b-128e-instruct'].filter(Boolean);
export async function visionDescribe(images, ask, { frames = false } = {}) {
  const key = process.env.GROQ_API_KEY; if (!key) throw new Error('The AI model is not configured on this server.');
  const imgs = (images || []).filter(u => /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(u)).slice(0, 4); if (!imgs.length) throw new Error('No readable picture was sent.');
  const instr = `${frames ? 'These are frames from one short video, in order. ' : ''}Describe what you see in detail (subjects, setting, colors, style, any motion or story). Copy any visible text exactly. Then answer the user's question if there is one.${ask ? ` User question: ${String(ask).slice(0, 300)}` : ''}`;
  const errs = [];
  for (const model of VISION) {
    const r = await fetch(URL_, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` }, body: JSON.stringify({ model, temperature: 0.2, max_tokens: 1400, messages: [{ role: 'user', content: [{ type: 'text', text: instr }, ...imgs.map(u => ({ type: 'image_url', image_url: { url: u } }))] }] }), signal: AbortSignal.timeout(60000) }).catch(e => ({ ok: false, status: 0, json: async () => ({ error: { message: e.message } }) }));
    const j = await r.json().catch(() => ({}));
    if (r.ok && j.choices?.[0]?.message?.content) return String(j.choices[0].message.content).replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 2500);
    errs.push(`${model.split('/').pop()}: ${String(j?.error?.message || r.status).slice(0, 330)}`);
  }
  throw new Error(`Picture understanding is not available right now (${errs.join(' | ')}).`);
}

// Cross-chat memory: a short rolling summary per user, updated in the background and injected into new chats.
const SECRET = /(sk-[\w-]{12,}|gsk_[\w]{10,}|hf_[\w]{10,}|ghp_[\w]{10,}|eyJ[\w-]{20,}|\b\d{12,19}\b|password\s*[:=]\s*\S+)/gi;
export async function updateMemory(old, userText, answer) {
  const m = await chatCompletion({ tools: [], messages: [{ role: 'system', content: 'You maintain a SHORT memory about a user of a chat app, to help in future chats. Input: current memory and the latest exchange. Output ONLY the updated memory as up to 8 short bullet lines (max 650 characters total): stable facts about the user (name, language, job, projects, goals), their preferences, and ongoing topics. Drop trivia and one-off questions. NEVER store passwords, keys, tokens, card or ID numbers, or health or political details. If nothing new is worth keeping, return the current memory unchanged.' }, { role: 'user', content: `CURRENT MEMORY:\n${old || '(empty)'}\n\nLATEST EXCHANGE:\nUser: ${String(userText).slice(0, 600)}\nAssistant: ${String(answer).slice(0, 500)}` }] });
  return String(m.content || '').replace(SECRET, '[hidden]').trim().slice(0, 700);
}
