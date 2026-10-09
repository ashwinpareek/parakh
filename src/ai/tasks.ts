// The three things AI does in Parakh, each with a strict JSON contract:
//  1. extractInvoice  – read any invoice (scan, photo, odd layout) into structured fields
//  2. reviewInvoice   – semantic checks rules cannot do: HSN ↔ description fit, Sec 17(5) intent,
//                       and a plain-language verdict (optionally in Telugu or Hindi)
//  3. draftFollowUp   – the email / WhatsApp message to the supplier that gets the problem fixed

import type { AiProvider } from './provider';
import type { Company, Finding, Invoice, LineItem, Severity } from '../domain/types';
import { normalizeGstin, parseStateRef } from '../domain/gstin';
import { parseDate, round2 } from '../domain/text';
import { formatINR } from '../lib/format';

export type Lang = 'English' | 'Telugu' | 'Hindi';

const SCHEMA = `{
  "invoiceNo": string|null, "invoiceDate": "YYYY-MM-DD"|null,
  "supplier": {"name": string, "gstin": string|null, "address": string|null},
  "buyer": {"name": string|null, "gstin": string|null, "address": string|null},
  "placeOfSupply": "two-digit GST state code"|null, "reverseCharge": boolean|null,
  "irn": string|null, "hasSignature": boolean|null, "hasQrCode": boolean|null,
  "items": [{"description": string, "hsn": string|null, "qty": number|null, "unit": string|null, "unitPrice": number|null,
             "taxableValue": number, "gstRate": number|null, "cgst": number, "sgst": number, "igst": number, "cess": number}],
  "taxableTotal": number, "cgstTotal": number, "sgstTotal": number, "igstTotal": number, "cessTotal": number,
  "roundOff": number, "grandTotal": number,
  "confidence": {"invoiceNo": 0-1, "invoiceDate": 0-1, "supplier.gstin": 0-1, "buyer.gstin": 0-1, "items": 0-1, "grandTotal": 0-1},
  "notes": string|null
}`;

interface AiInvoice {
  invoiceNo: string | null; invoiceDate: string | null;
  supplier?: { name?: string; gstin?: string | null; address?: string | null };
  buyer?: { name?: string | null; gstin?: string | null; address?: string | null };
  placeOfSupply?: string | null; reverseCharge?: boolean | null; irn?: string | null; hasSignature?: boolean | null;
  items?: Partial<LineItem>[];
  taxableTotal?: number; cgstTotal?: number; sgstTotal?: number; igstTotal?: number; cessTotal?: number; roundOff?: number; grandTotal?: number;
  confidence?: Record<string, number>; notes?: string | null;
}

export async function extractInvoice(ai: AiProvider, images: Blob[], textLayer: string | null, signal?: AbortSignal): Promise<Omit<Invoice, 'id' | 'source'>> {
  const prompt = `You are reading an Indian GST tax invoice for a compliance check. Transcribe exactly what is printed; never correct, infer or complete values. If a field is absent, use null. GSTINs are 15 characters: copy every character exactly as printed even if it looks wrong. Amounts are plain numbers in rupees (no commas). Dates as YYYY-MM-DD (Indian invoices print DD-MM-YYYY). placeOfSupply is the two-digit state code (e.g. Telangana = "36"). hasSignature is true if there is a signature, stamp or "digitally signed" mark.
${textLayer ? `\nThe PDF text layer is included below to help with exact characters; prefer it for digits.\n<text_layer>\n${textLayer.slice(0, 12000)}\n</text_layer>\n` : ''}
Reply with only JSON in this shape:
${SCHEMA}`;
  const raw = await ai.json<AiInvoice>(prompt, { images, signal, tier: 'default' });
  return fromAi(raw);
}

export function fromAi(raw: AiInvoice): Omit<Invoice, 'id' | 'source'> {
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : typeof v === 'string' && v.trim() !== '' && !isNaN(Number(v.replace(/,/g, ''))) ? Number(v.replace(/,/g, '')) : null);
  const items: LineItem[] = (raw.items ?? []).map((i) => ({
    description: String(i.description ?? ''), hsn: i.hsn ? String(i.hsn).replace(/\s/g, '') : null, qty: n(i.qty), unit: i.unit ?? null, unitPrice: n(i.unitPrice),
    taxableValue: n(i.taxableValue) ?? 0, gstRate: n(i.gstRate), cgst: n(i.cgst) ?? 0, sgst: n(i.sgst) ?? 0, igst: n(i.igst) ?? 0, cess: n(i.cess) ?? 0,
  }));
  const sum = (k: keyof LineItem) => round2(items.reduce((s, i) => s + (Number(i[k]) || 0), 0));
  const conf = raw.confidence ?? {};
  const keys = ['invoiceNo', 'invoiceDate', 'supplier.gstin', 'items', 'grandTotal'];
  const sGstin = normalizeGstin(raw.supplier?.gstin ?? null);
  const bGstin = normalizeGstin(raw.buyer?.gstin ?? null);
  return {
    extraction: { method: 'ai-vision', confidence: keys.reduce((s, k) => s + (Number(conf[k]) || 0.8), 0) / keys.length, fieldConfidence: conf, note: raw.notes ?? undefined },
    invoiceNo: raw.invoiceNo ?? null,
    invoiceDate: parseDate(raw.invoiceDate) ?? null,
    supplier: { name: raw.supplier?.name ?? '', gstin: sGstin, address: raw.supplier?.address ?? undefined, stateCode: sGstin?.slice(0, 2) ?? null },
    buyer: { name: raw.buyer?.name ?? '', gstin: bGstin, address: raw.buyer?.address ?? undefined, stateCode: bGstin?.slice(0, 2) ?? null },
    placeOfSupply: raw.placeOfSupply ? parseStateRef(String(raw.placeOfSupply)) : null,
    reverseCharge: raw.reverseCharge ?? null, irn: raw.irn ?? null, hasSignature: raw.hasSignature ?? null,
    items,
    taxableTotal: n(raw.taxableTotal) ?? sum('taxableValue'), cgstTotal: n(raw.cgstTotal) ?? sum('cgst'), sgstTotal: n(raw.sgstTotal) ?? sum('sgst'),
    igstTotal: n(raw.igstTotal) ?? sum('igst'), cessTotal: n(raw.cessTotal) ?? sum('cess'), roundOff: n(raw.roundOff) ?? 0,
    grandTotal: n(raw.grandTotal) ?? round2(sum('taxableValue') + sum('cgst') + sum('sgst') + sum('igst')),
  };
}

// ------------------------------------------------------------------------------- review

export interface AiReview {
  verdict: string;
  lines: { line: number; hsnFits: boolean; suggestedHsn: string | null; expectedRate: number | null; blockedCredit: boolean; clause: string | null; note: string }[];
  findings: { severity: Severity; title: string; detail: string; citation: string | null; itcAtRisk: number; field: string | null }[];
}

export async function reviewInvoice(ai: AiProvider, inv: Invoice, company: Company, ruleFindings: Finding[], lang: Lang, signal?: AbortSignal): Promise<AiReview> {
  const lines = inv.items.map((i, k) => `${k + 1}. "${i.description}" | HSN ${i.hsn ?? 'none'} | ${i.gstRate ?? '?'}% | taxable ${i.taxableValue} | tax ${round2(i.cgst + i.sgst + i.igst)}`).join('\n');
  const known = ruleFindings.map((f) => `- [${f.severity}] ${f.title}`).join('\n') || '- none';
  const prompt = `You are a senior Indian GST practitioner reviewing a purchase invoice before the recipient claims input tax credit (ITC).
Recipient: ${company.name}, GSTIN ${company.gstin}, a manufacturer of precision engineering components.
Supplier: ${inv.supplier.name} (${inv.supplier.gstin ?? 'no GSTIN'}). Invoice ${inv.invoiceNo ?? '?'} dated ${inv.invoiceDate ?? '?'}. Total ${formatINR(inv.grandTotal)}.
Rates in force: since 22 Sep 2025 GST uses 5%, 18% and 40% (plus 0, 0.25, 3); the 12% and 28% slabs were removed for most goods.

Line items:
${lines}

The rule engine already reported:
${known}

Do three things the rule engine cannot:
1. For each line, judge whether the HSN/SAC fits the description and what rate should apply now. Suggest a better 4-8 digit code only if you are confident.
2. Judge whether any line is blocked credit under Section 17(5) given this recipient's business (e.g. food, cars, gifts, club fees, construction of immovable property, personal consumption). Machinery, tools, consumables and job work for manufacturing are NOT blocked.
3. Add findings ONLY for problems not already listed above. Use itcAtRisk = rupees of ITC actually at risk (0 if none). Keep each detail under 40 words.

Then write "verdict": 2-3 plain sentences in ${lang} that tell the accounts team whether to claim the ITC and what to do next. Use simple words a small-business accountant uses. ${lang !== 'English' ? `Write the verdict in ${lang} script; keep GSTIN, numbers and section references in English.` : ''}

Reply with only JSON:
{"verdict": string, "lines": [{"line": number, "hsnFits": boolean, "suggestedHsn": string|null, "expectedRate": number|null, "blockedCredit": boolean, "clause": string|null, "note": string}], "findings": [{"severity": "critical"|"high"|"medium"|"low", "title": string, "detail": string, "citation": string|null, "itcAtRisk": number, "field": string|null}]}`;
  const r = await ai.json<AiReview>(prompt, { signal, tier: 'default' });
  return { verdict: String(r?.verdict ?? ''), lines: Array.isArray(r?.lines) ? r.lines : [], findings: Array.isArray(r?.findings) ? r.findings : [] };
}

export function reviewToFindings(r: AiReview, inv: Invoice): Omit<Finding, 'id' | 'invoiceId' | 'source'>[] {
  const out: Omit<Finding, 'id' | 'invoiceId' | 'source'>[] = [];
  for (const l of r.lines) {
    const it = inv.items[l.line - 1];
    if (!it) continue;
    if (!l.hsnFits && l.suggestedHsn) out.push({ ruleId: `AI-HSN-${l.line}`, severity: 'medium', category: 'rate', title: `Line ${l.line}: HSN ${it.hsn ?? '(none)'} may not fit the description`, detail: `${l.note} Suggested: ${l.suggestedHsn}${l.expectedRate != null ? ` at ${l.expectedRate}%` : ''}.`, itcAtRisk: 0, field: `items.${l.line - 1}.description` });
    if (l.blockedCredit) {
      const tax = round2(it.cgst + it.sgst + it.igst + it.cess);
      out.push({ ruleId: 'ITC-BLOCKED', severity: 'high', category: 'itc-eligibility', title: `Line ${l.line}: likely blocked credit`, detail: l.note, citation: l.clause ?? 'Sec 17(5)', itcAtRisk: tax, field: `items.${l.line - 1}.description`, fix: 'Report as ineligible ITC in GSTR-3B Table 4(B)(1).' });
    }
  }
  r.findings.forEach((x, k) => {
    const sev: Severity = ['critical', 'high', 'medium', 'low'].includes(x.severity) ? x.severity : 'medium';
    out.push({ ruleId: `AI-${k + 1}`, severity: sev, category: 'itc-eligibility', title: String(x.title), detail: String(x.detail), citation: x.citation ?? undefined, itcAtRisk: Math.max(0, Number(x.itcAtRisk) || 0), field: x.field ?? undefined });
  });
  return out;
}

// ------------------------------------------------------------------------------- batch semantic sweep

export interface SweepResult { id: string; line: number; issue: 'hsn' | 'blocked'; suggestedHsn: string | null; expectedRate: number | null; clause: string | null; note: string }

/** One call across every line in the batch: flags HSN/description misfits and Sec 17(5) intent
 *  that keyword rules miss. Only problems come back, so the answer stays small. */
export async function sweepBatch(ai: AiProvider, invoices: Invoice[], company: Company, signal?: AbortSignal): Promise<SweepResult[]> {
  const rows = invoices.flatMap((inv) => inv.items.map((it, k) => `${inv.id}#${k + 1} | ${inv.supplier.name} | "${it.description}" | HSN ${it.hsn ?? 'none'} | ${it.gstRate ?? '?'}%`));
  const prompt = `You are an Indian GST reviewer. The recipient is ${company.name}, a manufacturer of precision engineering components (machining, fabrication). Rates in force since 22 Sep 2025: 5%, 18%, 40% (plus 0, 0.25, 3); 12% and 28% removed for most goods.

Each row is: id#line | supplier | description | HSN | rate.
${rows.join('\n')}

Report ONLY rows with a real problem:
- "hsn": the HSN/SAC clearly does not fit the description, or the rate is wrong for it now. Give suggestedHsn (4-8 digits) and expectedRate.
- "blocked": input tax credit is blocked under Section 17(5) for this recipient (food/catering, motor cars, club/gym, beauty, life/health insurance, employee vacation travel, gifts, construction of immovable property other than plant and machinery). Tools, machinery, consumables, raw material, job work and repairs of plant are NOT blocked.
Do not report rows that are fine. Keep "note" under 25 words.

Reply with only JSON: {"issues": [{"id": string, "line": number, "issue": "hsn"|"blocked", "suggestedHsn": string|null, "expectedRate": number|null, "clause": string|null, "note": string}]}`;
  const r = await ai.json<{ issues: SweepResult[] }>(prompt, { signal, tier: 'default' });
  return Array.isArray(r?.issues) ? r.issues : [];
}

export function sweepToFindings(results: SweepResult[], invoices: Invoice[]): Record<string, Omit<Finding, 'id' | 'invoiceId' | 'source'>[]> {
  const out: Record<string, Omit<Finding, 'id' | 'invoiceId' | 'source'>[]> = {};
  for (const r of results) {
    const id = String(r.id).split('#')[0];
    const inv = invoices.find((i) => i.id === id);
    const it = inv?.items[(Number(r.line) || 1) - 1];
    if (!inv || !it) continue;
    const list = (out[id] ??= []);
    if (r.issue === 'blocked') {
      list.push({ ruleId: 'ITC-BLOCKED', severity: 'high', category: 'itc-eligibility', title: `Line ${r.line}: likely blocked credit`, detail: r.note, citation: r.clause ?? 'Sec 17(5)', itcAtRisk: round2(it.cgst + it.sgst + it.igst + it.cess), field: `items.${Number(r.line) - 1}.description`, fix: 'Report as ineligible ITC in GSTR-3B Table 4(B)(1).' });
    } else {
      const wrongRate = r.expectedRate != null && it.gstRate != null && r.expectedRate !== it.gstRate;
      const excess = wrongRate && r.expectedRate! < it.gstRate! ? round2(it.taxableValue * (it.gstRate! - r.expectedRate!) / 100) : 0;
      list.push({ ruleId: `AI-HSN-${r.line}`, severity: wrongRate ? 'high' : 'medium', category: 'rate', title: wrongRate ? `Line ${r.line}: ${it.gstRate}% looks wrong for this item` : `Line ${r.line}: HSN ${it.hsn ?? '(none)'} does not fit the description`, detail: `${r.note}${r.suggestedHsn ? ` Suggested HSN ${r.suggestedHsn}` : ''}${r.expectedRate != null ? ` at ${r.expectedRate}%` : ''}.`, itcAtRisk: excess, field: `items.${Number(r.line) - 1}.gstRate` });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------- vendor follow-up

export interface FollowUp { subject: string; email: string; whatsapp: string }

export async function draftFollowUp(ai: AiProvider, company: Company, vendor: { name: string; gstin: string }, issues: { invoiceNo: string; date: string; problem: string; ask: string; itc: number }[], lang: Lang, signal?: AbortSignal): Promise<FollowUp> {
  const list = issues.map((i, k) => `${k + 1}. Invoice ${i.invoiceNo} dated ${i.date}: ${i.problem} Needed: ${i.ask} (ITC held: ${formatINR(i.itc)})`).join('\n');
  const prompt = `Write a follow-up from the accounts team of ${company.name} (GSTIN ${company.gstin}) to their supplier ${vendor.name} (GSTIN ${vendor.gstin}) about GST issues on these invoices:
${list}

Tone: polite, firm, specific; a long-standing business relationship. State exactly what correction is needed for each invoice (credit note, GSTR-1/1A amendment, re-issue, IRN copy) and ask for it before the 11th of next month so it reflects in GSTR-2B. Do not threaten. Sign off as "Accounts Team, ${company.name}".
Write in ${lang}${lang !== 'English' ? ' script, keeping invoice numbers, GSTINs, amounts and form names in English' : ''}.

Reply with only JSON: {"subject": string (English, under 80 chars), "email": string (plain text, under 220 words), "whatsapp": string (under 90 words, no greeting fluff)}`;
  return ai.json<FollowUp>(prompt, { signal, tier: 'default' });
}

/** Deterministic follow-up used when no AI is available. */
export function templateFollowUp(company: Company, vendor: { name: string; gstin: string }, issues: { invoiceNo: string; date: string; problem: string; ask: string; itc: number }[]): FollowUp {
  const total = issues.reduce((s, i) => s + i.itc, 0);
  const body = issues.map((i, k) => `${k + 1}. Invoice ${i.invoiceNo} (${i.date}): ${i.problem}\n   Required: ${i.ask}`).join('\n');
  return {
    subject: `GST corrections needed on ${issues.length} invoice${issues.length > 1 ? 's' : ''} – ${company.name}`,
    email: `Dear ${vendor.name} team,\n\nWhile reconciling our purchases with GSTR-2B we found the following issues on invoices you raised to us (GSTIN ${company.gstin}):\n\n${body}\n\nInput tax credit of ${formatINR(total)} is on hold until these are corrected. Please arrange the corrections before the 11th so they reflect in our next GSTR-2B.\n\nThank you for your support.\n\nRegards,\nAccounts Team\n${company.name}`,
    whatsapp: `Hello ${vendor.name}, this is Accounts, ${company.name}. ${issues.length} invoice(s) need GST corrections: ${issues.map((i) => `${i.invoiceNo} – ${i.ask}`).join('; ')}. ITC of ${formatINR(total)} is on hold. Please fix before the 11th. Thank you.`,
  };
}
