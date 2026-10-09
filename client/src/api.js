const KEY = 'orbix_token';
export const token = () => localStorage.getItem(KEY);
export const setToken = t => (t ? localStorage.setItem(KEY, t) : localStorage.removeItem(KEY));
export async function api(path, { method = 'GET', body } = {}) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json', ...(token() ? { authorization: `Bearer ${token()}` } : {}) }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (r.status === 401 && token()) { setToken(null); window.dispatchEvent(new Event('orbix-logout')); }
  if (!r.ok) throw new Error(j.error || 'Request failed');
  return j;
}
// reads a text/event-stream from fetch (so the auth header can be sent)
export async function stream(path, { method = 'GET', body, onEvent, signal }) {
  const r = await fetch(path, { method, headers: { 'content-type': 'application/json', authorization: `Bearer ${token()}` }, body: body ? JSON.stringify(body) : undefined, signal });
  if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); throw new Error(j.error || 'Request failed'); }
  const reader = r.body.getReader(); const dec = new TextDecoder(); let buf = '';
  for (;;) {
    const { done, value } = await reader.read(); if (done) break;
    buf += dec.decode(value, { stream: true });
    let i; while ((i = buf.indexOf('\n\n')) >= 0) { const chunk = buf.slice(0, i); buf = buf.slice(i + 2); const line = chunk.split('\n').find(l => l.startsWith('data: ')); if (line) { try { onEvent(JSON.parse(line.slice(6))); } catch {} } }
  }
}
