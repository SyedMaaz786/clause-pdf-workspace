import { env } from 'cloudflare:workers';
export type Runtime = { DB: D1Database; BUCKET: R2Bucket; GEMINI_API_KEY?: string; GEMINI_MODEL?: string; GEMINI_EMBEDDING_MODEL?: string; RESEND_API_KEY?: string; EMAIL_FROM?: string; APP_URL?: string };
export const runtime = () => env as unknown as Runtime;
export function database() { const db = runtime().DB; if (!db) throw new HttpError(503, 'The workspace database is temporarily unavailable. Please try again.'); return db; }
export class HttpError extends Error { constructor(public status: number, message: string) { super(message); } }
export const id = () => crypto.randomUUID();
export const now = () => Date.now();
export async function one<T>(sql: string, ...args: (string | number | null)[]) { return database().prepare(sql).bind(...args).first<T>(); }
export async function all<T>(sql: string, ...args: (string | number | null)[]) { return (await database().prepare(sql).bind(...args).all<T>()).results; }
export async function run(sql: string, ...args: (string | number | null)[]) { return database().prepare(sql).bind(...args).run(); }
export const json = (data: unknown, status = 200, headers: HeadersInit = {}) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
export async function body<T>(request: Request): Promise<T> {
  if (!request.headers.get('content-type')?.includes('application/json')) throw new HttpError(415, 'Please send JSON.');
  const raw = await request.text(); if (raw.length > 18000) throw new HttpError(413, 'This request is too large.');
  try { return JSON.parse(raw) as T; } catch { throw new HttpError(400, 'Invalid request.'); }
}
