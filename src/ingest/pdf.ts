// PDF access via pdf.js. The worker is bundled as a string and started from a blob: URL so the app
// runs from a single self-contained file (no CDN worker fetch).
import * as pdfjs from 'pdfjs-dist';
import type { PDFDocumentProxy } from 'pdfjs-dist';
import workerSource from 'pdfjs-dist/build/pdf.worker.min.mjs?raw';

let workerReady: Promise<void> | null = null;
/** Start the pdf.js worker from a blob: URL. If the host refuses workers, load the worker module
 *  on the main thread instead; pdf.js then runs its "fake worker" from globalThis.pdfjsWorker. */
function ensureWorker(): Promise<void> {
  if (workerReady) return workerReady;
  const url = URL.createObjectURL(new Blob([workerSource], { type: 'text/javascript' }));
  workerReady = (async () => {
    try {
      const w = new Worker(url, { type: 'module' });
      const ok = await new Promise<boolean>((res) => {
        const t = setTimeout(() => res(true), 1500);
        w.addEventListener('error', () => { clearTimeout(t); res(false); }, { once: true });
      });
      if (!ok) throw new Error('worker failed');
      pdfjs.GlobalWorkerOptions.workerPort = w;
    } catch {
      await import(/* @vite-ignore */ url);
    }
  })();
  return workerReady;
}

export interface TextItem {
  str: string;
  page: number;
  x: number; // left, PDF units
  y: number; // top, PDF units, measured from the top of the page
  w: number;
  h: number;
}

export interface PdfText {
  pages: number;
  pageSize: { w: number; h: number };
  items: TextItem[];
}

const docCache = new WeakMap<Blob, Promise<PDFDocumentProxy>>();

export function openPdf(file: Blob): Promise<PDFDocumentProxy> {
  let p = docCache.get(file);
  if (!p) {
    p = ensureWorker().then(() => file.arrayBuffer()).then((buf) => pdfjs.getDocument({ data: new Uint8Array(buf), isEvalSupported: false }).promise);
    docCache.set(file, p);
  }
  return p;
}

export async function readPdfText(file: Blob): Promise<PdfText> {
  const doc = await openPdf(file);
  const items: TextItem[] = [];
  let pageSize = { w: 595, h: 842 };
  for (let p = 1; p <= Math.min(doc.numPages, 4); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1 });
    if (p === 1) pageSize = { w: vp.width, h: vp.height };
    const tc = await page.getTextContent();
    for (const it of tc.items) {
      if (!('str' in it) || !it.str.trim()) continue;
      const [, , , d, e, f] = it.transform as number[];
      const h = Math.abs(d) || it.height || 8;
      items.push({ str: it.str, page: p, x: e, y: vp.height - f - h * 0.82, w: it.width, h });
    }
  }
  return { pages: doc.numPages, pageSize, items };
}

/** Render one page to a canvas at the given CSS width (device-pixel aware). Renders on the same
 *  canvas are serialised, because pdf.js rejects overlapping render() calls on one canvas. */
const queues = new WeakMap<HTMLCanvasElement, Promise<unknown>>();
export function renderPdfPage(file: Blob, pageNo: number, canvas: HTMLCanvasElement, cssWidth: number): Promise<{ scale: number; w: number; h: number }> {
  const run = async () => {
    const doc = await openPdf(file);
    const page = await doc.getPage(pageNo);
    const base = page.getViewport({ scale: 1 });
    const scale = cssWidth / base.width;
    const dpr = Math.min(2.5, window.devicePixelRatio || 1);
    const vp = page.getViewport({ scale: scale * dpr });
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    canvas.style.width = `${cssWidth}px`;
    canvas.style.height = `${(base.height * scale).toFixed(1)}px`;
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return { scale, w: base.width, h: base.height };
  };
  const next = (queues.get(canvas) ?? Promise.resolve()).catch(() => undefined).then(run);
  queues.set(canvas, next);
  return next;
}

/** Rasterise the first pages of a PDF to JPEG blobs for a vision model. */
export async function pdfToImages(file: Blob, maxPages = 2): Promise<Blob[]> {
  const doc = await openPdf(file);
  const out: Blob[] = [];
  for (let p = 1; p <= Math.min(maxPages, doc.numPages); p++) {
    const page = await doc.getPage(p);
    const vp = page.getViewport({ scale: 1.6 });
    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(vp.width);
    canvas.height = Math.floor(vp.height);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    out.push(await new Promise<Blob>((res) => canvas.toBlob((b) => res(b!), 'image/jpeg', 0.88)));
  }
  return out;
}
