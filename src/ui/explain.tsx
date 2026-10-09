import { useState } from 'react';
import { formatDate, formatINRCompact, formatPeriod } from '../lib/format';
import { daysBetween } from '../domain/text';
import { Icon } from './kit';
import { T } from './mode';

const HIDE_KEY = 'parakh.startHereHidden';

/** The one-screen story of input tax credit, for someone who has never heard of it. */
export function StartHere({ onTour, onLearn }: { onTour: () => void; onLearn: () => void }) {
  const [hidden, setHidden] = useState(() => { try { return localStorage.getItem(HIDE_KEY) === '1'; } catch { return false; } });
  if (hidden) {
    return (
      <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => { setHidden(false); try { localStorage.removeItem(HIDE_KEY); } catch { /* ignore */ } }}>
        <Icon.learn /> New to GST? Show the 30-second explanation
      </button>
    );
  }
  return (
    <section className="card start" aria-labelledby="start-title">
      <div className="start-text">
        <div className="eyebrow">New to GST? Start here</div>
        <h2 id="start-title">Get back the GST you paid on purchases, safely</h2>
        <ol className="steps">
          <li><b>Your supplier adds GST to the bill.</b> You pay it along with the price.</li>
          <li><b>You can subtract that GST from the GST you owe</b> on your own sales. This is called <T k="itc">input tax credit</T>.</li>
          <li><b>But only if the bill is correct and the supplier reported it</b> to the government, so it shows up in your <T k="gstr2b">GSTR-2B</T>.</li>
        </ol>
        <p className="ink2" style={{ fontSize: 13 }}>Parakh checks every bill for both, then tells you in rupees what is safe to claim and what to fix.</p>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn primary sm" onClick={onTour}><Icon.play /> Take the 60-second tour</button>
          <button className="btn sm" onClick={onLearn}><Icon.learn /> Learn GST basics</button>
          <button className="btn ghost sm" onClick={() => { setHidden(true); try { localStorage.setItem(HIDE_KEY, '1'); } catch { /* ignore */ } }}>Hide</button>
        </div>
      </div>
      <FlowDiagram />
    </section>
  );
}

/** Supplier → bill → you; supplier → GSTR-1 → portal → GSTR-2B → you; Parakh compares the two paths. */
export function FlowDiagram() {
  return (
    <svg className="flow" viewBox="0 0 520 252" role="img" aria-label="How GST credit flows: your supplier gives you a bill and reports the sale to the GST portal; the portal lists it in your GSTR-2B; Parakh checks the bill and compares it with GSTR-2B.">
      <defs>
        <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" className="f-ink3" /></marker>
      </defs>
      <g className="node"><rect x="10" y="20" width="130" height="58" rx="8" /><text x="75" y="46" textAnchor="middle" className="t-b">Your supplier</text><text x="75" y="64" textAnchor="middle" className="t-s">sells you goods</text></g>
      <g className="node"><rect x="380" y="20" width="130" height="58" rx="8" /><text x="445" y="46" textAnchor="middle" className="t-b">You</text><text x="445" y="64" textAnchor="middle" className="t-s">claim the GST back</text></g>
      <g className="node"><rect x="195" y="172" width="130" height="58" rx="8" /><text x="260" y="198" textAnchor="middle" className="t-b">GST portal</text><text x="260" y="216" textAnchor="middle" className="t-s">government records</text></g>
      <path d="M140 49 H378" className="edge" markerEnd="url(#arr)" />
      <text x="260" y="40" textAnchor="middle" className="t-s">① bill with GST</text>
      <path d="M75 78 C 75 150, 140 200, 193 201" className="edge" markerEnd="url(#arr)" />
      <text x="188" y="244" textAnchor="end" className="t-s">② reports the sale (GSTR-1)</text>
      <path d="M327 201 C 380 200, 445 150, 445 80" className="edge" markerEnd="url(#arr)" />
      <text x="332" y="244" className="t-s">③ lists it in your GSTR-2B</text>
      <g className="lens"><rect x="196" y="82" width="128" height="52" rx="26" /><text x="260" y="104" textAnchor="middle" className="t-b acc">Parakh</text><text x="260" y="121" textAnchor="middle" className="t-s">checks ① against ③</text></g>
    </svg>
  );
}

/** The month's GST calendar with "you are here". Deadlines follow the standard monthly cycle. */
export function MonthTimeline({ period, asOf, atRisk }: { period: string; asOf: string; atRisk?: number }) {
  const [y, m] = period.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = String(m === 12 ? 1 : m + 1).padStart(2, '0');
  const start = `${period}-01`;
  const d = (day: number) => `${ny}-${nm}-${String(day).padStart(2, '0')}`;
  const end = d(22);
  void end;
  // Stops are evenly spaced so labels never collide; "today" is placed proportionally within its segment.
  const dates = [start, d(11), d(14), d(20)];
  const at = (iso: string) => {
    if (iso <= dates[0]) return 0;
    for (let i = 1; i < dates.length; i++) {
      if (iso <= dates[i]) return ((i - 1) + daysBetween(dates[i - 1], iso) / Math.max(1, daysBetween(dates[i - 1], dates[i]))) * (100 / (dates.length - 1));
    }
    return 100;
  };
  const stops = [
    { date: start, label: `${formatPeriod(period).split(' ')[0]}`, sub: 'you buy and get bills', k: undefined },
    { date: d(11), label: formatDate(d(11)).slice(0, 6), sub: 'suppliers report sales', k: 'gstr1' },
    { date: d(14), label: formatDate(d(14)).slice(0, 6), sub: 'IMS closes · GSTR-2B made', k: 'ims' },
    { date: d(20), label: formatDate(d(20)).slice(0, 6), sub: 'you file GSTR-3B', k: 'gstr3b' },
  ];
  const today = at(asOf);
  const next = stops.find((s) => s.date >= asOf);
  return (
    <section className="card timeline" aria-label="This month's GST deadlines">
      <div className="tl-head">
        <span className="eyebrow">This month’s deadlines</span>
        {next && <span className="ink2" style={{ fontSize: 12.5 }}><b style={{ color: 'var(--high)' }}>{daysBetween(asOf, next.date)} days</b> until {next.sub}{atRisk ? `. Fix what you can before then to save ${formatINRCompact(atRisk)}.` : '.'}</span>}
      </div>
      <div className="tl-track">
        <div className="tl-line" />
        <div className="tl-done" style={{ width: `${today}%` }} />
        {stops.map((s) => (
          <div key={s.date} className={`tl-stop ${s.date < asOf ? 'past' : ''} ${s.date === start ? 'first' : ''} ${s.k === 'gstr3b' ? 'last' : ''}`} style={{ left: `${at(s.date)}%` }}>
            <span className="tl-dot" />
            <span className="tl-label">{s.k ? <T k={s.k}>{s.label}</T> : s.label}</span>
            <span className="tl-sub">{s.sub}</span>
          </div>
        ))}
        <div className="tl-today" style={{ left: `${today}%` }}><span>Today · {formatDate(asOf).slice(0, 6)}</span></div>
      </div>
    </section>
  );
}
