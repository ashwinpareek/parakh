# Deploying Parakh so judges get AI with zero setup

Judges should open **one link** and have every AI feature work: reading scanned bills, AI review, the
AI line check and supplier emails. They should not need a Claude account or an API key. Do this by
hosting the app on Vercel with your team's key stored on the server (`api/ai.js`). The key never
reaches the browser.

## 1. Get a key (pick one)
- **Gemini (free):** https://aistudio.google.com/apikey → *Create API key*.
- **Claude API:** https://console.anthropic.com → *API keys* (needs credits).

## 2. Deploy
1. Push this folder to a GitHub repository.
2. Go to https://vercel.com → *Add New → Project* → import the repository. Vercel detects Vite;
   keep the defaults (build `npm run build`, output `dist`).
3. Before clicking Deploy, open *Environment Variables* and add **one** of:
   - `GEMINI_API_KEY` = your Gemini key
   - `ANTHROPIC_API_KEY` = your Claude key
4. Deploy. Open `https://<your-app>.vercel.app/api/ai`: it should show `{"ok":true,...}`.
5. Open the app. The sidebar shows **AI: Parakh AI**. Share this link with the judges.

## 3. Test locally first (optional)
Create `.env.local` containing `GEMINI_API_KEY=...`, then `npm run dev`. The dev server serves `/api/ai`.

## How the app picks its AI (automatic)
1. Inside claude.ai: Claude, using the viewer's own account.
2. On your hosted site: **Parakh AI** (`/api/ai`, your team's key). This is the judge path.
3. A personal Gemini key saved in Settings.
4. Nothing reachable: every AI button still works. AI review becomes a summary written from the
   rule checks (English, Telugu or Hindi). Supplier emails use a template in the chosen language.
   The scanned sample bill has a bundled transcription. Each fallback is labelled.

## Limits and safety
- `api/ai.js` allows about 40 requests per visitor every 10 minutes, at most 3 images per request,
  and checks inputs. Free Gemini keys have their own daily limits; a hackathon judging round fits
  comfortably within them.
- Rotate or delete the key after the event.
