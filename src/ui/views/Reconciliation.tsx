import { useMemo, useState } from 'react';
import type { Analysis, ReconStatus } from '../../domain/types';
import { portalImsAction } from '../../domain/analyze';
import { formatDate, formatINR } from '../../lib/format';
import { Icon, ImsPill, Tabs } from '../kit';
import type { WorkspaceApi } from '../workspace';
import type { Route } from '../App';
import { T, useMode } from '../mode';
import { RECON_SIMPLE } from '../plain';

const ORDER: ReconStatus[] = ['mismatch', 'missing-in-2b', 'missing-in-books', 'suggested', 'matched'];
const TAB_LABEL: Record<ReconStatus, string> = { mismatch: 'Mismatch', 'missing-in-2b': 'Not in GSTR-2B', 'missing-in-books': 'Not in books', suggested: 'Probable match', matched: 'Matched' };
const EXPLAIN_SIMPLE: Record<ReconStatus, string> = {
  mismatch: 'The supplier reported this bill, but with different amounts or details. Claim the lower figure until it is corrected.',
  'missing-in-2b': 'You have the bill, but the supplier has not told the government about it yet. You cannot claim it until they do.',
  'missing-in-books': 'A supplier reported a sale to you that is not in your records. If you never bought it, reject it: someone may be misusing your GST number.',
  suggested: 'Same bill, written slightly differently (for example SVT/0457/26-27 vs SVT457). Confirm and move on.',
  matched: 'Your bill and the supplier’s report agree exactly. Nothing to do.',
};
const EXPLAIN: Record<ReconStatus, string> = {
  mismatch: 'Found on both sides, but values, tax head, place of supply or ITC eligibility differ.',
  'missing-in-2b': 'In your books, but the supplier has not reported it. ITC cannot be claimed until it appears.',
  'missing-in-books': 'Reported by a supplier against your GSTIN, but not in your purchase records.',
  suggested: 'Same invoice with formatting differences (number format, date, GSTIN typo). Confirm to treat as matched.',
  matched: 'Identical on GSTIN, number, date, values and place of supply.',
};

export function Reconciliation({ a, api, go }: { a: Analysis; api: WorkspaceApi; go: (r: Route) => void }) {
  const [tab, setTab] = useState<ReconStatus>('mismatch');
  const mode = useMode();
  const inv = useMemo(() => new Map(a.invoices.map((i) => [i.id, i])), [a]);
  const portal = useMemo(() => new Map(a.portal.map((p) => [p.id, p])), [a]);
  const rows = a.recon.filter((r) => r.status === tab);
  const books = a.invoices.filter((i) => i.extraction.method !== 'pending');

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{mode === 'simple' ? <>Your bills vs what suppliers reported (<T k="gstr2b">GSTR-2B</T>)</> : 'GSTR-2B reconciliation'}</h1>
          <div className="meta">{books.length} book entries · {a.portal.length} supplier records · weighted match on invoice number, GSTIN, date and value</div>
        </div>
      </div>
      <div data-tour="recon" style={{ display: 'grid', gap: 12 }}>
      <Tabs<ReconStatus> value={tab} onChange={setTab} items={ORDER.map((s) => ({ id: s, label: mode === 'simple' ? RECON_SIMPLE[s] : TAB_LABEL[s], count: a.totals.recon[s] }))} />
      <p className="ink2" style={{ fontSize: 12.5 }}>{mode === 'simple' ? EXPLAIN_SIMPLE[tab] : EXPLAIN[tab]}</p>
      <section className="card">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr>
                <th>Supplier</th><th>Books</th><th>GSTR-2B</th><th className="r">Tax (books)</th><th className="r">Tax (2B)</th><th>Differences</th><th>{tab === 'missing-in-books' ? 'IMS' : 'Confidence'}</th><th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const b = r.invoiceId ? inv.get(r.invoiceId) : undefined;
                const p = r.portalId ? portal.get(r.portalId) : undefined;
                const bt = b ? b.igstTotal + b.cgstTotal + b.sgstTotal + b.cessTotal : null;
                const pt = p ? p.igst + p.cgst + p.sgst + p.cess : null;
                const ims = p && !b ? portalImsAction(p, books) : null;
                return (
                  <tr key={r.id} className={b ? 'click' : ''} onClick={() => b && go({ view: 'invoice', id: b.id })}>
                    <td className="trunc"><div className="sup">{b?.supplier.name || p?.tradeName}</div><div className="sub mono">{b?.supplier.gstin ?? p?.ctin}</div></td>
                    <td>{b ? <><span className="mono">{b.invoiceNo}</span><div className="sub">{formatDate(b.invoiceDate)}</div></> : <span className="muted">—</span>}</td>
                    <td>{p ? <><span className="mono">{p.invoiceNo}</span><div className="sub">{formatDate(p.invoiceDate)}</div></> : <span className="muted">—</span>}</td>
                    <td className="r num">{bt != null ? formatINR(bt) : '—'}</td>
                    <td className="r num">{pt != null ? formatINR(pt) : '—'}</td>
                    <td className="trunc" style={{ maxWidth: 260 }}>
                      {r.diffs.length ? <div>{r.diffs.map((d) => d.label).join(', ')}</div> : <div className="muted">{tab === 'matched' ? 'None' : r.reasons[0]}</div>}
                    </td>
                    <td>{ims ? <span title={ims.reason}><ImsPill a={ims.ims} /></span> : <span className="mono">{Math.round(r.confidence * 100)}%</span>}</td>
                    <td className="r" onClick={(e) => e.stopPropagation()}>
                      {r.status === 'suggested' && <button className="btn sm" onClick={() => api.confirmMatch(r.invoiceId!, r.portalId!)}><Icon.check /> Confirm</button>}
                    </td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={8}><div className="empty">Nothing in this group.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
      </div>
      {tab === 'missing-in-books' && rows.length > 0 && (
        <div className="callout warn">
          <Icon.alert />
          <div className="body">
            <b>Why this matters</b>
            <span className="ink2" style={{ fontSize: 12.5 }}>If you accept or ignore these in IMS they flow into your GSTR-2B and look like credit you can take. Credit on supplies you never received is a fake-invoice case. Reject unknown ones; confirm known suppliers with the goods-receipt register first.</span>
          </div>
        </div>
      )}
    </div>
  );
}
