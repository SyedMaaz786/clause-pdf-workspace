import { getDocumentProxy } from 'unpdf';
import { z } from 'zod';
import type { Chunk } from '../contracts';
import { chunkPages, segments } from '../retrieval';
import { all, database, HttpError, id, now, one, run, runtime } from './runtime';
import { aiReady, embed, generate } from './ai';

export const PUBLIC_FIELDS = 'd.id, d.filename, d.size, d.page_count, d.created_at, d.status, d.summary, d.category, d.insights, d.error, d.process_index, d.segment_count';
export async function getPublicDocument(documentId: string) {
  return one(`SELECT ${PUBLIC_FIELDS}, (SELECT COUNT(*) FROM shares s WHERE s.document_id = d.id AND s.revoked_at IS NULL AND s.expires_at > ${now()}) AS share_count, (SELECT COUNT(*) FROM comments c WHERE c.document_id = d.id) AS comment_count FROM documents d WHERE d.id = ?`, documentId);
}
export async function savePdf(ownerId: string, file: File) {
  if (file.size < 8 || file.size > 10 * 1024 * 1024) throw new HttpError(400, 'Choose a PDF smaller than 10 MB.');
  if (!file.name.toLowerCase().endsWith('.pdf') || (file.type && file.type !== 'application/pdf')) throw new HttpError(400, 'Only PDF files are supported.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (new TextDecoder().decode(bytes.slice(0, 5)) !== '%PDF-') throw new HttpError(400, 'This file is not a valid PDF.');
  let pages: string[];
  let pdf: Awaited<ReturnType<typeof getDocumentProxy>> | undefined;
  try {
    pdf = await getDocumentProxy(bytes.slice());
    if (pdf.numPages > 200) throw new HttpError(400, 'PDFs can contain up to 200 pages. Split this document into smaller files.');
    pages = []; let characters = 0;
    // Read sequentially to keep the memory footprint bounded on Workers.
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const text = content.items.map(item => 'str' in item ? item.str + ('hasEOL' in item && item.hasEOL ? '\n' : ' ') : '').join('');
      characters += text.length;
      if (characters > 800000) throw new HttpError(400, 'This PDF contains too much text. Please split it into smaller documents.');
      pages.push(text); page.cleanup();
    }
  } catch (error) { if (error instanceof HttpError) throw error; throw new HttpError(400, 'This PDF could not be read. Check that it is not damaged or password-protected.'); }
  finally { await pdf?.loadingTask.destroy(); }
  if (pages.join('').length > 800000) throw new HttpError(400, 'This PDF contains too much text. Please split it into smaller documents.');
  const chunks = chunkPages(pages), documentId = id(), objectKey = `${ownerId}/${documentId}.pdf`;
  const filename = file.name.replace(/[\x00-\x1f\x7f/\\]/g, '_').slice(0, 180);
  const noText = chunks.reduce((n, c) => n + c.text.length, 0) < 40;
  const error = noText ? 'This PDF has no readable text. Upload a text-based or OCR-processed PDF to use AI.' : !aiReady() ? 'AI is not configured yet. Your PDF is safely stored.' : null;
  const count = segments(chunks).length;
  await runtime().BUCKET.put(objectKey, bytes, { httpMetadata: { contentType: 'application/pdf' } });
  try {
    await run('INSERT INTO documents (id, owner_id, filename, object_key, size, page_count, created_at, status, error, segment_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', documentId, ownerId, filename, objectKey, file.size, pages.length, now(), error ? 'error' : 'pending', error, count);
    for (let offset = 0; offset < chunks.length; offset += 40) {
      await database().batch(chunks.slice(offset, offset + 40).map(c => database().prepare('INSERT INTO chunks (id, document_id, page, ordinal, text) VALUES (?, ?, ?, ?, ?)').bind(`${documentId}:${c.id}`, documentId, c.page, c.ordinal, c.text)));
    }
  } catch (error) { await run('DELETE FROM documents WHERE id = ?', documentId); await runtime().BUCKET.delete(objectKey); throw error; }
  return documentId;
}
const resultSchema = z.object({
  summary: z.string().min(80).max(3000), category: z.enum(['Agreement', 'Report', 'Research', 'Policy', 'Other']),
  insights: z.array(z.object({ label: z.string().max(50), value: z.string().max(240), page: z.number().int().positive() })).max(4),
});
/** One leased, resumable AI stage per request: avoids background-worker timeout loss. */
export async function processDocument(documentId: string) {
  if (!aiReady()) throw new HttpError(503, 'Add a Gemini API key on the server to enable document analysis.');
  const lease = await run("UPDATE documents SET lease_until = ?, status = 'processing', error = NULL WHERE id = ? AND lease_until < ? AND status != 'ready'", now() + 90000, documentId, now());
  if (!lease.meta.changes) return getPublicDocument(documentId);
  try {
    const doc = await one<{ process_index: number; notes: string; filename: string; page_count: number }>('SELECT process_index, notes, filename, page_count FROM documents WHERE id = ?', documentId);
    if (!doc) throw new HttpError(404, 'Document not found.');
    const chunks = await all<Chunk>('SELECT id, page, ordinal, text FROM chunks WHERE document_id = ? ORDER BY ordinal', documentId);
    const parts = segments(chunks), notes = JSON.parse(doc.notes) as string[];
    if (!parts.length) throw new HttpError(422, 'This PDF has no readable text. Upload an OCR-processed copy to enable AI.');
    if (parts.length > 1 && doc.process_index < parts.length) {
      const note = await generate('Extract a compact factual brief for this section, at most 400 words. Include document purpose, parties, obligations, amounts, dates, termination, exceptions and any unresolved ambiguities, when present. Retain [p. N] references. Do not repeat boilerplate. Evidence:\n' + parts[doc.process_index]);
      notes.push(note);
      await run('UPDATE documents SET notes = ?, process_index = process_index + 1, lease_until = 0 WHERE id = ?', JSON.stringify(notes), documentId);
    } else {
      const evidence = parts.length === 1 ? parts[0] : notes.join('\n\n');
      const raw = await generate(`Return JSON with keys summary, category, insights. summary must contain 3-5 concise sentences explaining this document's actual purpose, named parties or subject, material obligations/findings, and significant dates, amounts or limitations. Preserve source citations [p. N]. Avoid generic introductions and unsupported risk assessments. category is one of Agreement, Report, Research, Policy, Other. insights is up to 4 objects with label, value, page, containing the most useful concrete facts; use only pages in the evidence. Filename: ${doc.filename}\nEVIDENCE:\n${evidence}`, true);
      const parsed = resultSchema.parse(JSON.parse(raw));
      parsed.insights = parsed.insights.filter(i => i.page <= doc.page_count);
      // Search vectors are derived from the whole-document summary and every section brief.
      let embedding: string | null = null;
      try { embedding = JSON.stringify(await embed(`${doc.filename}\n${parsed.summary}\n${notes.join('\n')}`)); } catch { console.error('document_embedding_unavailable', { documentId }); }
      await run("UPDATE documents SET summary = ?, category = ?, insights = ?, embedding = ?, status = 'ready', process_index = segment_count, lease_until = 0 WHERE id = ?", parsed.summary, parsed.category, JSON.stringify(parsed.insights), embedding, documentId);
    }
  } catch (error) {
    const message = error instanceof HttpError ? error.message : 'Analysis could not finish. Your PDF is saved; retry to continue from the last completed step.';
    await run("UPDATE documents SET status = 'error', error = ?, lease_until = 0 WHERE id = ?", message, documentId);
    throw error instanceof HttpError ? error : new HttpError(502, message);
  }
  return getPublicDocument(documentId);
}
