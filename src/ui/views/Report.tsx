import type { Analysis } from '../../domain/types';
import { formatDate, formatINR, formatPeriod } from '../../lib/format';
import { buildFindingsCsv, buildHtmlReport, buildWorkbook, fileNames, saveFile } from '../../export/exporters';
import { Icon } from '../kit';
import type { WorkspaceApi } from '../workspace';
import { CATEGORY_LABEL } from './Overview';
import { table4 } from './Actions';
import type { FindingCategory } from '../../domain/types';

export function Report({ a, api }: { a: Analysis; api: WorkspaceApi }) {
  const t = a.totals;
  const t4 = table4(a);
  const top = (Object.keys(t.byCategory) as FindingCategory[]).filter((c) => t.byCategory[c].itc > 0).sort((x, y) => t.byCategory[y].itc - t.byCategory[x].itc).slice(0, 3);
  const save = async (name: string, blob: Blob) => {
    const r = await saveFile(name, blob);
    api.flash(r === 'saved' ? `Saved ${name}` : r === 'declined' ? 'Download cancelled' : 'Download is not available in this view');
  };

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h1>Report and exports</h1>
          <div className="meta">Hand these to your CA, or file from them.</div>
        </div>
      </div>
      <div className="export-grid">
        <div className="export"><Icon.table /><b>Excel workbook</b><p>Summary, every finding, the full reconciliation, IMS actions and the supplier scorecard on separate sheets.</p><button className="btn primary sm" onClick={() => save(fileNames.workbook(a), buildWorkbook(a))}><Icon.report /> .xlsx</button></div>
        <div className="export"><Icon.invoices /><b>Audit report</b><p>A printable one-page report for the partner or client, with the GSTR-3B Table 4 draft.</p><button className="btn sm" onClick={() => save(fileNames.html(a), buildHtmlReport(a))}><Icon.report /> .html</button></div>
        <div className="export"><Icon.alert /><b>Findings list</b><p>Flat CSV of every issue with rule, citation, fix and rupee impact. Opens in Excel or Tally import tools.</p><button className="btn sm" onClick={() => save(fileNames.csv(a), buildFindingsCsv(a))}><Icon.report /> .csv</button></div>
        <div className="export"><Icon.actions /><b>IMS action sheet</b><p>Accept, pending and reject decisions with reasons. Included as a sheet in the workbook.</p><button className="btn sm" onClick={() => save(fileNames.workbook(a), buildWorkbook(a))}><Icon.report /> In .xlsx</button></div>
      </div>
      <article className="report">
        <div>
          <div className="eyebrow">Summary for {formatPeriod(a.period)}</div>
          <h2 style={{ fontSize: 18, marginTop: 6 }}>{a.company.name}</h2>
          <p className="muted mono" style={{ fontSize: 12 }}>{a.company.gstin} · checked {formatDate(a.asOf)}</p>
        </div>
        <p style={{ maxWidth: '68ch' }}>
          We checked {t.invoices} purchase invoices carrying {formatINR(t.itcClaimed)} of input tax credit. {formatINR(t.itcSafe)} is safe to claim this month.
          {' '}{formatINR(t.itcAtRisk)} is at risk{top.length ? `, mostly from ${top.map((c) => CATEGORY_LABEL[c].toLowerCase()).join(', ')}` : ''}.
          {' '}{t.recon['missing-in-books'] ? `${t.recon['missing-in-books']} supplier filings against your GSTIN are not in your books and should be verified before the IMS deadline.` : ''}
        </p>
        <div className="table-wrap">
          <table className="t">
            <tbody>
              <tr><td>Net ITC to report in GSTR-3B Table 4(C)</td><td className="r num"><b>{formatINR(t4.net)}</b></td></tr>
              <tr><td>Critical findings</td><td className="r num">{t.bySeverity.critical}</td></tr>
              <tr><td>High findings</td><td className="r num">{t.bySeverity.high}</td></tr>
              <tr><td>Invoices to reject in IMS</td><td className="r num">{t.ims.reject}</td></tr>
              <tr><td>Invoices to keep pending</td><td className="r num">{t.ims.pending}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="muted" style={{ fontSize: 11.5 }}>Checks follow the CGST Act and Rules, 2017 and the rate structure in force from 22 Sep 2025. The supplier registry in this demo is a fixed sample; production uses a live GSTIN lookup through a GST Suvidha Provider.</p>
      </article>
    </div>
  );
}
