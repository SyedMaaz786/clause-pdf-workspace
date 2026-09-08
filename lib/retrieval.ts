import type { Chunk } from './contracts';
const STOP = new Set('a an the is are was were what which how when who why does do can could would should about for to in of and or from on it this that these those my your document pdf please tell me'.split(' '));
export const tokenize = (text: string) => (text.toLowerCase().match(/[\p{L}\p{N}]{2,}/gu) || []).filter(t => !STOP.has(t));
/** Page-aware overlapping windows; every source retains its original page. */
export function chunkPages(pages: string[], size = 1800, overlap = 240): Chunk[] {
  const chunks: Chunk[] = [];
  pages.forEach((raw, index) => {
    const text = raw.replace(/\s+/g, ' ').trim();
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + size, text.length);
      if (end < text.length) { const boundary = text.lastIndexOf(' ', end); if (boundary > start + size / 2) end = boundary; }
      chunks.push({ id: `p${index + 1}-${start}`, page: index + 1, ordinal: chunks.length, text: text.slice(start, end) });
      if (end === text.length) break;
      start = end - overlap;
    }
  });
  return chunks;
}
/** BM25 retrieval with previous questions for follow-ups; bounded context. */
export function retrieve(chunks: Chunk[], question: string, previousQuestions: string[] = [], budget = 16000): Chunk[] {
  const terms = [...new Set(tokenize(question + ' ' + previousQuestions.slice(-2).join(' ')))];
  const docs = chunks.map(c => tokenize(c.text));
  const avg = docs.reduce((n, d) => n + d.length, 0) / (docs.length || 1);
  const df = new Map(terms.map(t => [t, docs.filter(d => d.includes(t)).length]));
  const ranked = chunks.map((c, i) => {
    let score = 0;
    for (const term of terms) {
      const tf = docs[i].filter(t => t === term).length;
      const idf = Math.log(1 + (chunks.length - (df.get(term) || 0) + .5) / ((df.get(term) || 0) + .5));
      score += idf * tf * 2.2 / (tf + 1.2 * (.25 + .75 * docs[i].length / (avg || 1)));
    }
    return { ...c, score };
  }).sort((a, b) => b.score - a.score || a.ordinal - b.ordinal);
  const selected: Chunk[] = []; let used = 0;
  for (const c of ranked) { if (used + c.text.length > budget) continue; selected.push(c); used += c.text.length; if (selected.length >= 9) break; }
  return selected.sort((a, b) => a.ordinal - b.ordinal);
}
export function segments(chunks: Chunk[], budget = 22000): string[] {
  const result: string[] = []; let current = '';
  for (const chunk of chunks) { const text = `\n[Page ${chunk.page}] ${chunk.text}\n`; if (current.length + text.length > budget) { result.push(current); current = ''; } current += text; }
  if (current) result.push(current); return result;
}
export function cosine(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) return 0;
  let dot = 0, aa = 0, bb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i] * b[i]; aa += a[i] ** 2; bb += b[i] ** 2; }
  return dot / (Math.sqrt(aa * bb) || 1);
}
