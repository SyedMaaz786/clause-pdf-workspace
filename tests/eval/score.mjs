// Scoring for the AI answer-quality eval. Pure and dependency-free so it can be
// unit-tested on its own (tests/domain/eval-scoring.test.ts) and reused by run.mjs.

/** Page numbers the answer cites via the enforced `[p. N]` marker. */
export const extractCitedPages = (text) => [...String(text).matchAll(/\[p\.\s*(\d+)\]/gi)].map(m => Number(m[1]));

/** True when the model declines because the document is silent, not when it answers with a "not". */
export function looksLikeRefusal(text) {
  const t = String(text).toLowerCase();
  return /(could ?n'?t|can ?not|can'?t|was unable to|am unable to|do(?:es)? not appear to|don'?t) (find|locate|determine|see|have)/.test(t)
    || /not (?:explicitly )?(?:stated|mentioned|specified|covered|included|found|addressed|defined|provided|discussed) (?:in|within|by|anywhere in) (?:this|the) document/.test(t)
    || /(?:this|the) document (?:does not|doesn'?t|did not) (?:say|state|mention|contain|specify|address|include|cover|define|provide|discuss)/.test(t)
    || /no (?:mention|reference|information|provision|clause|section|detail|indication)s? (?:of|about|regarding|on|to|for)/.test(t)
    || /not (?:something|a topic|a subject|covered|part of what)/.test(t);
}

/** Score one dataset item against the model's final answer. */
export function scoreItem(item, result) {
  const answer = result.answer || '', lc = answer.toLowerCase();
  const explicit = extractCitedPages(answer);
  const cited = new Set([...explicit, ...(result.sources || []).map(s => s.page)]);
  const checks = [];
  const add = (label, pass) => checks.push({ label, pass: Boolean(pass) });
  if (item.expect.type === 'refusal') {
    add('declines (not in document)', looksLikeRefusal(answer));
    add('no fabricated citation', explicit.length === 0);
  } else {
    add('cites at least one page', explicit.length > 0);
    for (const p of item.expect.mustCite || []) add(`cites p.${p}`, cited.has(p));
    add('no unverifiable citation', !result.citationWarning);
    for (const s of item.expect.mustInclude || []) add(`contains "${s}"`, lc.includes(s.toLowerCase()));
    for (const s of item.expect.mustNotInclude || []) add(`omits "${s}"`, !lc.includes(s.toLowerCase()));
  }
  const passed = checks.filter(c => c.pass).length;
  return { checks, passed, total: checks.length, ok: passed === checks.length };
}

/** Roll item scores into headline metrics, keeping grounding and honesty separate. */
export function aggregate(items, scores) {
  const rows = items.map((it, i) => ({ it, s: scores[i] }));
  const grounded = rows.filter(r => r.it.expect.type !== 'refusal');
  const refusals = rows.filter(r => r.it.expect.type === 'refusal');
  const rate = list => list.length ? list.filter(r => r.s.ok).length / list.length : 1;
  const checkRate = (list, prefix) => {
    const flat = list.flatMap(r => r.s.checks.filter(c => c.label.startsWith(prefix)));
    return flat.length ? flat.filter(c => c.pass).length / flat.length : 1;
  };
  return {
    total: items.length, passed: scores.filter(s => s.ok).length,
    groundedItems: grounded.length, groundedPass: grounded.filter(r => r.s.ok).length,
    refusalItems: refusals.length, refusalPass: refusals.filter(r => r.s.ok).length,
    citationAccuracy: checkRate(grounded, 'cites p.'), factAccuracy: checkRate(grounded, 'contains '),
    groundingRate: rate(grounded), honestyRate: rate(refusals),
  };
}
