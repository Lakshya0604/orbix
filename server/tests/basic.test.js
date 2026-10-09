import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { encrypt, decrypt } from '../crypto.js';
import { assertPublicUrl } from '../ssrf.js';
import { mediaIn } from '../agent.js';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret';
test('encrypt round trip', () => { const e = encrypt('sk-abc'); assert.notEqual(e, 'sk-abc'); assert.equal(decrypt(e), 'sk-abc'); });
test('ssrf blocks private targets', async () => {
  for (const u of ['http://example.com', 'https://localhost/x', 'https://127.0.0.1/', 'https://169.254.169.254/', 'https://10.0.0.5/'])
    await assert.rejects(() => assertPublicUrl(u), u);
});
test('media links are detected', () => { assert.deepEqual(mediaIn('see https://a.com/x.mp4 and https://b.com/p.png.'), ['https://a.com/x.mp4', 'https://b.com/p.png']); });
test('catalog only holds verified entries', () => {
  const c = JSON.parse(fs.readFileSync(new URL('../../catalog/servers.json', import.meta.url)));
  assert.ok(c.servers.length > 0);
  for (const s of c.servers) { assert.equal(s.status, 'verified'); assert.ok(s.url.startsWith('https://')); assert.ok(['none', 'key'].includes(s.auth)); }
});
import { cleanSchema } from '../agent.js';
test('schema refs are inlined for Groq', () => {
  const o = cleanSchema({ type: 'object', properties: { a: { $ref: '#/$defs/F' } }, $defs: { F: { type: 'object', properties: { x: { type: 'string' } } } } });
  assert.equal(o.properties.a.properties.x.type, 'string'); assert.ok(!JSON.stringify(o).includes('$ref'));
});
