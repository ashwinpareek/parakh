import { useMemo } from 'react';
import type { Analysis, ImsAction, PortalRecord } from '../../domain/types';
import { portalImsAction } from '../../domain/analyze';
import { round2 } from '../../domain/text';
import { formatDate, formatINR, formatPeriod } from '../../lib/format';
import { Card, ImsPill } from '../kit';
import type { Route } from '../App';
import { periodDeadlines } from './Overview';
import { T, useMode } from '../mode';

export interface ImsRow { rec: PortalRecord; action: ImsAction; reason: string; invoiceId?: string; tax: number }

export function imsRows(a: Analysis): ImsRow[] {
  const books = a.invoices.filter((i) => i.extraction.method !== 'pending');
  return a.portal.map((rec) => {
    const r = a.recon.find((x) => x.portalId === rec.id);
    const tax = round2(rec.igst + rec.cgst + rec.sgst + rec.cess);
    if (r?.invoiceId) {
      const v = a.verdicts[r.invoiceId];
      return { rec, action: v.ims, reason: v.imsReason, invoiceId: r.invoiceId, tax };
    }
    const p = portalImsAction(rec, books);
    return { rec, action: p.ims, reason: p.reason, tax };
  });
}

export function table4(a: Analysis) {
  const rows = imsRows(a);
  const accepted = rows.filter((r) => r.action === 'accept' && r.rec.itcAvailable);
  const a5 = round2(accepted.reduce((s, r) => s + r.tax, 0));
  const blocked = round2(a.findings.filter((f) => f.ruleId === 'ITC-BLOCKED' && accepted.some((r) => r.invoiceId === f.invoiceId)).reduce((s, f) => s + f.itcAtRisk, 0));
  const others = round2(a.findings.filter((f) => f.ruleId === 'ITC-180-DAYS').reduce((s, f) => s + f.itcAtRisk, 0));
  const ineligible = round2(rows.filter((r) => !r.rec.itcAvailable).reduce((s, r) => s + r.tax, 0));
  const held = round2(rows.filter((r) => r.action === 'pending').reduce((s, r) => s + r.tax, 0) + a.recon.filter((r) => r.status === 'missing-in-2b').reduce((s, r) => s + (a.verdicts[r.invoiceId!]?.itcClaimed ?? 0), 0));
  return { a5, blocked, others, net: round2(a5 - blocked - others), ineligible, held };
}

export function Actions({ a, go }: { a: Analysis; go: (r: Route) => void }) {
  const rows = useMemo(() => imsRows(a), [a]);
  const t4 = useMemo(() => table4(a), [a]);
  const dl = periodDeadlines(a.period);
  const mode = useMode();
  const groups: { id: ImsAction; title: string; hint: string }[] = [
    { id: 'reject', title: 'Reject', hint: 'Supplier must correct; rejection sends it back to them through GSTR-1A.' },
    { id: 'pending', title: 'Keep pending', hint: 'Allowed for one tax period. Decide once the supplier responds.' },
    { id: 'accept', title: 'Accept', hint: 'Flows into GSTR-2B as available credit.' },
  ];

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Filing actions</h1>
          <div className="meta">{mode === 'simple'
            ? <>Two jobs left this month. First, on the GST portal’s <T k="ims">IMS</T> screen, accept the good bills and reject the wrong ones before {formatDate(dl.ims)}. Then file <T k="gstr3b">GSTR-3B</T> by {formatDate(dl.gstr3b)}, claiming the credit shown below.</>
            : <>What to click in the Invoice Management System before {formatDate(dl.ims)}, and the ITC to report in GSTR-3B for {formatPeriod(a.period)} (due {formatDate(dl.gstr3b)}).</>}</div>
        </div>
      </div>

      <div data-tour="table4">
      <Card title={<>GSTR-3B Table 4 · draft</>} sub="from accepted records and the checks above">
        <div className="table-wrap">
          <table className="t">
            <tbody>
              <tr><td><b>4(A)(5)</b> All other ITC (accepted in IMS)</td><td className="r num">{formatINR(t4.a5)}</td></tr>
              <tr><td><b>4(B)(1)</b> Reversal: blocked credit under Sec 17(5)</td><td className="r num" style={{ color: 'var(--crit)' }}>−{formatINR(t4.blocked)}</td></tr>
              <tr><td><b>4(B)(2)</b> Reversal: others (unpaid beyond 180 days)</td><td className="r num" style={{ color: 'var(--crit)' }}>−{formatINR(t4.others)}</td></tr>
              <tr style={{ background: 'var(--surface-2)' }}><td><b>4(C) Net ITC available</b></td><td className="r num" style={{ fontWeight: 600, fontSize: 15 }}>{formatINR(t4.net)}</td></tr>
              <tr><td className="muted"><b>4(D)(2)</b> Ineligible: place-of-supply rule / Sec 16(4) (shown in 2B as not available)</td><td className="r num muted">{formatINR(t4.ineligible)}</td></tr>
              <tr><td className="muted">Not claimed this month: pending in IMS or missing in GSTR-2B</td><td className="r num muted">{formatINR(t4.held)}</td></tr>
            </tbody>
          </table>
        </div>
      </Card>
      </div>

      {groups.map((g) => {
        const list = rows.filter((r) => r.action === g.id);
        if (!list.length) return null;
        return (
          <Card key={g.id} title={<span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><ImsPill a={g.id} /> {list.length} record{list.length > 1 ? 's' : ''}</span>} sub={g.hint} right={<span className="num mono">{formatINR(list.reduce((s, r) => s + r.tax, 0))}</span>}>
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Supplier</th><th>Invoice (as filed)</th><th className="r">Tax</th><th>Why</th></tr></thead>
                <tbody>
                  {list.map((r) => (
                    <tr key={r.rec.id} className={r.invoiceId ? 'click' : ''} onClick={() => r.invoiceId && go({ view: 'invoice', id: r.invoiceId })}>
                      <td className="trunc"><div className="sup">{r.rec.tradeName}</div><div className="sub mono">{r.rec.ctin}</div></td>
                      <td><span className="mono">{r.rec.invoiceNo}</span><div className="sub">{formatDate(r.rec.invoiceDate)}</div></td>
                      <td className="r num">{formatINR(r.tax)}</td>
                      <td style={{ minWidth: 240 }} className="ink2">{r.reason}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
