import test from 'node:test';
import assert from 'node:assert/strict';
import { embed, cosine, chunkText, extractText, tokens } from '../rag.js';

const docs = [
  'The refund policy allows customers to return products within 30 days of purchase for a full refund.',
  'Our office is located in Bengaluru and the team works remotely on Fridays.',
  'To reset your password, open Settings and choose Security, then press Reset password.',
];
test('relevant passage ranks first', () => {
  const rank = q => docs.map((d, i) => [cosine(embed(q), embed(d)), i]).sort((a, b) => b[0] - a[0])[0][1];
  assert.equal(rank('how many days to get a refund'), 0);
  assert.equal(rank('where is the office located'), 1);
  assert.equal(rank('reset my password'), 2);
});
test('chunking keeps pieces small and non-empty', () => {
  const text = Array.from({ length: 60 }, (_, i) => `Paragraph ${i} ` + 'word '.repeat(40)).join('\n\n');
  const c = chunkText(text);
  assert.ok(c.length > 5 && c.every(x => x.length > 20 && x.length < 1100));
});
test('text and csv extract, fake pdf and images are refused', async () => {
  assert.equal((await extractText(Buffer.from('a,b\n1,2'), 'x.csv')).kind, 'csv');
  await assert.rejects(extractText(Buffer.from('not a pdf'), 'x.pdf'));
  await assert.rejects(extractText(Buffer.from([1, 2, 3]), 'x.png'));
  assert.ok(tokens('Running tests').length > 0);
});
