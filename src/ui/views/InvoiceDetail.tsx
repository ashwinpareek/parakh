import { useEffect, useMemo, useState } from 'react';
import type { Analysis, Finding, Invoice } from '../../domain/types';
import { checkGstin, stateLabel } from '../../domain/gstin';
import { lookupRegistry } from '../../domain/reference';
import { formatDate, formatINR, formatNumber } from '../../lib/format';
import { DocViewer } from '../DocViewer';
import { BandPill, Icon, ImsPill, ReconPill, SevPill, Tabs, Spinner } from '../kit';
import type { WorkspaceApi } from '../workspace';
import type { Route } from '../App';
import type { Lang } from '../../ai/tasks';
import { supplierLabel } from './Overview';
import { T, useMode } from '../mode';
import { plainFor } from '../plain';
import { needsHumanReview } from '../workspace';
import type { QrCheck } from '../../domain/types';
import { round2 } from '../../domain/text';
import { completeMission } from '../onboarding/missions';

type Tab = 'issues' | 'fields' | 'match' | 'lines';

export function GstinBadge({ gstin }: { gstin: string | null }) {
  if (!gstin) return <span className="pill critical">No GSTIN</span>;
  const g = checkGstin(gstin);
  if (!g.valid) return <span className="pill critical" title={g.problems.join(' ')}>Invalid GSTIN</span>;
  const r = lookupRegistry(g.gstin);
  if (!r) return <span className="pill na" title="Checksum valid. Live status needs a GSP connection.">Checksum valid</span>;
  if (r.status === 'Cancelled') return <span className="pill critical">Cancelled {formatDate(r.cancelledOn)}</span>;
  return <span className="pill clear" title={`${r.legalName} · ${r.constitution} · registered ${formatDate(r.registeredOn)}`}>{r.status} · {r.filing === 'Monthly' ? 'monthly filer' : 'QRMP'}</span>;
}

export function InvoiceDetail({ a, api, id, go }: { a: Analysis; api: WorkspaceApi; id: string; go: (r: Route) => void }) {
  const inv = a.invoices.find((i) => i.id === id);
  const [tab, setTab] = useState<Tab>('issues');
  const [active, setActive] = useState<Finding | null>(null);
  const [lang, setLang] = useState<Lang>('English');
  const [editing, setEditing] = useState(false);
  const mode = useMode();
  const findings = useMemo(() => {
    const w = { critical: 0, high: 1, medium: 2, low: 3 };
    return a.findings.filter((f) => f.invoiceId === id).sort((x, y) => w[x.severity] - w[y.severity] || y.itcAtRisk - x.itcAtRisk);
  }, [a, id]);
  useEffect(() => {
    setActive(findings.find((f) => f.field) ?? null); setTab('issues'); setEditing(false);
    if (findings.some((f) => f.severity === 'critical' || f.severity === 'high')) completeMission('bill');
    if (findings.some((f) => f.ruleId === 'EINV-QR-MISMATCH')) completeMission('edited');
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  const order = useMemo(() => a.invoices.filter((i) => i.extraction.method !== 'pending').sort((x, y) => a.verdicts[y.id].risk - a.verdicts[x.id].risk).map((i) => i.id), [a]);
  if (!inv) return <div className="page"><div className="empty">This invoice is no longer in the workspace.<button className="btn" onClick={() => go({ view: 'invoices' })}>Back to invoices</button></div></div>;
  if (inv.extraction.method === 'pending') {
    return (
      <div className="page">
        <button className="btn ghost sm" style={{ justifySelf: 'start' }} onClick={() => go({ view: 'invoices' })}><Icon.back /> Invoices</button>
        <div className="detail">
          <DocViewer inv={inv} findings={[]} active={null} />
          <div className="callout ai">
            <Icon.scan />
            <div className="body"><b>This document has not been read yet</b><span className="ink2">{inv.extraction.note}</span></div>
            <div className="acts">
              <button className="btn primary sm" onClick={() => api.extractWithAi(inv)} disabled={!!api.busy}><span className="ai-badge">AI</span> Read with {api.ai?.label ?? 'AI'}</button>
              {!api.ai && api.hasReference(inv) && <button className="btn sm" onClick={() => api.applyReference(inv)}>Use bundled transcription</button>}
            </div>
          </div>
        </div>
      </div>
    );
  }
  const v = a.verdicts[inv.id];
  const recon = a.recon.find((r) => r.invoiceId === inv.id);
  const portal = recon?.portalId ? a.portal.find((p) => p.id === recon.portalId) : undefined;
  const pos = order.indexOf(inv.id);
  const verdict = api.verdicts[inv.id];

  return (
    <div className="page">
      <div className="toolbar">
        <button className="btn ghost sm" onClick={() => go({ view: 'invoices' })}><Icon.back /> Invoices</button>
        <span className="spacer" style={{ flex: 1 }} />
        <span className="muted" style={{ fontSize: 12 }}>{pos + 1} of {order.length} by risk</span>
        <button className="btn sm" aria-label="Previous invoice" disabled={pos <= 0} onClick={() => go({ view: 'invoice', id: order[pos - 1] })}><Icon.back /></button>
        <button className="btn sm" aria-label="Next invoice" disabled={pos >= order.length - 1} onClick={() => go({ view: 'invoice', id: order[pos + 1] })}><Icon.next /></button>
      </div>
      <div className="detail">
        <DocViewer inv={inv} findings={findings} active={active} />
        <div style={{ display: 'grid', gap: 14, minWidth: 0 }}>
          <div className="d-head">
            <div className="d-title">
              <div style={{ minWidth: 0 }}>
                <div className="eyebrow">{inv.source.kind === 'register' ? 'Register entry' : 'Tax invoice'} · {formatDate(inv.invoiceDate)}</div>
                <h1 style={{ marginTop: 4 }}>{supplierLabel(inv)}</h1>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6, flexWrap: 'wrap' }}>
                  <span className="mono">{inv.supplier.gstin ?? '—'}</span>
                  <GstinBadge gstin={inv.supplier.gstin} />
                  {inv.extraction.reviewed && <span className="pill clear" title={inv.extraction.reviewed.edited.length ? `You corrected: ${inv.extraction.reviewed.edited.join(', ')}` : 'You confirmed the extracted details'}><Icon.check /> Checked by you</span>}
                  <span className="muted">·</span>
                  <span className="mono">{inv.invoiceNo ?? 'no number'}</span>
                </div>
              </div>
              <div className="right"><BandPill band={v.band} /></div>
            </div>
            <div className="facts">
              <div><span className="eyebrow">Invoice value</span><span className="v">{formatINR(inv.grandTotal)}</span></div>
              <div><span className="eyebrow">{mode === 'simple' ? 'GST on this bill' : 'ITC claimed'}</span><span className="v">{formatINR(v.itcClaimed)}</span></div>
              <div><span className="eyebrow">{mode === 'simple' ? 'Stuck' : 'ITC at risk'}</span><span className={`v ${v.itcAtRisk ? 'risk-v' : ''}`}>{formatINR(v.itcAtRisk)}</span></div>
              {mode === 'simple'
                ? <div><span className="eyebrow">Safe to claim</span><span className="v" style={{ color: 'var(--ok)' }}>{formatINR(round2(v.itcClaimed - v.itcAtRisk))}</span></div>
                : <div><span className="eyebrow">Risk score</span><span className="v">{v.risk}<span className="muted" style={{ fontSize: 11 }}> / 100</span></span></div>}
            </div>
          </div>

          <div className="verdict">
            <ImsPill a={v.ims} />
            <div className="body">
              <b>{v.ims === 'accept' ? 'Accept' : v.ims === 'reject' ? 'Reject' : v.ims === 'pending' ? 'Keep pending' : 'Nothing to do yet'} in <T k="ims">IMS</T></b>
              <span>{v.imsReason}</span>
            </div>
          </div>

          {(needsHumanReview(inv) || editing) && (
            <div className="verdict review-box">
              <Icon.edit />
              <div className="body">
                <b>{editing ? 'Correct anything that was read wrongly' : 'AI read this bill. Please check the details.'}</b>
                {!editing && <span>Compare the fields with the document on the left. If they are right, confirm. If not, fix them and every check runs again.</span>}
                {editing ? <EditFields inv={inv} onCancel={() => setEditing(false)} onSave={(patch, edited) => { api.confirmFields(inv.id, patch, edited); setEditing(false); api.flash(edited.length ? `Updated ${edited.length} field${edited.length > 1 ? 's' : ''}; checks re-run` : 'Confirmed'); }} /> : (
                  <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                    <button className="btn sm primary" onClick={() => { api.confirmFields(inv.id, {}, []); api.flash('Confirmed as correct'); }}><Icon.check /> Details are correct</button>
                    <button className="btn sm" onClick={() => { setEditing(true); setTab('fields'); }}><Icon.edit /> Fix details</button>
                  </div>
                )}
              </div>
            </div>
          )}

          {inv.qr && <QrPanel qr={inv.qr} inv={inv} />}

          <div className="verdict" style={{ background: verdict ? 'color-mix(in srgb, var(--accent-soft) 45%, var(--surface))' : undefined }}>
            <span className="ai-badge" style={{ marginTop: 2 }}>AI</span>
            <div className="body">
              {verdict ? (
                <><b>{verdict.source === 'ai' ? `AI auditor’s note · ${verdict.by ?? 'AI'}` : 'Summary from the rule checks'}</b><span style={{ color: 'var(--ink)', whiteSpace: 'pre-wrap' }}>{verdict.text}</span>{verdict.source === 'rules' && <span className="muted" style={{ fontSize: 11.5 }}>AI is not connected in this view, so this was written from Parakh’s own checks.</span>}</>
              ) : (
                <><b>Second opinion from AI</b><span>Checks whether HSN codes fit the descriptions, judges Sec 17(5) intent for your business and explains the decision in plain language.</span></>
              )}
              <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap', alignItems: 'center' }}>
                <label className="sr-only" htmlFor="lang">Language</label>
                <select id="lang" className="input" style={{ height: 28, fontSize: 12 }} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
                  <option>English</option><option>Telugu</option><option>Hindi</option>
                </select>
                <button className="btn sm ai" onClick={() => api.review(inv, findings, lang)} disabled={!!api.busy}>
                  {api.busy?.includes('reviewing') ? <Spinner /> : null}{verdict ? 'Review again' : 'Run AI review'}
                </button>
              </div>
            </div>
          </div>

          <Tabs<Tab> value={tab} onChange={setTab} items={[
            { id: 'issues', label: 'Issues', count: findings.length },
            { id: 'match', label: 'GSTR-2B match' },
            { id: 'fields', label: 'Extracted fields' },
            { id: 'lines', label: 'Line items', count: inv.items.length },
          ]} />

          {tab === 'issues' && (
            <div className="findings" data-tour="findings">
              {findings.length === 0 && <div className="ok-box">Passed every check. Safe to claim {formatINR(v.itcClaimed)}.</div>}
              {findings.map((f) => {
                const p = plainFor(f);
                const simple = mode === 'simple';
                return (
                  <button key={f.id} className="finding" aria-pressed={active?.id === f.id} onClick={() => setActive(f)}>
                    <span className={`sev-bar ${f.severity}`} />
                    <span className="body">
                      <span className="ttl"><SevPill s={f.severity} /><b>{simple ? p.title : f.title}</b>{f.source === 'ai' && <span className="ai-badge">AI</span>}{f.itcAtRisk > 0 && <span className="amt">{simple ? `${formatINR(f.itcAtRisk)} stuck` : `−${formatINR(f.itcAtRisk)}`}</span>}</span>
                      <span className="det">{simple ? p.why : f.detail}</span>
                      <span className="fix">{simple ? p.todo : f.fix ?? p.todo}</span>
                      {simple ? (
                        <span className="det" style={{ fontSize: 11.5, color: 'var(--ink-3)' }}>Details: {f.detail}</span>
                      ) : (
                        (f.citation || f.ruleId) && <span className="cite">{f.citation && <span>{f.citation}</span>}<span>{f.ruleId}</span></span>
                      )}
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          {tab === 'match' && (
            <section className="card">
              <div className="card-h">
                <h2>Books vs supplier filing</h2>
                {recon && <ReconPill s={recon.status} />}
                <div className="right">
                  {recon?.status === 'suggested' && <button className="btn sm primary" onClick={() => api.confirmMatch(recon.invoiceId!, recon.portalId!)}><Icon.check /> Confirm match</button>}
                </div>
              </div>
              <div className="card-b" style={{ display: 'grid', gap: 10 }}>
                {!recon && <p className="muted">This document is a duplicate and was excluded from matching.</p>}
                {recon && !portal && <p className="ink2">{recon.reasons.join(' ')}</p>}
                {portal && recon && (
                  <>
                    <div className="table-wrap">
                      <table className="t diff-t">
                        <thead><tr><th>Field</th><th>Your books</th><th>GSTR-2B</th></tr></thead>
                        <tbody>
                          {([
                            ['gstin', 'Supplier GSTIN', inv.supplier.gstin, portal.ctin],
                            ['invoiceNo', 'Invoice number', inv.invoiceNo, portal.invoiceNo],
                            ['invoiceDate', 'Invoice date', formatDate(inv.invoiceDate), formatDate(portal.invoiceDate)],
                            ['taxable', 'Taxable value', formatINR(inv.taxableTotal), formatINR(portal.taxable)],
                            ['tax', 'Total tax', formatINR(inv.igstTotal + inv.cgstTotal + inv.sgstTotal + inv.cessTotal), formatINR(portal.igst + portal.cgst + portal.sgst + portal.cess)],
                            ['pos', 'Place of supply', stateLabel(inv.placeOfSupply), stateLabel(portal.placeOfSupply)],
                            ['itcavl', 'ITC available', '—', portal.itcAvailable ? 'Yes' : `No${portal.itcReason ? ` (reason ${portal.itcReason})` : ''}`],
                          ] as const).map(([k, label, b, p]) => (
                            <tr key={k} className={recon.diffs.some((d) => d.field === k) ? 'bad' : ''}><td>{label}</td><td className="b">{b ?? '—'}</td><td className="p">{p ?? '—'}</td></tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    <p className="muted" style={{ fontSize: 12 }}>Match confidence {Math.round(recon.confidence * 100)}%. {recon.reasons.join(' ')} Supplier filed {portal.supplierFiledOn ? `on ${formatDate(portal.supplierFiledOn)}` : 'GSTR-1'} for period {portal.supplierPeriod ?? '—'}.</p>
                  </>
                )}
              </div>
            </section>
          )}

          {tab === 'fields' && !editing && <Fields inv={inv} onEdit={() => setEditing(true)} />}{tab === 'fields' && editing && <p className="muted" style={{ fontSize: 12 }}>Editing above.</p>}

          {tab === 'lines' && (
            <section className="card">
              <div className="table-wrap">
                <table className="t">
                  <thead><tr><th>#</th><th>Description</th><th>HSN</th><th className="r">Qty</th><th className="r">Rate</th><th className="r">Taxable</th><th className="r">GST</th><th className="r">Tax</th></tr></thead>
                  <tbody>
                    {inv.items.map((it, k) => (
                      <tr key={k}>
                        <td className="muted">{k + 1}</td>
                        <td style={{ minWidth: 180 }}>{it.description || '—'}</td>
                        <td className="mono">{it.hsn ?? <span className="pill critical">missing</span>}</td>
                        <td className="r num">{formatNumber(it.qty)}</td>
                        <td className="r num">{it.unitPrice != null ? formatINR(it.unitPrice) : '—'}</td>
                        <td className="r num">{formatINR(it.taxableValue)}</td>
                        <td className="r num">{it.gstRate != null ? `${it.gstRate}%` : '—'}</td>
                        <td className="r num">{formatINR(it.cgst + it.sgst + it.igst + it.cess)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Fields({ inv, onEdit }: { inv: Invoice; onEdit: () => void }) {
  const c = inv.extraction.fieldConfidence ?? {};
  const row = (k: string, label: string, val: string | null | undefined) => [
    <div className="k" key={k + 'k'}>{label}</div>,
    <div className="v" key={k + 'v'}>{val || <span className="muted">not found</span>}</div>,
    <div key={k + 'c'} style={{ display: 'flex' }}>{c[k] != null && <span className={`conf ${c[k] < 0.7 ? 'lo' : ''}`}>{Math.round(c[k] * 100)}%</span>}</div>,
  ];
  return (
    <section className="card">
      <div className="card-b" style={{ paddingTop: 8 }}>
        <div className="kv">
          {row('supplier.name', 'Supplier', inv.supplier.name)}
          {row('supplier.address', 'Supplier address', inv.supplier.address)}
          {row('supplier.gstin', 'Supplier GSTIN', inv.supplier.gstin)}
          {row('buyer.name', 'Billed to', inv.buyer.name)}
          {row('buyer.gstin', 'Recipient GSTIN', inv.buyer.gstin)}
          {row('invoiceNo', 'Invoice number', inv.invoiceNo)}
          {row('invoiceDate', 'Invoice date', formatDate(inv.invoiceDate))}
          {row('placeOfSupply', 'Place of supply', inv.placeOfSupply ? stateLabel(inv.placeOfSupply) : null)}
          {row('reverseCharge', 'Reverse charge', inv.reverseCharge == null ? null : inv.reverseCharge ? 'Yes' : 'No')}
          {row('irn', 'IRN (e-invoice)', inv.irn)}
          {row('signature', 'Signature', inv.hasSignature == null ? null : inv.hasSignature ? 'Present' : 'Absent')}
          {row('taxableTotal', 'Taxable value', formatINR(inv.taxableTotal))}
          {row('tax', 'CGST / SGST / IGST', `${formatINR(inv.cgstTotal)} / ${formatINR(inv.sgstTotal)} / ${formatINR(inv.igstTotal)}`)}
          {row('grandTotal', 'Invoice total', formatINR(inv.grandTotal))}
        </div>
        {inv.extraction.note && <p className="muted" style={{ fontSize: 12, marginTop: 10 }}>{inv.extraction.note}</p>}
        {inv.source.kind !== 'register' && <button className="btn sm" style={{ marginTop: 12 }} onClick={onEdit}><Icon.edit /> Correct these details</button>}
      </div>
    </section>
  );
}

const EDITABLE: { key: string; label: string; get: (i: Invoice) => string; set: (v: string) => Partial<Invoice> | ((i: Invoice) => Partial<Invoice>); numeric?: boolean }[] = [
  { key: 'invoiceNo', label: 'Invoice number', get: (i) => i.invoiceNo ?? '', set: (v) => ({ invoiceNo: v.trim() || null }) },
  { key: 'invoiceDate', label: 'Invoice date (YYYY-MM-DD)', get: (i) => i.invoiceDate ?? '', set: (v) => ({ invoiceDate: v.trim() || null }) },
  { key: 'supplier.gstin', label: 'Supplier GSTIN', get: (i) => i.supplier.gstin ?? '', set: (v) => (i: Invoice) => ({ supplier: { ...i.supplier, gstin: v.trim().toUpperCase() || null, stateCode: v.trim().slice(0, 2) || null } }) },
  { key: 'buyer.gstin', label: 'Your GSTIN on the bill', get: (i) => i.buyer.gstin ?? '', set: (v) => (i: Invoice) => ({ buyer: { ...i.buyer, gstin: v.trim().toUpperCase() || null } }) },
  { key: 'placeOfSupply', label: 'Place of supply (state code)', get: (i) => i.placeOfSupply ?? '', set: (v) => ({ placeOfSupply: v.trim().padStart(2, '0') || null }) },
  { key: 'taxableTotal', label: 'Taxable value', get: (i) => String(i.taxableTotal), set: (v) => ({ taxableTotal: Number(v) || 0 }), numeric: true },
  { key: 'cgstTotal', label: 'CGST', get: (i) => String(i.cgstTotal), set: (v) => ({ cgstTotal: Number(v) || 0 }), numeric: true },
  { key: 'sgstTotal', label: 'SGST', get: (i) => String(i.sgstTotal), set: (v) => ({ sgstTotal: Number(v) || 0 }), numeric: true },
  { key: 'igstTotal', label: 'IGST', get: (i) => String(i.igstTotal), set: (v) => ({ igstTotal: Number(v) || 0 }), numeric: true },
  { key: 'grandTotal', label: 'Invoice total', get: (i) => String(i.grandTotal), set: (v) => ({ grandTotal: Number(v) || 0 }), numeric: true },
];

function EditFields({ inv, onSave, onCancel }: { inv: Invoice; onSave: (patch: Partial<Invoice>, edited: string[]) => void; onCancel: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(EDITABLE.map((e) => [e.key, e.get(inv)])));
  const save = () => {
    let patch: Partial<Invoice> = {};
    const edited: string[] = [];
    for (const e of EDITABLE) {
      if (vals[e.key] === e.get(inv)) continue;
      edited.push(e.label);
      const r = e.set(vals[e.key]);
      patch = { ...patch, ...(typeof r === 'function' ? r({ ...inv, ...patch }) : r) };
    }
    onSave(patch, edited);
  };
  return (
    <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
      <div className="edit-grid">
        {EDITABLE.map((e) => (
          <label key={e.key} className="field" htmlFor={`ef-${e.key}`}>{e.label}
            <input id={`ef-${e.key}`} className={`input ${e.numeric || e.key.includes('gstin') ? 'mono' : ''}`} inputMode={e.numeric ? 'decimal' : undefined} value={vals[e.key]} onChange={(ev) => setVals((v) => ({ ...v, [e.key]: ev.target.value }))} />
          </label>
        ))}
      </div>
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn sm primary" onClick={save}><Icon.check /> Save and re-check</button>
        <button className="btn sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}

function QrPanel({ qr, inv }: { qr: QrCheck; inv: Invoice }) {
  const p = qr.payload;
  if (!qr.found) return null;
  if (qr.signature === 'invalid') {
    return <div className="verdict" style={{ borderColor: 'var(--crit)' }}><Icon.qr /><div className="body"><b>E-invoice QR signature failed</b><span>The QR code is not signed by a key the portal uses. Treat this bill as unverified.</span></div></div>;
  }
  if (!p) return null;
  const rows: [string, string, string][] = [
    ['Supplier GSTIN', inv.supplier.gstin ?? '—', p.SellerGstin ?? '—'],
    ['Your GSTIN', inv.buyer.gstin ?? '—', p.BuyerGstin ?? '—'],
    ['Invoice number', inv.invoiceNo ?? '—', p.DocNo ?? '—'],
    ['Date', formatDate(inv.invoiceDate), p.DocDt ? formatDate(p.DocDt.split('/').reverse().join('-')) : '—'],
    ['Invoice total', formatINR(inv.grandTotal), p.TotInvVal != null ? formatINR(p.TotInvVal) : '—'],
  ];
  const bad = rows.filter(([, a, b]) => a !== b && b !== '—');
  return (
    <div data-tour="qr" className={`verdict ${bad.length ? '' : 'qr-ok'}`} style={bad.length ? { borderColor: 'color-mix(in srgb, var(--crit) 50%, var(--line))' } : undefined}>
      <Icon.qr />
      <div className="body">
        <b>{bad.length ? 'Printed bill differs from its signed QR code' : 'Signed e-invoice QR verified'}</b>
        <span>
          {qr.signature === 'valid' ? `The QR's digital signature checks out (${qr.keyLabel}), so its contents are exactly what the portal registered` : 'The QR was read but its signature could not be checked'}
          {p.IrnDt ? ` on ${formatDate(p.IrnDt.slice(0, 10))}` : ''}. {bad.length ? 'The printed copy was changed afterwards:' : 'The printed bill matches it.'}
        </span>
        {bad.length > 0 && (
          <div className="table-wrap" style={{ marginTop: 6 }}>
            <table className="t diff-t">
              <thead><tr><th>Field</th><th>Printed on bill</th><th>Signed in QR</th></tr></thead>
              <tbody>{rows.map(([l, a, b]) => <tr key={l} className={a !== b && b !== '—' ? 'bad' : ''}><td>{l}</td><td className="b">{a}</td><td className="p">{b}</td></tr>)}</tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
