// Hugging Face playground: paste any model URL or id, Orbix finds what it does and runs it through the free serverless router.
const ID = /^[\w.-]{1,96}\/[\w.-]{1,96}$/;
export function parseModel(input) {
  let s = String(input || '').trim();
  try { const u = new URL(s); if (!/(^|\.)huggingface\.co$/.test(u.hostname)) throw 0; if (/^\/(spaces|datasets)\//.test(u.pathname)) throw new Error('That is a Space or dataset link. Paste a model page link, like huggingface.co/org/model.'); s = u.pathname.replace(/^\/+|\/+$/g, '').split('/').slice(0, 2).join('/'); } catch (e) { if (e.message && e.message !== '0' && !(e instanceof TypeError)) throw e; }
  s = s.replace(/^\/+/, '');
  if (!ID.test(s)) throw new Error('Paste a Hugging Face model link or an id like org/model-name.');
  return s;
}
const H = () => ({ authorization: `Bearer ${process.env.HF_TOKEN}`, 'content-type': 'application/json' });
export async function modelInfo(id) {
  const r = await fetch(`https://huggingface.co/api/models/${id}`, { signal: AbortSignal.timeout(15000) });
  if (r.status === 404) throw new Error('No public model with that name.');
  if (!r.ok) throw new Error(`Hugging Face could not describe this model (HTTP ${r.status}).`);
  const j = await r.json();
  return { id: j.id || id, task: j.pipeline_tag || '', downloads: j.downloads || 0, likes: j.likes || 0, gated: !!j.gated, providers: Object.keys(j.inferenceProviderMapping || {}), live: j.inference === 'warm' || Object.keys(j.inferenceProviderMapping || {}).length > 0 };
}
const TEXT_GEN = new Set(['text-generation', 'image-text-to-text', 'conversational']);
export async function runModel(id, task, input) {
  const text = String(input || '').trim().slice(0, 2000); if (!text) throw new Error('Type something first.');
  if (!process.env.HF_TOKEN) throw new Error('The playground is not configured.');
  if (TEXT_GEN.has(task)) {
    const r = await fetch('https://router.huggingface.co/v1/chat/completions', { method: 'POST', headers: H(), body: JSON.stringify({ model: id, messages: [{ role: 'user', content: text }], max_tokens: 400 }), signal: AbortSignal.timeout(60000) });
    const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(errText(j, r.status));
    return { kind: 'text', text: String(j.choices?.[0]?.message?.content || '').slice(0, 4000) };
  }
  const body = task === 'question-answering' ? null : { inputs: text };
  if (!body) throw new Error('Question answering needs a context passage, which this simple box does not support yet.');
  const r = await fetch(`https://router.huggingface.co/hf-inference/models/${id}`, { method: 'POST', headers: H(), body: JSON.stringify(body), signal: AbortSignal.timeout(90000) });
  const ct = r.headers.get('content-type') || '';
  if (/^image\//.test(ct)) { const buf = Buffer.from(await r.arrayBuffer()); if (buf.length > 3e6) throw new Error('The picture was too large to show.'); return { kind: 'image', url: `data:${ct};base64,${buf.toString('base64')}` }; }
  const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(errText(j, r.status));
  return { kind: 'json', text: JSON.stringify(j, null, 2).slice(0, 4000) };
}
const errText = (j, status) => { const m = typeof j?.error === 'string' ? j.error : j?.error?.message || j?.message || ''; if (status === 402 || /credit|quota|limit/i.test(m)) return 'The free Hugging Face allowance for this month is used up.'; if (status === 404 || /not supported|not found|no provider/i.test(m)) return 'This model is not available on the free serverless service. Try another model (small popular ones usually work).'; return `The model service said: ${String(m || 'HTTP ' + status).slice(0, 200)}`; };
