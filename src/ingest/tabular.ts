// Purchase registers (Tally / Zoho / Busy exports, CSV or Excel) and GSTR-2B (portal JSON or Excel).
import * as XLSX from 'xlsx';
import type { Invoice, LineItem, PortalRecord } from '../domain/types';
import { normalizeGstin, parseStateRef } from '../domain/gstin';
import { parseAmount, parseDate, round2 } from '../domain/text';

type Row = Record<string, unknown>;

async function readRows(file: File | Blob, name: string): Promise<Row[]> {
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: 'array', raw: name.toLowerCase().endsWith('.csv') });
  // Prefer a B2B sheet when present (GSTR-2B Excel), else the first sheet.
  const sheetName = wb.SheetNames.find((s) => /^b2b$/i.test(s.trim())) ?? wb.SheetNames[0];
  const sheet = wb.Sheets[sheetName];
  const grid = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true, defval: '' });
  // Find the header row: the first row with at least 4 non-empty cells that mention invoice/gstin.
  const hi = grid.findIndex((r) => r.filter((c) => String(c).trim()).length >= 4 && r.some((c) => /gstin|invoice/i.test(String(c))));
  if (hi < 0) return [];
  // Two-row headers (GSTR-2B Excel has grouped headings): merge with the row below when it is also text.
  let header = grid[hi].map((c) => String(c).trim());
  const below = grid[hi + 1] ?? [];
  const belowIsHeader = below.filter((c) => /^[A-Za-z][A-Za-z\s/()₹%.,-]*$/.test(String(c).trim())).length >= 4 && below.filter((c) => /\d/.test(String(c))).length <= 1;
  if (belowIsHeader) header = header.map((h, i) => (String(below[i] ?? '').trim() || h));
  const start = hi + (belowIsHeader ? 2 : 1);
  return grid.slice(start).filter((r) => r.some((c) => String(c).trim())).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
}

function pick(row: Row, ...patterns: RegExp[]): unknown {
  for (const p of patterns) {
    for (const [k, v] of Object.entries(row)) if (p.test(k) && v !== '' && v != null) return v;
  }
  return null;
}

// ------------------------------------------------------------------ purchase register
export async function parseRegister(file: File, ownState: string): Promise<Invoice[]> {
  const rows = await readRows(file, file.name);
  const groups = new Map<string, { row: Row; index: number }[]>();
  rows.forEach((row, index) => {
    const no = String(pick(row, /supplier\s*inv.*no|^invoice\s*(no|number)|bill\s*no|ref.*no|^inv.*no/i) ?? '').trim();
    const g = normalizeGstin(String(pick(row, /gstin|gst\s*no/i) ?? '')) ?? '';
    if (!no) return;
    const key = `${g}|${no}`;
    groups.set(key, [...(groups.get(key) ?? []), { row, index }]);
  });
  const out: Invoice[] = [];
  for (const [key, list] of groups) {
    const first = list[0].row;
    const items: LineItem[] = list.map(({ row }) => {
      const taxable = parseAmount(pick(row, /taxable/i)) ?? 0;
      const igst = parseAmount(pick(row, /igst|integrated/i)) ?? 0;
      const cgst = parseAmount(pick(row, /cgst|central/i)) ?? 0;
      const sgst = parseAmount(pick(row, /sgst|utgst|state\s*tax/i)) ?? 0;
      const cess = parseAmount(pick(row, /cess/i)) ?? 0;
      let rate = parseAmount(String(pick(row, /gst\s*rate|tax\s*rate|^rate/i) ?? '').replace('%', ''));
      if (rate == null && taxable) rate = round2(((igst + cgst + sgst) / taxable) * 100);
      return { description: String(pick(row, /desc|item|particular|ledger/i) ?? ''), hsn: String(pick(row, /hsn|sac/i) ?? '') || null, qty: parseAmount(pick(row, /^qty|quantity/i)), unit: null, unitPrice: null, taxableValue: taxable, gstRate: rate, cgst, sgst, igst, cess };
    });
    const sum = (k: keyof LineItem) => round2(items.reduce((s, i) => s + (Number(i[k]) || 0), 0));
    const total = parseAmount(pick(first, /invoice\s*value|total|gross/i));
    const taxable = sum('taxableValue');
    const tax = sum('cgst') + sum('sgst') + sum('igst') + sum('cess');
    const payment = String(pick(first, /payment|paid|status/i) ?? '').toLowerCase();
    const gstin = key.split('|')[0] || null;
    const posRaw = pick(first, /place\s*of\s*supply|pos/i);
    out.push({
      id: `reg-${list[0].index}`,
      source: { kind: 'register', fileName: file.name, row: list[0].index + 2 },
      extraction: { method: 'structured', confidence: 1 },
      invoiceNo: key.split('|').slice(1).join('|'),
      invoiceDate: parseDate(pick(first, /supplier\s*inv.*date|^invoice\s*date|bill\s*date|^date|voucher\s*date/i)),
      supplier: { name: String(pick(first, /party|supplier\s*name|vendor|name/i) ?? ''), gstin, stateCode: gstin?.slice(0, 2) ?? null },
      buyer: { name: '', gstin: null },
      placeOfSupply: parseStateRef(String(posRaw ?? '')) ?? ownState,
      reverseCharge: /^y/i.test(String(pick(first, /reverse/i) ?? '')),
      irn: null, hasSignature: null, items,
      taxableTotal: taxable, cgstTotal: sum('cgst'), sgstTotal: sum('sgst'), igstTotal: sum('igst'), cessTotal: sum('cess'),
      roundOff: total != null ? round2(total - taxable - tax) : 0,
      grandTotal: total ?? round2(taxable + tax),
      paymentStatus: /unpaid|due|pending|outstanding/.test(payment) ? 'unpaid' : /paid/.test(payment) ? 'paid' : null,
    });
  }
  return out;
}

// ------------------------------------------------------------------ GSTR-2B
export async function parseGstr2b(file: File): Promise<{ records: PortalRecord[]; gstin: string | null; period: string | null; generated: string | null }> {
  if (file.name.toLowerCase().endsWith('.json')) {
    const json = JSON.parse(await file.text());
    const data = json?.data?.data ?? json?.data ?? json;
    const b2b = data?.docdata?.b2b ?? data?.b2b ?? [];
    const records: PortalRecord[] = [];
    let n = 0;
    for (const s of b2b) {
      for (const inv of s.inv ?? []) {
        const items = inv.items ?? [];
        const sum = (k: string) => round2(items.reduce((t: number, i: Record<string, number>) => t + (Number(i[k]) || 0), 0));
        records.push({
          id: `p${++n}`, ctin: s.ctin, tradeName: s.trdnm ?? '', supplierFiledOn: parseDate(s.supfildt), supplierPeriod: s.supprd ?? null,
          invoiceNo: String(inv.inum), invoiceDate: parseDate(inv.dt) ?? '', invoiceValue: Number(inv.val) || 0, placeOfSupply: String(inv.pos ?? '').padStart(2, '0'),
          reverseCharge: inv.rev === 'Y', itcAvailable: inv.itcavl !== 'N', itcReason: inv.rsn || null, source: inv.srctyp ?? null, irn: inv.irn ?? null,
          taxable: sum('txval'), igst: sum('igst'), cgst: sum('cgst'), sgst: sum('sgst'), cess: sum('cess'), rates: items.map((i: { rt: number }) => i.rt),
        });
      }
    }
    const rp = data?.rtnprd ? `${String(data.rtnprd).slice(2)}-${String(data.rtnprd).slice(0, 2)}` : null;
    return { records, gstin: data?.gstin ?? null, period: rp, generated: parseDate(data?.gendt) };
  }
  const rows = await readRows(file, file.name);
  const records: PortalRecord[] = rows.map((row, i) => ({
    id: `p${i + 1}`,
    ctin: normalizeGstin(String(pick(row, /gstin/i) ?? '')) ?? '',
    tradeName: String(pick(row, /trade|legal|name/i) ?? ''),
    supplierFiledOn: parseDate(pick(row, /filing\s*date/i)),
    supplierPeriod: String(pick(row, /period/i) ?? '') || null,
    invoiceNo: String(pick(row, /invoice\s*(no|number)/i) ?? ''),
    invoiceDate: parseDate(pick(row, /invoice\s*date/i)) ?? '',
    invoiceValue: parseAmount(pick(row, /invoice\s*value/i)) ?? 0,
    placeOfSupply: parseStateRef(String(pick(row, /place\s*of\s*supply/i) ?? '')) ?? '',
    reverseCharge: /^y/i.test(String(pick(row, /reverse/i) ?? '')),
    itcAvailable: !/^n/i.test(String(pick(row, /itc\s*avail/i) ?? 'Yes')),
    itcReason: String(pick(row, /reason/i) ?? '') || null,
    source: String(pick(row, /source/i) ?? '') || null,
    irn: String(pick(row, /^irn$/i) ?? '') || null,
    taxable: parseAmount(pick(row, /taxable/i)) ?? 0,
    igst: parseAmount(pick(row, /integrated|igst/i)) ?? 0,
    cgst: parseAmount(pick(row, /central|cgst/i)) ?? 0,
    sgst: parseAmount(pick(row, /state|sgst/i)) ?? 0,
    cess: parseAmount(pick(row, /cess/i)) ?? 0,
    rates: [parseAmount(pick(row, /rate/i)) ?? 0],
  })).filter((r) => r.ctin && r.invoiceNo);
  return { records, gstin: null, period: null, generated: null };
}
