import { z, ZodError } from 'zod';
import { all, body, database, HttpError, id, json, now, one, run, runtime } from './runtime';
import { authorize, checkOrigin, cookie, digest, hashPassword, limit, newSession, passwordValid, randomToken, requireUser, sessionCookie, user, verifyPassword } from './security';
import { aiReady, embed, providerTokens, streamAnswer } from './ai';
import { getPublicDocument, processDocument, PUBLIC_FIELDS, savePdf } from './documents';
import { deleteObject, getObject } from './storage';
import { cosine, retrieve } from '../retrieval';
import { emailReady, sendEmail } from './email';
import type { Chunk, Source } from '../contracts';

const credentials = z.object({ email: z.string().email().max(254).transform(s => s.toLowerCase().trim()), password: z.string().max(200) });
const documentPattern = /^\/api\/documents\/([a-f0-9-]{36})(?:\/(.*))?$/;

async function dispatch(request: Request): Promise<Response> {
  checkOrigin(request);
  const url = new URL(request.url), path = url.pathname, method = request.method;
  const ip = request.headers.get('cf-connecting-ip') || 'local';
  if (path === '/api/health') {
    await one('SELECT 1 AS ok');
    return json({ status: 'ok', aiConfigured: aiReady(), emailConfigured: emailReady() });
  }
  if (path === '/api/auth/me' && method === 'GET') return json({ user: await user(request), aiConfigured: aiReady(), emailConfigured: emailReady() });
  if (path === '/api/auth/register' && method === 'POST') {
    await limit(`register:${ip}`, 8, 3600000);
    const data = credentials.extend({ name: z.string().trim().min(2).max(80) }).parse(await body(request));
    if (!passwordValid(data.password)) throw new HttpError(400, 'Use at least 10 characters, up to 72 bytes, for your password.');
    const userId = id(), passwordHash = await hashPassword(data.password);
    try { await run('INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)', userId, data.name, data.email, passwordHash, now()); }
    catch (error) { if (String(error).includes('UNIQUE')) throw new HttpError(409, 'An account with this email already exists. Please sign in.'); throw error; }
    const token = await newSession(userId);
    return json({ user: { id: userId, name: data.name, email: data.email } }, 201, { 'Set-Cookie': sessionCookie(request, token) });
  }
  if (path === '/api/auth/login' && method === 'POST') {
    await limit(`login:${ip}`, 12, 600000);
    const data = credentials.parse(await body(request));
    await limit(`login-email:${await digest(data.email)}`, 15, 600000);
    const found = await one<{ id: string; name: string; email: string; password_hash: string }>('SELECT * FROM users WHERE email = ?', data.email);
    // Always compare a real bcrypt hash, including unknown accounts.
    const hash = found?.password_hash || '$2b$12$R9h/cIPz0gi.URNNX3kh2OPST9/PgBkqquzi.Ss7KIUgO2t0jWMUW';
    const valid = await verifyPassword(data.password, hash);
    if (!found || !valid) throw new HttpError(401, 'The email or password is incorrect.');
    const token = await newSession(found.id);
    return json({ user: { id: found.id, name: found.name, email: found.email } }, 200, { 'Set-Cookie': sessionCookie(request, token) });
  }
  if (path === '/api/auth/logout' && method === 'POST') {
    await run('DELETE FROM sessions WHERE token_hash = ?', await digest(cookie(request, 'clause_session')));
    return json({ ok: true }, 200, { 'Set-Cookie': sessionCookie(request, '', 0) });
  }
  if (path === '/api/auth/forgot' && method === 'POST') {
    await limit(`reset:${ip}`, 5, 3600000);
    if (!emailReady()) throw new HttpError(503, 'Password reset email is not configured yet. Please contact the workspace administrator.');
    const { email } = z.object({ email: z.string().email().transform(s => s.toLowerCase().trim()) }).parse(await body(request));
    const found = await one<{ id: string }>('SELECT id FROM users WHERE email = ?', email);
    if (found) {
      const token = randomToken();
      await run('INSERT INTO password_resets (token_hash, user_id, expires_at) VALUES (?, ?, ?)', await digest(token), found.id, now() + 1800000);
      try { await sendEmail(email, 'Reset your Clause password', `Reset your password using this single-use link. It expires in 30 minutes.\n\n${runtime().APP_URL}/reset#${token}\n\nIf you did not request this, you can ignore this email.`); }
      catch { console.error('password_reset_delivery_failed'); }
    }
    return json({ message: 'If this account exists, a password reset link will be sent to its email address.' });
  }
  if (path === '/api/auth/reset' && method === 'POST') {
    await limit(`reset-use:${ip}`, 8, 3600000);
    const data = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/), password: z.string() }).parse(await body(request));
    if (!passwordValid(data.password)) throw new HttpError(400, 'Use at least 10 characters, up to 72 bytes, for your password.');
    const passwordHash = await hashPassword(data.password);
    // DELETE RETURNING atomically consumes the token so concurrent reuse cannot succeed.
    const reset = await one<{ user_id: string }>('DELETE FROM password_resets WHERE token_hash = ? AND expires_at > ? RETURNING user_id', await digest(data.token), now());
    if (!reset) throw new HttpError(400, 'This reset link has expired or was already used. Request a new one.');
    await database().batch([
      database().prepare('UPDATE users SET password_hash = ? WHERE id = ?').bind(passwordHash, reset.user_id),
      database().prepare('DELETE FROM sessions WHERE user_id = ?').bind(reset.user_id),
      database().prepare('DELETE FROM password_resets WHERE user_id = ?').bind(reset.user_id),
    ]);
    return json({ ok: true });
  }
  if (path === '/api/share/exchange' && method === 'POST') {
    await limit(`share-exchange:${ip}`, 30);
    const { token } = z.object({ token: z.string().regex(/^[a-f0-9]{64}$/) }).parse(await body(request));
    const share = await one<{ document_id: string; expires_at: number }>('SELECT document_id, expires_at FROM shares WHERE token_hash = ? AND revoked_at IS NULL AND expires_at > ?', await digest(token), now());
    if (!share) throw new HttpError(404, 'This invitation has expired or been revoked. Ask the owner for a new link.');
    const headers = new Headers({ 'Cache-Control': 'no-store' });
    const secure = url.protocol === 'https:' ? '; Secure' : '';
    headers.append('Set-Cookie', `clause_share_${share.document_id}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${Math.floor((share.expires_at - now()) / 1000)}${secure}`);
    if (!cookie(request, 'clause_guest')) headers.append('Set-Cookie', `clause_guest=${randomToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`);
    return Response.json({ documentId: share.document_id }, { headers });
  }
  if (path === '/api/documents' && method === 'GET') {
    const u = await requireUser(request), q = (url.searchParams.get('q') || '').trim().slice(0, 200), semantic = url.searchParams.get('mode') === 'semantic';
    const docs = await all<Record<string, unknown>>(`SELECT ${PUBLIC_FIELDS}, d.embedding, (SELECT COUNT(*) FROM shares s WHERE s.document_id = d.id AND s.revoked_at IS NULL AND s.expires_at > ?) AS share_count, (SELECT COUNT(*) FROM comments c WHERE c.document_id = d.id) AS comment_count FROM documents d WHERE d.owner_id = ? ORDER BY d.created_at DESC LIMIT 100`, now(), u.id);
    let results = docs, searchNotice: string | null = null;
    if (q && semantic) {
      await limit(`search:${u.id}`, 15);
      const vector = await embed(q, true);
      results = docs.map(d => ({ ...d, filename: d.filename, score: d.embedding ? cosine(vector, JSON.parse(d.embedding as string)) : 0 })).filter(d => d.score > .2 || String(d.filename).toLowerCase().includes(q.toLowerCase())).sort((a, b) => b.score - a.score);
      if (docs.some(d => !d.embedding)) searchNotice = 'Some documents are not yet indexed for semantic search. Filename matches are still included.';
    } else if (q) results = docs.filter(d => String(d.filename).toLowerCase().includes(q.toLowerCase()));
    return json({ documents: results.map(d => { const publicDocument = { ...d }; delete publicDocument.embedding; return publicDocument; }), searchNotice });
  }
  if (path === '/api/documents' && method === 'POST') {
    const u = await requireUser(request); await limit(`upload:${u.id}`, 15, 3600000);
    const count = await one<{ count: number }>('SELECT COUNT(*) AS count FROM documents WHERE owner_id = ?', u.id);
    if ((count?.count || 0) >= 100) throw new HttpError(400, 'Your workspace supports up to 100 documents. Delete an older document to make room.');
    if (Number(request.headers.get('content-length')) > 11 * 1024 * 1024) throw new HttpError(413, 'Choose a PDF smaller than 10 MB.');
    if (!request.headers.get('content-type')?.startsWith('multipart/form-data')) throw new HttpError(415, 'Upload a PDF using a multipart form.');
    let form: FormData;
    try { form = await request.formData(); } catch { throw new HttpError(400, 'The upload could not be read. Please choose the file again.'); }
    const file = form.get('file');
    if (!(file instanceof File)) throw new HttpError(400, 'Choose a PDF to upload.');
    const documentId = await savePdf(u.id, file);
    return json({ document: await getPublicDocument(documentId) }, 201);
  }
  const match = path.match(documentPattern);
  if (!match) throw new HttpError(404, 'Endpoint not found.');
  const [, documentId, action = ''] = match;
  const access = await authorize(request, documentId);
  const owner = () => { if (!access.isOwner) throw new HttpError(403, 'Only the document owner can do this.'); };
  if (!action && method === 'GET') return json({ document: { ...await getPublicDocument(documentId) as object, isOwner: access.isOwner }, viewerName: access.name });
  if (!action && method === 'DELETE') {
    owner(); await deleteObject(String(access.doc.object_key)); await run('DELETE FROM documents WHERE id = ?', documentId); return json({ ok: true });
  }
  if (action === 'file' && method === 'GET') {
    const bytes = await getObject(String(access.doc.object_key));
    if (!bytes) throw new HttpError(404, 'The PDF file is unavailable.');
    return new Response(bytes, { headers: { 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename*=UTF-8''${encodeURIComponent(String(access.doc.filename))}`, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  if (action === 'process' && method === 'POST') { owner(); await limit(`process:${access.actorId}`, 80, 600000); return json({ document: await processDocument(documentId) }); }
  if (action === 'shares' && method === 'GET') { owner(); return json({ shares: await all('SELECT id, label, created_at, expires_at, revoked_at FROM shares WHERE document_id = ? ORDER BY created_at DESC', documentId), emailConfigured: emailReady() }); }
  if (action === 'shares' && method === 'POST') {
    owner(); await limit(`invite:${access.actorId}`, 20, 3600000);
    const data = z.object({ label: z.string().trim().max(100).default('Review invitation'), days: z.number().int().min(1).max(30).default(7), email: z.string().email().optional() }).parse(await body(request));
    if (data.email && !emailReady()) throw new HttpError(503, 'Email delivery is not configured. Create a link without an email address.');
    const token = randomToken(), shareId = id();
    await run('INSERT INTO shares (id, document_id, token_hash, label, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)', shareId, documentId, await digest(token), data.email || data.label || 'Review invitation', now(), now() + data.days * 86400000);
    // URL fragments are never sent in HTTP requests or Referer headers.
    const shareUrl = `${runtime().APP_URL || url.origin}/share#${token}`;
    let emailSent = false, emailError: string | null = null;
    if (data.email) { try { await sendEmail(data.email, `${access.name} shared a document on Clause`, `${access.name} invited you to review ${access.doc.filename}.\n\nOpen the PDF, ask questions, and leave comments. No account is required. This link expires in ${data.days} days.\n\n${shareUrl}`); emailSent = true; } catch { emailError = 'The link was created, but the email could not be delivered. Copy the link below.'; } }
    return json({ id: shareId, url: shareUrl, emailSent, emailError }, 201);
  }
  if (action.startsWith('shares/') && method === 'DELETE') { owner(); await run('UPDATE shares SET revoked_at = ? WHERE id = ? AND document_id = ?', now(), action.slice(7), documentId); return json({ ok: true }); }
  if (action === 'comments' && method === 'GET') return json({ comments: await all('SELECT id, parent_id, author_name, body, page, created_at, resolved FROM comments WHERE document_id = ? ORDER BY created_at ASC LIMIT 500', documentId) });
  if (action === 'comments' && method === 'POST') {
    await limit(`comment:${access.actorId}`, 20);
    const data = z.object({ body: z.string().trim().min(1).max(4000), name: z.string().trim().min(2).max(80).optional(), page: z.number().int().min(1).max(Number(access.doc.page_count)), parentId: z.string().uuid().nullable().optional() }).parse(await body(request));
    if (data.parentId && !await one('SELECT id FROM comments WHERE id = ? AND document_id = ? AND parent_id IS NULL', data.parentId, documentId)) throw new HttpError(400, 'Reply to an existing top-level comment in this document.');
    if (!access.user && !data.name) throw new HttpError(400, 'Add your name before leaving a comment.');
    await run('INSERT INTO comments (id, document_id, parent_id, author_id, author_name, body, page, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id(), documentId, data.parentId || null, access.actorId, access.user?.name || `${data.name} (guest)`, data.body, data.page, now());
    return json({ ok: true }, 201);
  }
  if (action.startsWith('comments/') && method === 'PATCH') { owner(); const data = z.object({ resolved: z.boolean() }).parse(await body(request)); await run('UPDATE comments SET resolved = ? WHERE id = ? AND document_id = ?', data.resolved ? 1 : 0, action.slice(9), documentId); return json({ ok: true }); }
  if (action === 'chat' && method === 'GET') {
    const messages = await all<{ sources: string } & Record<string, unknown>>('SELECT id, role, content, sources, created_at FROM messages WHERE document_id = ? AND actor_id = ? ORDER BY created_at DESC LIMIT 100', documentId, access.actorId);
    return json({ messages: messages.reverse().map(m => ({ ...m, sources: JSON.parse(m.sources) })) });
  }
  if (action === 'chat' && method === 'POST') {
    await limit(`chat:${access.actorId}`, 12);
    const { question } = z.object({ question: z.string().trim().min(2).max(2000) }).parse(await body(request));
    const chunks = await all<Chunk>('SELECT id, page, ordinal, text FROM chunks WHERE document_id = ? ORDER BY ordinal', documentId);
    if (!chunks.length) throw new HttpError(422, 'No readable text was found in this PDF. Upload an OCR-processed copy to use chat.');
    const history = (await all<{ role: string; content: string }>('SELECT role, content FROM messages WHERE document_id = ? AND actor_id = ? ORDER BY created_at DESC LIMIT 10', documentId, access.actorId)).reverse();
    const selected = retrieve(chunks, question, history.filter(h => h.role === 'user').map(h => h.content));
    const sources: Source[] = [...new Map(selected.map(c => [c.page, { page: c.page, excerpt: c.text.slice(0, 260) }])).values()];
    const context = `Whole-document summary (orientation only; cite source excerpts for precise facts): ${access.doc.summary || 'Not available'}\n\n${selected.map(c => `[Page ${c.page}]\n${c.text}`).join('\n\n')}`;
    const upstream = await streamAnswer(context, history, question);
    if (!upstream.body) throw new HttpError(502, 'No AI response was received.');
    const encoder = new TextEncoder(); let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        const emit = (data: unknown) => { if (!cancelled) controller.enqueue(encoder.encode(JSON.stringify(data) + '\n')); };
        let content = '';
        try {
          emit({ type: 'sources', sources });
          for await (const token of providerTokens(upstream.body!)) { if (cancelled) break; content += token; emit({ type: 'token', text: token }); }
          if (!content.trim() || cancelled) return;
          // Do not persist incomplete responses or unauthorized results after revocation.
          await authorize(request, documentId);
          const allowedPages = new Set(selected.map(c => c.page));
          const cited = [...content.matchAll(/\[p\.\s*(\d+)\]/g)].map(m => Number(m[1]));
          const citationWarning = cited.some(p => !allowedPages.has(p));
          const actualSources = sources.filter(s => cited.includes(s.page));
          const messageId = id(), created = now();
          await database().batch([
            database().prepare('INSERT INTO messages (id, document_id, actor_id, role, content, created_at) VALUES (?, ?, ?, ?, ?, ?)').bind(id(), documentId, access.actorId, 'user', question, created),
            database().prepare('INSERT INTO messages (id, document_id, actor_id, role, content, sources, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').bind(messageId, documentId, access.actorId, 'assistant', content, JSON.stringify(actualSources), created + 1),
          ]);
          emit({ type: 'done', id: messageId, sources: actualSources, citationWarning });
        } catch (error) { emit({ type: 'error', message: error instanceof HttpError ? error.message : 'The response was interrupted. Please retry your question.' }); }
        finally { if (!cancelled) controller.close(); }
      }, cancel() { cancelled = true; },
    });
    return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' } });
  }
  throw new HttpError(405, 'This action is not available.');
}

export async function handleApi(request: Request): Promise<Response> {
  try { return await dispatch(request); }
  catch (error) {
    if (error instanceof ZodError) return json({ error: error.issues[0]?.message || 'Check the information you entered.' }, 400);
    if (error instanceof HttpError) return json({ error: error.message }, error.status);
    console.error('api_error', { path: new URL(request.url).pathname, kind: error instanceof Error ? error.name : 'unknown', detail: error instanceof Error ? error.message.slice(0, 200) : '' });
    return json({ error: 'Something went wrong. Please try again; your saved work is safe.' }, 500);
  }
}
