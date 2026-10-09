// Layout-aware parser for digital (text-layer) tax invoices.
// Reconstructs lines from positioned text, reads labelled fields, finds the item table from its
// header row and maps cells to columns by alignment. Records where each value sits on the page so
// findings can be highlighted on the document.

import type { Box, Company, Invoice, LineItem } from '../domain/types';
import type { PdfText, TextItem } from './pdf';
import { normalizeGstin, parseStateRef } from '../domain/gstin';
import { parseAmount, parseDate, round2 } from '../domain/text';

interface Line { y: number; page: number; items: TextItem[]; text: string }

const GSTIN_RE = /\b\d{2}[A-Z]{5}\d{4}[A-Z][0-9A-Z]Z[0-9A-Z]\b/g;
const AMOUNT_RE = /^[-(]?₹?\s?\d{1,3}(?:,\d{2,3})*(?:\.\d{1,2})?\)?$|^[-(]?\d+(?:\.\d{1,2})?\)?$/;

function toLines(items: TextItem[]): Line[] {
  const sorted = [...items].sort((a, b) => a.page - b.page || a.y - b.y || a.x - b.x);
  const lines: Line[] = [];
  for (const it of sorted) {
    const last = lines[lines.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= Math.max(2.2, it.h * 0.35)) last.items.push(it);
    else lines.push({ y: it.y, page: it.page, items: [it], text: '' });
  }
  for (const l of lines) {
    l.items.sort((a, b) => a.x - b.x);
    let t = '';
    let prevEnd = -1;
    for (const it of l.items) {
      if (prevEnd >= 0) t += it.x - prevEnd > 6 ? '   ' : it.x - prevEnd > 1 ? ' ' : '';
      t += it.str;
      prevEnd = it.x + it.w;
    }
    l.text = t;
  }
  return lines;
}

const box = (it: TextItem | TextItem[]): Box => {
  const arr = Array.isArray(it) ? it : [it];
  const x = Math.min(...arr.map((i) => i.x)), y = Math.min(...arr.map((i) => i.y));
  const x2 = Math.max(...arr.map((i) => i.x + i.w)), y2 = Math.max(...arr.map((i) => i.y + i.h));
  return { page: arr[0].page, x, y, w: x2 - x, h: y2 - y };
};

/** Value item(s) to the right of a label on the same line. */
function valueAfter(line: Line, labelRe: RegExp): { text: string; items: TextItem[] } | null {
  const idx = line.items.findIndex((i) => labelRe.test(i.str));
  if (idx < 0) {
    const m = line.text.match(new RegExp(labelRe.source + '\\s*[:.\\-]?\\s*(.+)$', 'i'));
    return m ? { text: m[m.length - 1].trim(), items: line.items } : null;
  }
  const labelItem = line.items[idx];
  const inline = labelItem.str.replace(labelRe, '').replace(/^[\s:.\-#]+/, '').trim();
  if (inline) return { text: inline, items: [labelItem] };
  const rest: TextItem[] = [];
  for (let k = idx + 1; k < line.items.length; k++) {
    const it = line.items[k];
    if (rest.length && it.x - (rest[rest.length - 1].x + rest[rest.length - 1].w) > 40) break;
    if (/^[:\-]$/.test(it.str.trim())) continue;
    rest.push(it);
  }
  return rest.length ? { text: rest.map((r) => r.str).join(' ').replace(/^[:\s]+/, '').trim(), items: rest } : null;
}

type ColKey = 'sno' | 'description' | 'hsn' | 'qty' | 'unit' | 'unitPrice' | 'taxable' | 'gstRate' | 'cgst' | 'sgst' | 'igst' | 'cess' | 'lineTotal';

function headerKey(s: string): ColKey | null {
  const t = s.toLowerCase().replace(/\s+/g, ' ').trim();
  if (/^(#|s\.? ?no\.?|sr\.? ?no\.?|sl\.? ?no\.?)$/.test(t)) return 'sno';
  if (/hsn|sac/.test(t)) return 'hsn';
  if (/cgst/.test(t)) return 'cgst';
  if (/sgst|utgst/.test(t)) return 'sgst';
  if (/igst/.test(t)) return 'igst';
  if (/cess/.test(t)) return 'cess';
  if (/taxable/.test(t)) return 'taxable';
  if (/(gst|tax) ?(%|rate)|rate ?%|^%$/.test(t)) return 'gstRate';
  if (/desc|particular|item|goods|services/.test(t)) return 'description';
  if (/^(qty|quantity)/.test(t)) return 'qty';
  if (/^(unit|uom|per)$/.test(t)) return 'unit';
  if (/rate|price/.test(t)) return 'unitPrice';
  if (/amount|total|value/.test(t)) return 'lineTotal';
  return null;
}

const HEADER_TOKENS = /S\.?\s?No\.?|Sr\.?\s?No\.?|#|Description of Goods\s*\/\s*Services|Description|Particulars|HSN\s*\/\s*SAC|HSN|SAC|Quantity|Qty|UOM|Unit|Unit Price|Rate\s*%|Rate|Price|Taxable Value|Taxable Amt|Taxable|GST\s*%|GST Rate|Tax Rate|CGST(?:\s*Amt)?|SGST(?:\s*Amt)?|UTGST|IGST(?:\s*Amt)?|Cess|Amount|Total/gi;

/** pdf.js often merges neighbouring header cells ("Rate Taxable Value"); split them back into
 *  pseudo-items, estimating each cell's position from its character offset. */
function splitHeader(it: TextItem): TextItem[] {
  const matches = [...it.str.matchAll(HEADER_TOKENS)];
  if (matches.length <= 1) return [it];
  const len = it.str.length;
  return matches.map((m) => ({ ...it, str: m[0], x: it.x + (it.w * (m.index ?? 0)) / len, w: (it.w * m[0].length) / len }));
}

const NUMERIC: ColKey[] = ['qty', 'unitPrice', 'taxable', 'gstRate', 'cgst', 'sgst', 'igst', 'cess', 'lineTotal'];

export interface ParseResult {
  invoice: Omit<Invoice, 'id' | 'source'>;
  textFound: boolean;
}

export function parseInvoiceText(pdf: PdfText, company: Company | null): ParseResult {
  const lines = toLines(pdf.items);
  const boxes: Record<string, Box> = {};
  const conf: Record<string, number> = {};
  if (pdf.items.length < 15) {
    return { textFound: false, invoice: emptyInvoice(pdf, 'pending', 'No text layer found. This looks like a scan; use AI extraction.') };
  }

  // ---------- labelled fields
  let invoiceNo: string | null = null, invoiceDate: string | null = null, pos: string | null = null;
  let reverseCharge: boolean | null = null, irn: string | null = null;
  for (let li = 0; li < lines.length; li++) {
    const l = lines[li];
    if (!invoiceNo) {
      const v = valueAfter(l, /(invoice|inv|bill)\.?\s*(no|number|#)\.?\s*:?/i);
      if (v) {
        const m = v.text.match(/[A-Z0-9][A-Z0-9/\-_.]{1,30}/i);
        if (m) { invoiceNo = m[0].replace(/[.]$/, ''); boxes.invoiceNo = box(v.items); conf.invoiceNo = 0.95; }
      }
    }
    if (!invoiceDate) {
      const v = valueAfter(l, /(invoice|inv\.?|bill)?\s*date[d]?\s*:?/i);
      if (v) {
        const d = parseDate(v.text.split(/\s{2,}/)[0]) ?? parseDate(v.text.match(/\d{1,2}[-/.]\d{1,2}[-/.]\d{2,4}/)?.[0]);
        if (d) { invoiceDate = d; boxes.invoiceDate = box(v.items); conf.invoiceDate = 0.95; }
      }
    }
    if (!pos && /place\s*of\s*supply/i.test(l.text)) {
      const v = valueAfter(l, /place\s*of\s*supply\s*:?/i);
      pos = parseStateRef(v?.text ?? l.text.replace(/.*place\s*of\s*supply/i, ''));
      if (v) boxes.placeOfSupply = box(v.items);
      conf.placeOfSupply = pos ? 0.9 : 0.3;
    }
    if (reverseCharge == null && /reverse\s*charge/i.test(l.text)) {
      const m = l.text.match(/reverse\s*charge\s*(?:applicable)?\s*:?\s*(yes|no|y|n)\b/i);
      if (m) reverseCharge = /^y/i.test(m[1]);
    }
    if (!irn && /\bIRN\b/i.test(l.text)) {
      const m = l.text.match(/IRN\s*(?:no\.?)?\s*:?\s*([0-9a-f]{64})/i);
      if (m) { irn = m[1].toLowerCase(); const its = l.items.filter((i) => /IRN|[0-9a-f]{16}/i.test(i.str)); if (its.length) boxes.irn = box(its); }
    }
  }

  // ---------- parties
  const billIdx = lines.findIndex((l) => /\b(bill(ed)?\s*to|buyer|consignee|ship\s*to|details of (receiver|recipient)|recipient\s*(details|name)|customer)\b/i.test(l.text) && !/original|duplicate|triplicate/i.test(l.text));
  const billLine = billIdx >= 0 ? lines[billIdx] : null;
  const billX = billLine ? billLine.items.find((i) => /bill|buyer|recipient|consignee|ship|receiver|customer/i.test(i.str))?.x ?? 0 : 0;
  const midX = pdf.pageSize.w * 0.55;
  const gstins: { g: string; line: number; item: TextItem }[] = [];
  lines.forEach((l, i) => {
    for (const it of l.items) for (const m of it.str.toUpperCase().matchAll(GSTIN_RE)) gstins.push({ g: m[0], line: i, item: it });
    if (!l.items.some((it) => GSTIN_RE.test(it.str.toUpperCase()))) {
      for (const m of l.text.toUpperCase().replace(/\s/g, ' ').matchAll(GSTIN_RE)) gstins.push({ g: m[0], line: i, item: l.items[0] });
    }
    GSTIN_RE.lastIndex = 0;
  });
  const uniq = gstins.filter((g, i) => gstins.findIndex((h) => h.g === g.g && h.line === g.line) === i);
  let supG = null as (typeof uniq)[number] | null, buyG = null as (typeof uniq)[number] | null;
  const own = company ? uniq.find((g) => g.g === company.gstin) : undefined;
  if (own) buyG = own;
  for (const g of uniq) {
    if (g === buyG) continue;
    const afterBill = billIdx >= 0 && g.line > billIdx && Math.abs(g.item.x - billX) < 60 && g.item.x < midX;
    if (afterBill && !buyG) buyG = g;
    else if (!afterBill && !supG && (billIdx < 0 || g.line < billIdx || g.item.x >= midX)) supG = g;
  }
  if (!supG && uniq.length && uniq[0] !== buyG && !(billIdx >= 0 && uniq[0].line > billIdx)) supG = uniq[0];
  if (supG) { boxes['supplier.gstin'] = box(supG.item); conf['supplier.gstin'] = 0.97; }
  if (buyG) { boxes['buyer.gstin'] = box(buyG.item); conf['buyer.gstin'] = 0.97; }
  else if (billLine) boxes['buyer.gstin'] = box(billLine.items.filter((i) => i.x < midX));

  // supplier name: largest text in the top quarter of page 1
  const top = pdf.items.filter((i) => i.page === 1 && i.y < pdf.pageSize.h * 0.25 && !/tax\s*invoice|original|duplicate|triplicate|invoice/i.test(i.str));
  const nameItem = top.sort((a, b) => b.h - a.h || a.y - b.y)[0];
  const supplierName = nameItem?.str.trim() ?? '';
  if (nameItem) { boxes['supplier.name'] = box(nameItem); conf['supplier.name'] = 0.85; }
  const supAddr: string[] = [];
  if (nameItem) {
    const stop = supG ? lines[supG.line].y : nameItem.y + 60;
    for (const l of lines) {
      if (l.page !== 1 || l.y <= nameItem.y + 1 || l.y >= stop) continue;
      const left = l.items.filter((i) => Math.abs(i.x - nameItem.x) < 30 && i.x < midX).map((i) => i.str).join(' ').trim();
      if (left && !/gstin|state\s*:|phone|email|tel/i.test(left)) supAddr.push(left);
    }
  }
  let buyerName = '';
  const buyAddr: string[] = [];
  if (billIdx >= 0) {
    for (let k = billIdx + 1; k < Math.min(lines.length, billIdx + 7); k++) {
      const segs = lines[k].items.filter((i) => Math.abs(i.x - billX) < 30 && i.x < midX).map((i) => i.str).join(' ').trim();
      if (!segs) continue;
      if (/gstin|state\s*:|^#|description/i.test(segs)) break;
      if (!buyerName) { buyerName = segs; boxes['buyer.name'] = box(lines[k].items.filter((i) => Math.abs(i.x - billX) < 30)); }
      else buyAddr.push(segs);
    }
  }
  const sigLine = lines.find((l) => /authori[sz]ed\s*signatory|digitally\s*signed|signature/i.test(l.text));
  if (sigLine) boxes.signature = box(sigLine.items);

  // ---------- item table
  let headerIdx = -1;
  let cols: { key: ColKey; x: number; r: number; item: TextItem }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const cand = lines[i].items.flatMap(splitHeader).map((it) => ({ key: headerKey(it.str), x: it.x, r: it.x + it.w, item: it })).filter((c) => c.key) as typeof cols;
    const kinds = new Set(cand.map((c) => c.key));
    if (kinds.size >= 4 && (kinds.has('taxable') || kinds.has('lineTotal')) && (kinds.has('description') || kinds.has('hsn'))) {
      headerIdx = i;
      cols = cand.filter((c, k) => cand.findIndex((d) => d.key === c.key) === k);
      break;
    }
  }
  const items: LineItem[] = [];
  let tableEnd = headerIdx;
  if (headerIdx >= 0) {
    if (cols.find((c) => c.key === 'hsn')) boxes['items.hsn'] = box(cols.find((c) => c.key === 'hsn')!.item);
    const numCols = cols.filter((c) => NUMERIC.includes(c.key));
    const txtCols = cols.filter((c) => !NUMERIC.includes(c.key));
    for (let i = headerIdx + 1; i < lines.length; i++) {
      const l = lines[i];
      if (/^(sub\s*)?total|taxable\s*value|amount\s*in\s*words|grand\s*total|round\s*off/i.test(l.text.trim())) break;
      const row: Partial<Record<ColKey, { s: string; items: TextItem[] }>> = {};
      for (const it of l.items) {
        const s = it.str.trim();
        const hsnColumn = cols.find((c) => c.key === 'hsn');
        const looksHsn = /^\d{4,8}$/.test(s) && !!hsnColumn && Math.abs(hsnColumn.x - it.x) < 25;
        const numeric = !looksHsn && (AMOUNT_RE.test(s.replace(/%$/, '')) || /%$/.test(s));
        let target: (typeof cols)[number] | undefined = looksHsn ? hsnColumn : undefined;
        if (!target && numeric && numCols.length) {
          target = numCols.reduce((best, c) => (Math.abs(c.r - (it.x + it.w)) < Math.abs(best.r - (it.x + it.w)) ? c : best));
          if (Math.abs(target.r - (it.x + it.w)) > 45) target = undefined;
        }
        if (!target) target = txtCols.reduce((best, c) => (Math.abs(c.x - it.x) < Math.abs(best.x - it.x) ? c : best), txtCols[0]);
        if (!target) continue;
        const cell = row[target.key] ?? { s: '', items: [] };
        cell.s = (cell.s + ' ' + s).trim();
        cell.items.push(it);
        row[target.key] = cell;
      }
      const hasNumbers = NUMERIC.some((k) => row[k]);
      if (!hasNumbers) {
        if (row.description && items.length) items[items.length - 1].description += ' ' + row.description.s;
        if (!row.description && Object.keys(row).length === 0) continue;
        if (items.length === 0 && !row.description) continue;
        if (!items.length) continue;
        continue;
      }
      const num = (k: ColKey) => (row[k] ? parseAmount(row[k]!.s.replace('%', '')) : null);
      const taxable = num('taxable') ?? (num('qty') != null && num('unitPrice') != null ? round2(num('qty')! * num('unitPrice')!) : null);
      if (taxable == null) continue;
      const idx = items.length;
      const li: LineItem = {
        description: row.description?.s ?? '', hsn: row.hsn?.s.replace(/\s/g, '') || null, qty: num('qty'), unit: row.unit?.s ?? null,
        unitPrice: num('unitPrice'), taxableValue: taxable, gstRate: num('gstRate'), cgst: num('cgst') ?? 0, sgst: num('sgst') ?? 0, igst: num('igst') ?? 0, cess: num('cess') ?? 0, lineTotal: num('lineTotal'),
      };
      if (li.gstRate == null && taxable) {
        const t = li.cgst + li.sgst + li.igst;
        const r = round2((t / taxable) * 100);
        li.gstRate = [0, 0.25, 3, 5, 12, 18, 28, 40].find((x) => Math.abs(x - r) < 0.3) ?? r;
      }
      items.push(li);
      if (row.gstRate) boxes[`items.${idx}.gstRate`] = box(row.gstRate.items);
      if (row.taxable) boxes[`items.${idx}.taxableValue`] = box(row.taxable.items);
      const taxCell = row.igst ?? row.cgst;
      if (taxCell) boxes[`items.${idx}.tax`] = box([...(row.cgst?.items ?? []), ...(row.sgst?.items ?? []), ...(row.igst?.items ?? [])]);
      if (row.cgst) boxes[`items.${idx}.cgst`] = box([...(row.cgst?.items ?? []), ...(row.sgst?.items ?? [])]);
      if (row.description) boxes[`items.${idx}.description`] = box(row.description.items);
      tableEnd = i;
    }
    if (!boxes['items.hsn'] && items.length) boxes['items.hsn'] = box(lines[headerIdx].items);
  }

  // ---------- totals (search below the table)
  const after = lines.slice(Math.max(0, tableEnd + 1));
  const lastAmount = (re: RegExp): { v: number; it: TextItem } | null => {
    for (const l of after) {
      if (!re.test(l.text)) continue;
      const nums = l.items.filter((i) => AMOUNT_RE.test(i.str.trim()));
      const it = nums[nums.length - 1];
      if (it) { const v = parseAmount(it.str); if (v != null) return { v, it }; }
    }
    return null;
  };
  const sum = (k: 'cgst' | 'sgst' | 'igst' | 'cess' | 'taxableValue') => round2(items.reduce((s, i) => s + (i[k] as number), 0));
  const tTaxable = lastAmount(/taxable\s*(value|amount)|sub\s*total/i);
  const tCgst = lastAmount(/\bcgst\b|central\s*tax/i);
  const tSgst = lastAmount(/\b(sgst|utgst)\b|state\s*tax/i);
  const tIgst = lastAmount(/\bigst\b|integrated\s*tax/i);
  const tRound = lastAmount(/round(ed)?\s*off|rounding/i);
  const tGrand = lastAmount(/(invoice|grand|net)\s*total|total\s*(amount|payable|invoice\s*value)|amount\s*payable/i);
  if (tGrand) { boxes.grandTotal = box(tGrand.it); conf.grandTotal = 0.95; }
  if (tIgst) boxes.igstTotal = box(tIgst.it);
  if (tCgst) boxes.cgstTotal = box(tCgst.it);
  if (tTaxable) boxes.taxableTotal = box(tTaxable.it);
  if (tRound) boxes.roundOff = box(tRound.it);

  const taxableTotal = tTaxable?.v ?? sum('taxableValue');
  const cgstTotal = tCgst?.v ?? sum('cgst');
  const sgstTotal = tSgst?.v ?? sum('sgst');
  const igstTotal = tIgst?.v ?? sum('igst');
  const roundOff = tRound?.v ?? 0;
  const grandTotal = tGrand?.v ?? round2(taxableTotal + cgstTotal + sgstTotal + igstTotal + roundOff);

  conf.items = items.length ? 0.9 : 0.2;
  const keyFields = ['invoiceNo', 'invoiceDate', 'supplier.gstin', 'items', 'grandTotal'];
  const confidence = keyFields.reduce((s, k) => s + (conf[k] ?? 0.2), 0) / keyFields.length;

  return {
    textFound: true,
    invoice: {
      extraction: { method: 'text-layer', confidence, fieldConfidence: conf, boxes, pageSize: pdf.pageSize },
      invoiceNo, invoiceDate,
      supplier: { name: supplierName, gstin: normalizeGstin(supG?.g), address: supAddr.join(', ') || undefined, stateCode: supG?.g.slice(0, 2) ?? null },
      buyer: { name: buyerName, gstin: normalizeGstin(buyG?.g), address: buyAddr.filter((a) => !/gstin/i.test(a)).join(', ') || undefined, stateCode: buyG?.g.slice(0, 2) ?? null },
      placeOfSupply: pos, reverseCharge, irn, hasSignature: !!sigLine,
      items, taxableTotal, cgstTotal, sgstTotal, igstTotal, cessTotal: sum('cess'), roundOff, grandTotal,
    },
  };
}

export function emptyInvoice(pdf: PdfText | null, method: Invoice['extraction']['method'], note: string): Omit<Invoice, 'id' | 'source'> {
  return {
    extraction: { method, confidence: 0, note, pageSize: pdf?.pageSize },
    invoiceNo: null, invoiceDate: null, supplier: { name: '', gstin: null }, buyer: { name: '', gstin: null },
    placeOfSupply: null, reverseCharge: null, irn: null, hasSignature: null, items: [],
    taxableTotal: 0, cgstTotal: 0, sgstTotal: 0, igstTotal: 0, cessTotal: 0, roundOff: 0, grandTotal: 0,
  };
}

/** Find where a value appears in the text layer, for highlighting AI-extracted fields. */
export function locate(pdf: PdfText | null, value: string | number | null | undefined): Box | undefined {
  if (!pdf || value == null || value === '') return undefined;
  const needle = String(value).replace(/\s/g, '').toLowerCase();
  if (needle.length < 3) return undefined;
  const hit = pdf.items.find((i) => i.str.replace(/\s/g, '').toLowerCase().includes(needle));
  return hit ? box(hit) : undefined;
}
