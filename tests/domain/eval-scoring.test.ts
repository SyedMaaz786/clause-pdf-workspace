import { test } from 'node:test';
import assert from 'node:assert/strict';
// Plain-JS scoring module, shared with the live runner (tests/eval/run.mjs).
import { extractCitedPages, looksLikeRefusal, scoreItem, aggregate } from '../eval/score.mjs';

test('extractCitedPages reads the enforced [p. N] marker in any spacing/case', () => {
  assert.deepEqual(extractCitedPages('The fee is USD 48,000 [p. 2] and notice is 30 days [p.3].'), [2, 3]);
  assert.deepEqual(extractCitedPages('No citations here.'), []);
});

test('looksLikeRefusal matches the prompted decline, not a confident negative answer', () => {
  assert.ok(looksLikeRefusal("I couldn't find that in this document."));
  assert.ok(looksLikeRefusal('The document does not mention a non-compete clause.'));
  assert.ok(looksLikeRefusal('There is no reference to subscription pricing in this document.'));
  assert.equal(looksLikeRefusal('The agreement may not be terminated without 30 days notice. [p. 3]'), false);
});

test('a grounded answer with the right page and value passes every check', () => {
  const item = { expect: { mustCite: [3], mustInclude: ['30 days'] } };
  const result = { answer: 'Either party may terminate with **30 days** written notice. [p. 3]', sources: [{ page: 3 }], citationWarning: false };
  const score = scoreItem(item, result);
  assert.equal(score.ok, true);
  assert.equal(score.passed, score.total);
});

test('wrong page, missing value, and unverifiable citations each fail their check', () => {
  const item = { expect: { mustCite: [3], mustInclude: ['30 days'], mustNotInclude: ['60 days'] } };
  const score = scoreItem(item, { answer: 'Termination needs 60 days notice. [p. 2]', sources: [{ page: 2 }], citationWarning: true });
  const failed = score.checks.filter((c: { pass: boolean }) => !c.pass).map((c: { label: string }) => c.label);
  assert.ok(failed.includes('cites p.3'));
  assert.ok(failed.includes('no unverifiable citation'));
  assert.ok(failed.includes('contains "30 days"'));
  assert.ok(failed.includes('omits "60 days"'));
});

test('refusal items require a decline and reject fabricated citations', () => {
  const item = { expect: { type: 'refusal' } };
  assert.equal(scoreItem(item, { answer: "I couldn't find that in this document.", sources: [] }).ok, true);
  assert.equal(scoreItem(item, { answer: 'It is sunny. [p. 1]', sources: [{ page: 1 }] }).ok, false);
});

test('aggregate separates grounding from honesty and computes headline rates', () => {
  const items = [
    { expect: { mustCite: [1], mustInclude: ['a'] } },
    { expect: { mustCite: [2], mustInclude: ['b'] } },
    { expect: { type: 'refusal' } },
  ];
  const scores = [
    scoreItem(items[0], { answer: 'a [p. 1]', sources: [{ page: 1 }] }),
    scoreItem(items[1], { answer: 'wrong [p. 1]', sources: [{ page: 1 }] }),
    scoreItem(items[2], { answer: 'The document does not mention that.', sources: [] }),
  ];
  const a = aggregate(items, scores);
  assert.equal(a.groundedItems, 2);
  assert.equal(a.groundedPass, 1);
  assert.equal(a.refusalItems, 1);
  assert.equal(a.refusalPass, 1);
  assert.equal(a.groundingRate, 0.5);
  assert.equal(a.honestyRate, 1);
});
