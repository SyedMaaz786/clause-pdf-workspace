import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chunkPages, cosine, retrieve, segments } from '../../lib/retrieval';

test('chunks preserve original page numbers even when a page is blank', () => {
  const chunks = chunkPages(['First page.', '', 'Termination requires 30 days notice.']);
  assert.deepEqual(chunks.map(c => c.page), [1, 3]);
});
test('long pages are covered completely with bounded overlapping chunks', () => {
  const text = Array.from({ length: 6000 }, (_, i) => `word${i}`).join(' '), chunks = chunkPages([text]);
  assert.ok(chunks.length > 10);
  assert.ok(chunks.every(c => c.text.length <= 1800));
  assert.ok(chunks.at(-1)!.text.endsWith('word5999'));
  for (let i = 1; i < chunks.length; i++) assert.equal(chunks[i - 1].text.slice(-240), chunks[i].text.slice(0, 240));
});
test('retrieval finds relevant late pages and stays in budget', () => {
  const chunks = chunkPages(Array.from({ length: 100 }, (_, i) => i === 96 ? 'Termination requires thirty days written notice. Payment is due for completed work.' : `General administrative provision ${i}: project meetings occur every Monday.`));
  const retrieved = retrieve(chunks, 'What is the termination notice period?', [], 400);
  assert.ok(retrieved.some(c => c.page === 97));
  assert.ok(retrieved.reduce((n, c) => n + c.text.length, 0) <= 400);
});
test('follow-up retrieval retains relevant prior question terms', () => {
  const chunks = chunkPages(['Invoices are due within fifteen days. Payment is in USD.', 'The liability cap excludes confidentiality breaches.']);
  assert.equal(retrieve(chunks, 'Are there exceptions?', ['What is the liability cap?'], 75)[0].page, 2);
});
test('summary segmentation retains the last page of a long document', () => {
  const chunks = chunkPages(Array.from({ length: 150 }, (_, i) => `Page ${i + 1} ` + 'material information '.repeat(150)));
  const parts = segments(chunks);
  assert.ok(parts.every(s => s.length <= 22000));
  assert.ok(parts.at(-1)!.includes('[Page 150]'));
});
test('cosine similarity is bounded and handles incompatible embeddings', () => {
  assert.equal(cosine([1, 0], [1, 0]), 1); assert.equal(cosine([1, 0], [0, 1]), 0);
  assert.equal(cosine([], []), 0); assert.equal(cosine([1, 0], [1]), 0);
});
