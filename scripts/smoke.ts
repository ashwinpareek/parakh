// Engine smoke test: parses the sample pack in Node and prints what the engine finds.
// Run: npx tsx scripts/smoke.ts
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import { parseInvoiceText } from '../src/ingest/parser';
import type { PdfText, TextItem } from '../src/ingest/pdf';
import { analyze } from '../src/domain/analyze';
import type { Invoice } from '../src/domain/types';
import { fromAi } from '../src/ai/tasks';

const ROOT = join(import.meta.dirname, '..', 'public', 'samples');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const company = { name: manifest.company.name, gstin: manifest.company.gstin, stateCode: manifest.company.state };

async function pdfText(path: string): Promise<PdfText> {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(path)) }).promise;
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 1 });
  const tc = await page.getTextContent();
  const items: TextItem[] = [];
  for (const it of tc.items as { str: string; transform: number[]; width: number; height: number }[]) {
    if (!it.str?.trim()) continue;
    const h = Math.abs(it.transform[3]) || 8;
    items.push({ str: it.str, page: 1, x: it.transform[4], y: vp.height - it.transform[5] - h * 0.82, w: it.width, h });
  }
  return { pages: doc.numPages, pageSize: { w: vp.width, h: vp.height }, items };
}

const invoices: Invoice[] = [];
const refs = JSON.parse(readFileSync(join(ROOT, 'reference_extractions.json'), 'utf8'));
for (const [i, rel] of (manifest.invoices as string[]).entries()) {
  const path = join(ROOT, rel);
  if (rel.endsWith('.pdf')) {
    const r = parseInvoiceText(await pdfText(path), company);
    invoices.push({ ...r.invoice, id: `doc${i}`, source: { kind: 'pdf', fileName: rel } });
  } else {
    invoices.push({ ...fromAi(refs[rel]), id: `doc${i}`, source: { kind: 'image', fileName: rel } });
  }
}

// register via a tiny CSV reader (the app uses SheetJS)
const csv = readFileSync(join(ROOT, 'purchase_register.csv'), 'utf8').trim().split('\n').map((l) => l.split(','));
const [h, ...rows] = csv;
const col = (r: string[], name: string) => r[h.indexOf(name)];
rows.forEach((r, i) => {
  const tx = +col(r, 'Taxable Value'), ig = +col(r, 'IGST'), cg = +col(r, 'CGST'), sg = +col(r, 'SGST');
  const [d, m, y] = col(r, 'Supplier Invoice Date').split('-');
  invoices.push({
    id: `reg-${i}`, source: { kind: 'register', fileName: 'purchase_register.csv', row: i + 2 }, extraction: { method: 'structured', confidence: 1 },
    invoiceNo: col(r, 'Supplier Invoice No'), invoiceDate: `${y}-${m}-${d}`, supplier: { name: col(r, 'Party Name'), gstin: col(r, 'Party GSTIN') }, buyer: { name: '', gstin: null },
    placeOfSupply: '36', reverseCharge: false, irn: null, hasSignature: null,
    items: [{ description: col(r, 'Item Description'), hsn: col(r, 'HSN/SAC'), qty: null, unitPrice: null, taxableValue: tx, gstRate: +col(r, 'GST Rate'), cgst: cg, sgst: sg, igst: ig, cess: 0 }],
    taxableTotal: tx, cgstTotal: cg, sgstTotal: sg, igstTotal: ig, cessTotal: 0, roundOff: 0, grandTotal: +col(r, 'Invoice Value'),
    paymentStatus: col(r, 'Payment Status') === 'Unpaid' ? 'unpaid' : 'paid',
  });
});

const g = JSON.parse(readFileSync(join(ROOT, manifest.gstr2b), 'utf8')).data.data;
let n = 0;
const portal = g.docdata.b2b.flatMap((s: any) => s.inv.map((inv: any) => ({
  id: `p${++n}`, ctin: s.ctin, tradeName: s.trdnm, supplierFiledOn: null, supplierPeriod: s.supprd, invoiceNo: inv.inum,
  invoiceDate: inv.dt.split('-').reverse().join('-'), invoiceValue: inv.val, placeOfSupply: inv.pos, reverseCharge: inv.rev === 'Y', itcAvailable: inv.itcavl !== 'N', itcReason: inv.rsn || null, source: null, irn: null,
  taxable: inv.items.reduce((a: number, b: any) => a + b.txval, 0), igst: inv.items.reduce((a: number, b: any) => a + b.igst, 0), cgst: inv.items.reduce((a: number, b: any) => a + b.cgst, 0), sgst: inv.items.reduce((a: number, b: any) => a + b.sgst, 0), cess: 0, rates: [],
})));

const a = analyze({ company, period: manifest.period, asOf: '2026-10-09', invoices, portal });
for (const inv of invoices.filter((x) => x.source.kind !== 'register')) {
  const v = a.verdicts[inv.id];
  console.log(`\n${inv.source.fileName.replace('invoices/', '')}  [${manifest.scenarios[inv.source.fileName.replace('invoices/', '')]}]`);
  console.log(`  no=${inv.invoiceNo} date=${inv.invoiceDate} sup=${inv.supplier.name}/${inv.supplier.gstin} buy=${inv.buyer.gstin} pos=${inv.placeOfSupply} items=${inv.items.length} taxable=${inv.taxableTotal} total=${inv.grandTotal} sig=${inv.hasSignature} conf=${inv.extraction.confidence.toFixed(2)}`);
  console.log(`  items: ${inv.items.map((i) => `${i.description.slice(0, 28)}|${i.hsn}|${i.qty}x${i.unitPrice}=${i.taxableValue}@${i.gstRate}% c${i.cgst} s${i.sgst} i${i.igst}`).join(' ;; ')}`);
  console.log(`  risk=${v.risk} ${v.band} itc=${v.itcClaimed} atRisk=${v.itcAtRisk} ims=${v.ims}`);
  for (const f of a.findings.filter((x) => x.invoiceId === inv.id)) console.log(`   - ${f.severity.padEnd(8)} ${f.ruleId.padEnd(20)} ${f.title}  (₹${f.itcAtRisk})`);
}
console.log('\nREGISTER findings:');
for (const inv of invoices.filter((x) => x.source.kind === 'register')) {
  const fs = a.findings.filter((x) => x.invoiceId === inv.id);
  if (fs.length) console.log(`  ${inv.invoiceNo}: ${fs.map((f) => `${f.ruleId}`).join(', ')}`);
}
console.log('\nTOTALS', JSON.stringify(a.totals, null, 1));
console.log('missing-in-books', a.recon.filter((r) => r.status === 'missing-in-books').map((r) => portal.find((p: any) => p.id === r.portalId)!.invoiceNo));
