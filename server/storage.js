// External media store: generated video bytes live in a private Hugging Face dataset,
// Mongo keeps only metadata. If HF is unreachable, reads fall back to Mongo data (transition window).
const API = 'https://huggingface.co';
let repoId = null;
const H = () => ({ authorization: `Bearer ${process.env.HF_TOKEN}` });
async function repo() {
  if (repoId) return repoId;
  if (!process.env.HF_TOKEN) throw new Error('HF_TOKEN is not set.');
  const w = await fetch(`${API}/api/whoami-v2`, { headers: H(), signal: AbortSignal.timeout(15000) });
  if (!w.ok) throw new Error(`HF whoami failed (HTTP ${w.status}).`);
  const me = await w.json();
  const name = (process.env.HF_MEDIA_REPO || 'orbix-media').replace(/[^\w.-]/g, '-').slice(0, 90);
  const cr = await fetch(`${API}/api/datasets`, { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify({ name, private: true }), signal: AbortSignal.timeout(15000) });
  if (!cr.ok && cr.status !== 409) throw new Error(`HF dataset create failed (HTTP ${cr.status}): ${(await cr.text()).slice(0, 120)}`);
  repoId = `${me.name}/${name}`;
  return repoId;
}
export async function putBlob(key, buf) {
  const id = await repo();
  const r = await fetch(`${API}/api/datasets/${id}/upload/main/${key}`, { method: 'POST', headers: { ...H(), 'content-type': 'application/octet-stream' }, body: buf, signal: AbortSignal.timeout(180000) });
  if (!r.ok) throw new Error(`HF upload failed (HTTP ${r.status}): ${(await r.text()).slice(0, 120)}`);
}
export async function getBlob(key) {
  const id = await repo();
  const r = await fetch(`${API}/datasets/${id}/resolve/main/${key}`, { headers: H(), signal: AbortSignal.timeout(180000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HF download failed (HTTP ${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}
export async function delBlob(key) {
  const id = await repo();
  const r = await fetch(`${API}/api/datasets/${id}/tree/main/${key}`, { method: 'DELETE', headers: H(), signal: AbortSignal.timeout(60000) });
  if (!r.ok && r.status !== 404) console.error('HF delete failed', r.status, key);
}
