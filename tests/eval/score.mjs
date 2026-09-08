/**
 * Pure scoring logic for the AI answer-quality eval.
 *
 * Kept dependency-free and side-effect-free so it can be unit-tested hermetically
 * (see tests/domain/eval-scoring.test.ts) and reused by the live runner (run.mjs).
 */

/** Page numbers the answer explicitly cites via the enforced `[p. N]` marker. */
export function extractCitedPages(text) {
  return [...String(text).matchAll(/\[p\.\s*(\d+)\]/gi)].map((m) => Number(m[1]));
}

/**
 * Does the answer decline because the document doesn't cover the question?
 * The system prompt tells the model to say "I couldn't find that in this
 * document." — this matches that and common paraphrases, without matching a
 * confident answer that merely contains the word "not".
 */
export function looksLikeRefusal(text) {
  const t = String(text).toLowerCase();
  return (
    /(could ?n'?t|can ?not|can'?t|was unable to|am unable to|do(?:es)? not appear to|don'?t) (find|locate|determine|see|have)/.test(t) ||
    /not (?:explicitly )?(?:stated|mentioned|specified|covered|included|found|addressed|defined|provided|discussed) (?:in|within|by|anywhere in) (?:this|the) document/.test(t) ||
    /(?:this|the) document (?:does not|doesn'?t|did not) (?:say|state|mention|contain|specify|address|include|cover|define|provide|discuss)/.test(t) ||
    /no (?:mention|reference|information|provision|clause|section|detail|indication)s? (?:of|about|regarding|on|to|for)/.test(t) ||
    /not (?:something|a topic|a subject|covered|part of what)/.test(t)
  );
}

/**
 * Score one dataset item against the model's final answer.
 * @param {{expect: {type?: string, mustCite?: number[], mustInclude?: string[], mustNotInclude?: string[]}}} item
 * @param {{answer: string, sources?: {page:number}[], citationWarning?: boolean}} result
 */
export function scoreItem(item, result) {
  const answer = result.answer || '';
  const lc = answer.toLowerCase();
  const explicitCites = extractCitedPages(answer);
  const cited = new Set([...explicitCites, ...(result.sources || []).map((s) => s.page)]);
  const checks = [];
  const add = (label, pass) => checks.push({ label, pass: Boolean(pass) });

  if (item.expect.type === 'refusal') {
    add('declines (not in document)', looksLikeRefusal(answer));
    add('no fabricated citation', explicitCites.length === 0);
  } else {
    add('cites at least one page', explicitCites.length > 0);
    for (const p of item.expect.mustCite || []) add(`cites p.${p}`, cited.has(p));
    add('no unverifiable citation', !result.citationWarning);
    for (const s of item.expect.mustInclude || []) add(`contains "${s}"`, lc.includes(s.toLowerCase()));
    for (const s of item.expect.mustNotInclude || []) add(`omits "${s}"`, !lc.includes(s.toLowerCase()));
  }

  const passed = checks.filter((c) => c.pass).length;
  return { checks, passed, total: checks.length, ok: passed === checks.length };
}

/** Roll individual item scores into headline metrics. */
export function aggregate(items, scores) {
  const grounded = items.map((it, i) => ({ it, s: scores[i] })).filter((x) => x.it.expect.type !== 'refusal');
  const refusals = items.map((it, i) => ({ it, s: scores[i] })).filter((x) => x.it.expect.type === 'refusal');
  const rate = (rows) => (rows.length ? rows.filter((r) => r.s.ok).length / rows.length : 1);
  const checkRate = (rows, label) => {
    const flat = rows.flatMap((r) => r.s.checks.filter((c) => c.label.startsWith(label)));
    return flat.length ? flat.filter((c) => c.pass).length / flat.length : 1;
  };
  return {
    total: items.length,
    passed: scores.filter((s) => s.ok).length,
    groundedItems: grounded.length,
    groundedPass: grounded.filter((r) => r.s.ok).length,
    refusalItems: refusals.length,
    refusalPass: refusals.filter((r) => r.s.ok).length,
    citationAccuracy: checkRate(grounded, 'cites p.'),
    factAccuracy: checkRate(grounded, 'contains '),
    groundingRate: rate(grounded),
    honestyRate: rate(refusals),
  };
}
