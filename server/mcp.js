import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';
import { assertPublicUrl } from './ssrf.js';
import { decrypt } from './crypto.js';

const CONNECT_TIMEOUT = 30000;
const conns = new Map(); // `${userId}:${serverId}` -> {client, tools, state, latencyMs, error, checkedAt, transport}
const listeners = new Map(); // userId -> Set(fn)

const withTimeout = (p, ms, msg) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(msg)), ms))]);
const k = (u, s) => `${u}:${s}`;

export function onStatus(userId, fn) {
  if (!listeners.has(userId)) listeners.set(userId, new Set());
  listeners.get(userId).add(fn);
  return () => listeners.get(userId)?.delete(fn);
}
function emit(userId, serverId) {
  const c = conns.get(k(userId, serverId));
  const payload = publicStatus(serverId, c);
  listeners.get(String(userId))?.forEach(fn => fn(payload));
}
export function publicStatus(serverId, c) {
  return {
    id: String(serverId),
    state: c?.state || 'disconnected',
    toolCount: c?.tools?.length || 0,
    latencyMs: c?.latencyMs ?? null,
    error: c?.error || null,
    checkedAt: c?.checkedAt || null,
  };
}
export const statusOf = (userId, serverId) => publicStatus(serverId, conns.get(k(userId, serverId)));

function headersFor(doc) {
  const h = {};
  if (doc.authSecret) {
    const v = decrypt(doc.authSecret);
    const name = doc.authHeader || 'Authorization';
    h[name] = name.toLowerCase() === 'authorization' && !/^(bearer|basic) /i.test(v) ? `Bearer ${v}` : v;
  }
  return h;
}

async function open(doc) {
  const url = await assertPublicUrl(doc.url);
  const headers = headersFor(doc);
  const tries = doc.transport === 'sse' ? ['sse'] : doc.transport === 'http' ? ['http'] : ['http', 'sse'];
  let lastErr;
  for (const t of tries) {
    const client = new Client({ name: 'orbix', version: '1.0.0' }, { capabilities: {} });
    try {
      const transport = t === 'http'
        ? new StreamableHTTPClientTransport(url, { requestInit: { headers } })
        : new SSEClientTransport(url, { requestInit: { headers }, eventSourceInit: { fetch: (u, i) => fetch(u, { ...i, headers: { ...(i?.headers || {}), ...headers } }) } });
      await withTimeout(client.connect(transport), CONNECT_TIMEOUT, 'Connection timed out');
      return { client, transportName: t };
    } catch (e) { lastErr = e; try { await client.close(); } catch {} }
  }
  throw lastErr || new Error('Could not connect');
}

export async function connect(userId, doc) {
  userId = String(userId);
  const key = k(userId, doc._id);
  await disconnect(userId, doc._id, true);
  conns.set(key, { state: 'connecting', tools: [], checkedAt: Date.now() });
  emit(userId, doc._id);
  const t0 = Date.now();
  try {
    const { client, transportName } = await open(doc);
    const { tools } = await withTimeout(client.listTools(), 20000, 'tools/list timed out');
    const rec = { client, tools, state: 'connected', latencyMs: Date.now() - t0, error: null, checkedAt: Date.now(), transport: transportName, slug: doc.slug };
    client.onclose = () => { const c = conns.get(key); if (c && c.client === client) { c.state = 'error'; c.error = 'Connection closed by the server'; emit(userId, doc._id); } };
    conns.set(key, rec);
  } catch (e) {
    conns.set(key, { state: 'error', tools: [], error: humanError(e), checkedAt: Date.now() });
  }
  emit(userId, doc._id);
  return statusOf(userId, doc._id);
}

export function humanError(e) {
  const m = String(e?.message || e);
  if (/401|403|unauthor|invalid_token|authentication/i.test(m)) return 'The server rejected the token (401). Re-copy it with no spaces, check it has not expired, then remove this server and add it again.';
  if (/ENOTFOUND|getaddrinfo/i.test(m)) return 'The server address could not be found.';
  if (/timed out/i.test(m)) return 'The server took too long to answer.';
  return m.replace(/\s+/g, ' ').slice(0, 160);
}

export async function disconnect(userId, serverId, silent = false) {
  const key = k(userId, serverId);
  const c = conns.get(key);
  if (c?.client) { c.client.onclose = undefined; try { await c.client.close(); } catch {} }
  conns.delete(key);
  if (!silent) emit(String(userId), serverId);
}

export async function ping(userId, serverId) {
  const c = conns.get(k(userId, serverId));
  if (!c || c.state !== 'connected') return;
  const t0 = Date.now();
  try { await withTimeout(c.client.ping(), 10000, 'ping timed out'); c.latencyMs = Date.now() - t0; c.checkedAt = Date.now(); }
  catch (e) { c.state = 'error'; c.error = humanError(e); }
  emit(String(userId), serverId);
}
export function pingAll() { for (const key of conns.keys()) { const [u, s] = key.split(':'); ping(u, s); } }

export const toolsOf = (userId, serverId) => conns.get(k(userId, serverId))?.tools || [];
export const isConnected = (userId, serverId) => conns.get(k(userId, serverId))?.state === 'connected';

export async function callTool(userId, serverId, name, args) {
  const c = conns.get(k(userId, serverId));
  if (!c || c.state !== 'connected') throw new Error('Server is not connected');
  return c.client.callTool({ name, arguments: args || {} }, undefined, { timeout: 120000 });
}

// One-off health probe for catalog entries (no user credentials). Cached for 10 minutes.
const probeCache = new Map();
export async function probe(entry, force = false) {
  const c = probeCache.get(entry.id);
  if (!force && c && Date.now() - c.checkedAt < 600000) return c;
  const t0 = Date.now(); let res;
  try {
    const { client } = await open({ url: entry.url, transport: entry.transport });
    const { tools } = await withTimeout(client.listTools(), 20000, 'tools/list timed out');
    try { await client.close(); } catch {}
    res = { id: entry.id, ok: true, toolCount: tools.length, latencyMs: Date.now() - t0, checkedAt: Date.now() };
  } catch (e) { res = { id: entry.id, ok: false, error: humanError(e), latencyMs: Date.now() - t0, checkedAt: Date.now() }; }
  probeCache.set(entry.id, res); return res;
}
