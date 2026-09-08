import bcrypt from 'bcryptjs';
import { HttpError, now, one, run } from './runtime';
import type { User } from '../contracts';
export const randomToken = () => Array.from(crypto.getRandomValues(new Uint8Array(32)), b => b.toString(16).padStart(2, '0')).join('');
export async function digest(token: string) { return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), b => b.toString(16).padStart(2, '0')).join(''); }
export function passwordValid(password: unknown): password is string { return typeof password === 'string' && password.length >= 10 && new TextEncoder().encode(password).length <= 72; }
export const hashPassword = (password: string) => bcrypt.hash(password, 12);
export const verifyPassword = (password: string, hash: string) => bcrypt.compare(password, hash);
export function cookie(request: Request, name: string) { return request.headers.get('cookie')?.split(';').map(c => c.trim()).find(c => c.startsWith(name + '='))?.slice(name.length + 1) || ''; }
export const sessionCookie = (request: Request, token: string, age = 604800) => `clause_session=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${age}${new URL(request.url).protocol === 'https:' ? '; Secure' : ''}`;
export async function user(request: Request): Promise<User | null> {
  const token = cookie(request, 'clause_session'); if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return one<User>('SELECT u.id, u.name, u.email FROM sessions s JOIN users u ON s.user_id = u.id WHERE s.token_hash = ? AND s.expires_at > ?', await digest(token), now());
}
export async function requireUser(request: Request) { const u = await user(request); if (!u) throw new HttpError(401, 'Please sign in to continue.'); return u; }
export async function newSession(userId: string) { const token = randomToken(); await run('INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)', await digest(token), userId, now() + 604800000); return token; }
export function checkOrigin(request: Request) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(request.method)) return;
  const origin = request.headers.get('origin');
  if (origin && origin !== new URL(request.url).origin) throw new HttpError(403, 'This request came from a different website.');
  if (request.headers.get('sec-fetch-site') === 'cross-site') throw new HttpError(403, 'Cross-site requests are not allowed.');
}
export async function limit(key: string, max: number, windowMs = 60000) {
  const bucket = Math.floor(now() / windowMs);
  const result = await one<{ count: number }>('INSERT INTO rate_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count', key + ':' + bucket, now() + windowMs);
  if (result && result.count > max) throw new HttpError(429, 'Too many requests. Please wait a moment and try again.');
  if (Math.random() < .02) await run('DELETE FROM rate_limits WHERE expires_at < ?', now() - 3600000);
}
export async function authorize(request: Request, documentId: string, ownerOnly = false) {
  const doc = await one<Record<string, unknown>>('SELECT * FROM documents WHERE id = ?', documentId);
  if (!doc) throw new HttpError(404, 'This document is unavailable or you do not have access.');
  const u = await user(request);
  if (u && doc.owner_id === u.id) return { doc, actorId: u.id, name: u.name, isOwner: true, user: u };
  if (!ownerOnly) {
    const token = request.headers.get('x-share-token') || cookie(request, `clause_share_${documentId}`);
    if (token && /^[a-f0-9]{64}$/.test(token)) {
      const share = await one<{ id: string }>('SELECT id FROM shares WHERE token_hash = ? AND document_id = ? AND revoked_at IS NULL AND expires_at > ?', await digest(token), documentId, now());
      if (share) return { doc, actorId: `guest:${share.id}:${await digest(cookie(request, 'clause_guest') || token)}`, name: u?.name || 'Guest', isOwner: false, user: u };
    }
  }
  throw new HttpError(404, 'This document is unavailable or you do not have access.');
}
