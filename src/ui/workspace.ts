import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Company, Finding, Invoice, PortalRecord } from '../domain/types';
import { analyze } from '../domain/analyze';
import { readPdfText, pdfToImages, type PdfText } from '../ingest/pdf';
import { parseInvoiceText, emptyInvoice, locate } from '../ingest/parser';
import { parseGstr2b, parseRegister } from '../ingest/tabular';
import { resolveProvider, describeAiError, type AiProvider } from '../ai/provider';
import { extractInvoice, fromAi, reviewInvoice, reviewToFindings, sweepBatch, sweepToFindings, type Lang } from '../ai/tasks';
import { itcOf } from '../domain/rules';
import { checkEinvoiceQr } from '../einvoice/qr';
import { lookupRegistry } from '../domain/reference';
import { completeMission } from './onboarding/missions';
import { rulesVerdict } from '../ai/fallback';

export type JobStage = 'queued' | 'reading' | 'extracting' | 'done' | 'needs-ai' | 'error';
export interface Job { id: string; fileName: string; kind: 'invoice' | 'register' | 'gstr2b'; stage: JobStage; detail?: string; ms?: number; invoiceId?: string }

type AiFindingMap = Record<string, Omit<Finding, 'id' | 'invoiceId' | 'source'>[]>;

export interface Workspace {
  company: Company;
  period: string;
  asOf: string;
  sample: boolean;
  invoices: Invoice[];
  portal: PortalRecord[];
  portalMeta: { fileName: string; generated: string | null } | null;
}

export interface NewCheckInput {
  company: Company;
  period: string;
  invoiceFiles: File[];
  register: File | null;
  gstr2b: File | null;
}

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export const SAMPLE_AS_OF = '2026-10-09';

/** What the sample documents really contain and which issues were planted, for the reliability page. */
export interface GroundTruth {
  documents: Record<string, { invoiceNo: string; invoiceDate: string; supplierGstin: string; buyerGstin: string | null; taxableTotal: number; grandTotal: number; itemCount: number; expected: string[]; scenario: string }>;
  register: Record<string, string[]>;
  portalOnly: string[];
}

export function needsHumanReview(inv: Invoice): boolean {
  if (inv.extraction.reviewed || inv.extraction.method === 'pending' || inv.extraction.method === 'structured') return false;
  return inv.extraction.method === 'ai-vision' || inv.extraction.confidence < 0.8;
}

let idSeq = 0;
const newId = (p: string) => `${p}${++idSeq}`;

export function useWorkspace() {
  const [ws, setWs] = useState<Workspace | null>(null);
  const [jobs, setJobs] = useState<Job[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [ai, setAi] = useState<AiProvider | null>(null);
  const [aiChecked, setAiChecked] = useState(false);
  const [aiFindings, setAiFindings] = useState<AiFindingMap>({});
  const [verdicts, setVerdicts] = useState<Record<string, { text: string; lang: Lang; source: 'ai' | 'rules'; by?: string }>>({});
  const [confirmed, setConfirmed] = useState<Set<string>>(new Set());
  const [toast, setToast] = useState<string | null>(null);
  const [sweepDone, setSweepDone] = useState(false);
  const texts = useRef(new Map<string, PdfText>());
  const analysisRef = useRef<ReturnType<typeof analyze> | null>(null);
  const refs = useRef<Record<string, unknown>>({});
  const groundTruth = useRef<GroundTruth | null>(null);

  const flash = useCallback((m: string) => {
    setToast(m);
    window.setTimeout(() => setToast((t) => (t === m ? null : t)), 3800);
  }, []);

  const refreshAi = useCallback(async () => {
    const p = await resolveProvider();
    setAi(p);
    setAiChecked(true);
    return p;
  }, []);
  useEffect(() => { void refreshAi(); }, [refreshAi]);

  const patchJob = (id: string, patch: Partial<Job>) => setJobs((js) => js.map((j) => (j.id === id ? { ...j, ...patch } : j)));

  const ingest = useCallback(async (input: NewCheckInput & { sample?: boolean; asOf?: string; files?: Record<string, File> }) => {
    setBusy('Processing documents');
    texts.current.clear();
    setAiFindings({});
    setVerdicts({});
    setConfirmed(new Set());
    setSweepDone(false);
    const initial: Job[] = [
      ...input.invoiceFiles.map((f) => ({ id: newId('j'), fileName: f.name, kind: 'invoice' as const, stage: 'queued' as JobStage })),
      ...(input.register ? [{ id: newId('j'), fileName: input.register.name, kind: 'register' as const, stage: 'queued' as JobStage }] : []),
      ...(input.gstr2b ? [{ id: newId('j'), fileName: input.gstr2b.name, kind: 'gstr2b' as const, stage: 'queued' as JobStage }] : []),
    ];
    setJobs(initial);
    const invoices: Invoice[] = [];
    let portal: PortalRecord[] = [];
    let portalMeta: Workspace['portalMeta'] = null;
    let k = 0;
    for (const f of input.invoiceFiles) {
      const job = initial[k++];
      patchJob(job.id, { stage: 'reading' });
      const id = newId('doc');
      const t0 = performance.now();
      try {
        if (f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')) {
          const t = await readPdfText(f);
          texts.current.set(id, t);
          const r = parseInvoiceText(t, input.company);
          const inv: Invoice = { ...r.invoice, id, source: { kind: 'pdf', fileName: f.name, file: f } };
          if (r.textFound && (inv.irn || lookupRegistry(inv.supplier.gstin)?.einvoiceMandated || t.items.some((i) => /e-?invoice|\bIRN\b/i.test(i.str)))) {
            inv.qr = await checkEinvoiceQr(f, 'pdf').catch(() => ({ found: false, signature: 'not-signed' as const }));
          }
          invoices.push(inv);
          const qrNote = inv.qr?.found ? ` · QR ${inv.qr.signature === 'valid' ? 'signature verified' : inv.qr.signature}` : '';
          patchJob(job.id, { ...(r.textFound ? { stage: 'done' as JobStage, detail: `${r.invoice.items.length} line items · ${Math.round(r.invoice.extraction.confidence * 100)}% confidence${qrNote}` } : { stage: 'needs-ai' as JobStage, detail: 'Scanned PDF · needs AI extraction' }), ms: Math.round(performance.now() - t0), invoiceId: id });
        } else if (/^image\//.test(f.type) || /\.(jpe?g|png|webp)$/i.test(f.name)) {
          invoices.push({ ...emptyInvoice(null, 'pending', 'Photo or scan. Text has to be read by AI.'), id, source: { kind: 'image', fileName: f.name, file: f } });
          patchJob(job.id, { stage: 'needs-ai', detail: 'Image · needs AI extraction', ms: Math.round(performance.now() - t0), invoiceId: id });
        } else {
          patchJob(job.id, { stage: 'error', detail: 'Unsupported file type' });
        }
      } catch (e) {
        patchJob(job.id, { stage: 'error', detail: (e as Error).message.slice(0, 80) });
      }
      await new Promise((r) => setTimeout(r, input.sample ? 35 : 0));
    }
    if (input.register) {
      const job = initial[k++];
      patchJob(job.id, { stage: 'reading' });
      try {
        const rows = await parseRegister(input.register, input.company.stateCode);
        invoices.push(...rows);
        patchJob(job.id, { stage: 'done', detail: `${rows.length} invoices from the register` });
      } catch (e) { patchJob(job.id, { stage: 'error', detail: (e as Error).message.slice(0, 80) }); }
    }
    if (input.gstr2b) {
      const job = initial[k++];
      patchJob(job.id, { stage: 'reading' });
      try {
        const g = await parseGstr2b(input.gstr2b);
        portal = g.records;
        portalMeta = { fileName: input.gstr2b.name, generated: g.generated };
        patchJob(job.id, { stage: 'done', detail: `${g.records.length} supplier records${g.gstin && g.gstin !== input.company.gstin ? ' · GSTIN differs from workspace' : ''}` });
      } catch (e) { patchJob(job.id, { stage: 'error', detail: 'Could not read this GSTR-2B file' }); void e; }
    }
    setWs({ company: input.company, period: input.period, asOf: input.asOf ?? todayIso(), sample: !!input.sample, invoices, portal, portalMeta });
    setBusy(null);
    return invoices;
  }, []);

  const loadSample = useCallback(async () => {
    setBusy('Loading sample workspace');
    try {
      const get = async (path: string) => {
        const r = await fetch(`samples/${path}`);
        if (!r.ok) throw new Error(`Missing sample file ${path}`);
        const b = await r.blob();
        const name = path.split('/').pop()!;
        const type = name.endsWith('.pdf') ? 'application/pdf' : name.endsWith('.jpg') ? 'image/jpeg' : name.endsWith('.json') ? 'application/json' : 'text/csv';
        return new File([b], name, { type });
      };
      const m = await (await fetch('samples/manifest.json')).json();
      refs.current = await (await fetch('samples/reference_extractions.json')).json().catch(() => ({}));
      groundTruth.current = await fetch('samples/ground_truth.json').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const files = await Promise.all((m.invoices as string[]).map(get));
      const register = await get(m.register);
      const gstr2b = await get(m.gstr2b);
      const company: Company = { name: m.company.name, gstin: m.company.gstin, stateCode: m.company.state, address: m.company.address };
      await ingest({ company, period: m.period, invoiceFiles: files, register, gstr2b, sample: true, asOf: SAMPLE_AS_OF });
    } catch (e) {
      setBusy(null);
      flash(`Could not load the sample: ${(e as Error).message}`);
    }
  }, [ingest, flash]);

  const replaceInvoice = (id: string, next: Omit<Invoice, 'id' | 'source'>) =>
    setWs((w) => (w ? { ...w, invoices: w.invoices.map((i) => (i.id === id ? { ...next, id, source: i.source, paymentStatus: i.paymentStatus } : i)) } : w));

  /** A person confirmed or corrected the extracted fields. Re-runs every check through analysis. */
  const confirmFields = useCallback((id: string, patch: Partial<Invoice>, edited: string[]) => {
    setWs((w) => (w ? { ...w, invoices: w.invoices.map((i) => (i.id === id ? { ...i, ...patch, extraction: { ...i.extraction, reviewed: { at: new Date().toISOString(), edited } } } : i)) } : w));
  }, []);

  const extractWithAi = useCallback(async (inv: Invoice) => {
    const provider = ai ?? (await refreshAi());
    if (!provider) { flash('Connect an AI provider in Settings to read scans.'); return false; }
    if (!inv.source.file) return false;
    setBusy(`Reading ${inv.source.fileName} with ${provider.label}`);
    try {
      const isPdf = inv.source.kind === 'pdf';
      const images = isPdf ? await pdfToImages(inv.source.file) : [inv.source.file];
      const t = texts.current.get(inv.id) ?? null;
      const textLayer = t && t.items.length > 15 ? t.items.map((i) => i.str).join(' ') : null;
      const out = await extractInvoice(provider, provider.canSeeImages ? images : [], textLayer);
      if (t) {
        const boxes: Record<string, NonNullable<ReturnType<typeof locate>>> = {};
        const put = (k: string, v: string | number | null | undefined) => { const b = locate(t, v); if (b) boxes[k] = b; };
        put('invoiceNo', out.invoiceNo); put('supplier.gstin', out.supplier.gstin); put('buyer.gstin', out.buyer.gstin); put('supplier.name', out.supplier.name);
        out.extraction.boxes = boxes;
        out.extraction.pageSize = t.pageSize;
      }
      out.extraction.model = provider.label;
      if (out.irn || lookupRegistry(out.supplier.gstin)?.einvoiceMandated) {
        (out as Invoice).qr = await checkEinvoiceQr(inv.source.file, isPdf ? 'pdf' : 'image').catch(() => undefined);
      }
      replaceInvoice(inv.id, out);
      flash(`Extracted ${out.items.length} line items from ${inv.source.fileName}`);
      completeMission('scan');
      return true;
    } catch (e) {
      // For the sample scan, keep the demo moving: fall back to the bundled transcription, clearly labelled.
      if (hasRefFor(inv)) {
        applyRefFor(inv, `${describeAiError(e)} Showing the bundled transcription of this sample instead.`);
        flash('AI could not read it just now, so the bundled transcription was used.');
        return true;
      }
      flash(describeAiError(e));
      return false;
    } finally { setBusy(null); }
  }, [ai, refreshAi, flash]);

  const hasRefFor = (inv: Invoice) => Object.keys(refs.current ?? {}).some((k) => k.endsWith(inv.source.fileName));
  const applyRefFor = (inv: Invoice, note: string) => {
    const ref = Object.entries(refs.current).find(([k]) => k.endsWith(inv.source.fileName));
    if (!ref) return false;
    const out = fromAi(ref[1] as Parameters<typeof fromAi>[0]);
    out.extraction = { method: 'reference', confidence: 1, note };
    replaceInvoice(inv.id, out);
    completeMission('scan');
    return true;
  };
  const applyReference = useCallback((inv: Invoice) => {
    if (!applyRefFor(inv, 'Reference transcription bundled with the sample, used because no AI provider is connected.')) flash('No reference extraction for this file.');
  }, [flash]); // eslint-disable-line react-hooks/exhaustive-deps

  const review = useCallback(async (inv: Invoice, findings: Finding[], lang: Lang) => {
    const provider = ai ?? (await refreshAi());
    if (!ws) return;
    if (!provider) {
      const v = analysisRef.current?.verdicts[inv.id];
      if (v) setVerdicts((m) => ({ ...m, [inv.id]: { text: rulesVerdict(inv, findings, v, lang), lang, source: 'rules' } }));
      flash('AI is not connected here, so this summary comes from the rule checks.');
      return;
    }
    setBusy(`${provider.label} is reviewing ${inv.invoiceNo ?? inv.source.fileName}`);
    try {
      const r = await reviewInvoice(provider, inv, ws.company, findings.filter((f) => f.source === 'rule'), lang);
      setVerdicts((v) => ({ ...v, [inv.id]: { text: r.verdict, lang, source: 'ai', by: provider.label } }));
      const extra = reviewToFindings(r, inv);
      setAiFindings((m) => ({ ...m, [inv.id]: extra }));
      flash(extra.length ? `AI review added ${extra.length} finding${extra.length > 1 ? 's' : ''}` : 'AI review found nothing beyond the rule checks');
    } catch (e) { flash(describeAiError(e)); } finally { setBusy(null); }
  }, [ai, refreshAi, ws, flash]);

  const sweep = useCallback(async () => {
    const provider = ai ?? (await refreshAi());
    if (!provider || !ws) { flash('AI is not connected here. The rule checks have already run on every line.'); return; }
    const ready = ws.invoices.filter((i) => i.extraction.method !== 'pending');
    setBusy(`${provider.label} is checking ${ready.reduce((s, i) => s + i.items.length, 0)} line items`);
    try {
      const res = await sweepBatch(provider, ready, ws.company);
      const map = sweepToFindings(res, ready);
      setAiFindings((m) => {
        const next = { ...m };
        for (const [id, list] of Object.entries(map)) next[id] = [...(next[id] ?? []).filter((x) => !list.some((y) => y.ruleId === x.ruleId)), ...list];
        return next;
      });
      setSweepDone(true);
      flash(res.length ? `AI flagged ${res.length} line${res.length > 1 ? 's' : ''} the rules did not` : 'AI check complete: no additional issues');
    } catch (e) { flash(describeAiError(e)); } finally { setBusy(null); }
  }, [ai, refreshAi, ws, flash]);

  const confirmMatch = useCallback((invoiceId: string, portalId: string) => {
    setConfirmed((s) => new Set(s).add(`${invoiceId}|${portalId}`));
    flash('Match confirmed');
  }, [flash]);

  const analysis = useMemo(() => (ws ? analyze({ company: ws.company, period: ws.period, asOf: ws.asOf, invoices: ws.invoices, portal: ws.portal, aiFindings, confirmed }) : null), [ws, aiFindings, confirmed]);
  analysisRef.current = analysis;
  const pending = useMemo(() => ws?.invoices.filter((i) => i.extraction.method === 'pending') ?? [], [ws]);

  return {
    ws, analysis, jobs, busy, ai, aiChecked, toast, pending, verdicts, sweepDone, texts: texts.current, hasReference: (inv: Invoice) => Object.keys(refs.current).some((k) => k.endsWith(inv.source.fileName)),
    ingest, loadSample, extractWithAi, applyReference, review, sweep, confirmMatch, refreshAi, flash, setBusy, confirmFields, groundTruth: groundTruth.current,
    itcOf,
  };
}

export type WorkspaceApi = ReturnType<typeof useWorkspace>;
