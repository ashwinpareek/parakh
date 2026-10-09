// Orchestrates rules + reconciliation into one Analysis: findings, per-invoice verdicts
// (risk score, ITC at risk, recommended IMS action), vendor scorecards and headline totals.

import type { Analysis, Company, Finding, FindingCategory, ImsAction, Invoice, InvoiceVerdict, PortalRecord, ReconRow, ReconStatus, Severity, VendorScore } from './types';
import { itcOf, runRules } from './rules';
import { reconcile } from './reconcile';
import { lookupRegistry } from './reference';
import { checkGstin } from './gstin';
import { round2 } from './text';
import { formatDate, formatINR, formatPeriod } from '../lib/format';

// Findings caused by the recipient's own books or choices, not the supplier.
const RECIPIENT_SIDE = new Set(['ITC-BLOCKED', 'ITC-TIME-BARRED', 'ITC-TIME-SOON', 'ITC-180-DAYS', 'ITC-180-SOON', 'DUP-EXACT', 'DUP-NEAR', 'RECON-OUT-OF-PERIOD', 'RECON-SUGGESTED']);
const WEIGHT: Record<Severity, number> = { critical: 0.6, high: 0.32, medium: 0.12, low: 0.04 };
export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];

export interface AnalyzeInput {
  company: Company;
  period: string;
  asOf: string;
  invoices: Invoice[];
  portal: PortalRecord[];
  /** Findings from the AI review, keyed by invoice id. Merged with rule findings. */
  aiFindings?: Record<string, Omit<Finding, 'id' | 'invoiceId' | 'source'>[]>;
  /** Pairs the user confirmed by hand ("invoiceId|portalId"). */
  confirmed?: Set<string>;
}

export function analyze(input: AnalyzeInput): Analysis {
  const { company, period, asOf, invoices, portal } = input;
  const ready = invoices.filter((i) => i.extraction.method !== 'pending');
  const findings: Finding[] = [];
  let seq = 0;
  const push = (invoiceId: string, d: Omit<Finding, 'id' | 'invoiceId' | 'source'>, source: Finding['source'] = 'rule') =>
    findings.push({ ...d, id: `f${++seq}`, invoiceId, source });

  // 1. invoice-level rules
  const duplicates = new Set<string>();
  for (const inv of ready) {
    for (const d of runRules(inv, { company, asOf, all: ready })) {
      if (d.ruleId === 'DUP-EXACT') duplicates.add(inv.id);
      push(inv.id, d);
    }
  }

  // 2. reconciliation (duplicates are excluded so the original keeps its match)
  const recon = reconcile(ready, portal, duplicates);
  const portalById = new Map(portal.map((p) => [p.id, p]));
  const invById = new Map(ready.map((i) => [i.id, i]));
  const periodStart = `${period}-01`;
  const [py, pm] = period.split('-').map(Number);
  const gstr1Due = `${pm === 12 ? py + 1 : py}-${String(pm === 12 ? 1 : pm + 1).padStart(2, '0')}-11`;
  for (const row of recon) {
    if (row.status === 'suggested' && input.confirmed?.has(`${row.invoiceId}|${row.portalId}`)) row.status = 'matched';
    if (!row.invoiceId) continue;
    const inv = invById.get(row.invoiceId)!;
    const itc = itcOf(inv);
    if (row.status === 'missing-in-2b') {
      const outOfPeriod = inv.invoiceDate && inv.invoiceDate < periodStart;
      push(inv.id, outOfPeriod
        ? { ruleId: 'RECON-OUT-OF-PERIOD', severity: 'medium', category: 'reconciliation', title: 'Not in this GSTR-2B (dated in an earlier period)', detail: `Invoice is dated ${inv.invoiceDate}; check the GSTR-2B of that month before claiming it now.`, itcAtRisk: 0, citation: 'Sec 16(2)(aa)', fix: 'Locate it in the earlier GSTR-2B, or treat as missing.' }
        : { ruleId: 'RECON-MISSING-2B', severity: 'high', category: 'reconciliation', title: 'Not reported by the supplier (missing in GSTR-2B)', detail: `The supplier has not reported this invoice in GSTR-1/IFF for ${formatPeriod(period)}. ITC can only be claimed once it appears in your GSTR-2B.${gstr1Due >= asOf ? ` Their GSTR-1 is due on ${formatDate(gstr1Due)}, so it may still arrive.` : ''}`, itcAtRisk: itc, citation: 'Sec 16(2)(aa); Rule 36(4)', fix: 'Hold the claim. Ask the supplier to report it in GSTR-1/IFF; it will flow into next month’s 2B.' });
    } else if (row.status === 'mismatch') {
      const rec = portalById.get(row.portalId!)!;
      const pTax = rec.igst + rec.cgst + rec.sgst + rec.cess;
      const excess = Math.max(0, round2(itc - pTax));
      const ineligible = !rec.itcAvailable;
      push(inv.id, {
        ruleId: ineligible ? 'RECON-2B-INELIGIBLE' : 'RECON-MISMATCH', severity: ineligible ? 'critical' : 'high', category: 'reconciliation',
        title: ineligible ? 'GSTR-2B marks this ITC as not available' : 'Books and GSTR-2B disagree',
        detail: row.reasons.join(' ') || row.diffs.map((d) => `${d.label}: books ${d.books ?? '—'} vs 2B ${d.portal ?? '—'}`).join('; '),
        itcAtRisk: ineligible ? itc : excess, citation: 'Sec 16(2)(aa)',
        fix: ineligible ? 'Do not claim. Resolve the underlying issue with the supplier.' : excess > 0 ? `Claim the lower figure (${formatINR(pTax)}) and ask the supplier to amend via GSTR-1A.` : 'Supplier reported more than you booked; check for a missing debit note before accepting.',
      });
    } else if (row.status === 'suggested') {
      push(inv.id, { ruleId: 'RECON-SUGGESTED', severity: 'low', category: 'reconciliation', title: 'Matched with differences in formatting', detail: row.reasons.join(' '), itcAtRisk: 0, fix: 'Confirm the match and correct the reference in your books so future periods match automatically.' });
    }
  }

  // A GSTIN typo on the printed invoice is a document defect, not lost credit, when the supplier's
  // own filing (which is what GSTR-2B and ITC follow) carries a valid GSTIN.
  for (const row of recon) {
    if (!row.invoiceId || !row.portalId || !row.diffs.some((d) => d.field === 'gstin')) continue;
    const fnd = findings.find((x) => x.invoiceId === row.invoiceId && x.ruleId === 'GSTIN-SUP-INVALID');
    const rec = portalById.get(row.portalId)!;
    if (fnd && checkGstin(rec.ctin).valid) {
      fnd.severity = 'high';
      fnd.itcAtRisk = 0;
      fnd.detail += ` The supplier's GSTR-1 uses ${rec.ctin}, which is valid, so the credit still reaches your GSTR-2B.`;
      fnd.fix = `Correct the GSTIN to ${rec.ctin} in your purchase register and ask the supplier for a corrected copy for your records.`;
    }
  }

  for (const [id, list] of Object.entries(input.aiFindings ?? {})) {
    if (!invById.has(id)) continue;
    for (const fnd of list) {
      // An AI finding never duplicates a rule finding with the same rule id.
      if (findings.some((x) => x.invoiceId === id && (x.ruleId === fnd.ruleId || (fnd.field && x.category === fnd.category && x.field?.split('.').slice(0, 2).join('.') === fnd.field.split('.').slice(0, 2).join('.'))))) continue;
      push(id, fnd, 'ai');
    }
  }

  // 3. verdicts
  const verdicts: Record<string, InvoiceVerdict> = {};
  const reconByInv = new Map(recon.filter((r) => r.invoiceId).map((r) => [r.invoiceId!, r]));
  for (const inv of ready) {
    const fs = findings.filter((x) => x.invoiceId === inv.id);
    const itc = itcOf(inv);
    const atRisk = Math.min(itc, fs.reduce((m, x) => Math.max(m, x.itcAtRisk), 0));
    const ratio = itc > 0 ? atRisk / itc : 0;
    // Severity drives the score; the share of credit at stake sets a floor, so an invoice whose
    // whole ITC is blocked never reads as "review".
    const risk = Math.max(Math.round(100 * (1 - fs.reduce((p, x) => p * (1 - WEIGHT[x.severity]), 1))), ratio > 0 ? Math.round(40 + 50 * ratio) : 0);
    const { ims, reason } = imsFor(inv, fs, reconByInv.get(inv.id), duplicates.has(inv.id));
    verdicts[inv.id] = { invoiceId: inv.id, risk, band: risk >= 55 ? 'high' : risk >= 20 ? 'review' : 'clear', itcClaimed: itc, itcAtRisk: round2(atRisk), ims, imsReason: reason };
  }

  // 4. vendors
  const vendors = vendorScores(ready, portal, findings, verdicts, recon);

  // 5. totals
  const byCategory = {} as Analysis['totals']['byCategory'];
  const cats: FindingCategory[] = ['mandatory-fields', 'gstin', 'tax-math', 'place-of-supply', 'rate', 'itc-eligibility', 'reconciliation', 'fraud-signal', 'e-invoice'];
  for (const c of cats) byCategory[c] = { count: 0, itc: 0 };
  for (const x of findings) {
    byCategory[x.category].count++;
  }
  // Attribute each invoice's ITC at risk to the category of its largest finding, so the
  // breakdown sums exactly to the headline figure.
  for (const inv of ready) {
    const v = verdicts[inv.id];
    if (!v.itcAtRisk) continue;
    const top = findings.filter((x) => x.invoiceId === inv.id).sort((a, b) => b.itcAtRisk - a.itcAtRisk || WEIGHT[b.severity] - WEIGHT[a.severity])[0];
    if (top) byCategory[top.category].itc = round2(byCategory[top.category].itc + v.itcAtRisk);
  }
  const bySeverity = { critical: 0, high: 0, medium: 0, low: 0 } as Record<Severity, number>;
  for (const x of findings) bySeverity[x.severity]++;
  const reconCount = { matched: 0, suggested: 0, mismatch: 0, 'missing-in-2b': 0, 'missing-in-books': 0 } as Record<ReconStatus, number>;
  for (const r of recon) reconCount[r.status]++;
  const ims = { accept: 0, pending: 0, reject: 0, 'n/a': 0 } as Record<ImsAction, number>;
  for (const v of Object.values(verdicts)) ims[v.ims]++;
  const portalOnly = recon.filter((r) => r.status === 'missing-in-books').map((r) => portalById.get(r.portalId!)!);
  for (const p of portalOnly) ims[portalImsAction(p, ready).ims]++;

  const itcClaimed = round2(Object.values(verdicts).reduce((s, v) => s + v.itcClaimed, 0));
  const itcAtRisk = round2(Object.values(verdicts).reduce((s, v) => s + v.itcAtRisk, 0));
  const matchedish = reconCount.matched + reconCount.suggested;
  const denominator = recon.filter((r) => r.invoiceId).length;

  return {
    company, period, asOf, invoices, portal, findings, recon, verdicts, vendors,
    totals: {
      invoices: ready.length, itcClaimed, itcAtRisk, itcSafe: round2(itcClaimed - itcAtRisk),
      matchRate: denominator ? matchedish / denominator : 0,
      byCategory, bySeverity, recon: reconCount, ims,
      portalOnlyTax: round2(portalOnly.reduce((s, p) => s + p.igst + p.cgst + p.sgst + p.cess, 0)),
    },
  };
}

function imsFor(_inv: Invoice, fs: Finding[], row: ReconRow | undefined, isDuplicate: boolean): { ims: ImsAction; reason: string } {
  if (isDuplicate) return { ims: 'n/a', reason: 'Duplicate copy; act on the original only.' };
  if (!row || row.status === 'missing-in-2b') return { ims: 'n/a', reason: 'Not in IMS yet: the supplier has not reported it. Nothing to accept.' };
  const has = (id: string) => fs.some((x) => x.ruleId === id);
  if (has('GSTIN-SUP-CANCELLED')) return { ims: 'reject', reason: 'Supplier registration was cancelled before the invoice date.' };
  if (has('TAX-HEAD-IGST') || has('TAX-HEAD-LOCAL')) return { ims: 'reject', reason: 'Wrong tax head. Rejecting lets the supplier correct it through GSTR-1A.' };
  if (has('POS-OTHER-STATE')) return { ims: 'reject', reason: 'Place of supply is outside your state; the supplier must re-issue.' };
  if (has('ITC-TIME-BARRED')) return { ims: 'reject', reason: 'ITC is time-barred under Sec 16(4).' };
  if (has('EINV-QR-FORGED')) return { ims: 'reject', reason: 'The e-invoice QR is not genuine. Reject until the IRN is verified on the portal.' };
  if (has('EINV-QR-MISMATCH')) return { ims: 'pending', reason: 'The printed copy differs from the registered e-invoice. Keep pending until the supplier explains; claim only the registered value.' };
  if (has('EINV-MISSING-IRN')) return { ims: 'pending', reason: 'Hold until the supplier provides the e-invoice (IRN) copy.' };
  if (has('RATE-LEGACY') || has('RATE-HSN') || has('MATH-LINE-TAX') || has('MATH-LINE-VALUE')) return { ims: 'pending', reason: 'Hold until the supplier issues a credit note or amends the values.' };
  if (row.status === 'mismatch') return { ims: 'pending', reason: 'Values differ from your books. Keep pending while the supplier amends via GSTR-1A.' };
  if (has('R46-BUYER-GSTIN') || has('R46-BUYER-OTHER')) return { ims: 'pending', reason: 'Invoice does not carry your GSTIN; get it corrected first.' };
  if (has('ITC-BLOCKED')) return { ims: 'accept', reason: 'Genuine purchase: accept, then report the blocked amount in GSTR-3B Table 4(B)(1).' };
  if (has('GSTIN-SUP-INVALID')) return { ims: 'accept', reason: 'Supplier filing is correct; only the printed GSTIN has a typo. Accept and get the invoice copy corrected.' };
  return { ims: 'accept', reason: 'Matches your books and passes all checks.' };
}

export function portalImsAction(p: PortalRecord, books: Invoice[]): { ims: ImsAction; reason: string } {
  const known = books.some((b) => b.supplier.gstin === p.ctin);
  const reg = lookupRegistry(p.ctin);
  if (!known) {
    const newReg = reg && (Date.parse(p.invoiceDate) - Date.parse(reg.registeredOn)) / 86400000 < 180;
    return { ims: 'reject', reason: `No purchase history with this supplier${newReg ? ' and the GSTIN is newly registered' : ''}. Possible misuse of your GSTIN; reject unless someone can confirm the purchase.` };
  }
  return { ims: 'pending', reason: 'Known supplier, but the invoice is not in your books. Check the goods-receipt register, then accept and record it.' };
}

function vendorScores(invs: Invoice[], portal: PortalRecord[], findings: Finding[], verdicts: Record<string, InvoiceVerdict>, recon: ReconRow[]): VendorScore[] {
  const map = new Map<string, VendorScore & { riskSum: number }>();
  const key = (inv: Invoice) => inv.supplier.gstin ?? `name:${inv.supplier.name}`;
  for (const inv of invs) {
    const k = key(inv);
    const v = map.get(k) ?? { gstin: inv.supplier.gstin ?? '—', name: inv.supplier.name, invoices: 0, findings: 0, critical: 0, itcAtRisk: 0, itcTotal: 0, score: 100, missingIn2b: 0, lastFiled: null, riskSum: 0, registry: lookupRegistry(inv.supplier.gstin) };
    const fs = findings.filter((x) => x.invoiceId === inv.id && !RECIPIENT_SIDE.has(x.ruleId));
    v.invoices++;
    v.findings += fs.length;
    v.critical += fs.filter((x) => x.severity === 'critical').length;
    v.itcAtRisk = round2(v.itcAtRisk + verdicts[inv.id].itcAtRisk);
    v.itcTotal = round2(v.itcTotal + verdicts[inv.id].itcClaimed);
    v.riskSum += Math.round(100 * (1 - fs.reduce((p, x) => p * (1 - WEIGHT[x.severity]), 1)));
    if (recon.some((r) => r.invoiceId === inv.id && r.status === 'missing-in-2b')) v.missingIn2b++;
    map.set(k, v);
  }
  for (const v of map.values()) {
    const ids = new Set(invs.filter((i) => (i.supplier.gstin ?? `name:${i.supplier.name}`) === (v.gstin === '—' ? `name:${v.name}` : v.gstin)).map((i) => i.id));
    const linked = new Set(recon.filter((r) => r.invoiceId && ids.has(r.invoiceId) && r.portalId).map((r) => r.portalId));
    const filed = portal.filter((p) => p.ctin === v.gstin || linked.has(p.id)).map((p) => p.supplierFiledOn).filter(Boolean).sort();
    v.lastFiled = filed[filed.length - 1] ?? null;
    let score = 100 - v.riskSum / v.invoices;
    if (v.missingIn2b) score -= 12;
    if (v.registry?.status === 'Cancelled') score = Math.min(score, 10);
    v.score = Math.max(0, Math.min(100, Math.round(score)));
  }
  return [...map.values()].map(({ riskSum: _r, ...v }) => v).sort((a, b) => a.score - b.score || b.itcAtRisk - a.itcAtRisk);
}
