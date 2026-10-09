// String utilities used by matching and parsing.

/** Canonical form of an invoice number for matching: drops financial-year tokens,
 *  punctuation and leading zeros, so "SVT/0457/26-27" and "SVT457" compare equal. */
export function canonicalInvoiceNo(raw: string | null | undefined): string {
  if (!raw) return '';
  const upper = raw.toUpperCase();
  // Financial-year tokens: 26-27, 2026-27, 2627, 2026-2027 (consecutive years only)
  let s = upper.replace(/(?:20)?(\d{2})\s*[-/]?\s*(?:20)?(\d{2})/g, (m, a, b) => (Number(b) === Number(a) + 1 ? ' ' : m));
  if (!/\d/.test(s)) s = upper; // the "year" was the serial number itself
  s = s.replace(/[^0-9A-Z]+/g, '');
  s = s.replace(/(^|[A-Z])0+(\d)/g, '$1$2');
  return s;
}

export function jaroWinkler(a: string, b: string): number {
  if (a === b) return 1;
  if (!a.length || !b.length) return 0;
  const range = Math.max(0, Math.floor(Math.max(a.length, b.length) / 2) - 1);
  const am = new Array(a.length).fill(false);
  const bm = new Array(b.length).fill(false);
  let matches = 0;
  for (let i = 0; i < a.length; i++) {
    const lo = Math.max(0, i - range), hi = Math.min(i + range + 1, b.length);
    for (let j = lo; j < hi; j++) {
      if (bm[j] || a[i] !== b[j]) continue;
      am[i] = bm[j] = true;
      matches++;
      break;
    }
  }
  if (!matches) return 0;
  let t = 0, k = 0;
  for (let i = 0; i < a.length; i++) {
    if (!am[i]) continue;
    while (!bm[k]) k++;
    if (a[i] !== b[k]) t++;
    k++;
  }
  const jaro = (matches / a.length + matches / b.length + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && a[prefix] === b[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}

export function normalizeName(s: string | null | undefined): string {
  return (s ?? '')
    .toUpperCase()
    .replace(/\b(M\/S\.?|MESSRS|THE)\b/g, ' ')
    .replace(/\bPRIVATE\b/g, 'PVT')
    .replace(/\bLIMITED\b/g, 'LTD')
    .replace(/\bCOMPANY\b/g, 'CO')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

export function nameSimilarity(a: string | null | undefined, b: string | null | undefined): number {
  const x = normalizeName(a), y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y || x.startsWith(y) || y.startsWith(x)) return 1;
  return jaroWinkler(x, y);
}

export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
}

/** Parse dd-mm-yyyy, dd/mm/yyyy, dd.mm.yy, yyyy-mm-dd, "16 Aug 2026", Excel serials. Returns ISO date. */
export function parseDate(raw: unknown): string | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number' && raw > 20000 && raw < 80000) {
    const d = new Date(Math.round((raw - 25569) * 86400000));
    return d.toISOString().slice(0, 10);
  }
  const s = String(raw).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return iso(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    return iso(y, +m[2], +m[1]);
  }
  m = s.match(/^(\d{1,2})[\s-]+([A-Za-z]{3,9})[\s-,]+(\d{2,4})$/);
  if (m) {
    const mon = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
    if (mon >= 0) return iso(m[3].length === 2 ? 2000 + +m[3] : +m[3], mon + 1, +m[1]);
  }
  return null;
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function iso(y: number, m: number, d: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCMonth() !== m - 1) return null;
  return dt.toISOString().slice(0, 10);
}

/** Parse Indian-formatted amounts: "1,57,200.00", "₹ 2,13,606", "(450.00)". */
export function parseAmount(raw: unknown): number | null {
  if (raw == null || raw === '') return null;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  let s = String(raw).trim();
  const neg = /^\(.*\)$/.test(s) || s.startsWith('-');
  s = s.replace(/[₹,\s()]|Rs\.?|INR/gi, '').replace(/^-/, '');
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const n = parseFloat(s);
  return neg ? -n : n;
}

export const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
