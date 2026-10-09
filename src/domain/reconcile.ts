// Books ↔ GSTR-2B reconciliation.
// Pairs each purchase invoice with the supplier-reported record using a weighted similarity score
// (invoice number, GSTIN, date, value), assigns greedily from the strongest pair down, then
// classifies every pair the way practitioners do: matched, suggested, mismatch, or missing.

import type { FieldDiff, Invoice, PortalRecord, ReconRow } from './types';
import { canonicalInvoiceNo, daysBetween, jaroWinkler, nameSimilarity, round2 } from './text';
import { charDiff, stateLabel } from './gstin';
import { formatDate, formatINR } from '../lib/format';

const TOL_TAX = 1; // rupees
const TOL_TAXABLE = 10;

interface Candidate { inv: Invoice; rec: PortalRecord; score: number; gstinExact: boolean }

function invNoScore(a: string | null, b: string): number {
  if (!a) return 0;
  if (a === b) return 1;
  const ca = canonicalInvoiceNo(a), cb = canonicalInvoiceNo(b);
  if (ca && ca === cb) return 0.96;
  const na = ca.replace(/\D/g, ''), nb = cb.replace(/\D/g, '');
  if (na && na === nb && na.length >= 3) return 0.85;
  return jaroWinkler(ca, cb) * 0.8;
}

function valueScore(inv: Invoice, rec: PortalRecord): number {
  const d = Math.abs(inv.taxableTotal - rec.taxable);
  const rel = d / Math.max(1, rec.taxable);
  if (d <= TOL_TAXABLE) return 1;
  if (rel <= 0.01) return 0.85;
  if (rel <= 0.15) return 0.55;
  return 0.15;
}

function dateScore(a: string | null, b: string): number {
  if (!a) return 0.3;
  const d = Math.abs(daysBetween(a, b));
  return d === 0 ? 1 : d <= 3 ? 0.8 : d <= 31 ? 0.45 : 0.1;
}

export function reconcile(invoices: Invoice[], portal: PortalRecord[], excluded: Set<string>): ReconRow[] {
  const books = invoices.filter((i) => !excluded.has(i.id));
  const cands: Candidate[] = [];
  for (const inv of books) {
    for (const rec of portal) {
      const g = inv.supplier.gstin;
      let gScore = 0;
      let exact = false;
      if (g && g === rec.ctin) { gScore = 1; exact = true; }
      else if (g && g.length === 15 && charDiff(g, rec.ctin) <= 2) gScore = 0.75;
      else if (nameSimilarity(inv.supplier.name, rec.tradeName) > 0.9) gScore = 0.6;
      else continue;
      const score = 0.45 * invNoScore(inv.invoiceNo, rec.invoiceNo) + 0.25 * valueScore(inv, rec) + 0.15 * dateScore(inv.invoiceDate, rec.invoiceDate) + 0.15 * gScore;
      if (score >= 0.62) cands.push({ inv, rec, score, gstinExact: exact });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const usedInv = new Set<string>(), usedRec = new Set<string>();
  const rows: ReconRow[] = [];

  for (const c of cands) {
    if (usedInv.has(c.inv.id) || usedRec.has(c.rec.id)) continue;
    usedInv.add(c.inv.id);
    usedRec.add(c.rec.id);
    rows.push(classify(c));
  }
  for (const inv of books) {
    if (usedInv.has(inv.id)) continue;
    rows.push({ id: `r-${inv.id}`, status: 'missing-in-2b', invoiceId: inv.id, confidence: 1, diffs: [], reasons: ['No matching record in GSTR-2B for this supplier and invoice.'] });
  }
  for (const rec of portal) {
    if (usedRec.has(rec.id)) continue;
    rows.push({ id: `r-${rec.id}`, status: 'missing-in-books', portalId: rec.id, confidence: 1, diffs: [], reasons: ['Reported by the supplier against your GSTIN but not in your purchase records.'] });
  }
  return rows;
}

function classify({ inv, rec, score, gstinExact }: Candidate): ReconRow {
  const diffs: FieldDiff[] = [];
  const reasons: string[] = [];
  let hard = false; // value or eligibility differences
  let soft = false; // formatting-level differences

  if (!gstinExact) {
    soft = true;
    diffs.push({ field: 'gstin', label: 'Supplier GSTIN', books: inv.supplier.gstin, portal: rec.ctin });
    const d = inv.supplier.gstin ? charDiff(inv.supplier.gstin, rec.ctin) : 15;
    reasons.push(d <= 2 ? `GSTIN on the invoice differs from the supplier’s filing by ${d} character${d > 1 ? 's' : ''}; likely a typo on the invoice.` : 'Matched on supplier name; GSTIN differs.');
  }
  if (inv.invoiceNo !== rec.invoiceNo) {
    soft = true;
    diffs.push({ field: 'invoiceNo', label: 'Invoice number', books: inv.invoiceNo, portal: rec.invoiceNo });
    reasons.push(canonicalInvoiceNo(inv.invoiceNo) === canonicalInvoiceNo(rec.invoiceNo) ? 'Same invoice, number formatted differently by the supplier.' : 'Invoice numbers are similar but not identical.');
  }
  if (inv.invoiceDate !== rec.invoiceDate) {
    soft = true;
    diffs.push({ field: 'invoiceDate', label: 'Invoice date', books: formatDate(inv.invoiceDate), portal: formatDate(rec.invoiceDate) });
    reasons.push(`Date differs by ${Math.abs(daysBetween(inv.invoiceDate ?? rec.invoiceDate, rec.invoiceDate))} day(s).`);
  }
  const bTax = round2(inv.igstTotal + inv.cgstTotal + inv.sgstTotal + inv.cessTotal);
  const pTax = round2(rec.igst + rec.cgst + rec.sgst + rec.cess);
  if (Math.abs(inv.taxableTotal - rec.taxable) > TOL_TAXABLE) {
    hard = true;
    diffs.push({ field: 'taxable', label: 'Taxable value', books: inv.taxableTotal, portal: rec.taxable });
  }
  if (Math.abs(bTax - pTax) > TOL_TAX) {
    hard = true;
    diffs.push({ field: 'tax', label: 'Total tax', books: bTax, portal: pTax });
    reasons.push(`Tax in books ${formatINR(bTax)} vs supplier filing ${formatINR(pTax)} (difference ${formatINR(bTax - pTax)}).`);
  }
  const headBooks = inv.igstTotal > 0.5 ? 'IGST' : 'CGST+SGST';
  const headPortal = rec.igst > 0.5 ? 'IGST' : 'CGST+SGST';
  if (headBooks !== headPortal && bTax > 0) {
    hard = true;
    diffs.push({ field: 'head', label: 'Tax head', books: headBooks, portal: headPortal });
  }
  if (inv.placeOfSupply && inv.placeOfSupply !== rec.placeOfSupply) {
    hard = true;
    diffs.push({ field: 'pos', label: 'Place of supply', books: stateLabel(inv.placeOfSupply), portal: stateLabel(rec.placeOfSupply) });
  }
  if (!rec.itcAvailable) {
    hard = true;
    diffs.push({ field: 'itcavl', label: 'ITC availability (2B)', books: 'Claimed', portal: `Not available${rec.itcReason ? ` (reason ${rec.itcReason})` : ''}` });
    reasons.push(rec.itcReason === 'P' ? 'GSTR-2B marks this ITC unavailable because of the place-of-supply rule.' : rec.itcReason === 'C' ? 'GSTR-2B marks this ITC unavailable because of the Sec 16(4) time limit.' : 'GSTR-2B marks this ITC unavailable.');
  }

  const status = hard ? 'mismatch' : soft ? 'suggested' : 'matched';
  return { id: `r-${inv.id}-${rec.id}`, status, invoiceId: inv.id, portalId: rec.id, confidence: Math.min(1, score), diffs, reasons };
}
