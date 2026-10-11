// External media store: generated video bytes live in a private Hugging Face dataset,
// Mongo keeps only metadata. If HF is unreachable, reads fall back to Mongo data (transition window).
import crypto from 'crypto';
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
  const cr = await fetch(`${API}/api/repos/create`, { method: 'POST', headers: { ...H(), 'content-type': 'application/json' }, body: JSON.stringify({ name, type: 'dataset', private: true }), signal: AbortSignal.timeout(15000) });
  if (!cr.ok && cr.status !== 409) throw new Error(`HF dataset create failed (HTTP ${cr.status}): ${(await cr.text()).slice(0, 120)}`);
  repoId = `${me.name}/${name}`;
  return repoId;
}
async function lfsUpload(id, key, buf) {
  const oid = crypto.createHash('sha256').update(buf).digest('hex');
  const br = await fetch(`${API}/datasets/${id}.git/info/lfs/objects/batch`, { method: 'POST', headers: { ...H(), 'content-type': 'application/json', accept: 'application/vnd.git-lfs+json' }, body: JSON.stringify({ operation: 'upload', transfers: ['basic'], objects: [{ oid, size: buf.length }] }), signal: AbortSignal.timeout(60000) });
  if (!br.ok) throw new Error(`HF LFS batch failed (HTTP ${br.status}): ${(await br.text()).slice(0, 120)}`);
  const bj = await br.json();
  const act = bj.objects?.[0]?.actions;
  if (act?.upload) {
    const up = await fetch(act.upload.href, { method: 'PUT', headers: { ...(act.upload.header || {}), 'content-type': 'application/octet-stream' }, body: buf, signal: AbortSignal.timeout(300000) });
    if (!up.ok) throw new Error(`HF LFS upload failed (HTTP ${up.status})`);
    if (act.verify) await fetch(act.verify.href, { method: 'POST', headers: { ...(act.verify.header || {}), 'content-type': 'application/json' }, body: JSON.stringify({ oid, size: buf.length }), signal: AbortSignal.timeout(30000) });
  }
  return { oid, size: buf.length };
}
async function commit(id, ops, summary) {
  const body = JSON.stringify({ key: 'header', value: { summary } }) + '\n' + ops.map(o => JSON.stringify(o)).join('\n') + '\n';
  const r = await fetch(`${API}/api/datasets/${id}/commit/main`, { method: 'POST', headers: { ...H(), 'content-type': 'application/x-ndjson' }, body, signal: AbortSignal.timeout(60000) });
  if (!r.ok) throw new Error(`HF commit failed (HTTP ${r.status}): ${(await r.text()).slice(0, 160)}`);
}
const GITATTR = ['*.mp4','*.webm','*.mov','*.png','*.jpg','*.jpeg','*.webp','*.gif','*.mp3','*.wav','*.ogg','*.flac'].map(e=>`${e} filter=lfs diff=lfs merge=lfs -text`).join('\n')+'\n';
export async function putBlob(key, buf) {
  const id = await repo();
  const ops = [{ key: 'file', value: { path: '.gitattributes', content: Buffer.from(GITATTR).toString('base64'), encoding: 'base64' } }];
  if (buf.length > 5e6) {
    const { oid, size } = await lfsUpload(id, key, buf);
    ops.push({ key: 'lfsFile', value: { path: key, algo: 'sha256', oid, size } });
  } else {
    ops.push({ key: 'file', value: { path: key, content: buf.toString('base64'), encoding: 'base64' } });
  }
  await commit(id, ops, `add ${key}`);
}
export async function getBlob(key) {
  const id = await repo();
  const r = await fetch(`${API}/datasets/${id}/resolve/main/${key}`, { headers: H(), signal: AbortSignal.timeout(180000) });
  if (r.status === 404) return null;
  if (!r.ok) throw new Error(`HF download failed (HTTP ${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}
export async function delBlob(key) {
  try {
    const id = await repo();
    await commit(id, [{ key: 'deletedFile', value: { path: key } }], `del ${key}`);
  } catch (e) { console.error('HF delete failed', key, String(e).slice(0, 120)); }
}
