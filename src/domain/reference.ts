// Reference data used by the rule engine.
// Rates reflect the rationalised structure effective 22 Sep 2025 (5% / 18% / 40% plus special rates).
// They are a curated subset for common B2B purchases, used as an advisory check; the authoritative
// source is the CBIC rate notification for the exact 8-digit HSN.

import type { RegistryEntry } from './types';

export const GST_REFORM_DATE = '2025-09-22';
export const VALID_RATES = [0, 0.1, 0.25, 1, 1.5, 3, 5, 6, 7.5, 12, 18, 28, 40];
export const LEGACY_RATES = [12, 28];

interface HsnRef { rate: number; label: string; previous?: number }

const HSN: Record<string, HsnRef> = {
  '2523': { rate: 18, label: 'Cement', previous: 28 },
  '2710': { rate: 18, label: 'Lubricating oils (petroleum)' },
  '3920': { rate: 18, label: 'Plastic film and sheets' },
  '4009': { rate: 18, label: 'Rubber hoses' },
  '4016': { rate: 18, label: 'Articles of vulcanised rubber' },
  '7208': { rate: 18, label: 'Hot-rolled steel flat products' },
  '7214': { rate: 18, label: 'Steel bars and rods' },
  '7216': { rate: 18, label: 'Steel angles, shapes and sections' },
  '7318': { rate: 18, label: 'Screws, bolts, nuts and washers' },
  '8207': { rate: 18, label: 'Interchangeable tools (drills, taps, mills)' },
  '8209': { rate: 18, label: 'Tool tips and inserts' },
  '8415': { rate: 18, label: 'Air conditioning machines', previous: 28 },
  '8471': { rate: 18, label: 'Computers and peripherals' },
  '8482': { rate: 18, label: 'Ball and roller bearings' },
  '8504': { rate: 18, label: 'Transformers, converters, UPS' },
  '8517': { rate: 18, label: 'Telephones and network equipment' },
  '8528': { rate: 18, label: 'Monitors and televisions', previous: 28 },
  '8536': { rate: 18, label: 'Switchgear (MCBs, relays, connectors)' },
  '8544': { rate: 18, label: 'Insulated wire and cable' },
  '2202': { rate: 40, label: 'Aerated and caffeinated beverages', previous: 28 },
  '9954': { rate: 18, label: 'Construction services' },
  '9983': { rate: 18, label: 'Professional and technical services' },
  '9984': { rate: 18, label: 'Telecommunication services' },
  '9985': { rate: 18, label: 'Support services' },
  '9987': { rate: 18, label: 'Maintenance and repair services' },
};

/** Everyday words people type, mapped to codes, for the rate finder. */
const HSN_ALIASES: Record<string, string[]> = {
  '8415': ['ac', 'air conditioner', 'aircon', 'split ac'], '8471': ['laptop', 'computer', 'desktop', 'pc'], '8517': ['phone', 'mobile', 'router', 'smartphone'],
  '8528': ['tv', 'television', 'monitor'], '2523': ['cement'], '8482': ['bearing', 'bearings'], '7318': ['bolt', 'nut', 'screw', 'washer', 'fastener'],
  '8544': ['cable', 'wire'], '7214': ['steel bar', 'rod', 'tmt'], '8207': ['drill', 'tap', 'end mill', 'cutting tool'], '2710': ['lubricant', 'oil', 'grease'],
  '2202': ['cola', 'soft drink', 'soda', 'energy drink'], '9983': ['consultant', 'ca fees', 'legal', 'audit fees'], '9984': ['internet', 'broadband', 'telecom'],
  '9987': ['repair', 'maintenance', 'amc'], '9954': ['construction', 'civil work'], '8536': ['mcb', 'switch', 'relay'], '8504': ['ups', 'inverter', 'transformer'],
};

export function searchHsn(q: string): (HsnRef & { code: string })[] {
  const n = q.trim().toLowerCase();
  if (!n) return [];
  const digits = n.replace(/\D/g, '');
  return Object.entries(HSN)
    .map(([code, ref]) => {
      let score = 0;
      if (digits.length >= 2 && (code.startsWith(digits.slice(0, 4)) || digits.startsWith(code))) score = 3;
      if (ref.label.toLowerCase().includes(n)) score = Math.max(score, 2);
      if ((HSN_ALIASES[code] ?? []).some((a) => a === n || n.includes(a) || a.includes(n))) score = Math.max(score, 2);
      if (n.split(/\s+/).some((w) => w.length > 3 && ref.label.toLowerCase().includes(w))) score = Math.max(score, 1);
      return { code, ...ref, score };
    })
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6);
}

export function hsnReference(hsn: string | null | undefined): (HsnRef & { code: string }) | null {
  if (!hsn) return null;
  const h = hsn.replace(/\D/g, '');
  for (let len = Math.min(8, h.length); len >= 4; len--) {
    const ref = HSN[h.slice(0, len)];
    if (ref) return { ...ref, code: h.slice(0, len) };
  }
  return null;
}

/** Section 17(5) blocked-credit patterns. Deterministic first pass; the AI review refines it. */
export const BLOCKED_CREDIT: { id: string; clause: string; label: string; re: RegExp; hsn?: RegExp }[] = [
  { id: 'food', clause: 'Sec 17(5)(b)(i)', label: 'Food, beverages and outdoor catering', re: /\b(catering|canteen|food|lunch|dinner|breakfast|meals?|beverages?|refreshments?|snacks?|sweets|restaurant|banquet|buffet)\b/i, hsn: /^9963/ },
  { id: 'vehicle', clause: 'Sec 17(5)(a)', label: 'Motor vehicles for up to 13 persons', re: /\b(car|sedan|suv|hatchback|motor car|passenger vehicle)\b/i, hsn: /^8703/ },
  { id: 'club', clause: 'Sec 17(5)(b)(ii)', label: 'Club, health and fitness memberships', re: /\b(club|gym|fitness|membership fee)\b/i },
  { id: 'beauty', clause: 'Sec 17(5)(b)(i)', label: 'Beauty treatment, health services, cosmetic surgery', re: /\b(beauty|spa|salon|cosmetic)\b/i },
  { id: 'insurance', clause: 'Sec 17(5)(b)(i)', label: 'Life and health insurance', re: /\b(health insurance|life insurance|mediclaim|group medical)\b/i },
  { id: 'travel', clause: 'Sec 17(5)(b)(iii)', label: 'Travel benefits to employees on vacation', re: /\b(holiday package|vacation|leave travel|ltc|tour package)\b/i },
  { id: 'gift', clause: 'Sec 17(5)(h)', label: 'Gifts and free samples', re: /\b(gifts?|hampers?|diwali gift|free samples?)\b/i },
];

// ---------------------------------------------------------------------------------------------
// Taxpayer registry. In production this is a live GSTIN search through a GST Suvidha Provider
// (GSP) API. The demo ships a fixed registry for the sample suppliers so the flow works offline.
// ---------------------------------------------------------------------------------------------
const REGISTRY: RegistryEntry[] = [
  { gstin: '36AAHFD7712K1Z9', legalName: 'DECCAN STEEL TRADERS', tradeName: 'Deccan Steel Traders', status: 'Active', registeredOn: '2017-07-01', constitution: 'Partnership', einvoiceMandated: false, filing: 'Monthly' },
  { gstin: '27AAFCP3391Q1ZP', legalName: 'PUNE TOOLCRAFT INDUSTRIES PRIVATE LIMITED', tradeName: 'Pune Toolcraft Industries', status: 'Active', registeredOn: '2017-07-01', constitution: 'Private Limited Company', einvoiceMandated: true, filing: 'Monthly' },
  { gstin: '36ABDFK5520H1ZH', legalName: 'KAKATIYA PACKAGING SOLUTIONS', tradeName: 'Kakatiya Packaging Solutions', status: 'Active', registeredOn: '2019-11-12', constitution: 'Partnership', einvoiceMandated: false, filing: 'Monthly' },
  { gstin: '36AGPFG1184C1Z5', legalName: 'GODAVARI ELECTRICALS', tradeName: 'Godavari Electricals', status: 'Active', registeredOn: '2018-03-20', constitution: 'Partnership', einvoiceMandated: false, filing: 'Monthly' },
  { gstin: '36AAJFN2245E1ZG', legalName: 'NIZAM HYDRAULICS', tradeName: 'Nizam Hydraulics', status: 'Active', registeredOn: '2020-01-08', constitution: 'Partnership', einvoiceMandated: false, filing: 'Monthly' },
  { gstin: '33AABCC8834L1ZH', legalName: 'CHENNAI BEARINGS COMPANY PRIVATE LIMITED', tradeName: 'Chennai Bearings Co.', status: 'Active', registeredOn: '2017-07-01', constitution: 'Private Limited Company', einvoiceMandated: false, filing: 'Monthly' },
  { gstin: '36AAQFS9012B1Z7', legalName: 'SREE VINAYAKA TOOLS', tradeName: 'Sree Vinayaka Tools', status: 'Active', registeredOn: '2021-06-02', constitution: 'Partnership', einvoiceMandated: false, filing: 'Monthly' },
  { gstin: '36AAKFC4471N1ZZ', legalName: 'COOLAIR SYSTEMS', tradeName: 'Coolair Systems', status: 'Active', registeredOn: '2018-09-14', constitution: 'Partnership', einvoiceMandated: false, filing: 'Monthly' },
  { gstin: '36ADVPR3328G1Z3', legalName: 'RAVINDER REDDY ADULLA', tradeName: 'Paradise Caterers', status: 'Active', registeredOn: '2019-04-01', constitution: 'Proprietorship', einvoiceMandated: false, filing: 'Quarterly (QRMP)' },
  { gstin: '36AFGPL7765D1Z9', legalName: 'LAXMAN PRASAD GUPTA', tradeName: 'Laxmi Hardware Stores', status: 'Active', registeredOn: '2017-07-01', constitution: 'Proprietorship', einvoiceMandated: false, filing: 'Quarterly (QRMP)' },
  { gstin: '36AACFB5519J1ZH', legalName: 'BHARAT ABRASIVES', tradeName: 'Bharat Abrasives', status: 'Cancelled', registeredOn: '2018-02-05', cancelledOn: '2026-06-30', constitution: 'Partnership', einvoiceMandated: false, filing: 'Monthly' },
  { gstin: '29AAECB6672P1ZW', legalName: 'BENGALURU FASTENERS PRIVATE LIMITED', tradeName: 'Bengaluru Fasteners', status: 'Active', registeredOn: '2017-07-01', constitution: 'Private Limited Company', einvoiceMandated: false, filing: 'Monthly' },
  { gstin: '36AAOFO3341K1ZY', legalName: 'ORUGALLU ENGINEERING WORKS', tradeName: 'Orugallu Engineering Works', status: 'Active', registeredOn: '2020-08-17', constitution: 'Partnership', einvoiceMandated: false, filing: 'Monthly' },
  { gstin: '36AAGCT8890F1ZU', legalName: 'TELANGANA LUBRICANTS AND CHEMICALS PRIVATE LIMITED', tradeName: 'Telangana Lubricants & Chemicals', status: 'Active', registeredOn: '2017-07-01', constitution: 'Private Limited Company', einvoiceMandated: true, filing: 'Monthly' },
  { gstin: '37AAZFK1203M1ZW', legalName: 'KRISHNA TRADERS', tradeName: 'Krishna Traders', status: 'Active', registeredOn: '2026-05-02', constitution: 'Partnership', einvoiceMandated: false, filing: 'Monthly' },
  { gstin: '36AAJCS6618L1ZT', legalName: 'SIGMA MACHINE TOOLS PRIVATE LIMITED', tradeName: 'Sigma Machine Tools', status: 'Active', registeredOn: '2017-07-01', constitution: 'Private Limited Company', einvoiceMandated: true, filing: 'Monthly' },
  { gstin: '36AAICT2290R1ZL', legalName: 'TELENET BROADBAND SERVICES PRIVATE LIMITED', tradeName: 'TeleNet Broadband', status: 'Active', registeredOn: '2017-07-01', constitution: 'Private Limited Company', einvoiceMandated: true, filing: 'Monthly' },
];

const REG_INDEX = new Map(REGISTRY.map((r) => [r.gstin, r]));
export const lookupRegistry = (gstin: string | null | undefined) => (gstin ? REG_INDEX.get(gstin) ?? null : null);
