// GSTIN structure: SS PPPPPPPPPP E Z C
//   SS  state code (01-38, 97 other territory, 99 centre jurisdiction)
//   P   PAN of the taxpayer (AAAAA9999A)
//   E   entity number for the same PAN in that state (1-9, A-Z)
//   Z   default "Z"
//   C   check character, base-36 Luhn-style checksum over the first 14 characters

export const STATE_CODES: Record<string, string> = {
  '01': 'Jammu & Kashmir', '02': 'Himachal Pradesh', '03': 'Punjab', '04': 'Chandigarh',
  '05': 'Uttarakhand', '06': 'Haryana', '07': 'Delhi', '08': 'Rajasthan', '09': 'Uttar Pradesh',
  '10': 'Bihar', '11': 'Sikkim', '12': 'Arunachal Pradesh', '13': 'Nagaland', '14': 'Manipur',
  '15': 'Mizoram', '16': 'Tripura', '17': 'Meghalaya', '18': 'Assam', '19': 'West Bengal',
  '20': 'Jharkhand', '21': 'Odisha', '22': 'Chhattisgarh', '23': 'Madhya Pradesh', '24': 'Gujarat',
  '26': 'Dadra & Nagar Haveli and Daman & Diu', '27': 'Maharashtra', '29': 'Karnataka', '30': 'Goa',
  '31': 'Lakshadweep', '32': 'Kerala', '33': 'Tamil Nadu', '34': 'Puducherry',
  '35': 'Andaman & Nicobar Islands', '36': 'Telangana', '37': 'Andhra Pradesh', '38': 'Ladakh',
  '97': 'Other Territory', '99': 'Centre Jurisdiction',
};

const UT_CODES = new Set(['04', '26', '31', '35', '38', '97']);
export const isUnionTerritory = (code: string) => UT_CODES.has(code);

export const PAN_ENTITY: Record<string, string> = {
  P: 'Individual / Proprietor', C: 'Company', H: 'Hindu Undivided Family', F: 'Firm / LLP',
  A: 'Association of Persons', T: 'Trust', B: 'Body of Individuals', L: 'Local Authority',
  J: 'Artificial Juridical Person', G: 'Government',
};

const CHARS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const PATTERN = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/;

export function checkChar(first14: string): string {
  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const v = CHARS.indexOf(first14[i]);
    if (v < 0) return '?';
    const p = v * (i % 2 === 0 ? 1 : 2);
    sum += Math.floor(p / 36) + (p % 36);
  }
  return CHARS[(36 - (sum % 36)) % 36];
}

export function normalizeGstin(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const g = raw.toUpperCase().replace(/[^0-9A-Z]/g, '');
  return g.length ? g : null;
}

export interface GstinCheck {
  gstin: string;
  valid: boolean;
  formatOk: boolean;
  checksumOk: boolean;
  stateOk: boolean;
  stateCode: string;
  stateName: string | null;
  pan: string;
  entityType: string | null;
  expectedCheck: string | null;
  problems: string[];
}

export function checkGstin(raw: string): GstinCheck {
  const g = normalizeGstin(raw) ?? '';
  const problems: string[] = [];
  const formatOk = PATTERN.test(g);
  if (g.length !== 15) problems.push(`Has ${g.length} characters; a GSTIN has 15.`);
  else if (!formatOk) problems.push('Does not follow the GSTIN pattern (2-digit state, 10-character PAN, entity number, "Z", check character).');
  const stateCode = g.slice(0, 2);
  const stateName = STATE_CODES[stateCode] ?? null;
  const stateOk = !!stateName;
  if (g.length >= 2 && !stateOk) problems.push(`"${stateCode}" is not a valid GST state code.`);
  const expectedCheck = g.length >= 14 ? checkChar(g.slice(0, 14)) : null;
  const checksumOk = g.length === 15 && expectedCheck === g[14];
  if (g.length === 15 && formatOk && !checksumOk) problems.push(`Check character is "${g[14]}" but the first 14 characters produce "${expectedCheck}". At least one character is wrong.`);
  const pan = g.slice(2, 12);
  const entityType = PAN_ENTITY[pan[3]] ?? null;
  return { gstin: g, valid: formatOk && checksumOk && stateOk, formatOk, checksumOk, stateOk, stateCode, stateName, pan, entityType, expectedCheck, problems };
}

/** Number of positions at which two equal-length strings differ (Hamming). */
export function charDiff(a: string, b: string): number {
  if (a.length !== b.length) return Math.max(a.length, b.length);
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

export function stateLabel(code: string | null | undefined): string {
  if (!code) return '—';
  return `${STATE_CODES[code] ?? 'Unknown'} (${code})`;
}

/** Resolve a free-text state reference ("Telangana (36)", "36-Telangana", "TS") to a code. */
export function parseStateRef(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const num = s.match(/\b(\d{1,2})\b/);
  if (num) {
    const c = num[1].padStart(2, '0');
    if (STATE_CODES[c]) return c;
  }
  const lower = s.toLowerCase();
  for (const [code, name] of Object.entries(STATE_CODES)) {
    if (lower.includes(name.toLowerCase())) return code;
  }
  return null;
}
