import { useState } from 'react';
import type { Analysis } from '../../domain/types';
import { searchHsn } from '../../domain/reference';
import { formatINR } from '../../lib/format';
import { round2 } from '../../domain/text';
import { Card, Icon, Spinner } from '../kit';
import { T } from '../mode';
import { FlowDiagram, MonthTimeline } from '../explain';
import { GLOSSARY, GLOSSARY_ORDER } from '../glossary';
import type { WorkspaceApi } from '../workspace';
import { describeAiError } from '../../ai/provider';

export function Learn({ a, api }: { a: Analysis; api: WorkspaceApi }) {
  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Learn</div>
          <h1 style={{ marginTop: 6 }}>GST in two minutes</h1>
          <div className="meta">Everything you need to understand what Parakh is telling you. No accounting background needed.</div>
        </div>
      </div>

      <div className="learn-grid">
        <section className="card learn-card">
          <span className="big">1</span>
          <h3>GST is added to almost every sale</h3>
          <p className="ink2">A tool priced ₹1,000 with 18% GST costs ₹1,180. The ₹180 is <T k="gst">GST</T>, which the seller collects for the government.</p>
        </section>
        <section className="card learn-card">
          <span className="big">2</span>
          <h3>Businesses pay GST on what they buy, too</h3>
          <p className="ink2">When your business buys raw material, the supplier adds GST to the <T k="invoice">bill</T>. You pay it.</p>
        </section>
        <section className="card learn-card">
          <span className="big">3</span>
          <h3>You get that GST back as credit</h3>
          <p className="ink2">You subtract the GST you paid from the GST you collected, and pay only the difference. That credit is <T k="itc">input tax credit</T>, and it is only allowed when the bill is right.</p>
        </section>
      </div>

      <Calculator a={a} />

      <Card title="Which kind of GST should the bill show?" sub="it depends on where you and the supplier are">
        <div className="card-b states">
          <div className="card state-ex">
            <div className="route">Hyderabad <span className="arrow">→</span> Warangal <span className="pill clear">same state</span></div>
            <div className="split"><div style={{ width: '50%', background: 'var(--accent)' }}>CGST 9%</div><div style={{ width: '50%', background: 'var(--info)' }}>SGST 9%</div></div>
            <p className="ink2" style={{ fontSize: 12.5 }}>Within one state the 18% is split into two equal halves: <T k="cgst">CGST + SGST</T>.</p>
          </div>
          <div className="card state-ex">
            <div className="route">Pune <span className="arrow">→</span> Warangal <span className="pill info">different states</span></div>
            <div className="split"><div style={{ width: '100%', background: 'var(--ink-2)', color: 'var(--surface)' }}>IGST 18%</div></div>
            <p className="ink2" style={{ fontSize: 12.5 }}>Across states it is one tax: <T k="igst">IGST</T>. If a bill uses the wrong kind, the credit cannot be used, even if the amount is right.</p>
          </div>
        </div>
      </Card>

      <Card title="How a bill reaches the government" sub="and why your supplier matters">
        <div className="card-b" style={{ display: 'grid', gap: 14 }}>
          <FlowDiagram />
          <p className="expl">You only get credit for bills your supplier reports. Every month the portal lists those bills for you in <T k="gstr2b">GSTR-2B</T>, and you accept or reject each one in <T k="ims">IMS</T>. Parakh compares your bills with that list and checks each bill against the rules, so you know what is safe before you file <T k="gstr3b">GSTR-3B</T>.</p>
        </div>
      </Card>

      <MonthTimeline period={a.period} asOf={a.asOf} />

      <RateFinder api={api} />

      <Card title="What Parakh checks, in plain words">
        <div className="card-b gloss">
          {[
            ['Is the bill complete?', 'Every detail the law requires: numbers, dates, both GST numbers, item codes, signature.'],
            ['Is the supplier real and registered?', 'GST number checked digit by digit, and whether the registration is active or cancelled.'],
            ['Is the maths right?', 'Quantity × price, the GST amount, and the totals.'],
            ['Is it the right kind and rate of GST?', 'CGST + SGST vs IGST, and the current rate for the item.'],
            ['Can this purchase get credit at all?', 'Some purchases, like staff meals and cars, never qualify. Old bills expire.'],
            ['Did the supplier report it?', 'Your bill compared with what the supplier told the government (GSTR-2B).'],
            ['Is the e-invoice genuine?', 'The QR code’s government signature is verified and compared with the printed bill.'],
            ['Is anything suspicious?', 'Duplicate bills, brand-new suppliers with large bills, and bills from strangers.'],
          ].map(([q, d]) => <div key={q}><b>{q}</b><span className="ink2">{d}</span></div>)}
        </div>
      </Card>

      <Card title="Glossary" sub="hover or tap any underlined word in the app for these">
        <div className="card-b gloss">
          {GLOSSARY_ORDER.map((k) => {
            const g = GLOSSARY[k];
            return <div key={k}><b>{g.term}</b><span>{g.short}</span><span className="muted">{g.why}</span>{g.example && <span className="mono muted" style={{ fontSize: 11.5 }}>{g.example}</span>}</div>;
          })}
        </div>
      </Card>
    </div>
  );
}

function Calculator({ a }: { a: Analysis }) {
  const [sales, setSales] = useState(Math.round(a.totals.itcClaimed * 1.45));
  const [paid, setPaid] = useState(Math.round(a.totals.itcClaimed));
  const [stuck, setStuck] = useState(Math.round(a.totals.itcAtRisk));
  const clean = Math.max(0, sales - paid);
  const real = Math.max(0, sales - (paid - stuck));
  const max = Math.max(sales, 1);
  const num = (v: string) => Math.max(0, Number(v.replace(/[^\d.]/g, '')) || 0);
  return (
    <section className="card">
      <div className="card-h"><h2>Why every bill matters: try it</h2><span className="muted" style={{ fontSize: 12 }}>pre-filled with this workspace’s numbers</span></div>
      <div className="calc">
        <div className="calc-in">
          <label className="field" htmlFor="c-sales">GST you collected on your sales this month<input id="c-sales" className="input mono" inputMode="numeric" value={sales} onChange={(e) => setSales(num(e.target.value))} /></label>
          <label className="field" htmlFor="c-paid">GST you paid on purchases<input id="c-paid" className="input mono" inputMode="numeric" value={paid} onChange={(e) => setPaid(Math.min(num(e.target.value), 1e12))} /></label>
          <label className="field" htmlFor="c-stuck">GST stuck on bills with problems<input id="c-stuck" className="input mono" inputMode="numeric" value={stuck} onChange={(e) => setStuck(Math.min(num(e.target.value), paid))} /></label>
        </div>
        <div className="calc-out">
          <div className="calc-bar">
            <div className="row"><span>If every bill is fine</span><div className="bar"><div style={{ width: `${(clean / max) * 100}%`, background: 'var(--ok)' }} /></div><span className="v">{formatINR(clean, { decimals: false })}</span></div>
            <div className="row"><span>With the problems found</span><div className="bar"><div style={{ width: `${(clean / max) * 100}%`, background: 'var(--ok)' }} /><div style={{ width: `${((real - clean) / max) * 100}%`, background: 'var(--crit)' }} /></div><span className="v">{formatINR(real, { decimals: false })}</span></div>
          </div>
          <p style={{ fontSize: 14 }}>
            You would pay the government <b style={{ color: 'var(--crit)' }}>{formatINR(round2(real - clean), { decimals: false })} more</b> this month unless those bills are fixed.
            {' '}That is cash out of your business, not a paperwork problem.
          </p>
          <p className="muted" style={{ fontSize: 12 }}>Tax payable = GST on sales − GST credit you can claim. Credit on a faulty bill cannot be claimed, so it stops reducing your tax.</p>
        </div>
      </div>
    </section>
  );
}

function RateFinder({ api }: { api: WorkspaceApi }) {
  const [q, setQ] = useState('');
  const [ai, setAi] = useState<{ hsn: string; rate: number; label: string; note: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const results = searchHsn(q);
  const ask = async () => {
    if (!api.ai) return;
    setBusy(true); setErr(null); setAi(null);
    try {
      setAi(await api.ai.json(`What GST rate applies in India today (after the 22 Sep 2025 rate rationalisation to 5%, 18% and 40%) to: "${q}"? Give the most likely 4-6 digit HSN or SAC code. Reply with only JSON: {"hsn": string, "rate": number, "label": string (short official-style description), "note": string (one plain sentence, mention if the rate depends on details)}`, { tier: 'quick' }));
    } catch (e) { setErr(describeAiError(e)); } finally { setBusy(false); }
  };
  return (
    <Card title="GST rate finder" sub="type an item or an HSN code">
      <div className="card-b" style={{ display: 'grid', gap: 12 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <label className="sr-only" htmlFor="rf-q">Item or HSN code</label>
          <input id="rf-q" className="input" style={{ flex: '1 1 240px' }} placeholder="e.g. air conditioner, bearings, 8471" value={q} onChange={(e) => { setQ(e.target.value); setAi(null); }} />
          {api.ai && q.trim().length > 2 && <button className="btn ai" onClick={ask} disabled={busy}>{busy ? <Spinner /> : <span className="ai-badge">AI</span>} Ask AI</button>}
        </div>
        {q && (
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>HSN / SAC</th><th>Item</th><th className="r">Rate now</th><th>Before 22 Sep 2025</th></tr></thead>
              <tbody>
                {results.map((r) => (
                  <tr key={r.code}><td className="mono">{r.code}</td><td>{r.label}</td><td className="r"><b>{r.rate}%</b></td><td className="muted">{r.previous != null ? `${r.previous}% (reduced)` : 'unchanged'}</td></tr>
                ))}
                {ai && <tr><td className="mono">{ai.hsn}</td><td>{ai.label} <span className="ai-badge">AI</span><div className="sub">{ai.note}</div></td><td className="r"><b>{ai.rate}%</b></td><td className="muted">verify before use</td></tr>}
                {!results.length && !ai && <tr><td colSpan={4} className="muted">Not in the built-in list.{api.ai ? ' Ask AI for a suggestion.' : ''}</td></tr>}
              </tbody>
            </table>
          </div>
        )}
        {err && <p className="muted" style={{ fontSize: 12 }}>{err}</p>}
        <p className="muted" style={{ fontSize: 11.5 }}><Icon.alert /> A reference for common business purchases. The exact rate depends on the full 8-digit code; confirm with the CBIC rate notification.</p>
      </div>
    </Card>
  );
}
