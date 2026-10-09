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
    const images = await Promise.all((opts.images ?? []).slice(0, 3).map(async (b) => ({ mime: b.type || 'image/jpeg', data: await blobToBase64(b) })));
    const r = await fetch('/api/ai', { method: 'POST', signal: opts.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ prompt, images, json }) })
      .catch((e) => { throw new AiError('network', String(e?.message ?? e)); });
    if (!r.ok) throw new AiError(r.status === 429 ? 'rate_limited' : 'upstream_error', `AI server returned ${r.status}`);
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
    case 'bad_key': return 'The Gemini API key was rejected. Check it in Settings.';
    case 'invalid_json': return 'The AI answer could not be read. Try again.';
    case 'images_unavailable': return 'This view cannot send images to the AI.';
    case 'cancelled': return 'Stopped.';
    case 'network': return 'Could not reach the AI service from here.';
    default: return 'The AI request failed. Try again.';
  }
}
