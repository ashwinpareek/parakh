// Recovery plan: turns findings into "who has to act" so stuck credit becomes money recovered.
// Every bill with credit at risk lands in exactly one bucket, decided by the finding that holds the most credit.
import type { Analysis, Finding, Invoice } from './types';
import { round2 } from './text';

export type Bucket = 'supplier' | 'you' | 'lost';

/** Credit that can never be claimed, or must not be claimed. */
const LOST = new Set(['ITC-BLOCKED', 'ITC-TIME-BARRED', 'RECON-2B-INELIGIBLE', 'DUP-EXACT', 'DUP-NEAR', 'GSTIN-SELF', 'GSTIN-SUP-CANCELLED']);
/** Credit the business itself can unlock, without waiting on the supplier. */
const YOU = new Set(['ITC-180-DAYS', 'ITC-180-SOON', 'ITC-TIME-SOON', 'RECON-OUT-OF-PERIOD', 'RECON-SUGGESTED', 'R46-DATE-FUTURE', 'FRAUD-NEW-REG']);

export function bucketOf(ruleId: string): Bucket {
  if (LOST.has(ruleId)) return 'lost';
  if (YOU.has(ruleId)) return 'you';
  return 'supplier';
}

/** What the business does next, for the "you" and "lost" buckets. */
export function youAction(ruleId: string): string {
  switch (ruleId) {
    case 'ITC-180-DAYS': return 'Pay the supplier. The credit comes back once the bill is paid (Rule 37).';
    case 'ITC-180-SOON': return 'Pay this bill before day 180 to keep the credit.';
    case 'ITC-TIME-SOON': return 'Claim it in this month’s return. The time limit is close.';
    case 'RECON-OUT-OF-PERIOD': return 'Claim it in the month the supplier reported it.';
    case 'RECON-SUGGESTED': return 'Confirm the suggested match on the Reconciliation page.';
    case 'R46-DATE-FUTURE': return 'Wait until the bill date before claiming.';
    case 'FRAUD-NEW-REG': return 'Verify the supplier on the GST portal before claiming.';
    case 'ITC-BLOCKED': return 'The law blocks credit on this purchase. Book it as a cost.';
    case 'ITC-TIME-BARRED': return 'The time limit has passed. This credit cannot be claimed.';
    case 'RECON-2B-INELIGIBLE': return 'GSTR-2B marks this credit as not available.';
    case 'DUP-EXACT': case 'DUP-NEAR': return 'Looks like a bill you already have. Claim it only once.';
    case 'GSTIN-SUP-CANCELLED': return 'The supplier’s registration was cancelled before this bill. Credit is not available; talk to the supplier about the GST they charged.';
    case 'GSTIN-SELF': return 'The bill is made out from your own GSTIN. Do not claim it.';
    default: return 'Review this bill.';
  }
}

export interface PlanItem { inv: Invoice; f: Finding; itc: number; key: string }
export interface SupplierGroup { gstin: string; name: string; items: PlanItem[]; itc: number; key: string }
export interface Plan { supplier: SupplierGroup[]; you: PlanItem[]; lost: PlanItem[]; totals: Record<Bucket, number>; recoverable: number }

/** Stable key so progress survives a reload of the same bills (invoice ids are regenerated on every load). */
export const itemKey = (inv: Invoice) => `${inv.supplier.gstin ?? inv.supplier.name}|${inv.invoiceNo ?? inv.source.fileName}`;

export function buildPlan(a: Analysis): Plan {
  const supplier = new Map<string, SupplierGroup>();
  const you: PlanItem[] = [];
  const lost: PlanItem[] = [];
  for (const inv of a.invoices) {
    const v = a.verdicts[inv.id];
    if (!v || v.itcAtRisk <= 0 || inv.extraction.method === 'pending') continue;
    const fs = a.findings.filter((f) => f.invoiceId === inv.id && f.itcAtRisk > 0);
    if (!fs.length) continue;
    const f = [...fs].sort((x, y) => y.itcAtRisk - x.itcAtRisk)[0];
    const item: PlanItem = { inv, f, itc: v.itcAtRisk, key: itemKey(inv) };
    const b = bucketOf(f.ruleId);
    if (b === 'you') you.push(item);
    else if (b === 'lost') lost.push(item);
    else {
      const g = inv.supplier.gstin ?? inv.supplier.name;
      const grp = supplier.get(g) ?? { gstin: inv.supplier.gstin ?? '', name: inv.supplier.name || g, items: [], itc: 0, key: `S|${g}` };
      grp.items.push(item);
      grp.itc = round2(grp.itc + item.itc);
      supplier.set(g, grp);
    }
  }
  const sum = (xs: { itc: number }[]) => round2(xs.reduce((s, x) => s + x.itc, 0));
  const groups = [...supplier.values()].sort((x, y) => y.itc - x.itc);
  const totals = { supplier: sum(groups), you: sum(you), lost: sum(lost) };
  return { supplier: groups, you: you.sort((x, y) => y.itc - x.itc), lost: lost.sort((x, y) => y.itc - x.itc), totals, recoverable: round2(totals.supplier + totals.you) };
}

// ---------------------------------------------------------------------------- calendar reminders

const icsDate = (iso: string) => iso.replace(/-/g, '');
const esc = (s: string) => s.replace(/[\\;,]/g, (m) => `\\${m}`).replace(/\n/g, '\\n');

/** An .ics file with the month's three GST deadlines, as all-day events with a reminder the day before. */
export function deadlinesIcs(company: string, period: string, d: { gstr1: string; ims: string; gstr3b: string }, atRisk: string): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const ev = (iso: string, title: string, desc: string, n: number) => {
    const next = new Date(`${iso}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
    return [
      'BEGIN:VEVENT', `UID:parakh-${period}-${n}@parakh`, `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${icsDate(iso)}`, `DTEND;VALUE=DATE:${icsDate(next.toISOString().slice(0, 10))}`,
      `SUMMARY:${esc(title)}`, `DESCRIPTION:${esc(desc)}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc(title)}`, 'TRIGGER:-PT15H', 'END:VALARM',
      'END:VEVENT',
    ].join('\r\n');
  };
  return [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Parakh//GST deadlines//EN', 'CALSCALE:GREGORIAN',
    ev(d.gstr1, 'GST: suppliers report sales (GSTR-1)', `Last day for suppliers to report bills for ${company}. ${atRisk} of credit is waiting on supplier fixes. Chase them before today.`, 1),
    ev(d.ims, 'GST: accept or reject bills in IMS', `Accept good bills and reject wrong ones on the GST portal's IMS screen for ${company}.`, 2),
    ev(d.gstr3b, 'GST: file GSTR-3B', `File GSTR-3B for ${company} and claim the credit Parakh marked as safe.`, 3),
    'END:VCALENDAR',
  ].join('\r\n');
}

export function downloadText(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
