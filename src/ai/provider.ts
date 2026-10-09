// AI provider abstraction.
//  - "claude": Claude via the claude.ai artifact runtime (sample capability), used when the app runs as a published artifact.
//  - "gemini": Google Gemini with the user's own API key, for running the app standalone (localhost / Vercel).
//  - none: everything still works; extraction falls back to the text-layer parser and checks to the rule engine.

export interface AiCallOptions {
  images?: Blob[];
  signal?: AbortSignal;
  tier?: 'quick' | 'default' | 'complex';
}

export interface AiProvider {
  id: 'claude' | 'gemini' | 'server';
  label: string;
  canSeeImages: boolean;
  json<T>(prompt: string, opts?: AiCallOptions): Promise<T>;
  text(prompt: string, opts?: AiCallOptions & { onText?: (t: string) => void }): Promise<string>;
}

type SampleFn = ((input: string, opts?: Record<string, unknown>) => Promise<{ text: string }>) & {
  json: <T>(input: string, opts?: Record<string, unknown>) => Promise<T>;
  limits: () => Promise<{ images?: { maxCount: number } }>;
};

declare global {
  interface Window {
    claude?: { use: (name: string) => Promise<unknown> };
  }
}

export class AiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

const wrap = (e: unknown): AiError => {
  if (e instanceof AiError) return e;
  const err = e as { code?: string; message?: string };
  return new AiError(err?.code ?? 'upstream_error', err?.message ?? String(e));
};

async function claudeProvider(): Promise<AiProvider | null> {
  if (!window.claude?.use) return null;
  const sample = (await window.claude.use('sample').catch(() => null)) as SampleFn | null;
  if (!sample) return null;
  const limits = await sample.limits().catch(() => ({} as { images?: { maxCount: number } }));
  const imgMax = limits.images?.maxCount ?? 0;
  return {
    id: 'claude',
    label: 'Claude',
    canSeeImages: imgMax > 0,
    async json<T>(prompt: string, opts: AiCallOptions = {}) {
      try {
        return await sample.json<T>(prompt, { modelTier: opts.tier ?? 'default', signal: opts.signal, ...(opts.images?.length && imgMax ? { images: opts.images.slice(0, imgMax) } : {}) });
      } catch (e) { throw wrap(e); }
    },
    async text(prompt, opts = {}) {
      try {
        const r = await sample(prompt, { modelTier: opts.tier ?? 'default', signal: opts.signal, cache: false, onText: opts.onText ? ({ text }: { text: string }) => opts.onText!(text) : undefined });
        return r.text;
      } catch (e) { throw wrap(e); }
    },
  };
}

const GEMINI_MODEL = 'gemini-2.5-flash';

async function blobToBase64(b: Blob): Promise<string> {
  const buf = new Uint8Array(await b.arrayBuffer());
  let s = '';
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return btoa(s);
}

function geminiProvider(key: string): AiProvider {
  const call = async (prompt: string, opts: AiCallOptions, asJson: boolean) => {
    const parts: unknown[] = [{ text: prompt }];
    for (const img of opts.images ?? []) parts.push({ inline_data: { mime_type: img.type || 'image/jpeg', data: await blobToBase64(img) } });
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL}:generateContent?key=${encodeURIComponent(key)}`, {
      method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, ...(asJson ? { responseMimeType: 'application/json' } : {}) } }),
    }).catch((e) => { throw new AiError('network', `Could not reach Gemini: ${e.message}`); });
    if (!res.ok) throw new AiError(res.status === 429 ? 'rate_limited' : res.status === 400 || res.status === 403 ? 'bad_key' : 'upstream_error', `Gemini returned ${res.status}`);
    const data = await res.json();
    return (data?.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
  };
  return {
    id: 'gemini', label: 'Gemini', canSeeImages: true,
    async json<T>(prompt: string, opts: AiCallOptions = {}) {
      const t = await call(prompt, opts, true);
      try { return JSON.parse(t.replace(/^```(?:json)?|```$/g, '').trim()) as T; } catch { throw new AiError('invalid_json', 'Gemini returned malformed JSON'); }
    },
    async text(prompt, opts = {}) {
      const t = await call(prompt, opts, false);
      opts.onText?.(t);
      return t;
    },
  };
}

/** Re-encode large photos so a request stays well under the hosting body limit (about 4.5 MB). */
async function shrinkImage(b: Blob, maxSide = 1800, maxBytes = 1_200_000): Promise<Blob> {
  if (b.size <= maxBytes && b.type !== 'image/heic') return b;
  try {
    const bmp = await createImageBitmap(b);
    const k = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas');
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.85, 0.72, 0.6]) {
      const out = await new Promise<Blob | null>((res) => c.toBlob(res, 'image/jpeg', q));
      if (out && out.size <= maxBytes) return out;
    }
    return await new Promise<Blob>((res, rej) => c.toBlob((o) => (o ? res(o) : rej(new Error('encode'))), 'image/jpeg', 0.5));
  } catch { return b; }
}

/** The team's hosted AI (api/ai.js): works for every visitor without an account or key. */
async function serverProvider(): Promise<AiProvider | null> {
  if (!/^https?:$/.test(location.protocol)) return null;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 2500);
    const r = await fetch('/api/ai', { signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return null;
    const info = await r.json();
    if (!info?.ok) return null;
  } catch { return null; }
  const call = async (prompt: string, opts: AiCallOptions, json: boolean) => {
    const images = await Promise.all((opts.images ?? []).slice(0, 3).map(async (b) => {
      const small = await shrinkImage(b);
      return { mime: small.type || 'image/jpeg', data: await blobToBase64(small) };
    }));
    const r = await fetch('/api/ai', { method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, images, json }) })
      .catch((e) => { throw new AiError('network', String(e?.message ?? e)); });
    if (!r.ok) {
      const body = await r.json().catch(() => null) as { error?: string; detail?: string } | null;
      const code = body?.error ?? (r.status === 413 ? 'too_large' : r.status === 429 ? 'rate_limited' : r.status === 504 ? 'timeout' : 'upstream_error');
      throw new AiError(code, body?.detail ? `${body.detail}` : `AI server returned ${r.status}`);
    }
    return String((await r.json())?.text ?? '');
  };
  return {
    id: 'server', label: 'Parakh AI', canSeeImages: true,
    async json<T>(prompt: string, opts: AiCallOptions = {}) {
      const t = await call(prompt, opts, true);
      const m = t.match(/```(?:json)?\s*([\s\S]*?)```/);
      const body = m ? m[1] : t.slice(Math.min(...['{', '['].map((c) => (t.indexOf(c) < 0 ? Infinity : t.indexOf(c)))));
      try { return JSON.parse(body.trim()) as T; } catch { throw new AiError('invalid_json', 'AI returned malformed JSON'); }
    },
    async text(prompt, opts = {}) {
      const t = await call(prompt, opts, false);
      opts.onText?.(t);
      return t;
    },
  };
}

const KEY_STORE = 'parakh.geminiKey';
export function savedGeminiKey(): string {
  try { return localStorage.getItem(KEY_STORE) ?? ''; } catch { return ''; }
}
export function saveGeminiKey(k: string) {
  try { if (k) localStorage.setItem(KEY_STORE, k); else localStorage.removeItem(KEY_STORE); } catch { /* storage unavailable */ }
}

/** Resolve the best available provider. Claude wins inside claude.ai; otherwise a saved Gemini key. */
export async function resolveProvider(): Promise<AiProvider | null> {
  const c = await claudeProvider();
  if (c) return c;
  const s = await serverProvider();
  if (s) return s;
  const k = savedGeminiKey();
  return k ? geminiProvider(k) : null;
}

export function describeAiError(e: unknown): string {
  const code = (e as AiError)?.code;
  switch (code) {
    case 'not_granted': return 'AI access was declined for this page. Rule-based checks still run.';
    case 'rate_limited': return 'The AI service is busy or your usage limit was reached. Try again in a minute.';
    case 'bad_key': return (e as AiError).message?.startsWith('Gemini returned') ? 'The Gemini API key was rejected. Check it in Settings.' : 'The AI key on the server was rejected. Check GEMINI_API_KEY in Vercel.';
    case 'invalid_json': return 'The AI answer could not be read. Try again.';
    case 'images_unavailable': return 'This view cannot send images to the AI.';
    case 'cancelled': return 'Stopped.';
    case 'network': return 'Could not reach the AI service from here.';
    case 'timeout': return 'The AI took too long to answer. Try again.';
    case 'too_large': return 'That image is too large to send. Try a smaller photo or a PDF.';
    case 'not_configured': return 'The AI key is not set on the server.';
    default: {
      const d = (e as AiError)?.message;
      return d && !/^AI server returned/.test(d) ? `The AI request failed: ${d.slice(0, 140)}` : 'The AI request failed. Try again.';
    }
  }
}
