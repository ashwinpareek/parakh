import { useState } from 'react';
import { useMode } from '../mode';
import type { Route } from '../App';

const HINTS: Partial<Record<Route['view'], string>> = {
  overview: 'Your summary for the month. Start with the headline, then the red part of the bar: that is GST stuck on bills with problems.',
  invoices: 'Every bill, most urgent first. Click any row to open the bill and see what is wrong with it.',
  invoice: 'Left: the bill itself. Right: what Parakh found. Click a problem to see it highlighted on the bill.',
  recon: 'Your bills compared with the list your suppliers gave the government. Each tab is one kind of difference.',
  suppliers: 'Which suppliers are causing problems. Pick one and Parakh writes them a message asking for a fix.',
  actions: 'What to do on the GST portal this month: which bills to accept or reject, and how much GST to claim.',
  report: 'Download everything for your accountant: an Excel workbook, a printable report or a list of problems.',
  reliability: 'How we test Parakh: bills whose right answers we know, and how many of them it gets right.',
};

const KEY = 'parakh.hints.hidden';
const read = (): string[] => { try { return JSON.parse(localStorage.getItem(KEY) ?? '[]'); } catch { return []; } };

/** One plain sentence at the top of each page saying what it is for. Shown in Simple mode until dismissed. */
export function PageHint({ view }: { view: Route['view'] }) {
  const mode = useMode();
  const [hidden, setHidden] = useState<string[]>(read);
  const text = HINTS[view];
  if (!text || mode !== 'simple' || hidden.includes(view)) return null;
  const hide = () => { const next = [...hidden, view]; setHidden(next); try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* ignore */ } };
  return (
    <div className="page-hint" role="note">
      <span className="ph-icon" aria-hidden="true">i</span>
      <span>{text}</span>
      <button className="btn ghost sm" onClick={hide}>Got it</button>
    </div>
  );
}

export function resetHints() { try { localStorage.removeItem(KEY); } catch { /* ignore */ } }
