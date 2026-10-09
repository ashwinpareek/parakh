import type { Analysis, Finding, FindingCategory, Invoice } from '../../domain/types';
import { formatDate, formatINR, formatINRCompact, formatPeriod } from '../../lib/format';

import { BandPill, Card, Icon, ImsPill, Money, RiskMeter } from '../kit';
import { plainFor } from '../plain';
import { needsHumanReview, type WorkspaceApi } from '../workspace';
import { T, useMode } from '../mode';
import { MonthTimeline } from '../explain';
import type { Route } from '../App';

export const CATEGORY_LABEL: Record<FindingCategory, string> = {
  reconciliation: 'Not matching GSTR-2B',
  'itc-eligibility': 'Blocked or time-barred ITC',
  'tax-math': 'Tax head and arithmetic',
  gstin: 'Supplier GSTIN problems',
  'fraud-signal': 'Duplicates and fraud signals',
  'e-invoice': 'E-invoice (IRN) missing',
  'place-of-supply': 'Place of supply outside your state',
  rate: 'Wrong GST rate',
  'mandatory-fields': 'Missing invoice particulars',
};

/** Names a beginner can follow, for Simple mode. */
export const CATEGORY_SIMPLE: Record<FindingCategory, string> = {
  reconciliation: 'Supplier didn’t report it, or figures differ',
  'itc-eligibility': 'Purchases that don’t qualify, or claimed too late',
  'tax-math': 'Wrong type of GST or wrong maths',
  gstin: 'Problems with the supplier’s GST number',
  'fraud-signal': 'Duplicate bills and suspicious patterns',
  'e-invoice': 'E-invoice missing or altered',
  'place-of-supply': 'Bill made out for another state',
  rate: 'Wrong GST rate charged',
  'mandatory-fields': 'Details missing from the bill',
};

export function periodDeadlines(period: string) {
  const [y, m] = period.split('-').map(Number);
  const ny = m === 12 ? y + 1 : y;
  const nm = String(m === 12 ? 1 : m + 1).padStart(2, '0');
  return { gstr1: `${ny}-${nm}-11`, ims: `${ny}-${nm}-14`, gstr3b: `${ny}-${nm}-20` };
}

export function primaryFinding(fs: Finding[]): Finding | undefined {
  const w = { critical: 4, high: 3, medium: 2, low: 1 };
  return [...fs].sort((a, b) => b.itcAtRisk - a.itcAtRisk || w[b.severity] - w[a.severity])[0];
}

export function supplierLabel(inv: Invoice) {
  return inv.supplier.name || inv.supplier.gstin || inv.source.fileName;
}

export function Overview({ a, api, go }: { a: Analysis; api: WorkspaceApi; go: (r: Route) => void; onTour?: () => void }) {
  const mode = useMode();
  const catLabel = mode === 'simple' ? CATEGORY_SIMPLE : CATEGORY_LABEL;
  const toReview = a.invoices.filter(needsHumanReview);
  const t = a.totals;
  const dl = periodDeadlines(a.period);
  const riskShare = t.itcClaimed ? t.itcAtRisk / t.itcClaimed : 0;
  const cats = (Object.keys(t.byCategory) as FindingCategory[]).map((c) => ({ c, ...t.byCategory[c] })).filter((x) => x.count > 0).sort((x, y) => y.itc - x.itc || y.count - x.count);
  const maxCat = Math.max(1, ...cats.map((c) => c.itc));
  const ready = a.invoices.filter((i) => i.extraction.method !== 'pending');
  const fixFirst = ready.map((inv) => ({ inv, v: a.verdicts[inv.id], f: primaryFinding(a.findings.filter((x) => x.invoiceId === inv.id)) })).filter((x) => x.v.itcAtRisk > 0 || x.v.band === 'high').sort((x, y) => y.v.itcAtRisk - x.v.itcAtRisk).slice(0, 7);
  const weak = a.vendors.filter((v) => v.score < 70).slice(0, 5);
  const sources = new Set(a.invoices.map((i) => i.source.kind));

  return (
    <div className="page">

      <div className="page-head" data-tour="headline">
        <div>
          <div className="eyebrow">Purchase check · {formatPeriod(a.period)}</div>
          {mode === 'simple' ? (
            <>
              <h1 style={{ marginTop: 6 }}>You can safely claim {formatINRCompact(t.itcSafe)}. Another {formatINRCompact(t.itcAtRisk)} is stuck on {Object.values(a.verdicts).filter((v) => v.itcAtRisk > 0).length} bills.</h1>
              <div className="meta">Your suppliers charged you {formatINRCompact(t.itcClaimed)} of GST on {t.invoices} bills. That is <T k="itc">input tax credit</T> you can get back, once each bill passes the checks below.</div>
            </>
          ) : (
            <>
              <h1 style={{ marginTop: 6 }}>{formatINRCompact(t.itcAtRisk)} of input tax credit needs attention</h1>
              <div className="meta">
                {t.invoices} invoices from {[sources.has('pdf') && 'PDFs', sources.has('image') && 'scans', sources.has('register') && 'purchase register'].filter(Boolean).join(', ')} · matched against GSTR-2B · checked as of {formatDate(a.asOf)}
              </div>
            </>
          )}
        </div>
      </div>

      <div data-tour="timeline"><MonthTimeline period={a.period} asOf={a.asOf} atRisk={t.itcAtRisk} /></div>

      {api.pending.length > 0 && (
        <div className="callout ai" data-tour="scan">
          <Icon.scan />
          <div className="body">
            <b>{api.pending.length} scanned invoice{api.pending.length > 1 ? 's are' : ' is'} waiting to be read</b>
            <span className="ink2" style={{ fontSize: 12.5 }}>{api.pending.map((p) => p.source.fileName).join(', ')} has no text layer. AI reads the image and the same checks run on it.</span>
          </div>
          <div className="acts">
            <button className="btn primary sm" onClick={async () => { for (const p of api.pending) await api.extractWithAi(p); }} disabled={!!api.busy}>
              <span className="ai-badge">AI</span> Read {api.pending.length > 1 ? 'scans' : 'scan'}{api.ai ? ` with ${api.ai.label}` : ''}
            </button>
            {!api.ai && api.pending.some(api.hasReference) && (
              <button className="btn sm" onClick={() => api.pending.forEach(api.applyReference)}>Use bundled transcription</button>
            )}
          </div>
        </div>
      )}

      {toReview.length > 0 && (
        <div className="callout review-box">
          <Icon.edit />
          <div className="body">
            <b>{toReview.length} bill{toReview.length > 1 ? 's were' : ' was'} read by AI. Please confirm the details.</b>
            <span className="ink2" style={{ fontSize: 12.5 }}>AI can misread a scan. A quick human check before claiming keeps mistakes out of your return.</span>
          </div>
          <div className="acts"><button className="btn sm" onClick={() => go({ view: 'invoice', id: toReview[0].id })}>Review now</button></div>
        </div>
      )}

      <section className="card ledger" aria-label="Input tax credit summary" data-tour="ledger">
        <div className="ledger-figs">
          <div className="fig">
            <div className="label"><span className="key" style={{ background: 'var(--ink-3)' }} />{mode === 'simple' ? 'GST you paid suppliers' : 'ITC in your books'}</div>
            <div className="value">{formatINRCompact(t.itcClaimed)}</div>
            <div className="note num">{formatINR(t.itcClaimed)}</div>
          </div>
          <div className="fig risk-fig">
            <div className="label"><span className="key" style={{ background: 'var(--crit)' }} />{mode === 'simple' ? 'Stuck: fix first' : 'At risk'}</div>
            <div className="value">{formatINRCompact(t.itcAtRisk)}</div>
            <div className="note">{Math.round(riskShare * 100)}% of claimed credit · {Object.values(a.verdicts).filter((v) => v.itcAtRisk > 0).length} invoices</div>
          </div>
          <div className="fig safe-fig">
            <div className="label"><span className="key" style={{ background: 'var(--ok)' }} />Safe to claim</div>
            <div className="value">{formatINRCompact(t.itcSafe)}</div>
            <div className="note num">{formatINR(t.itcSafe)}</div>
          </div>
          <div className="fig">
            <div className="label"><span className="key" style={{ background: 'var(--info)' }} />{mode === 'simple' ? <>Reported by suppliers in <T k="gstr2b">GSTR-2B</T></> : 'Matched with GSTR-2B'}</div>
            <div className="value">{Math.round(t.matchRate * 100)}%</div>
            <div className="note">{t.recon.matched + t.recon.suggested} of {t.recon.matched + t.recon.suggested + t.recon.mismatch + t.recon['missing-in-2b']} book invoices</div>
          </div>
        </div>
        <div>
          <div className="ledger-bar" role="img" aria-label={`${Math.round((1 - riskShare) * 100)}% safe, ${Math.round(riskShare * 100)}% at risk`}>
            <div style={{ width: `${(1 - riskShare) * 100}%`, background: 'var(--ok)' }} />
            <div style={{ width: `${riskShare * 100}%`, background: 'var(--crit)' }} />
          </div>
          <div className="ledger-scale" style={{ marginTop: 6 }}><span>₹0</span><span>{formatINR(t.itcClaimed, { decimals: false })}</span></div>
        </div>
      </section>

      <div className="grid-2">
        <Card title={mode === 'simple' ? 'Why money is stuck' : 'Where the credit is at risk'} sub={mode === 'simple' ? 'GST held back, by reason' : 'ITC at risk by root cause'} right={<button className="btn sm ghost" onClick={() => go({ view: 'invoices' })}>All invoices <Icon.next /></button>}>
          <div className="card-b leak">
            {cats.map((c) => (
              <div className={`leak-row ${c.itc ? '' : 'zero'}`} key={c.c}>
                <div className="name"><span>{catLabel[c.c]}</span><span className="muted mono" style={{ fontSize: 11 }}>{c.count}</span></div>
                <div className="leak-track"><div className="leak-fill" style={{ width: `${(c.itc / maxCat) * 100}%` }} /></div>
                <div className="amt">{c.itc ? formatINRCompact(c.itc) : '—'}</div>
              </div>
            ))}
            {!cats.length && <div className="ok-box">No issues found.</div>}
          </div>
        </Card>

        <div style={{ display: 'grid', gap: 20 }}>
          <Card title={<>What to do in <T k="ims">IMS</T></>} sub={`before ${formatDate(dl.ims)}`} right={<button className="btn sm ghost" onClick={() => go({ view: 'actions' })}>Action list <Icon.next /></button>}>
            <div className="card-b" style={{ display: 'grid', gap: 12 }}>
              <div className="ims-grid">
                <div className="ims-cell accept"><span className="n">{t.ims.accept}</span><span className="l">Accept</span></div>
                <div className="ims-cell pending"><span className="n">{t.ims.pending}</span><span className="l">Keep pending</span></div>
                <div className="ims-cell reject"><span className="n">{t.ims.reject}</span><span className="l">Reject</span></div>
              </div>
              {t.recon['missing-in-books'] > 0 && (
                <div className="callout warn" style={{ padding: '10px 12px' }}>
                  <Icon.alert />
                  <div className="body" style={{ fontSize: 12.5 }}>
                    <b>{t.recon['missing-in-books']} invoice{t.recon['missing-in-books'] > 1 ? 's' : ''} filed against your GSTIN {t.recon['missing-in-books'] > 1 ? 'are' : 'is'} not in your books</b>
                    <span className="ink2">{formatINR(t.portalOnlyTax)} of tax. Unknown suppliers can mean misuse of your GSTIN.</span>
                  </div>
                </div>
              )}
            </div>
          </Card>
          <Card title="Suppliers to follow up" right={<button className="btn sm ghost" onClick={() => go({ view: 'suppliers' })}>Scorecard <Icon.next /></button>}>
            <div className="table-wrap">
              <table className="t">
                <tbody>
                  {weak.map((v) => (
                    <tr key={v.gstin} className="click" onClick={() => go({ view: 'suppliers', focus: v.gstin })}>
                      <td className="trunc"><div className="sup">{v.name}</div><div className="sub mono">{v.gstin}</div></td>
                      <td className="r"><Money v={v.itcAtRisk} /></td>
                      <td className="r"><span className={`score ${v.score >= 75 ? 'good' : v.score >= 45 ? 'mid' : 'bad'}`}>{v.score}</span></td>
                    </tr>
                  ))}
                  {!weak.length && <tr><td className="muted">All suppliers are in good standing.</td></tr>}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <Card title={mode === 'simple' ? 'Bills to fix first' : 'Fix these first'} sub={mode === 'simple' ? 'biggest amounts first' : 'largest credit at stake'} right={<span className="muted" style={{ fontSize: 12 }}>{fixFirst.length} of {Object.values(a.verdicts).filter((v) => v.band !== 'clear').length} flagged</span>}>
        <div className="table-wrap">
          <table className="t">
            <thead><tr><th>Supplier</th><th>Invoice</th><th>Main issue</th><th className="r">ITC at risk</th><th>Risk</th><th>IMS</th></tr></thead>
            <tbody>
              {fixFirst.map(({ inv, v, f }) => (
                <tr key={inv.id} className="click" onClick={() => go({ view: 'invoice', id: inv.id })}>
                  <td className="trunc"><div className="sup">{supplierLabel(inv)}</div></td>
                  <td><span className="mono">{inv.invoiceNo ?? '—'}</span><div className="sub">{formatDate(inv.invoiceDate)}</div></td>
                  <td className="trunc"><div className="issue-cell"><span className={`sev-bar ${f?.severity ?? ''}`} style={{ height: 16 }} /><span>{f ? (mode === 'simple' ? plainFor(f).title : f.title) : '—'}</span></div></td>
                  <td className="r"><Money v={v.itcAtRisk} /></td>
                  <td><RiskMeter value={v.risk} band={v.band} /></td>
                  <td><ImsPill a={v.ims} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="muted" style={{ fontSize: 11.5 }}>
        <BandPill band="clear" /> {Object.values(a.verdicts).filter((v) => v.band === 'clear').length} invoices passed every check. Risk scores combine finding severity with the share of credit at stake.
      </p>
    </div>
  );
}
