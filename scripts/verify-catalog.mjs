// Connects to every candidate with the real MCP client and only keeps the ones that pass.
// Usage: node scripts/verify-catalog.mjs [candidates.json]
// Feed it new free servers (from a daily digest) by adding entries to catalog/candidates.json.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const dir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../catalog');
const candFile = process.argv[2] || path.join(dir, 'candidates.json');
const outFile = path.join(dir, 'servers.json');
const cands = JSON.parse(fs.readFileSync(candFile, 'utf8')).candidates;
const prev = fs.existsSync(outFile) ? JSON.parse(fs.readFileSync(outFile, 'utf8')) : { servers: [], rejected: [] };
const timeout = (p, ms, m) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(new Error(m)), ms))]);

async function test(c) {
  let lastErr;
  for (const T of c.transport === 'sse' ? ['sse'] : ['http', 'sse']) {
    const client = new Client({ name: 'orbix-verify', version: '1' });
    try {
      const u = new URL(c.url);
      await timeout(client.connect(T === 'http' ? new StreamableHTTPClientTransport(u) : new SSEClientTransport(u)), 45000, 'connect timeout');
      const { tools } = await timeout(client.listTools(), 20000, 'tools/list timeout');
      if (!tools.length) throw new Error('server exposes no tools');
      let smoke = 'skipped';
      if (c.smoke) {
        if (!tools.some(t => t.name === c.smoke.tool)) throw new Error(`tool ${c.smoke.tool} missing`);
        const r = await client.callTool({ name: c.smoke.tool, arguments: c.smoke.args }, undefined, { timeout: c.smoke.timeoutMs || 60000 });
        if (r.isError) throw new Error('smoke call returned an error');
        smoke = 'passed';
      }
      await client.close();
      return { ok: true, transport: T, toolCount: tools.length, tools: tools.slice(0, 8).map(t => t.name), smoke };
    } catch (e) { lastErr = e; try { await client.close(); } catch {} }
  }
  return { ok: false, error: String(lastErr?.message || lastErr).slice(0, 160) };
}

const servers = new Map(prev.servers.map(s => [s.id, s]));
const rejected = new Map((prev.rejected || []).map(s => [s.id, s]));
for (const c of cands) {
  process.stdout.write(`${c.id} ... `);
  const r = await test(c);
  const day = new Date().toISOString().slice(0, 10);
  if (r.ok) {
    const { smoke: _s, ...rest } = c;
    servers.set(c.id, { ...rest, transport: r.transport, toolCount: r.toolCount, sampleTools: r.tools, smoke: r.smoke, testedAt: day, status: 'verified' });
    rejected.delete(c.id); console.log('verified', r.toolCount, 'tools, smoke', r.smoke);
  } else {
    servers.delete(c.id); // a server that stops passing leaves the catalog
    rejected.set(c.id, { id: c.id, name: c.name, url: c.url, error: r.error, testedAt: day });
    console.log('REJECTED:', r.error);
  }
}
fs.writeFileSync(outFile, JSON.stringify({ updatedAt: new Date().toISOString(), servers: [...servers.values()], rejected: [...rejected.values()] }, null, 2) + '\n');
console.log(`catalog: ${servers.size} verified, ${rejected.size} rejected`);
