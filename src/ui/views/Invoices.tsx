import { useMemo, useState } from 'react';
import type { Analysis } from '../../domain/types';
import { formatDate, formatINR } from '../../lib/format';
import { Icon, ImsPill, Money, ReconPill, RiskMeter } from '../kit';
import { needsHumanReview, type WorkspaceApi } from '../workspace';
import { useMode } from '../mode';
import { plainFor } from '../plain';
import type { Route } from '../App';
import { primaryFinding, supplierLabel } from './Overview';

type Filter = 'all' | 'high' | 'review' | 'clear' | 'pending' | 'check';

const SourceIcon = ({ kind }: { kind: string }) => (
  <span className="src" title={kind === 'register' ? 'Purchase register row' : kind === 'image' ? 'Scanned image' : 'PDF invoice'}>
    {kind === 'register' ? <Icon.table /> : kind === 'image' ? <Icon.scan /> : <Icon.pdf />}
  </span>
);

export function Invoices({ a, api, go }: { a: Analysis; api: WorkspaceApi; go: (r: Route) => void }) {
  const [q, setQ] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const mode = useMode();
  const reconBy = useMemo(() => new Map(a.recon.filter((r) => r.invoiceId).map((r) => [r.invoiceId!, r])), [a]);
  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return a.invoices
      .filter((inv) => {
        if (filter === 'pending') return inv.extraction.method === 'pending';
        if (filter === 'check') return needsHumanReview(inv);
        if (inv.extraction.method === 'pending') return filter === 'all';
        const v = a.verdicts[inv.id];
        return filter === 'all' || v.band === filter;
      })
      .filter((inv) => !needle || [inv.supplier.name, inv.supplier.gstin, inv.invoiceNo, inv.source.fileName].some((s) => s?.toLowerCase().includes(needle)))
      .sort((x, y) => (a.verdicts[y.id]?.risk ?? 101) - (a.verdicts[x.id]?.risk ?? 101) || (a.verdicts[y.id]?.itcAtRisk ?? 0) - (a.verdicts[x.id]?.itcAtRisk ?? 0));
  }, [a, q, filter]);
  const count = (f: Filter) => f === 'check' ? a.invoices.filter(needsHumanReview).length : a.invoices.filter((i) => (f === 'pending' ? i.extraction.method === 'pending' : i.extraction.method !== 'pending' && (f === 'all' || a.verdicts[i.id]?.band === f))).length + (f === 'all' ? a.invoices.filter((i) => i.extraction.method === 'pending').length : 0);

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Invoices</h1>
          <div className="meta">{a.invoices.length} documents · sorted by risk</div>
        </div>
        <div className="right">
          <button className="btn ai" onClick={api.sweep} disabled={!!api.busy} title="One AI pass over every line item to catch HSN misfits and blocked credit that keyword rules miss">
            <span className="ai-badge">AI</span> {api.sweepDone ? 'Re-run AI line check' : 'AI line check'}
          </button>
        </div>
      </div>
      <div className="toolbar">
        <div className="search" style={{ position: 'relative' }}>
          <label className="sr-only" htmlFor="inv-search">Search invoices</label>
          <input id="inv-search" className="input" style={{ width: '100%', paddingLeft: 30 }} placeholder="Supplier, GSTIN or invoice number" value={q} onChange={(e) => setQ(e.target.value)} />
          <span style={{ position: 'absolute', left: 9, top: 8, color: 'var(--ink-3)' }}><Icon.search /></span>
        </div>
        <div className="seg" role="group" aria-label="Filter by risk">
          {(['all', 'high', 'review', 'clear', 'pending', 'check'] as Filter[]).filter((f) => f === 'all' || count(f) > 0 || f === 'high' || f === 'clear').map((f) => (
            <button key={f} aria-pressed={filter === f} onClick={() => setFilter(f)}>
              {f === 'all' ? 'All' : f === 'high' ? 'Don’t claim yet' : f === 'review' ? 'Check first' : f === 'clear' ? 'Safe' : f === 'pending' ? 'Not read yet' : 'Confirm details'} <span className="mono" style={{ opacity: 0.6 }}>{count(f)}</span>
            </button>
          ))}
        </div>
      </div>
      <section className="card">
        <div className="table-wrap">
          <table className="t">
            <thead>
              <tr><th>{mode === 'simple' ? 'Verdict' : 'Risk'}</th><th>Supplier</th><th>Invoice</th><th className="r">{mode === 'simple' ? 'GST stuck' : 'ITC at risk'}</th><th>{mode === 'simple' ? 'Reported by supplier?' : 'GSTR-2B'}</th><th>{mode === 'simple' ? 'Main problem' : 'Main issue'}</th><th>IMS</th></tr>
            </thead>
            <tbody>
              {rows.map((inv) => {
                if (inv.extraction.method === 'pending') {
                  return (
                    <tr key={inv.id}>
                      <td><span className="pill info">Needs AI</span></td>
                      <td className="trunc" colSpan={4}><div className="issue-cell"><SourceIcon kind={inv.source.kind} /><span className="mono">{inv.source.fileName}</span></div><div className="sub">{inv.extraction.note}</div></td>
                      <td colSpan={2}>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                          <button className="btn sm primary" onClick={() => api.extractWithAi(inv)} disabled={!!api.busy}><span className="ai-badge">AI</span> Read</button>
                          {!api.ai && api.hasReference(inv) && <button className="btn sm" onClick={() => api.applyReference(inv)}>Bundled</button>}
                        </div>
                      </td>
                    </tr>
                  );
                }
                const v = a.verdicts[inv.id];
                const fs = a.findings.filter((f) => f.invoiceId === inv.id && f.ruleId !== 'RECON-SUGGESTED');
                const f = primaryFinding(fs);
                const r = reconBy.get(inv.id);
                return (
                  <tr key={inv.id} className="click" onClick={() => go({ view: 'invoice', id: inv.id })}>
                    <td><RiskMeter value={v.risk} band={v.band} /></td>
                    <td className="trunc"><div className="sup">{supplierLabel(inv)}</div><div className="sub mono">{inv.supplier.gstin ?? 'no GSTIN'}</div></td>
                    <td><div className="issue-cell"><SourceIcon kind={inv.source.kind} /><span className="mono">{inv.invoiceNo ?? '—'}</span></div><div className="sub">{formatDate(inv.invoiceDate)}</div></td>
                    <td className="r">{v.itcAtRisk ? <Money v={v.itcAtRisk} /> : <span className="muted">—</span>}<div className="sub num">of {formatINR(v.itcClaimed)}</div></td>
                    <td>{r ? <ReconPill s={r.status} /> : <span className="pill na">Duplicate</span>}</td>
                    <td className="trunc issue">
                      {f ? (
                        <div className="issue-cell">
                          <span className={`sev-bar ${f.severity}`} style={{ height: 16 }} />
                          <span>{mode === 'simple' ? plainFor(f).title : f.title}</span>
                          {fs.length > 1 && <span className="more">+{fs.length - 1}</span>}
                          {fs.some((x) => x.source === 'ai') && <span className="ai-badge">AI</span>}
                        </div>
                      ) : <span className="muted">No issues</span>}
                    </td>
                    <td><ImsPill a={v.ims} /></td>
                  </tr>
                );
              })}
              {!rows.length && <tr><td colSpan={7}><div className="empty">No invoices match this filter.</div></td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
