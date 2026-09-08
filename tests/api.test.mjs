import assert from 'node:assert/strict';
import { readFile, readdir, mkdir } from 'node:fs/promises';
import { build } from 'esbuild';
import { Miniflare } from 'miniflare';

await mkdir('artifacts', { recursive: true });
await build({ stdin: { contents: `import { handleApi } from './lib/server/api'; export default { fetch: handleApi };`, resolveDir: process.cwd(), sourcefile: 'test-worker.ts', loader: 'ts' }, bundle: true, format: 'esm', platform: 'browser', target: 'es2022', external: ['cloudflare:workers', 'node:*'], outfile: 'artifacts/test-worker.mjs', logLevel: 'warning' });
let lastPrompt, failProvider = false, emails = [];
const summary = 'Northstar Labs engages Meridian Studio to deliver a customer analytics dashboard by December 15, 2026. [p. 1] The fixed fee is USD 48,000, payable in three installments. [p. 2] Either party may terminate with 30 days of written notice, and confidentiality survives for two years. [p. 3] Liability is capped at fees paid, with exceptions for fraud, willful misconduct, and confidentiality breaches. [p. 3]';
const mf = new Miniflare({
  modules: true, scriptPath: 'artifacts/test-worker.mjs', compatibilityDate: '2026-04-01', compatibilityFlags: ['nodejs_compat'],
  // No R2 binding: exercises the D1-backed PDF storage path (lib/server/storage.ts).
  d1Databases: ['DB'], bindings: { GEMINI_API_KEY: 'test-provider-key', RESEND_API_KEY: 'test-email-key', EMAIL_FROM: 'Clause <test@example.com>', APP_URL: 'https://clause.test' },
  outboundService: async request => {
    const url = new URL(request.url), payload = await request.json();
    if (url.hostname === 'api.resend.com') { emails.push(payload); return Response.json({ id: 'test-email' }); }
    if (failProvider) return new Response('quota exceeded', { status: 429 });
    if (url.pathname.endsWith(':embedContent')) return Response.json({ embedding: { values: [1, .5, .25] } });
    if (url.pathname.endsWith(':generateContent')) return Response.json({ candidates: [{ content: { parts: [{ text: payload.generationConfig.responseMimeType ? JSON.stringify({ summary, category: 'Agreement', insights: [{ label: 'Total fee', value: 'USD 48,000', page: 2 }] }) : 'This section establishes a 30-day termination notice. [p. 3]' }] } }] });
    if (url.pathname.endsWith(':streamGenerateContent')) {
      lastPrompt = payload;
      const answer = payload.contents.at(-1).parts[0].text.includes('weather') ? "I couldn't find that in this document." : 'Either party may terminate with **30 days of written notice**. [p. 3]';
      const data = answer.match(/.{1,12}/g).map(text => `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`).join('');
      const bytes = new TextEncoder().encode(data);
      return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < bytes.length; i += 7) controller.enqueue(bytes.slice(i, i + 7)); controller.close(); } }), { headers: { 'Content-Type': 'text/event-stream' } });
    }
    throw new Error(`Unexpected outbound request: ${url.hostname}`);
  },
});
let checks = 0;
const pass = name => { checks++; console.log(`PASS ${name}`); };
try {
  const db = await mf.getD1Database('DB');
  for (const file of (await readdir('drizzle')).filter(f => f.endsWith('.sql')).sort()) {
    const sql = await readFile(`drizzle/${file}`, 'utf8');
    for (const statement of sql.split('--> statement-breakpoint').filter(s => s.trim())) await db.prepare(statement).run();
  }
  async function call(path, { method = 'GET', data, cookie, form, ip = '192.0.2.1', headers = {} } = {}) {
    const serialized = form ? new Request('https://clause.test' + path, { method, body: form }) : null;
    const response = await mf.dispatchFetch('https://clause.test' + path, { method, headers: { 'cf-connecting-ip': ip, ...(cookie ? { Cookie: cookie } : {}), ...(data ? { 'Content-Type': 'application/json', Origin: 'https://clause.test' } : {}), ...(serialized ? { 'Content-Type': serialized.headers.get('content-type') } : {}), ...headers }, body: serialized ? await serialized.arrayBuffer() : (data ? JSON.stringify(data) : undefined) });
    const type = response.headers.get('content-type') || '';
    const result = type.includes('application/json') ? await response.json() : type.includes('pdf') ? await response.arrayBuffer() : await response.text();
    return { status: response.status, data: result, headers: response.headers };
  }
  const register = async (email, ip) => {
    const r = await call('/api/auth/register', { method: 'POST', data: { name: 'Alex Morgan', email, password: 'Correct-horse-42!' }, ip });
    assert.equal(r.status, 201, JSON.stringify(r.data)); return { cookie: r.headers.get('set-cookie').split(';')[0], user: r.data.user };
  };
  const owner = await register('owner@example.com', '192.0.2.1'), stranger = await register('stranger@example.com', '192.0.2.2');
  const stored = await db.prepare('SELECT password_hash FROM users WHERE id = ?').bind(owner.user.id).first();
  assert.ok(stored.password_hash.startsWith('$2b$12$')); assert.notEqual(stored.password_hash, 'Correct-horse-42!');
  assert.equal((await call('/api/auth/me', { cookie: owner.cookie })).data.user.id, owner.user.id);
  pass('registration, bcrypt password storage, and HttpOnly session authentication');
  const wrong = await call('/api/auth/login', { method: 'POST', data: { email: 'owner@example.com', password: 'wrong' } }); assert.equal(wrong.status, 401);
  const valid = await call('/api/auth/login', { method: 'POST', data: { email: 'owner@example.com', password: 'Correct-horse-42!' } }); assert.equal(valid.status, 200); assert.match(valid.headers.get('set-cookie'), /HttpOnly.*SameSite=Lax.*Secure/);
  pass('login validates credentials and sets secure cookies');
  assert.equal((await call('/api/documents')).status, 401);
  assert.equal((await call('/api/auth/logout', { method: 'POST', cookie: owner.cookie, data: {}, headers: { Origin: 'https://evil.test' } })).status, 403);
  pass('anonymous dashboard and cross-origin mutations are blocked');
  const upload = async (bytes, name = 'Agreement_v3.pdf', cookie = owner.cookie, type = 'application/pdf') => {
    const form = new FormData(); form.append('file', new File([bytes], name, { type })); return call('/api/documents', { method: 'POST', cookie, form });
  };
  assert.equal((await upload('not really a pdf')).status, 400);
  assert.equal((await upload('%PDF-1.7 not valid content')).status, 400);
  assert.equal((await upload('%PDF-1.7 x', 'malware.txt', owner.cookie, 'text/plain')).status, 400);
  pass('extension, MIME type, magic bytes, and malformed PDF validation');
  const pdfBytes = await readFile('public/samples/service-agreement.pdf');
  const uploaded = await upload(pdfBytes);
  assert.equal(uploaded.status, 201, JSON.stringify(uploaded.data)); const doc = uploaded.data.document;
  assert.equal(doc.page_count, 3); assert.equal(doc.status, 'pending');
  assert.equal((await call(`/api/documents/${doc.id}`, { cookie: stranger.cookie })).status, 404);
  assert.equal((await call(`/api/documents/${doc.id}/file`, { cookie: stranger.cookie })).status, 404);
  assert.equal((await call(`/api/documents/${doc.id}/comments`, { cookie: stranger.cookie })).status, 404);
  assert.equal((await call(`/api/documents/${doc.id}/chat`, { cookie: stranger.cookie })).status, 404);
  const served = await call(`/api/documents/${doc.id}/file`, { cookie: owner.cookie });
  assert.equal(served.status, 200);
  // round-trips through D1 blob storage, byte-for-byte
  assert.deepEqual(new Uint8Array(served.data), new Uint8Array(pdfBytes));
  assert.ok((await db.prepare('SELECT COUNT(*) AS n FROM blobs WHERE key = ?').bind(`${owner.user.id}/${doc.id}.pdf`).first()).n >= 1);
  pass('real PDF extraction, D1 byte-exact file storage, and owner-only access');
  const processed = await call(`/api/documents/${doc.id}/process`, { method: 'POST', cookie: owner.cookie, data: {} });
  assert.equal(processed.status, 200, JSON.stringify(processed.data)); assert.equal(processed.data.document.status, 'ready'); assert.equal(processed.data.document.summary, summary);
  pass('automatic-analysis endpoint persists provider summary and document embedding');
  const search = await call('/api/documents?q=termination%20agreement&mode=semantic', { cookie: owner.cookie }); assert.equal(search.status, 200); assert.equal(search.data.documents[0].id, doc.id); assert.ok(!('embedding' in search.data.documents[0]));
  assert.equal((await call('/api/documents?q=agreement', { cookie: owner.cookie })).data.documents.length, 1);
  assert.equal((await call('/api/documents?q=agreement', { cookie: stranger.cookie })).data.documents.length, 0);
  pass('filename and embedding search preserve document ownership');
  const created = await call(`/api/documents/${doc.id}/shares`, { method: 'POST', cookie: owner.cookie, data: { label: 'Finance', days: 7 } });
  assert.equal(created.status, 201); const token = new URL(created.data.url).hash.slice(1); assert.equal(token.length, 64);
  const storedShare = await db.prepare('SELECT token_hash FROM shares WHERE id = ?').bind(created.data.id).first(); assert.notEqual(storedShare.token_hash, token);
  const exchange = await call('/api/share/exchange', { method: 'POST', data: { token }, ip: '192.0.2.3' }); assert.equal(exchange.status, 200);
  const cookies = exchange.headers.getSetCookie().map(s => s.split(';')[0]).join('; ');
  assert.equal((await call(`/api/documents/${doc.id}/file`, { cookie: cookies })).status, 200);
  assert.equal((await call(`/api/documents/${doc.id}/shares`, { cookie: cookies })).status, 403);
  assert.equal((await call(`/api/documents/${doc.id}`, { method: 'DELETE', cookie: cookies })).status, 403);
  pass('256-bit hashed share tokens grant scoped guest access without an account');
  assert.equal((await call(`/api/documents/${doc.id}/comments`, { method: 'POST', cookie: cookies, data: { name: 'Priya', body: '**Check** the notice period.\n- Confirm timeline', page: 3 } })).status, 201);
  const list = await call(`/api/documents/${doc.id}/comments`, { cookie: owner.cookie }); const comment = list.data.comments[0]; assert.match(comment.author_name, /guest/); assert.equal(comment.page, 3);
  assert.equal((await call(`/api/documents/${doc.id}/comments`, { method: 'POST', cookie: owner.cookie, data: { body: 'Confirmed.', page: 3, parentId: comment.id } })).status, 201);
  assert.equal((await call(`/api/documents/${doc.id}/comments`, { method: 'POST', cookie: owner.cookie, data: { body: 'Invalid', page: 500 } })).status, 400);
  assert.equal((await call(`/api/documents/${doc.id}/comments`, { method: 'POST', cookie: owner.cookie, data: { body: 'Invalid', page: 1, parentId: crypto.randomUUID() } })).status, 400);
  assert.equal((await call(`/api/documents/${doc.id}/comments/${comment.id}`, { method: 'PATCH', cookie: owner.cookie, data: { resolved: true } })).status, 200);
  pass('guest names, Markdown comments, threaded replies, page validation, and resolution');
  for (let i = 0; i < 6; i++) {
    const answer = await call(`/api/documents/${doc.id}/chat`, { method: 'POST', cookie: owner.cookie, data: { question: i === 0 ? 'What is the termination notice period?' : 'What else about that notice?' } });
    assert.equal(answer.status, 200); const events = answer.data.trim().split('\n').map(JSON.parse);
    assert.ok(events.filter(e => e.type === 'token').length > 2); assert.equal(events.at(-1).type, 'done'); assert.equal(events.at(-1).sources[0].page, 3);
  }
  assert.equal(lastPrompt.contents.length, 11); assert.ok(lastPrompt.systemInstruction.parts[0].text.includes('[Page 3]')); assert.ok(lastPrompt.systemInstruction.parts[0].text.includes('untrusted evidence'));
  assert.equal((await call(`/api/documents/${doc.id}/chat`, { cookie: cookies })).data.messages.length, 0);
  const refusal = await call(`/api/documents/${doc.id}/chat`, { method: 'POST', cookie: cookies, data: { question: 'What is the weather tomorrow?' } });
  assert.ok(refusal.data.includes('done'));
  pass('streaming, original-page context, five-turn history, refusal transport, and private conversations');
  failProvider = true;
  assert.equal((await call(`/api/documents/${doc.id}/chat`, { method: 'POST', cookie: owner.cookie, data: { question: 'What are the dates?' } })).status, 429);
  failProvider = false;
  pass('provider quota errors remain honest and recoverable');
  await call(`/api/documents/${doc.id}/shares/${created.data.id}`, { method: 'DELETE', cookie: owner.cookie });
  for (const suffix of ['', '/file', '/comments', '/chat']) assert.equal((await call(`/api/documents/${doc.id}${suffix}`, { cookie: cookies })).status, 404);
  pass('revocation blocks existing guest cookies on every protected endpoint');
  const reset = await call('/api/auth/forgot', { method: 'POST', data: { email: 'owner@example.com' } }); assert.equal(reset.status, 200);
  const resetToken = emails.at(-1).text.match(/reset#([a-f0-9]{64})/)[1];
  assert.equal((await call('/api/auth/reset', { method: 'POST', data: { token: resetToken, password: 'My-new-password-42!' } })).status, 200);
  assert.equal((await call('/api/auth/reset', { method: 'POST', data: { token: resetToken, password: 'Another-password-42!' } })).status, 400);
  assert.equal((await call('/api/auth/me', { cookie: owner.cookie })).data.user, null);
  pass('email recovery tokens are single-use and invalidate existing sessions');
  const renewed = await call('/api/auth/login', { method: 'POST', data: { email: 'owner@example.com', password: 'My-new-password-42!' } }); owner.cookie = renewed.headers.get('set-cookie').split(';')[0];
  assert.equal((await call(`/api/documents/${doc.id}`, { method: 'DELETE', cookie: owner.cookie })).status, 200);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM chunks WHERE document_id = ?').bind(doc.id).first()).count, 0);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM comments WHERE document_id = ?').bind(doc.id).first()).count, 0);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM messages WHERE document_id = ?').bind(doc.id).first()).count, 0);
  assert.equal((await db.prepare('SELECT count(*) AS count FROM blobs WHERE key = ?').bind(`${owner.user.id}/${doc.id}.pdf`).first()).count, 0);
  pass('deletion removes the stored PDF bytes and cascades comments, chunks, shares, and chat');
  console.log(`\n${checks} integration scenarios passed. Provider responses are controlled fixtures; this does not validate live model quality.`);
} finally { await mf.dispose(); }
