import { useEffect, useMemo, useState } from 'react';
import type { Analysis } from '../../domain/types';
import { buildPlan, deadlinesIcs, downloadText, youAction, type PlanItem, type SupplierGroup } from '../../domain/recovery';
import { round2 } from '../../domain/text';
import { formatDate, formatINR, formatINRCompact, formatPeriod } from '../../lib/format';
import { templateFollowUp } from '../../ai/tasks';
import { Icon } from '../kit';
import type { WorkspaceApi } from '../workspace';
import type { Route } from '../App';
import { periodDeadlines } from './Overview';
import { useMode } from '../mode';

type Status = 'todo' | 'asked' | 'fixed';
const RATE_KEY = 'parakh.costOfMoney';

function useProgress(a: Analysis) {
  const key = `parakh.recovery.v1|${a.company.gstin}|${a.period}`;
  const [map, setMap] = useState<Record<string, Status>>(() => { try { return JSON.parse(localStorage.getItem(key) ?? '{}'); } catch { return {}; } });
  useEffect(() => { try { localStorage.setItem(key, JSON.stringify(map)); } catch { /* storage unavailable */ } }, [key, map]);
  const set = (k: string, s: Status) => setMap((m) => ({ ...m, [k]: s }));
  return { map, set, reset: () => setMap({}) };
}

export function whatsappLink(a: Analysis, g: SupplierGroup) {
  const issues = g.items.map(({ inv, f, itc }) => ({ invoiceNo: inv.invoiceNo ?? '?', date: formatDate(inv.invoiceDate), problem: f.title + '.', ask: f.fix ?? 'Please correct and re-share.', itc }));
  const msg = templateFollowUp(a.company, { name: g.name, gstin: g.gstin }, issues).whatsapp;
  return `https://wa.me/?text=${encodeURIComponent(msg)}`;
}

export function Recovery({ a, api, go }: { a: Analysis; api: WorkspaceApi; go: (r: Route) => void }) {
  const mode = useMode();
  const plan = useMemo(() => buildPlan(a), [a]);
  const { map, set, reset } = useProgress(a);
  const [rate, setRate] = useState<number>(() => { try { return Number(localStorage.getItem(RATE_KEY)) || 12; } catch { return 12; } });
  useEffect(() => { try { localStorage.setItem(RATE_KEY, String(rate)); } catch { /* storage unavailable */ } }, [rate]);
  const dl = periodDeadlines(a.period);

  const recovered = round2(
    plan.supplier.filter((g) => map[g.key] === 'fixed').reduce((s, g) => s + g.itc, 0) +
    plan.you.filter((i) => map[i.key] === 'fixed').reduce((s, i) => s + i.itc, 0),
  );
  const asked = plan.supplier.filter((g) => map[g.key] === 'asked' || map[g.key] === 'fixed').length;
  const share = plan.recoverable ? recovered / plan.recoverable : 0;
  const locked = round2(plan.recoverable - recovered);
  const perMonth = round2((locked * (rate || 0)) / 100 / 12);
  const allDone = plan.recoverable > 0 && recovered >= plan.recoverable;

  const addToCalendar = () => {
    downloadText(`parakh-gst-deadlines-${a.period}.ics`, deadlinesIcs(a.company.name, a.period, dl, formatINR(plan.totals.supplier)), 'text/calendar');
    api.flash('Calendar file downloaded. Open it to add the three deadlines.');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Recovery plan · {formatPeriod(a.period)}</div>
          <h1 style={{ marginTop: 6 }}>{plan.recoverable > 0 ? <>Get back {formatINRCompact(plan.recoverable)} of stuck GST</> : 'Nothing to recover this month'}</h1>
          <div className="meta">{mode === 'simple'
            ? 'Finding mistakes is half the job. This page turns every stuck rupee into a to-do: who has to act, what to ask for, and by when. Tick things off as they get fixed.'
            : 'Credit at risk, grouped by the party that must act. Supplier-side items need a GSTR-1/1A correction or a re-issued invoice; your-side items clear on your own action; the rest must not be claimed.'}</div>
        </div>
        <div className="right">
          <button className="btn" onClick={addToCalendar}><Icon.calendar /> Add deadlines to calendar</button>
        </div>
      </div>

      <section className={`card rec-hero ${allDone ? 'done' : ''}`} data-tour="recovery">
        <div className="rec-hero-top">
          <div>
            <div className="eyebrow">Recovered so far</div>
            <div className="rec-big"><span className="num">{formatINR(recovered)}</span><span className="muted"> of {formatINR(plan.recoverable)}</span></div>
          </div>
          <div className="rec-ring" style={{ ['--p' as string]: `${Math.round(share * 100)}` }}><span>{Math.round(share * 100)}%</span></div>
        </div>
        <div className="rec-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, share * 100)}%` }} /></div>
        <div className="rec-stats">
          <div><span><span className="rec-dot sup" />Suppliers must fix</span><b className="num">{formatINR(plan.totals.supplier)}</b><span className="muted">{plan.supplier.length} suppliers · {asked} asked</span></div>
          <div><span><span className="rec-dot you" />You can unlock</span><b className="num">{formatINR(plan.totals.you)}</b><span className="muted">{plan.you.length} bill{plan.you.length === 1 ? '' : 's'}</span></div>
          <div><span><span className="rec-dot lost" />Do not claim</span><b className="num">{formatINR(plan.totals.lost)}</b><span className="muted">{plan.lost.length} bill{plan.lost.length === 1 ? '' : 's'} · avoids notices</span></div>
        </div>
        {allDone && <div className="rec-win"><Icon.check /> Every recoverable rupee is marked as fixed. Re-run the check with the corrected bills to confirm.</div>}
      </section>

      {locked > 0 && (
        <div className="callout warn rec-cost">
          <Icon.alert />
          <div className="body">
            <b>{formatINR(locked)} of your cash is locked until these are fixed.</b>
            <span className="ink2" style={{ fontSize: 12.5 }}>
              Credit you cannot claim is paid in cash instead. If that cash costs you{' '}
              <label className="rec-rate"><input type="number" min={0} max={60} step={0.5} value={rate} onChange={(e) => setRate(Number(e.target.value))} aria-label="Your yearly cost of money, in percent" />% a year</label>
              {' '}(for example, your overdraft rate), waiting costs about <b className="num">{formatINR(perMonth)}</b> every month.
            </span>
          </div>
        </div>
      )}

      <section className="card">
        <div className="card-h"><h2><span className="rec-step">1</span> Ask suppliers to fix their bills</h2><span className="muted" style={{ fontSize: 12 }}>Ask before {formatDate(dl.gstr1)}, so the fix reaches this month’s GSTR-2B</span></div>
        {plan.supplier.length === 0 ? <div className="card-b"><div className="ok-box">No supplier needs to correct anything.</div></div> : (
          <div className="rec-list">
            <div className="rec-tip"><b>Tip:</b> many businesses hold back the GST part of their next payment to a supplier until the corrected bill shows in GSTR-2B. It is the fastest way to get a fix.</div>
            {plan.supplier.map((g) => {
              const s = map[g.key] ?? 'todo';
              return (
                <div key={g.key} className={`rec-row ${s}`}>
                  <div className="rec-main">
                    <b>{g.name}</b>
                    <span className="muted">{g.items.length} bill{g.items.length > 1 ? 's' : ''} · {g.items[0].f.title}{g.items.length > 1 ? ` and ${g.items.length - 1} more` : ''}</span>
                  </div>
                  <b className="num rec-amt">{formatINR(g.itc)}</b>
                  <div className="rec-acts">
                    <a className="btn sm wa" href={whatsappLink(a, g)} target="_blank" rel="noreferrer" onClick={() => { if (s === 'todo') set(g.key, 'asked'); }}><Icon.whatsapp /> WhatsApp</a>
                    <button className="btn sm ghost" onClick={() => go({ view: 'suppliers', focus: g.gstin })}><Icon.mail /> Email</button>
                    <StatusSeg value={s} onChange={(v) => set(g.key, v)} />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>

      <section className="card">
        <div className="card-h"><h2><span className="rec-step">2</span> Things only you can unlock</h2></div>
        {plan.you.length === 0 ? <div className="card-b"><div className="ok-box">Nothing waiting on you.</div></div> : (
          <div className="rec-list">{plan.you.map((i) => <ItemRow key={i.key} i={i} go={go} done={map[i.key] === 'fixed'} toggle={(d) => set(i.key, d ? 'fixed' : 'todo')} />)}</div>
        )}
      </section>

      <section className="card">
        <div className="card-h"><h2><span className="rec-step lost">3</span> Do not claim these</h2><span className="muted" style={{ fontSize: 12 }}>Leaving them out protects you from a notice and interest</span></div>
        {plan.lost.length === 0 ? <div className="card-b"><div className="ok-box">Nothing to leave out.</div></div> : (
          <div className="rec-list">{plan.lost.map((i) => <ItemRow key={i.key} i={i} go={go} />)}</div>
        )}
      </section>

      {Object.keys(map).length > 0 && <div><button className="btn sm ghost" onClick={reset}>Reset progress</button></div>}
    </div>
  );
}

function StatusSeg({ value, onChange }: { value: Status; onChange: (s: Status) => void }) {
  return (
    <div className="seg rec-seg" role="group" aria-label="Status">
      {(['todo', 'asked', 'fixed'] as Status[]).map((s) => (
        <button key={s} aria-pressed={value === s} onClick={() => onChange(s)}>{s === 'todo' ? 'To do' : s === 'asked' ? 'Asked' : 'Fixed'}</button>
      ))}
    </div>
  );
}

function ItemRow({ i, go, done, toggle }: { i: PlanItem; go: (r: Route) => void; done?: boolean; toggle?: (d: boolean) => void }) {
  return (
    <div className={`rec-row ${done ? 'fixed' : ''}`}>
      {toggle && <input type="checkbox" className="rec-check" checked={!!done} onChange={(e) => toggle(e.target.checked)} aria-label={`Mark ${i.inv.invoiceNo} as done`} />}
      <button className="rec-main linkish" onClick={() => go({ view: 'invoice', id: i.inv.id })}>
        <b><span className="mono">{i.inv.invoiceNo ?? i.inv.source.fileName}</span> · {i.inv.supplier.name || i.inv.supplier.gstin}</b>
        <span className="muted">{youAction(i.f.ruleId)}</span>
      </button>
      <b className="num rec-amt">{formatINR(i.itc)}</b>
    </div>
  );
}
