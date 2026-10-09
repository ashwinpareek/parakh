// Parakh AI proxy (Vercel serverless function).
// Lets every visitor use the AI features with the TEAM's key, so judges need no account or setup.
// The key lives only in the server environment and is never sent to the browser.
//
// Environment (set one in Vercel → Project → Settings → Environment Variables):
//   GEMINI_API_KEY      free key from Google AI Studio (default provider)
//   ANTHROPIC_API_KEY   Claude API key (used if set)
//   AI_MODEL            optional model override
//
// GET  /api/ai  → { ok, provider }            (the app calls this to see if AI is available)
// POST /api/ai  → { text }                    body: { prompt, images?: [{ mime, data(base64) }], json?: boolean }

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 40;
const hits = new Map(); // best-effort per-instance rate limit

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

async function callGemini(prompt, images, json) {
  const model = process.env.AI_MODEL || 'gemini-2.5-flash';
  const parts = [{ text: prompt }, ...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.data } }))];
  const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.1, ...(json ? { responseMimeType: 'application/json' } : {}) } }),
  });
  if (!r.ok) throw Object.assign(new Error(`Gemini ${r.status}`), { status: r.status });
  const d = await r.json();
  return (d?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('');
}

async function callClaude(prompt, images, json) {
  const model = process.env.AI_MODEL || 'claude-haiku-5-5';
  const content = [
    ...images.map((i) => ({ type: 'image', source: { type: 'base64', media_type: i.mime, data: i.data } })),
    { type: 'text', text: json ? `${prompt}\n\nReply with the JSON only, no other text.` : prompt },
  ];
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model, max_tokens: 4000, messages: [{ role: 'user', content }] }),
  });
  if (!r.ok) throw Object.assign(new Error(`Claude ${r.status}`), { status: r.status });
  const d = await r.json();
  return (d?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
}

export default async function handler(req, res) {
  const p = provider();
  if (req.method === 'GET') return res.status(200).json({ ok: !!p, provider: p });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' });
  if (!p) return res.status(503).json({ error: 'not_configured' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'rate_limited' });

  const { prompt, images = [], json = false } = req.body ?? {};
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 80000) return res.status(400).json({ error: 'bad_prompt' });
  if (!Array.isArray(images) || images.length > 3) return res.status(400).json({ error: 'too_many_images' });
  for (const i of images) {
    if (!/^image\/(jpeg|png|webp)$/.test(i?.mime) || typeof i?.data !== 'string' || i.data.length > 4_500_000) return res.status(400).json({ error: 'bad_image' });
  }

  try {
    const text = p === 'claude' ? await callClaude(prompt, images, json) : await callGemini(prompt, images, json);
    return res.status(200).json({ text, provider: p });
  } catch (e) {
    return res.status(e.status === 429 ? 429 : 502).json({ error: e.status === 429 ? 'rate_limited' : 'upstream_error' });
  }
}

export const config = { api: { bodyParser: { sizeLimit: '12mb' } }, maxDuration: 60 };
