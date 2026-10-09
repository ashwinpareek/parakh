// E-invoice QR verification.
// The Invoice Registration Portal (IRP) prints a QR code on every e-invoice. It holds a JWT signed
// with RS256 by the IRP; its payload "data" carries the seller/buyer GSTIN, invoice number, date,
// total value and IRN. Verifying the signature proves the QR came from the IRP; comparing its
// fields with the printed invoice catches PDFs edited after the e-invoice was generated.
import jsQR from 'jsqr';
import { openPdf } from '../ingest/pdf';
import demoKey from './demoIrpKey.json';

import type { QrCheck, QrPayload } from '../domain/types';
export type { QrCheck, QrPayload };

/** Public keys trusted for QR signatures, by key id. Production adds the IRP's published certificates. */
const KEYS: Record<string, { jwk: JsonWebKey; label: string }> = {
  [demoKey.kid]: { jwk: demoKey as JsonWebKey, label: 'Parakh demo IRP key' },
};

async function decodeCanvas(canvas: HTMLCanvasElement): Promise<string | null> {
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const { width, height } = canvas;
  // Scan the full page, then each quarter (QR codes are easier to find in a smaller frame).
  const regions: [number, number, number, number][] = [[0, 0, width, height], [0, height / 2, width / 2, height / 2], [width / 2, 0, width / 2, height / 2], [0, 0, width / 2, height / 2], [width / 2, height / 2, width / 2, height / 2]];
  for (const [x, y, w, h] of regions) {
    const img = ctx.getImageData(Math.floor(x), Math.floor(y), Math.floor(w), Math.floor(h));
    const r = jsQR(img.data, img.width, img.height, { inversionAttempts: 'dontInvert' });
    if (r?.data) return r.data;
  }
  return null;
}

export async function readQrFromPdf(file: Blob): Promise<string | null> {
  const doc = await openPdf(file);
  const page = await doc.getPage(1);
  const vp = page.getViewport({ scale: 2.6 });
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(vp.width);
  canvas.height = Math.floor(vp.height);
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvasContext: ctx, viewport: vp }).promise;
  return decodeCanvas(canvas);
}

export async function readQrFromImage(file: Blob): Promise<string | null> {
  const bmp = await createImageBitmap(file);
  const canvas = document.createElement('canvas');
  const scale = Math.min(2, 2600 / Math.max(bmp.width, bmp.height));
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext('2d', { willReadFrequently: true })!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return decodeCanvas(canvas);
}

const b64uToBytes = (s: string) => {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
};
const b64uToJson = (s: string) => JSON.parse(new TextDecoder().decode(b64uToBytes(s)));

export async function verifyQr(text: string): Promise<QrCheck> {
  const parts = text.trim().split('.');
  if (parts.length !== 3) {
    // Some invoices carry an unsigned QR (payment UPI codes, plain text). Treat as not an IRP QR.
    return { found: true, signature: 'not-signed' };
  }
  try {
    const header = b64uToJson(parts[0]);
    const body = b64uToJson(parts[1]);
    const payload: QrPayload = typeof body.data === 'string' ? JSON.parse(body.data) : body.data ?? body;
    const key = KEYS[header.kid];
    if (!key) return { found: true, signature: 'unknown-key', payload };
    const k = await crypto.subtle.importKey('jwk', key.jwk, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
    const ok = await crypto.subtle.verify('RSASSA-PKCS1-v1_5', k, b64uToBytes(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`));
    return { found: true, signature: ok ? 'valid' : 'invalid', keyLabel: key.label, payload };
  } catch {
    return { found: true, signature: 'not-signed' };
  }
}

export async function checkEinvoiceQr(file: Blob, kind: 'pdf' | 'image'): Promise<QrCheck> {
  const text = kind === 'pdf' ? await readQrFromPdf(file) : await readQrFromImage(file);
  if (!text) return { found: false, signature: 'not-signed' };
  return verifyQr(text);
}
