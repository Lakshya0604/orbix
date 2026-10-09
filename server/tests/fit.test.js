import test from 'node:test';
import assert from 'node:assert/strict';
import { fit, estTokens } from '../llm.js';

const tool = i => ({ type: 'function', function: { name: `gh__t${i}`, description: 'List repositories for the user. '.repeat(8), parameters: { type: 'object', properties: Object.fromEntries(Array.from({ length: 10 }, (_, k) => [`p${k}`, { type: 'string', description: 'x'.repeat(200) }])) } } });

test('huge toolbox is shrunk under the token budget and keeps the relevant tool', () => {
  const defs = Array.from({ length: 48 }, (_, i) => tool(i));
  defs[9].function.name = 'gh__list_repos'; defs[9].function.description = 'List repositories owned by me';
  const msgs = [{ role: 'system', content: 's'.repeat(1500) }, { role: 'user', content: 'Show my all repository' }];
  assert.ok(estTokens(msgs) + estTokens(defs) > 20000);
  const f = fit(msgs, defs);
  assert.ok(estTokens(f.messages) + estTokens(f.tools) <= 5600);
  assert.ok(f.tools.some(t => t.function.name === 'gh__list_repos'));
});
