import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Box, Finding, Invoice } from '../domain/types';
import { renderPdfPage } from '../ingest/pdf';
import { formatDate, formatINR } from '../lib/format';
import { Icon } from './kit';

/** Resolve a finding's field path to a box on the page: exact key, then the nearest parent. */
export function boxFor(inv: Invoice, field?: string): Box | undefined {
  const boxes = inv.extraction.boxes;
  if (!boxes || !field) return undefined;
  if (boxes[field]) return boxes[field];
  const alias: Record<string, string[]> = {
    igstTotal: ['igstTotal', 'items.0.tax'], cgstTotal: ['cgstTotal', 'items.0.tax'], signature: ['signature'], irn: ['irn', 'invoiceNo'],
    'items.hsn': ['items.hsn'], paymentStatus: [], placeOfSupply: ['placeOfSupply'],
  };
  for (const k of alias[field] ?? []) if (boxes[k]) return boxes[k];
  const m = field.match(/^items\.(\d+)\./);
  if (m) for (const k of ['tax', 'taxableValue', 'gstRate', 'description']) if (boxes[`items.${m[1]}.${k}`]) return boxes[`items.${m[1]}.${k}`];
  return undefined;
}

export function DocViewer({ inv, findings, active }: { inv: Invoice; findings: Finding[]; active: Finding | null }) {
  const frame = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(560);
  const [scale, setScale] = useState(0);
  const [imgUrl, setImgUrl] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const file = inv.source.file;
  const kind = inv.source.kind;

  useLayoutEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(Math.max(260, Math.min(820, el.clientWidth - 30))));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    if (kind !== 'pdf' || !file || !canvas.current) return;
    let live = true;
    setErr(null);
    renderPdfPage(file, 1, canvas.current, width).then((r) => { if (live) setScale(r.scale); }).catch((e) => { if (live) setErr(String(e?.message ?? e)); });
    return () => { live = false; };
  }, [file, kind, width]);

  useEffect(() => {
    if (kind !== 'image' || !file) return;
    const u = URL.createObjectURL(file);
    setImgUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [file, kind]);

  useEffect(() => {
    if (!active || !frame.current) return;
    const el = frame.current.querySelector('.hl.active') as HTMLElement | null;
    if (el) el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [active, scale]);

  const marks = findings.map((f) => ({ f, b: boxFor(inv, f.field) })).filter((x) => x.b && x.b.page === 1) as { f: Finding; b: Box }[];
  const activeBox = active ? boxFor(inv, active.field) : undefined;
  const pad = 3;

  return (
    <div className="doc" data-tour="doc">
      <div className="doc-cap">
        {kind === 'register' ? <Icon.table /> : kind === 'image' ? <Icon.scan /> : <Icon.pdf />}
        <span className="mono" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{inv.source.fileName}{inv.source.row ? ` · row ${inv.source.row}` : ''}</span>
        <span className="spacer" />
        <span>{methodLabel(inv)}</span>
      </div>
      <div className="doc-frame" ref={frame}>
        {kind === 'pdf' && (
          <div className="doc-page" style={{ width }}>
            <canvas ref={canvas} />
            {scale > 0 && marks.map(({ f, b }) => (
              <div key={f.id} className={`hl ${active?.id === f.id ? 'active' : 'ghost'}`} style={{ left: b.x * scale - pad, top: b.y * scale - pad, width: b.w * scale + pad * 2, height: b.h * scale + pad * 2 }} />
            ))}
            {scale > 0 && activeBox && !marks.some((m) => m.f.id === active?.id) && (
              <div className="hl active" style={{ left: activeBox.x * scale - pad, top: activeBox.y * scale - pad, width: activeBox.w * scale + pad * 2, height: activeBox.h * scale + pad * 2 }} />
            )}
          </div>
        )}
        {kind === 'image' && imgUrl && <div className="doc-page" style={{ width }}><img src={imgUrl} alt={`Scanned invoice ${inv.invoiceNo ?? ''}`} style={{ width }} /></div>}
        {kind === 'register' && <LedgerRow inv={inv} />}
        {err && <div className="empty">Could not render this PDF: {err}</div>}
      </div>
      {kind === 'pdf' && active && !activeBox && <div className="doc-cap">This finding has no single location on the page.</div>}
    </div>
  );
}

function methodLabel(inv: Invoice) {
  switch (inv.extraction.method) {
    case 'text-layer': return `Read from PDF text · ${Math.round(inv.extraction.confidence * 100)}%`;
    case 'ai-vision': return `Read by ${inv.extraction.model ?? 'AI'} vision · ${Math.round(inv.extraction.confidence * 100)}%`;
    case 'structured': return 'Imported from purchase register';
    case 'reference': return 'Bundled transcription';
    default: return 'Not read yet';
  }
}

function LedgerRow({ inv }: { inv: Invoice }) {
  const rows: [string, string][] = [
    ['Party', inv.supplier.name], ['Party GSTIN', inv.supplier.gstin ?? '—'], ['Supplier invoice no.', inv.invoiceNo ?? '—'], ['Invoice date', formatDate(inv.invoiceDate)],
    ['Item', inv.items.map((i) => i.description).join('; ') || '—'], ['HSN/SAC', inv.items.map((i) => i.hsn).filter(Boolean).join(', ') || '—'],
    ['Taxable value', formatINR(inv.taxableTotal)], ['IGST', formatINR(inv.igstTotal)], ['CGST', formatINR(inv.cgstTotal)], ['SGST', formatINR(inv.sgstTotal)], ['Invoice value', formatINR(inv.grandTotal)],
    ['Payment status', inv.paymentStatus === 'unpaid' ? 'Unpaid' : inv.paymentStatus === 'paid' ? 'Paid' : '—'],
  ];
  return (
    <div className="ledger-row-card">
      <div className="eyebrow">Purchase register · row {inv.source.row}</div>
      <div className="kv" style={{ gridTemplateColumns: '150px minmax(0,1fr)' }}>
        {rows.map(([k, v]) => [<div className="k" key={k + 'k'}>{k}</div>, <div className="v mono" key={k + 'v'}>{v}</div>])}
      </div>
      <p className="muted" style={{ fontSize: 12 }}>Register entries carry no document image. Upload the supplier's PDF to also check Rule 46 particulars.</p>
    </div>
  );
}
