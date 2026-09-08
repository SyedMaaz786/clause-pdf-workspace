import { database, runtime } from './runtime';

/**
 * PDF byte storage. Uses R2 when a `BUCKET` binding is present; otherwise keeps
 * the bytes in D1 so the app runs on a single datastore with nothing else to
 * provision. D1 caps a value at 2 MB, so blobs are split across rows.
 */
const CHUNK = 900_000;

export async function putObject(key: string, bytes: Uint8Array) {
  const bucket = runtime().BUCKET;
  if (bucket) return void (await bucket.put(key, bytes, { httpMetadata: { contentType: 'application/pdf' } }));
  const db = database();
  await db.prepare('DELETE FROM blobs WHERE key = ?').bind(key).run();
  for (let offset = 0, ordinal = 0; offset < bytes.byteLength; offset += CHUNK, ordinal++) {
    // D1 binds an ArrayBuffer for a BLOB column, not a typed-array view.
    const part = bytes.slice(offset, offset + CHUNK).buffer;
    await db.prepare('INSERT INTO blobs (key, ordinal, bytes) VALUES (?, ?, ?)').bind(key, ordinal, part).run();
  }
}

export async function getObject(key: string): Promise<ArrayBuffer | null> {
  const bucket = runtime().BUCKET;
  if (bucket) { const object = await bucket.get(key); return object ? object.arrayBuffer() : null; }
  const rows = (await database().prepare('SELECT bytes FROM blobs WHERE key = ? ORDER BY ordinal').bind(key).all<{ bytes: ArrayBuffer }>()).results;
  if (!rows.length) return null;
  const parts = rows.map(r => new Uint8Array(r.bytes));
  const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
  let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.byteLength; }
  return out.buffer;
}

export async function deleteObject(key: string) {
  const bucket = runtime().BUCKET;
  if (bucket) return void (await bucket.delete(key));
  await database().prepare('DELETE FROM blobs WHERE key = ?').bind(key).run();
}
