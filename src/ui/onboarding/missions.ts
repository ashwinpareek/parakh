// Missions: a short checklist where every item teaches one feature by doing it.
// Each mission completes itself when the user performs the action anywhere in the app.
import type { Analysis } from '../../domain/types';
import type { Route } from '../App';
import type { Step } from '../Tour';

export type MissionId = 'stuck' | 'bill' | 'scan' | 'edited' | 'recon' | 'followup' | 'file';

export interface Mission {
  id: MissionId;
  title: string;
  why: string;
  learn: string; // what the user will understand after doing it
  spotlight: Step;
}

const byRule = (a: Analysis, rule: string) => a.findings.find((f) => f.ruleId === rule)?.invoiceId;

export const MISSIONS: Mission[] = [
  {
    id: 'stuck', title: 'Find out how much money is stuck', why: 'Start with the big picture.', learn: 'How much GST you can get back, and how much is blocked by bad bills.',
    spotlight: { route: () => ({ view: 'overview' }), selector: '[data-tour="ledger"]', title: 'This is your money', body: 'Green is GST you can safely get back. Red is stuck because some bills have problems. Your job this month is to shrink the red.' },
  },
  {
    id: 'bill', title: 'Open a bill with a problem', why: 'See exactly what went wrong.', learn: 'How Parakh points to the mistake on the bill itself.',
    spotlight: { route: (a) => { const id = byRule(a, 'TAX-HEAD-IGST'); return id ? { view: 'invoice', id } : { view: 'invoices' }; }, selector: '[data-tour="doc"]', title: 'The problem, highlighted on the bill', body: 'The gold box marks the wrong line. On the right, Parakh explains what is wrong, why it matters and what to do.' },
  },
  {
    id: 'scan', title: 'Let AI read a photographed bill', why: 'Not every bill is a neat PDF.', learn: 'How AI turns a photo into data, and why a person confirms it.',
    spotlight: { route: () => ({ view: 'overview' }), selector: '[data-tour="scan"]', title: 'A photo of a bill', body: 'This bill is only a picture, so a computer cannot read its text. Press the button and AI will read it, then the same checks run.' },
  },
  {
    id: 'edited', title: 'Catch a bill that was changed after registration', why: 'Some bills are tampered with.', learn: 'How the government-signed QR code proves what the real bill said.',
    spotlight: { route: (a) => { const id = byRule(a, 'EINV-QR-MISMATCH'); return id ? { view: 'invoice', id } : { view: 'invoices' }; }, selector: '[data-tour="qr"]', title: 'The printed bill does not match its QR code', body: 'The QR code was signed by the government when the bill was registered. The printed total is higher, so someone edited it afterwards.' },
  },
  {
    id: 'recon', title: 'See which bills suppliers never reported', why: 'You only get GST back for reported bills.', learn: 'How your bills are compared with the government’s list (GSTR-2B).',
    spotlight: { route: () => ({ view: 'recon' }), selector: '[data-tour="recon"]', title: 'Your bills vs the government’s list', body: 'Each tab is one kind of difference. Open "Supplier hasn’t reported" to see bills whose GST you cannot claim yet.' },
  },
  {
    id: 'followup', title: 'Ask a supplier to fix their bill', why: 'Problems are fixed by the supplier.', learn: 'How Parakh writes the message for you, in English, Telugu or Hindi.',
    spotlight: { route: () => ({ view: 'suppliers' }), selector: '[data-tour="followup"]', title: 'Write to the supplier in one click', body: 'Pick a language and press "Draft follow-up". Parakh lists every bill and exactly what the supplier must correct.' },
  },
  {
    id: 'file', title: 'See what to file this month', why: 'The last step.', learn: 'Which bills to accept or reject on the GST portal, and the credit to claim.',
    spotlight: { route: () => ({ view: 'actions' }), selector: '[data-tour="table4"]', title: 'Your filing, ready', body: 'These are the figures for this month’s return, worked out from every check you just saw.' },
  },
];

const KEY = 'parakh.missions.v1';
export function loadDone(): MissionId[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; }
}
export function saveDone(ids: MissionId[]) {
  try { localStorage.setItem(KEY, JSON.stringify(ids)); } catch { /* storage unavailable */ }
}

/** Fire from anywhere in the app when the user does something a mission teaches. */
export function completeMission(id: MissionId) {
  window.dispatchEvent(new CustomEvent('parakh:mission', { detail: id }));
}

/** Which mission a navigation completes. */
export function missionForRoute(r: Route): MissionId | null {
  if (r.view === 'recon') return 'recon';
  if (r.view === 'actions') return 'file';
  return null;
}
