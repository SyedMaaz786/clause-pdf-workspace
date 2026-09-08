// Live answer-quality eval: runs the real API worker in Miniflare against the
// real Gemini API, uploads the sample contract, and scores answers on the fixed
// question set in dataset.json. Needs GEMINI_API_KEY. Exits non-zero below
// EVAL_THRESHOLD so it can gate CI. `EVAL_DELAY_MS` spaces calls for free-tier RPM.
import assert from 'node:assert/strict';
import { readFile, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';
import { scoreItem, aggregate } from './score.mjs';

const KEY = process.env.GEMINI_API_KEY;
if (!KEY) {
  console.log('\n  Set GEMINI_API_KEY to run the live AI eval (skipped).');
  console.log('  e.g.  GEMINI_API_KEY=your-key npm run eval\n');
  process.exit(0);
}
const DELAY = Number(process.env.EVAL_DELAY_MS || 4500);
const THRESHOLD = Number(process.env.EVAL_THRESHOLD || 0.85);
const sleep = ms => new Promise(r => setTimeout(r, ms));

await mkdir('artifacts', { recursive: true });
await build({
  stdin: { contents: `import { handleApi } from './lib/server/api'; export default { fetch: handleApi };`, resolveDir: process.cwd(), sourcefile: 'eval-worker.ts', loader: 'ts' },
  bundle: true, format: 'esm', platform: 'browser', target: 'es2022',
  external: ['cloudflare:workers', 'node:*'], outfile: 'artifacts/eval-worker.mjs', logLevel: 'warning',
});

const mf = new Miniflare({
  modules: true, scriptPath: 'artifacts/eval-worker.mjs',
  compatibilityDate: '2026-04-01', compatibilityFlags: ['nodejs_compat'],
  d1Databases: ['DB'], r2Buckets: ['BUCKET'],
  bindings: {
    GEMINI_API_KEY: KEY,
    GEMINI_MODEL: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    GEMINI_EMBEDDING_MODEL: process.env.GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
    APP_URL: 'https://clause.eval',
  },
});

try {
  const db = await mf.getD1Database('DB');
  for (const stmt of (await readFile('drizzle/0000_medical_betty_ross.sql', 'utf8')).split('--> statement-breakpoint').filter((s) => s.trim())) {
    await db.prepare(stmt).run();
  }

  const origin = 'https://clause.eval';
  const call = async (path, { method = 'GET', data, cookie, form } = {}) => {
    const serialized = form ? new Request(origin + path, { method, body: form }) : null;
    const res = await mf.dispatchFetch(origin + path, {
      method,
      headers: {
        'cf-connecting-ip': '192.0.2.9',
        ...(cookie ? { Cookie: cookie } : {}),
        ...(data ? { 'Content-Type': 'application/json', Origin: origin } : {}),
        ...(serialized ? { 'Content-Type': serialized.headers.get('content-type') } : {}),
      },
      body: serialized ? await serialized.arrayBuffer() : data ? JSON.stringify(data) : undefined,
    });
    const ct = res.headers.get('content-type') || '';
    return { status: res.status, headers: res.headers, data: ct.includes('json') ? await res.json() : await res.text() };
  };

  const reg = await call('/api/auth/register', { method: 'POST', data: { name: 'Eval Runner', email: `eval-${Date.now()}@example.com`, password: 'Correct-horse-battery-42!' } });
  assert.equal(reg.status, 201, JSON.stringify(reg.data));
  const cookie = reg.headers.get('set-cookie').split(';')[0];

  const form = new FormData();
  form.append('file', new File([await readFile('public/samples/service-agreement.pdf')], 'service-agreement.pdf', { type: 'application/pdf' }));
  const up = await call('/api/documents', { method: 'POST', cookie, form });
  assert.equal(up.status, 201, JSON.stringify(up.data));
  const docId = up.data.document.id;

  process.stdout.write('  analyzing document');
  let status = 'pending';
  for (let i = 0; i < 12 && status !== 'ready'; i++) {
    const p = await call(`/api/documents/${docId}/process`, { method: 'POST', cookie, data: {} });
    status = p.data.document?.status;
    process.stdout.write('.');
    if (status === 'error') throw new Error('processing failed: ' + p.data.document.error);
    if (status !== 'ready') await sleep(DELAY);
  }
  assert.equal(status, 'ready', 'document did not reach ready state');
  console.log(' ready\n');

  const ask = async (question) => {
    const res = await mf.dispatchFetch(`${origin}/api/documents/${docId}/chat`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: origin, Cookie: cookie, 'cf-connecting-ip': '192.0.2.9' },
      body: JSON.stringify({ question }),
    });
    if (res.status !== 200) throw new Error(`chat ${res.status}: ${await res.text()}`);
    let answer = '', sources = [], citationWarning = false;
    for (const line of (await res.text()).trim().split('\n')) {
      if (!line.trim()) continue;
      const ev = JSON.parse(line);
      if (ev.type === 'token') answer += ev.text;
      if (ev.type === 'sources') sources = ev.sources;
      if (ev.type === 'done') { sources = ev.sources; citationWarning = Boolean(ev.citationWarning); }
      if (ev.type === 'error') throw new Error(ev.message);
    }
    return { answer, sources, citationWarning };
  };

  const { items } = JSON.parse(await readFile('tests/eval/dataset.json', 'utf8'));
  const scores = [];
  for (const item of items) {
    let result = await ask(item.question);
    for (const follow of item.followUps || []) { await sleep(DELAY); result = await ask(follow); }
    const score = scoreItem(item, result);
    scores.push(score);
    const mark = score.ok ? '✓' : '✗';
    const turns = [item.question, ...(item.followUps || [])].join('  →  ');
    console.log(`  ${mark}  ${item.id.padEnd(24)} ${score.passed}/${score.total}`);
    console.log(`      Q: ${turns}`);
    console.log(`      A: ${result.answer.replace(/\s+/g, ' ').slice(0, 200)}${result.answer.length > 200 ? '…' : ''}`);
    for (const c of score.checks.filter((c) => !c.pass)) console.log(`      ✗ ${c.label}`);
    console.log();
    await sleep(DELAY);
  }

  const a = aggregate(items, scores);
  const pct = (n) => `${(n * 100).toFixed(0)}%`;
  console.log('  ─────────────────────────────────────────────');
  console.log(`  Items passed        ${a.passed}/${a.total}`);
  console.log(`  Grounding rate      ${pct(a.groundingRate)}   (grounded answers that cite the right page + expected fact)`);
  console.log(`  Citation accuracy   ${pct(a.citationAccuracy)}   (expected page appears in the answer's citations)`);
  console.log(`  Fact accuracy       ${pct(a.factAccuracy)}   (expected value present in the answer)`);
  console.log(`  Honesty rate        ${pct(a.honestyRate)}   (declines when the document is silent — ${a.refusalPass}/${a.refusalItems})`);
  console.log('  ─────────────────────────────────────────────\n');

  const overall = a.passed / a.total;
  if (overall < THRESHOLD) {
    console.error(`  ✗ pass rate ${pct(overall)} is below threshold ${pct(THRESHOLD)}\n`);
    process.exitCode = 1;
  }
} finally {
  await mf.dispose();
}
