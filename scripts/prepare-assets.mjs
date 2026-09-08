import { copyFile, mkdir } from 'node:fs/promises';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { writeFile } from 'node:fs/promises';
await mkdir('public/samples', { recursive: true });
await copyFile('node_modules/pdfjs-dist/build/pdf.worker.min.mjs', 'public/pdf.worker.min.mjs');

const pages = [
  ['MASTER SERVICES AGREEMENT', 'NORTHSTAR  /  MERIDIAN', '01  THE ENGAGEMENT',
    'This Master Services Agreement is entered into on September 1, 2026 between Northstar Labs, Inc. (Client) and Meridian Studio LLC (Provider).',
    '1. Scope of services', 'Provider will design and develop a customer analytics dashboard, including discovery, interface design, front-end implementation, and handover documentation. The project includes three design review rounds.',
    '2. Project timeline', 'The project starts September 15, 2026 and ends December 15, 2026. Discovery is due September 30; the approved design is due October 31; production handover is due December 15.',
    '3. Collaboration', 'Each party will appoint one project lead. The parties will hold a weekly progress review. Client will provide consolidated feedback within five business days. Delays in feedback may extend delivery dates by mutual written agreement.',
    '4. Changes to scope', 'Additional work requires a written change order approved by both parties. A change order must specify deliverables, fees, and schedule changes. Verbal requests do not change the agreed scope.'],
  ['COMMERCIAL TERMS', 'NORTHSTAR  /  MERIDIAN', '02  FEES & OWNERSHIP',
    '5. Fees and payment', 'The total fixed project fee is USD 48,000, payable in three installments: 40% (USD 19,200) on signing, 30% (USD 14,400) on design approval, and 30% (USD 14,400) on final delivery.',
    'Invoices are due within 15 calendar days of receipt. Fees exclude applicable taxes. Pre-approved travel expenses are reimbursable at cost. There are no automatic renewal fees.',
    '6. Acceptance', 'Client has ten business days after delivery to identify material deviations from the approved scope in writing. Provider will remedy confirmed deviations within fifteen business days at no additional charge.',
    '7. Intellectual property', 'Upon full payment, Client owns the project-specific deliverables. Provider retains ownership of pre-existing tools, libraries, and methods, and grants Client a perpetual, non-exclusive license to use any of these included in the deliverables.',
    '8. Confidentiality', 'Both parties must protect confidential information with reasonable care and may disclose it only to personnel who need it for this project. This obligation continues for two years after termination. Publicly available information is excluded.'],
  ['TERM & RESPONSIBILITIES', 'NORTHSTAR  /  MERIDIAN', '03  THE DETAILS THAT MATTER',
    '9. Termination', 'Either party may terminate this agreement with 30 days of written notice. Client will pay for work completed and approved expenses incurred before the termination date. Provider will transfer completed and paid-for work within ten business days.',
    'Either party may terminate immediately for a material breach that remains uncured 14 days after written notice. The confidentiality and intellectual property provisions survive termination.',
    '10. Liability', 'Each party\'s aggregate liability is capped at the total fees paid under this agreement. This cap does not apply to fraud, willful misconduct, or breach of confidentiality. Neither party is liable for indirect or consequential damages, except where prohibited by law.',
    '11. Data handling', 'Provider may use only anonymized test data during development. Access to production data requires a separate data processing agreement. Provider will delete Client data within 30 days of final handover unless retention is required by law.',
    '12. Governing law and disputes', 'This agreement is governed by the laws of New York. The parties will first attempt to resolve disputes through good-faith negotiation for 30 days. Unresolved disputes will be submitted to the courts located in New York County.',
    'SAMPLE DOCUMENT - FOR PRODUCT DEMONSTRATION ONLY'],
];
const pdf = await PDFDocument.create();
const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
function wrap(text, max, font, size) {
  const lines = []; let current = '';
  for (const word of text.split(' ')) { const candidate = current ? current + ' ' + word : word; if (font.widthOfTextAtSize(candidate, size) > max && current) { lines.push(current); current = word; } else current = candidate; }
  if (current) lines.push(current); return lines;
}
for (let i = 0; i < pages.length; i++) {
  const page = pdf.addPage([595.28, 841.89]), [title, brand, section, ...paragraphs] = pages[i];
  page.drawRectangle({ x: 48, y: 784, width: 28, height: 3, color: rgb(.45,.32,.8) });
  page.drawText(brand, { x: 87, y: 781, size: 9, font: bold, color: rgb(.48,.45,.55) });
  page.drawText(section, { x: 48, y: 731, size: 8, font: bold, color: rgb(.52,.42,.64) });
  for (const [lineIndex,line] of wrap(title, 500, bold, 22).entries()) page.drawText(line, { x: 48, y: 699 - lineIndex * 27, size: 22, font: bold, color: rgb(.17,.15,.22) });
  let y = 648;
  for (const paragraph of paragraphs) {
    const heading = /^\d+\./.test(paragraph) && paragraph.length < 80;
    const size = heading ? 11 : paragraph.startsWith('SAMPLE') ? 8 : 10;
    const font = heading ? bold : regular;
    if (heading) y -= 8;
    for (const line of wrap(paragraph, 492, font, size)) { page.drawText(line, { x: 48, y, size, font, color: heading ? rgb(.23,.20,.28) : rgb(.38,.35,.42) }); y -= heading ? 17 : 16; }
    y -= 10;
  }
  page.drawLine({ start: { x: 48, y: 54 }, end: { x: 547, y: 54 }, thickness: .5, color: rgb(.88,.86,.91) });
  page.drawText('CONFIDENTIAL  |  SAMPLE AGREEMENT', { x: 48, y: 35, size: 7, font: regular, color: rgb(.6,.55,.64) });
  page.drawText(`${String(i + 1).padStart(2,'0')} / 03`, { x: 510, y: 35, size: 8, font: bold, color: rgb(.5,.4,.6) });
}
pdf.setTitle('Northstar - Meridian Master Services Agreement'); pdf.setAuthor('Clause sample documents');
await writeFile('public/samples/service-agreement.pdf', await pdf.save());
console.log('PDF worker and 3-page sample document prepared.');
