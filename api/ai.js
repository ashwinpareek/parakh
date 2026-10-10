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
const CALL_TIMEOUT_MS = 25_000;
const hits = new Map(); // best-effort per-instance rate limit

// Fallback list if model discovery fails. Google retires model names often, so the live list
// (discoverGemini) is tried first and these only fill in.
const GEMINI_STATIC = ['gemini-2.5-flash', 'gemini-2.5-flash-lite']; // used only when discovery returns nothing
let lastGood = null; // the model that answered most recently is tried first
const DEADLINE_MS = 52_000; // stay inside the 60 s function limit
let geminiCache = { at: 0, list: [] };

/** Ask Google which Flash models this key can use right now, newest first. Cached for an hour. */
async function discoverGemini() {
  if (Date.now() - geminiCache.at < 3_600_000 && geminiCache.list.length) return geminiCache.list;
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 6000);
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': process.env.GEMINI_API_KEY }, signal: ctl.signal });
    clearTimeout(t);
    if (!r.ok) return [];
    const d = await r.json();
    const ver = (n) => { const m = n.match(/gemini-(\d+(?:\.\d+)?)/); return m ? parseFloat(m[1]) : 0; };
    const list = (d.models ?? [])
      .filter((m) => (m.supportedGenerationMethods ?? []).includes('generateContent'))
      .map((m) => String(m.name).replace(/^models\//, ''))
      .filter((n) => /^gemini-[\d.]+-flash/.test(n) && !/image|tts|audio|live|embed|exp|thinking/.test(n))
      .sort((a, b) => ver(b) - ver(a) || Number(/lite/.test(a)) - Number(/lite/.test(b)) || Number(/preview/.test(a)) - Number(/preview/.test(b)) || a.length - b.length);
    geminiCache = { at: Date.now(), list };
    return list;
  } catch { return []; }
}
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
  const models = p === 'claude' ? CLAUDE_MODELS
    : await (async () => { const live = await discoverGemini(); return [process.env.AI_MODEL, lastGood, ...(live.length ? live.slice(0, 6) : GEMINI_STATIC)].filter(Boolean); })();
  const once = p === 'claude' ? claudeOnce : geminiOnce;
  const start = Date.now(); const tried = [];
  let last = new UpstreamError(502, 'No model answered.');
  for (const model of [...new Set(models)]) {
    if (Date.now() - start > DEADLINE_MS - 8000) break;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const text = await once(model, prompt, images, json); if (p === 'gemini') lastGood = model; return { text, model };
      } catch (e) {
        last = e; tried.push(`${model}: ${e.status}`);
        if (e.status === 401 || e.status === 403) throw e; // bad key: no model will work
        if (e.status === 400 && !/model|not found|not supported/i.test(e.detail ?? '')) throw e; // bad request
        const busy = e.status === 503 || e.status === 500 || e.status === 529;
        if (busy && attempt === 0) { await sleep(1200); continue; }
        break; // 404 unknown model, 429 quota, timeout, or still busy → next model
      }
    }
  }
  if (tried.length > 1) last.detail = `${last.detail} (tried ${tried.join(', ')})`.slice(0, 400);
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
    const check = req.query?.check ?? new URL(req.url ?? '/', 'http://x').searchParams.get('check');
    if (!check) return res.status(200).json({ ok: !!p, provider: p, v: 2 });
    if (!p) return res.status(200).json({ ok: false, error: 'not_configured', detail: 'No GEMINI_API_KEY or ANTHROPIC_API_KEY set.' });
    if (limited(ip)) return res.status(429).json({ ok: false, error: 'rate_limited' });
    const t0 = Date.now();
    try {
      // ?check=image runs the same path as reading a scanned bill: an image plus JSON output.
      const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4//8/AAX+Av4N70a4AAAAAElFTkSuQmCC';
      const r = check === 'image'
        ? await complete(p, 'Describe this image in one word. Reply with only JSON: {"word": string}', [{ mime: 'image/png', data: PNG }], true)
        : await complete(p, 'Reply with the single word OK.', [], false);
      return res.status(200).json({ ok: true, provider: p, model: r.model, ms: Date.now() - t0, reply: r.text.trim().slice(0, 20), available: p === 'gemini' ? (await discoverGemini()).slice(0, 6) : undefined });
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
