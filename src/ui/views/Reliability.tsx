// "How reliable is this?" Measures Parakh against the ground truth shipped with the sample pack:
// field-level extraction accuracy, whether each planted problem was caught, extra flags it raised,
// and processing time. Failures are shown, not hidden.
import { useMemo } from 'react';
import type { Analysis, Invoice } from '../../domain/types';
import { Card } from '../kit';
import { needsHumanReview, type WorkspaceApi } from '../workspace';
import type { Route } from '../App';

const FIELDS: { key: string; label: string; ok: (inv: Invoice, gt: GT) => boolean }[] = [
  { key: 'no', label: 'Invoice number', ok: (i, g) => i.invoiceNo === g.invoiceNo },
  { key: 'date', label: 'Date', ok: (i, g) => i.invoiceDate === g.invoiceDate },
  { key: 'sup', label: 'Supplier GSTIN', ok: (i, g) => i.supplier.gstin === g.supplierGstin },
  { key: 'buy', label: 'Your GSTIN', ok: (i, g) => (i.buyer.gstin ?? null) === (g.buyerGstin ?? null) },
  { key: 'tax', label: 'Taxable value', ok: (i, g) => Math.abs(i.taxableTotal - g.taxableTotal) <= 1 },
  { key: 'tot', label: 'Invoice total', ok: (i, g) => Math.abs(i.grandTotal - g.grandTotal) <= 1 },
  { key: 'items', label: 'Line items', ok: (i, g) => i.items.length === g.itemCount },
];
type GT = NonNullable<WorkspaceApi['groundTruth']>['documents'][string];

export function Reliability({ a, api, go }: { a: Analysis; api: WorkspaceApi; go: (r: Route) => void }) {
  const gt = api.ws?.sample ? api.groundTruth : null;
  const rows = useMemo(() => {
    if (!gt) return [];
    return a.invoices.filter((i) => gt.documents[i.source.fileName] || gt.documents[`${i.source.fileName}`]).map((inv) => {
      const g = gt.documents[inv.source.fileName];
      const read = inv.extraction.method !== 'pending';
      const fields = read ? FIELDS.map((f) => ({ ...f, pass: f.ok(inv, g) })) : [];
      const found = a.findings.filter((f) => f.invoiceId === inv.id);
      const caught = g.expected.map((r) => ({ rule: r, hit: found.some((f) => f.ruleId === r) }));
      const extra = found.filter((f) => f.source === 'rule' && f.severity !== 'low' && !g.expected.includes(f.ruleId));
      const job = api.jobs.find((j) => j.invoiceId === inv.id);
      return { inv, g, read, fields, caught, extra, ms: job?.ms };
    });
  }, [a, gt, api.jobs]);

  const read = rows.filter((r) => r.read);
  // Unread documents count as wrong on every field, so failures cannot hide.
  const fieldTotal = rows.length * FIELDS.length;
  const fieldPass = read.reduce((s, r) => s + r.fields.filter((f) => f.pass).length, 0);
  const docsPerfect = read.filter((r) => r.fields.every((f) => f.pass)).length;
  const reg = gt ? Object.entries(gt.register).map(([no, rules]) => {
    const inv = a.invoices.find((i) => i.source.kind === 'register' && i.invoiceNo === no);
    return rules.map((r) => ({ rule: r, hit: !!inv && a.findings.some((f) => f.invoiceId === inv.id && f.ruleId === r) }));
  }).flat() : [];
  const portalHits = gt ? gt.portalOnly.filter((no) => a.recon.some((r) => r.status === 'missing-in-books' && a.portal.find((p) => p.id === r.portalId)?.invoiceNo === no)).length : 0;
  const expected = rows.flatMap((r) => (r.read ? r.caught : r.g.expected.map((rule) => ({ rule, hit: false })))).concat(reg);
  const caught = expected.filter((c) => c.hit).length + portalHits;
  const expectedTotal = expected.length + (gt?.portalOnly.length ?? 0);
  const extras = rows.reduce((s, r) => s + r.extra.length, 0);
  const pdfTimes = rows.map((r) => r.ms).filter((x): x is number => x != null && x > 0);
  const avgMs = pdfTimes.length ? Math.round(pdfTimes.reduce((s, x) => s + x, 0) / pdfTimes.length) : null;
  const methods = a.invoices.reduce<Record<string, number>>((m, i) => ({ ...m, [i.extraction.method]: (m[i.extraction.method] ?? 0) + 1 }), {});

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <div className="eyebrow">Reliability</div>
          <h1 style={{ marginTop: 6 }}>How far can you trust these results?</h1>
          <div className="meta">An answer that looks right is not the same as one that is right. This page measures Parakh against documents whose correct answers are known, and shows where it falls short.</div>
        </div>
      </div>

      {!gt ? (
        <Card title="Measured accuracy needs labelled documents">
          <div className="card-b" style={{ display: 'grid', gap: 8 }}>
            <p className="ink2">Your own uploads have no answer key, so accuracy cannot be measured here. Load the sample workspace (New check → Load sample) to see the measurements.</p>
            <p className="ink2">For this workspace: {Object.entries(methods).map(([k, n]) => `${n} read by ${k === 'text-layer' ? 'PDF text' : k === 'ai-vision' ? 'AI vision' : k === 'structured' ? 'register import' : k}`).join(', ')}. {a.invoices.filter(needsHumanReview).length} waiting for a human check.</p>
          </div>
        </Card>
      ) : (
        <>
          <div className="metric-grid">
            <section className="card metric"><span className="v">{fieldTotal ? Math.round((fieldPass / fieldTotal) * 100) : 0}%</span><span className="l">Fields read correctly ({fieldPass} of {fieldTotal})</span></section>
            <section className="card metric"><span className="v">{docsPerfect}/{rows.length}</span><span className="l">Bills with every field exactly right{read.length < rows.length ? ` (${rows.length - read.length} not read yet)` : ''}</span></section>
            <section className="card metric"><span className="v">{caught}/{expectedTotal}</span><span className="l">Planted problems caught</span></section>
            <section className="card metric"><span className="v">{avgMs != null ? `${avgMs} ms` : '—'}</span><span className="l">Average time per document, in your browser (the first includes start-up)</span></section>
          </div>

          <Card title="Bill by bill" sub="each sample bill was made with one known problem (or none)">
            <div className="table-wrap">
              <table className="t">
                <thead><tr><th>Document</th><th>Planted problem</th><th>Read by</th><th>Fields right</th><th>Problem caught?</th><th>Extra flags</th><th className="r">Time</th></tr></thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.inv.id} className={r.read ? 'click' : ''} onClick={() => r.read && go({ view: 'invoice', id: r.inv.id })}>
                      <td className="trunc"><div className="mono" style={{ fontSize: 12 }}>{r.inv.source.fileName}</div></td>
                      <td>{r.g.scenario}</td>
                      <td>{r.read ? (r.inv.extraction.method === 'text-layer' ? 'PDF text' : r.inv.extraction.method === 'ai-vision' ? 'AI vision' : 'Bundled') : <span className="pill info">Not read yet</span>}</td>
                      <td>{r.read ? <span className={r.fields.every((f) => f.pass) ? 'cell-ok' : 'cell-bad'} title={r.fields.filter((f) => !f.pass).map((f) => f.label).join(', ')}>{r.fields.filter((f) => f.pass).length}/{r.fields.length}{r.fields.some((f) => !f.pass) ? ` · missed ${r.fields.filter((f) => !f.pass).map((f) => f.label.toLowerCase()).join(', ')}` : ''}</span> : '—'}</td>
                      <td>{!r.read ? '—' : r.caught.length === 0 ? <span className="muted">none planted</span> : r.caught.every((c) => c.hit) ? <span className="cell-ok">Yes</span> : <span className="cell-bad">Missed {r.caught.filter((c) => !c.hit).map((c) => c.rule).join(', ')}</span>}</td>
                      <td className="trunc">{r.extra.length ? <div className="ink2">{r.extra.map((f) => f.ruleId).join(', ')}</div> : <span className="muted">0</span>}</td>
                      <td className="r num muted">{r.ms != null ? `${r.ms} ms` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>

          <div className="grid-2">
            <Card title="What the numbers mean">
              <div className="card-b" style={{ display: 'grid', gap: 8 }}>
                <p className="expl">Field accuracy counts a bill that was not read at all as wrong on every field, so failures cannot hide. "Extra flags" are issues raised beyond the planted one ({extras} in total). Most are real secondary effects of the planted problem, for example a bill without your GSTIN also never reaches GSTR-2B.</p>
                <p className="expl">Register rows and supplier-only filings are included in "planted problems caught": {reg.filter((c) => c.hit).length}/{reg.length} register issues and {portalHits}/{gt.portalOnly.length} unknown supplier filings.</p>
              </div>
            </Card>
            <Card title="Known limits">
              <div className="card-b">
                <ul className="steps" style={{ paddingLeft: 18 }}>
                  <li>The sample bills are synthetic and share one layout family. Real bills vary more, so the parser’s accuracy on unseen layouts will be lower.</li>
                  <li>That is why any bill read by AI, or read with under 80% confidence, goes to a person to confirm before it counts.</li>
                  <li>Supplier registration status comes from a demo registry. Production needs a live GSTIN lookup through a licensed GST Suvidha Provider.</li>
                  <li>HSN rates cover common purchases only. Unknown codes are left to the AI check and your accountant.</li>
                  <li>Only B2B invoices are reconciled; credit and debit notes are not matched yet.</li>
                </ul>
              </div>
            </Card>
          </div>
        </>
      )}
    </div>
  );
}
