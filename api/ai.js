// Parakh AI proxy (Vercel serverless function).
// Lets every visitor use the AI features with the TEAM's key, so judges need no account or setup.
// The key lives only in the server environment and is never sent to the browser.
//
// Environment (set one in Vercel → Project → Settings → Environment Variables):
//   GEMINI_API_KEY      free key from Google AI Studio (default provider)
//   ANTHROPIC_API_KEY   Claude API key (used if set)
//   AI_MODEL            optional model override (tried first)
//
// GET  /api/ai           → { ok, provider }                      (the app calls this to see if AI is available)
// GET  /api/ai?check=1   → { ok, provider, model, ms } or { ok:false, error, detail }   (live self-test)
// POST /api/ai           → { text, model }   body: { prompt, images?: [{ mime, data(base64) }], json?: boolean }

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 40;
const CALL_TIMEOUT_MS = 40_000;
const hits = new Map(); // best-effort per-instance rate limit

// Tried in order. A model that is unknown, overloaded or out of free quota falls through to the next.
const GEMINI_MODELS = [process.env.AI_MODEL, 'gemini-2.5-flash', 'gemini-flash-latest', 'gemini-2.5-flash-lite', 'gemini-2.0-flash'].filter(Boolean);
const CLAUDE_MODELS = [process.env.AI_MODEL, 'claude-haiku-5-5', 'claude-sonnet-5-5'].filter(Boolean);

function provider() {
  if (process.env.ANTHROPIC_API_KEY) return 'claude';
  if (process.env.GEMINI_API_KEY) return 'gemini';
  return null;
}

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > MAX_PER_WINDOW;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const scrub = (s) => String(s ?? '').replace(/key=[^&\s"]+/g, 'key=***').replace(/AIza[0-9A-Za-z_-]{20,}/g, '***').replace(/sk-ant-[0-9A-Za-z_-]+/g, '***').slice(0, 300);

class UpstreamError extends Error {
  constructor(status, detail) { super(`upstream ${status}`); this.status = status; this.detail = detail; }
}

async function post(url, headers, body) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), CALL_TIMEOUT_MS);
  try {
    const r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal: ctl.signal });
    const text = await r.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* not JSON */ }
    if (!r.ok) throw new UpstreamError(r.status, scrub(data?.error?.message ?? text));
    return data;
  } catch (e) {
    if (e instanceof UpstreamError) throw e;
    throw new UpstreamError(e?.name === 'AbortError' ? 504 : 502, scrub(e?.name === 'AbortError' ? 'The AI model took too long to answer.' : e?.message));
  } finally { clearTimeout(t); }
}

async function geminiOnce(model, prompt, images, json) {
  const parts = [{ text: prompt }, ...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } }))];
  const generationConfig = { temperature: 0.1, ...(json ? { responseMimeType: 'application/json' } : {}) };
  // 2.5 models "think" by default, which makes simple extraction slow. Turn it off where supported.
  if (/^gemini-2\.5-flash/.test(model)) generationConfig.thinkingConfig = { thinkingBudget: 0 };
  const d = await post(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    { 'content-type': 'application/json', 'x-goog-api-key': process.env.GEMINI_API_KEY },
    { contents: [{ role: 'user', parts }], generationConfig },
  );
  const cand = d?.candidates?.[0];
  const text = (cand?.content?.parts ?? []).map((p) => p.text ?? '').join('');
  if (!text) throw new UpstreamError(502, scrub(d?.promptFeedback?.blockReason ? `Blocked: ${d.promptFeedback.blockReason}` : `Empty answer (${cand?.finishReason ?? 'no candidates'})`));
  return text;
}

async function claudeOnce(model, prompt, images, json) {
  const content = [
    ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })),
    { type: 'text', text: json ? `${prompt}\n\nReply with the JSON only, no other text.` : prompt },
  ];
  const d = await post(
    'https://api.anthropic.com/v1/messages',
    { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    { model, max_tokens: 4000, messages: [{ role: 'user', content }] },
  );
  return (d?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

/** Try each model; retry a busy model once; skip models that do not exist or are out of quota. */
async function complete(p, prompt, images, json) {
  const models = p === 'claude' ? CLAUDE_MODELS : GEMINI_MODELS;
  const once = p === 'claude' ? claudeOnce : geminiOnce;
  let last = new UpstreamError(502, 'No model answered.');
  for (const model of [...new Set(models)]) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        return { text: await once(model, prompt, images, json), model };
      } catch (e) {
        last = e;
        if (e.status === 401 || e.status === 403) throw e; // bad key: no model will work
        if (e.status === 400 && !/model|not found|not supported/i.test(e.detail ?? '')) throw e; // bad request
        const busy = e.status === 503 || e.status === 500 || e.status === 529;
        if (busy && attempt === 0) { await sleep(1200); continue; }
        break; // 404 unknown model, 429 quota, timeout, or still busy → next model
      }
    }
  }
  throw last;
}

function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

function errorCode(e) {
  if (e.status === 401 || e.status === 403) return 'bad_key';
  if (e.status === 429) return 'rate_limited';
  if (e.status === 504) return 'timeout';
  return 'upstream_error';
}

export default async function handler(req, res) {
  res.setHeader('cache-control', 'no-store');
  const p = provider();
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';

  if (req.method === 'GET') {
    if (!req.query?.check) return res.status(200).json({ ok: !!p, provider: p });
    if (!p) return res.status(200).json({ ok: false, error: 'not_configured', detail: 'No GEMINI_API_KEY or ANTHROPIC_API_KEY set.' });
    if (limited(ip)) return res.status(429).json({ ok: false, error: 'rate_limited' });
    const t0 = Date.now();
    try {
      const r = await complete(p, 'Reply with the single word OK.', [], false);
      return res.status(200).json({ ok: true, provider: p, model: r.model, ms: Date.now() - t0, reply: r.text.trim().slice(0, 20) });
    } catch (e) {
      return res.status(200).json({ ok: false, provider: p, error: errorCode(e), status: e.status, detail: e.detail });
    }
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!p) return res.status(503).json({ error: 'not_configured' });
  if (limited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const { prompt, images = [], json = false } = readBody(req);
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 80000) return res.status(400).json({ error: 'bad_prompt' });
  if (!Array.isArray(images) || images.length > 3) return res.status(400).json({ error: 'too_many_images' });
  for (const i of images) {
    if (!/^image\/(jpeg|png|webp)$/.test(i?.mime) || typeof i?.data !== 'string' || i.data.length > 3_000_000) return res.status(400).json({ error: 'bad_image' });
  }

  try {
    const r = await complete(p, prompt, images, json);
    return res.status(200).json({ text: r.text, provider: p, model: r.model });
  } catch (e) {
    const code = errorCode(e);
    return res.status(code === 'rate_limited' ? 429 : code === 'timeout' ? 504 : 502).json({ error: code, detail: e.detail });
  }
}

export const config = { maxDuration: 60 };
