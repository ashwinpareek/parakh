import { useEffect, useMemo, useState } from 'react';
import type { Analysis } from '../../domain/types';
import { formatDate, formatINR } from '../../lib/format';
import { Icon, Money, Spinner } from '../kit';
import type { WorkspaceApi } from '../workspace';
import type { Route } from '../App';
import { draftFollowUp, templateFollowUp, type FollowUp, type Lang } from '../../ai/tasks';
import { describeAiError } from '../../ai/provider';
import { templateFollowUpLang } from '../../ai/fallback';
import { GstinBadge } from './InvoiceDetail';
import { primaryFinding } from './Overview';
import { useMode } from '../mode';
import { completeMission } from '../onboarding/missions';

export function Suppliers({ a, api, focus, go }: { a: Analysis; api: WorkspaceApi; focus?: string; go: (r: Route) => void }) {
  const mode = useMode();
  const [sel, setSel] = useState<string | null>(focus ?? a.vendors.find((v) => v.itcAtRisk > 0)?.gstin ?? null);
  useEffect(() => { if (focus) setSel(focus); }, [focus]);
  const vendor = a.vendors.find((v) => v.gstin === sel) ?? null;

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>{mode === 'simple' ? 'Which suppliers are causing problems' : 'Supplier scorecard'}</h1>
          <div className="meta">{mode === 'simple' ? 'A score out of 100 for each supplier: lower means more of their bills had problems this month. Pick one to draft a message asking them to fix it.' : 'Compliance score from this period’s invoices: severity of issues, credit at stake, filing status and registration. Recipient-side issues (blocked credit, late claims) do not count against the supplier.'}</div>
        </div>
      </div>
      <div className="grid-2">
        <section className="card">
          <div className="table-wrap">
            <table className="t">
              <thead><tr><th>Score</th><th>Supplier</th><th className="r">Invoices</th><th className="r">Issues</th><th className="r">ITC at risk</th><th>Last GSTR-1</th></tr></thead>
              <tbody>
                {a.vendors.map((v) => (
                  <tr key={v.gstin + v.name} className="click" onClick={() => setSel(v.gstin)} style={sel === v.gstin ? { background: 'var(--surface-2)' } : undefined}>
                    <td><span className={`score ${v.score >= 75 ? 'good' : v.score >= 45 ? 'mid' : 'bad'}`}>{v.score}</span></td>
                    <td className="trunc"><div className="sup">{v.name}</div><div className="sub mono">{v.gstin}</div></td>
                    <td className="r num">{v.invoices}</td>
                    <td className="r num">{v.findings}{v.critical ? <span style={{ color: 'var(--crit)' }}> · {v.critical} crit</span> : ''}</td>
                    <td className="r">{v.itcAtRisk ? <Money v={v.itcAtRisk} /> : <span className="muted">—</span>}</td>
                    <td>{v.lastFiled ? formatDate(v.lastFiled) : <span className="pill missing-in-2b">Not filed</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
        {vendor ? <FollowUpPanel key={vendor.gstin} a={a} api={api} gstin={vendor.gstin} go={go} /> : <div className="card empty">Select a supplier.</div>}
      </div>
    </div>
  );
}

function FollowUpPanel({ a, api, gstin, go }: { a: Analysis; api: WorkspaceApi; gstin: string; go: (r: Route) => void }) {
  const vendor = a.vendors.find((v) => v.gstin === gstin)!;
  const [lang, setLang] = useState<Lang>('English');
  const [draft, setDraft] = useState<FollowUp | null>(null);
  const [mode, setMode] = useState<'email' | 'whatsapp'>('email');
  const [working, setWorking] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const issues = useMemo(() => {
    return a.invoices
      .filter((i) => i.supplier.gstin === gstin && i.extraction.method !== 'pending')
      .map((inv) => {
        const fs = a.findings.filter((f) => f.invoiceId === inv.id && f.severity !== 'low' && !['ITC-BLOCKED', 'ITC-TIME-SOON', 'ITC-180-DAYS', 'ITC-180-SOON', 'DUP-EXACT', 'ITC-TIME-BARRED', 'RECON-OUT-OF-PERIOD'].includes(f.ruleId));
        const f = primaryFinding(fs);
        return f ? { inv, f, fs, itc: a.verdicts[inv.id].itcAtRisk } : null;
      })
      .filter(Boolean) as { inv: (typeof a.invoices)[number]; f: (typeof a.findings)[number]; fs: (typeof a.findings); itc: number }[];
  }, [a, gstin]);

  const payload = issues.map(({ inv, fs, itc }) => ({
    invoiceNo: inv.invoiceNo ?? '?', date: formatDate(inv.invoiceDate),
    problem: fs.map((f) => f.title).join('; ') + '.', ask: fs.map((f) => f.fix).filter(Boolean)[0] ?? 'Please correct and re-share.', itc,
  }));

  const generate = async () => {
    setWorking(true);
    setNote(null);
    try {
      if (!api.ai) throw Object.assign(new Error('no ai'), { code: 'none' });
      setDraft(await draftFollowUp(api.ai, a.company, { name: vendor.name, gstin }, payload, lang));
    } catch (e) {
      setDraft(templateFollowUpLang(a.company, { name: vendor.name, gstin }, payload, lang, templateFollowUp(a.company, { name: vendor.name, gstin }, payload)));
      setNote((e as { code?: string }).code === 'none' ? 'Written from a template because AI is not connected in this view.' : `${describeAiError(e)} Showing the template version.`);
    } finally { setWorking(false); completeMission('followup'); }
  };

  const text = draft ? (mode === 'email' ? `Subject: ${draft.subject}\n\n${draft.email}` : draft.whatsapp) : '';
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); api.flash('Copied to clipboard'); }
    catch { const el = document.getElementById('followup-text'); if (el) { const r = document.createRange(); r.selectNodeContents(el); const s = window.getSelection(); s?.removeAllRanges(); s?.addRange(r); } api.flash('Press Ctrl+C to copy the selected text'); }
  };

  return (
    <section className="card" data-tour="followup">
      <div className="card-h" style={{ alignItems: 'flex-start' }}>
        <div style={{ display: 'grid', gap: 4, minWidth: 0 }}>
          <h2>{vendor.name}</h2>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}><span className="mono muted">{gstin}</span><GstinBadge gstin={gstin} /></div>
        </div>
      </div>
      <div className="card-b" style={{ display: 'grid', gap: 14 }}>
        {vendor.registry && <p className="muted" style={{ fontSize: 12 }}>{vendor.registry.legalName} · {vendor.registry.constitution} · registered {formatDate(vendor.registry.registeredOn)}{vendor.registry.einvoiceMandated ? ' · e-invoicing mandatory' : ''}</p>}
        {issues.length === 0 ? (
          <div className="ok-box">Nothing to ask this supplier for.</div>
        ) : (
          <>
            <div className="findings">
              {issues.map(({ inv, f, itc }) => (
                <button key={inv.id} className="finding" onClick={() => go({ view: 'invoice', id: inv.id })}>
                  <span className={`sev-bar ${f.severity}`} />
                  <span className="body">
                    <span className="ttl"><b className="mono" style={{ fontWeight: 500 }}>{inv.invoiceNo}</b><span className="muted">{formatDate(inv.invoiceDate)}</span>{itc > 0 && <span className="amt">−{formatINR(itc)}</span>}</span>
                    <span className="det">{f.title}</span>
                  </span>
                </button>
              ))}
            </div>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
              <label className="sr-only" htmlFor="fu-lang">Message language</label>
              <select id="fu-lang" className="input" value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                <option>English</option><option>Telugu</option><option>Hindi</option>
              </select>
              <button className="btn primary" onClick={generate} disabled={working}>
                {working ? <Spinner /> : <Icon.mail />} {draft ? 'Redraft' : 'Draft follow-up'}{api.ai ? <span className="ai-badge" style={{ background: 'rgba(255,255,255,.18)', color: 'inherit' }}>AI</span> : null}
              </button>
            </div>
            {draft && (
              <div style={{ display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <div className="seg" role="group" aria-label="Channel">
                    <button aria-pressed={mode === 'email'} onClick={() => setMode('email')}>Email</button>
                    <button aria-pressed={mode === 'whatsapp'} onClick={() => setMode('whatsapp')}>WhatsApp</button>
                  </div>
                  <span style={{ flex: 1 }} />
                  <button className="btn sm" onClick={copy}><Icon.copy /> Copy</button>
                </div>
                <div className="msg-box" id="followup-text">{text}</div>
                {note && <p className="muted" style={{ fontSize: 12 }}>{note}</p>}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}
