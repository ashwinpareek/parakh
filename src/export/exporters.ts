import * as XLSX from 'xlsx';
import type { Analysis } from '../domain/types';
import { formatDate, formatINR, formatPeriod } from '../lib/format';
import { imsRows, table4 } from '../ui/views/Actions';
import { CATEGORY_LABEL } from '../ui/views/Overview';

/** Offer a file to the viewer. Inside claude.ai this goes through the downloads capability;
 *  standalone it is a normal browser download. */
export async function saveFile(filename: string, data: Blob): Promise<'saved' | 'declined' | 'failed'> {
  try {
    const dl = window.claude?.use ? ((await window.claude.use('downloads')) as { save: (r: { filename: string; data: Blob }) => Promise<unknown> } | null) : null;
    if (dl) {
      await dl.save({ filename, data });
      return 'saved';
    }
  } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === 'declined') return 'declined';
  }
  try {
    const url = URL.createObjectURL(data);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return 'saved';
  } catch {
    return 'failed';
  }
}

/** Audit trail: when the report was made and from which inputs, so any figure can be traced back. */
function provenance(a: Analysis) {
  const docs = a.invoices.filter((i) => i.source.kind === 'pdf' || i.source.kind === 'image');
  const regs = [...new Set(a.invoices.filter((i) => i.source.kind === 'register').map((i) => i.source.fileName))];
  return {
    generated: new Date().toISOString(),
    lines: [
      `${docs.length} invoice documents (${docs.filter((d) => d.extraction.method === 'text-layer').length} read from PDF text, ${docs.filter((d) => d.extraction.method === 'ai-vision').length} read by AI, ${docs.filter((d) => d.extraction.reviewed).length} confirmed by a person)`,
      ...regs.map((r) => `Purchase register: ${r} (${a.invoices.filter((i) => i.source.fileName === r).length} invoices)`),
      `GSTR-2B: ${a.portal.length} supplier records`,
    ],
  };
}

const slug = (a: Analysis) => `parakh_${a.company.gstin}_${a.period}`;

function findingRows(a: Analysis) {
  const inv = new Map(a.invoices.map((i) => [i.id, i]));
  return a.findings.map((f) => {
    const i = inv.get(f.invoiceId)!;
    return {
      Severity: f.severity, Category: CATEGORY_LABEL[f.category], Rule: f.ruleId, Source: f.source === 'ai' ? 'AI review' : 'Rule engine',
      Supplier: i.supplier.name, 'Supplier GSTIN': i.supplier.gstin ?? '', 'Invoice No': i.invoiceNo ?? '', 'Invoice Date': i.invoiceDate ?? '',
      Issue: f.title, Detail: f.detail, 'Recommended fix': f.fix ?? '', Citation: f.citation ?? '', 'ITC at risk (₹)': f.itcAtRisk, Document: i.source.fileName,
    };
  });
}

export function buildWorkbook(a: Analysis): Blob {
  const wb = XLSX.utils.book_new();
  const t = a.totals;
  const t4 = table4(a);
  const summary = [
    ['Parakh GST purchase check'], [],
    ['Company', a.company.name], ['GSTIN', a.company.gstin], ['Period', formatPeriod(a.period)], ['Checked as of', a.asOf], ['Report generated', provenance(a).generated], ...provenance(a).lines.map((l) => ['Source', l]), [],
    ['Invoices checked', t.invoices], ['ITC in books (₹)', t.itcClaimed], ['ITC at risk (₹)', t.itcAtRisk], ['Safe to claim (₹)', t.itcSafe], ['Match rate with GSTR-2B', `${Math.round(t.matchRate * 100)}%`], [],
    ['GSTR-3B Table 4 draft'], ['4(A)(5) All other ITC', t4.a5], ['4(B)(1) Sec 17(5) reversal', t4.blocked], ['4(B)(2) Other reversal', t4.others], ['4(C) Net ITC', t4.net], ['4(D)(2) Ineligible', t4.ineligible],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), 'Summary');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(findingRows(a)), 'Findings');
  const inv = new Map(a.invoices.map((i) => [i.id, i]));
  const portal = new Map(a.portal.map((p) => [p.id, p]));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.recon.map((r) => {
    const b = r.invoiceId ? inv.get(r.invoiceId) : undefined;
    const p = r.portalId ? portal.get(r.portalId) : undefined;
    return {
      Status: r.status, Supplier: b?.supplier.name ?? p?.tradeName ?? '', GSTIN: b?.supplier.gstin ?? p?.ctin ?? '',
      'Books invoice': b?.invoiceNo ?? '', 'Books date': b?.invoiceDate ?? '', '2B invoice': p?.invoiceNo ?? '', '2B date': p?.invoiceDate ?? '',
      'Books taxable': b?.taxableTotal ?? '', '2B taxable': p?.taxable ?? '', 'Books tax': b ? b.igstTotal + b.cgstTotal + b.sgstTotal + b.cessTotal : '', '2B tax': p ? p.igst + p.cgst + p.sgst + p.cess : '',
      Differences: r.diffs.map((d) => d.label).join(', '), Notes: r.reasons.join(' '), Confidence: Math.round(r.confidence * 100) / 100,
    };
  })), 'Reconciliation');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(imsRows(a).map((r) => ({
    Action: r.action === 'n/a' ? 'No action' : r.action[0].toUpperCase() + r.action.slice(1), 'Supplier GSTIN': r.rec.ctin, Supplier: r.rec.tradeName, 'Invoice No': r.rec.invoiceNo, 'Invoice Date': r.rec.invoiceDate, 'Tax (₹)': r.tax, Reason: r.reason,
  }))), 'IMS actions');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(a.vendors.map((v) => ({
    Supplier: v.name, GSTIN: v.gstin, Score: v.score, Invoices: v.invoices, Findings: v.findings, Critical: v.critical, 'ITC at risk (₹)': v.itcAtRisk, 'Missing in 2B': v.missingIn2b, 'Last GSTR-1 filed': v.lastFiled ?? 'Not filed',
  }))), 'Suppliers');
  const out = XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
  return new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

export function buildFindingsCsv(a: Analysis): Blob {
  const ws = XLSX.utils.json_to_sheet(findingRows(a));
  return new Blob(['﻿' + XLSX.utils.sheet_to_csv(ws)], { type: 'text/csv' });
}

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

export function buildHtmlReport(a: Analysis): Blob {
  const t = a.totals;
  const t4 = table4(a);
  const inv = new Map(a.invoices.map((i) => [i.id, i]));
  const flagged = a.invoices.filter((i) => a.verdicts[i.id] && a.verdicts[i.id].band !== 'clear').sort((x, y) => a.verdicts[y.id].itcAtRisk - a.verdicts[x.id].itcAtRisk);
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>GST purchase check – ${esc(a.company.name)} – ${esc(formatPeriod(a.period))}</title>
<style>
body{font:13px/1.5 'IBM Plex Sans',system-ui,sans-serif;color:#14181b;margin:40px auto;max-width:900px;padding:0 24px}
h1{font-size:22px;margin:0 0 4px}h2{font-size:15px;margin:28px 0 8px;border-bottom:1px solid #ddd;padding-bottom:6px}
.muted{color:#6b7378}.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:16px}.k{border:1px solid #e0e3dc;border-radius:6px;padding:10px}
.k b{display:block;font-size:20px}table{width:100%;border-collapse:collapse;font-size:12px}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid #eee;vertical-align:top}
th{font-size:10.5px;text-transform:uppercase;letter-spacing:.05em;color:#6b7378}.r{text-align:right;white-space:nowrap}.crit{color:#b3322a}.sev{font-size:10.5px;text-transform:uppercase;font-weight:600}
.critical{color:#b3322a}.high{color:#c05a17}.medium{color:#9a7410}.low{color:#5a646c}@media print{body{margin:0}}
</style></head><body>
<p class="muted">Parakh · GST purchase check</p>
<h1>${esc(a.company.name)}</h1>
<p class="muted">GSTIN ${esc(a.company.gstin)} · ${esc(formatPeriod(a.period))} · checked as of ${esc(formatDate(a.asOf))}</p>
<div class="grid">
<div class="k">ITC in books<b>${esc(formatINR(t.itcClaimed))}</b></div>
<div class="k">ITC at risk<b class="crit">${esc(formatINR(t.itcAtRisk))}</b></div>
<div class="k">Safe to claim<b>${esc(formatINR(t.itcSafe))}</b></div>
<div class="k">Matched with GSTR-2B<b>${Math.round(t.matchRate * 100)}%</b></div>
</div>
<h2>GSTR-3B Table 4 (draft)</h2>
<table><tr><td>4(A)(5) All other ITC</td><td class="r">${esc(formatINR(t4.a5))}</td></tr><tr><td>4(B)(1) Reversal under Sec 17(5)</td><td class="r">−${esc(formatINR(t4.blocked))}</td></tr><tr><td>4(B)(2) Other reversals</td><td class="r">−${esc(formatINR(t4.others))}</td></tr><tr><td><b>4(C) Net ITC</b></td><td class="r"><b>${esc(formatINR(t4.net))}</b></td></tr><tr><td class="muted">4(D)(2) Ineligible</td><td class="r muted">${esc(formatINR(t4.ineligible))}</td></tr></table>
<h2>Invoices needing action (${flagged.length})</h2>
<table><tr><th>Supplier</th><th>Invoice</th><th>Issues</th><th class="r">ITC at risk</th><th>IMS</th></tr>
${flagged.map((i) => `<tr><td>${esc(i.supplier.name)}<br><span class="muted">${esc(i.supplier.gstin ?? '')}</span></td><td>${esc(i.invoiceNo)}<br><span class="muted">${esc(formatDate(i.invoiceDate))}</span></td><td>${a.findings.filter((f) => f.invoiceId === i.id).map((f) => `<span class="sev ${f.severity}">${f.severity}</span> ${esc(f.title)}${f.fix ? `<br><span class="muted">→ ${esc(f.fix)}</span>` : ''}`).join('<br>')}</td><td class="r">${esc(formatINR(a.verdicts[i.id].itcAtRisk))}</td><td>${esc(a.verdicts[i.id].ims)}</td></tr>`).join('')}
</table>
<h2>Supplier filings not in books</h2>
<table><tr><th>Supplier</th><th>Invoice</th><th class="r">Tax</th></tr>
${a.recon.filter((r) => r.status === 'missing-in-books').map((r) => { const p = a.portal.find((x) => x.id === r.portalId)!; return `<tr><td>${esc(p.tradeName)}<br><span class="muted">${esc(p.ctin)}</span></td><td>${esc(p.invoiceNo)} · ${esc(formatDate(p.invoiceDate))}</td><td class="r">${esc(formatINR(p.igst + p.cgst + p.sgst + p.cess))}</td></tr>`; }).join('') || '<tr><td colspan="3" class="muted">None</td></tr>'}
</table>
<h2>Audit trail</h2>
<p class="muted">Generated ${esc(provenance(a).generated)}</p>
<ul class="muted">${provenance(a).lines.map((l) => `<li>${esc(l)}</li>`).join('')}</ul>
<p class="muted" style="margin-top:28px;font-size:11px">Generated by Parakh. Rule references: CGST Act 2017 and CGST Rules 2017; rates per the rationalised structure effective 22 Sep 2025. Review with your tax advisor before filing. ${inv.size} documents analysed.</p>
</body></html>`;
  return new Blob([html], { type: 'text/html' });
}

export const fileNames = {
  workbook: (a: Analysis) => `${slug(a)}.xlsx`,
  csv: (a: Analysis) => `${slug(a)}_findings.csv`,
  html: (a: Analysis) => `${slug(a)}_report.html`,
};
