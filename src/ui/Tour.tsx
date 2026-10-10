import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Analysis } from '../domain/types';
import type { Route } from './App';
import { Icon } from './kit';

export interface Step { route: (a: Analysis) => Route | null; selector: string; title: string; body: string }

const byRule = (a: Analysis, rule: string) => a.findings.find((f) => f.ruleId === rule)?.invoiceId;

export const STEPS: Step[] = [
  { route: () => ({ view: 'overview' }), selector: '[data-tour="headline"]', title: 'Start with the answer', body: 'How much of the GST you paid suppliers you can safely get back this month, and how much is stuck on bills with problems.' },
  { route: () => ({ view: 'overview' }), selector: '[data-tour="timeline"]', title: 'The deadlines that matter', body: 'Suppliers report by the 11th, decisions lock on the 14th, you file on the 20th. Parakh shows where you are today.' },
  { route: () => ({ view: 'overview' }), selector: '[data-tour="ledger"]', title: 'Every rupee accounted for', body: 'Green is safe to claim. Red is stuck until a bill is fixed. Underlined words explain themselves when you hover or tap them.' },
  { route: (a) => { const id = byRule(a, 'TAX-HEAD-IGST') ?? Object.values(a.verdicts).sort((x, y) => y.risk - x.risk)[0]?.invoiceId; return id ? { view: 'invoice', id } : null; }, selector: '[data-tour="doc"]', title: 'See the problem on the bill itself', body: 'Parakh reads the bill and highlights exactly where the problem is. Here the supplier charged the wrong kind of GST.' },
  { route: (a) => { const id = byRule(a, 'TAX-HEAD-IGST'); return id ? { view: 'invoice', id } : null; }, selector: '[data-tour="findings"]', title: 'What is wrong, why it matters, what to do', body: 'Each problem is explained in plain words, with the rupees at stake and the next step. Switch to Expert mode for the legal references.' },
  { route: (a) => { const id = byRule(a, 'EINV-QR-MISMATCH'); return id ? { view: 'invoice', id } : null; }, selector: '[data-tour="qr"]', title: 'Catches edited bills', body: 'The QR code on an e-invoice is signed by the government. Parakh checks the signature and compares it with the print. This bill was changed after it was registered.' },
  { route: () => ({ view: 'recon' }), selector: '[data-tour="recon"]', title: 'Compared with what suppliers reported', body: 'Your bills are matched with the government’s list (GSTR-2B), even when numbers are written differently. Anything missing or different shows up here.' },
  { route: () => ({ view: 'suppliers' }), selector: '[data-tour="followup"]', title: 'Get it fixed', body: 'One click drafts the email or WhatsApp to the supplier, listing exactly what to correct, in English, Telugu or Hindi.' },
  { route: () => ({ view: 'actions' }), selector: '[data-tour="table4"]', title: 'Know exactly what to file', body: 'What to accept or reject on the GST portal, and the credit figures for this month’s return.' },
];

interface Box { left: number; top: number; width: number; height: number }
const GAP = 14;
const PAD = 6;

/** Put the card next to the highlighted area, never on top of it. Tries right, left, below, above;
 *  if nothing fits, uses the viewport corner that overlaps the target least. */
function placeCard(t: Box | null, w: number, h: number, vw: number, vh: number): { left: number; top: number } {
  const clampX = (x: number) => Math.max(12, Math.min(x, vw - w - 12));
  const clampY = (y: number) => Math.max(12, Math.min(y, vh - h - 12));
  if (!t) return { left: (vw - w) / 2, top: (vh - h) / 2 };
  const cands = [
    { left: t.left + t.width + GAP, top: clampY(t.top), ok: t.left + t.width + GAP + w <= vw - 12 },
    { left: t.left - GAP - w, top: clampY(t.top), ok: t.left - GAP - w >= 12 },
    { left: clampX(t.left), top: t.top + t.height + GAP, ok: t.top + t.height + GAP + h <= vh - 12 },
    { left: clampX(t.left), top: t.top - GAP - h, ok: t.top - GAP - h >= 12 },
  ];
  const fit = cands.find((c) => c.ok);
  if (fit) return { left: fit.left, top: fit.top };
  const overlap = (x: number, y: number) => Math.max(0, Math.min(x + w, t.left + t.width) - Math.max(x, t.left)) * Math.max(0, Math.min(y + h, t.top + t.height) - Math.max(y, t.top));
  const corners = [[vw - w - 16, vh - h - 16], [16, vh - h - 16], [vw - w - 16, 16], [16, 16]];
  const best = corners.sort((p, q) => overlap(p[0], p[1]) - overlap(q[0], q[1]))[0];
  return { left: best[0], top: best[1] };
}

export function Tour({ a, step, setStep, go, steps: custom, finishLabel = 'Finish' }: { a: Analysis; step: number; setStep: (n: number | null) => void; go: (r: Route) => void; steps?: Step[]; finishLabel?: string }) {
  const steps = (custom ?? STEPS).filter((s) => s.route(a));
  const s = steps[step];
  const [target, setTarget] = useState<Box | null>(null);
  const [tracking, setTracking] = useState(false);
  const [cardH, setCardH] = useState(190);
  const card = useRef<HTMLDivElement>(null);
  const el = useRef<HTMLElement | null>(null);

  const measure = () => {
    if (!el.current || !el.current.isConnected) return null;
    const r = el.current.getBoundingClientRect();
    const vh = window.innerHeight;
    const top = Math.max(8, r.top - PAD);
    return { left: r.left - PAD, top, width: r.width + PAD * 2, height: Math.min(r.bottom + PAD, vh - 8) - top };
  };

  // Navigate, wait until the target has rendered and stopped changing size (PDF pages and
  // tables settle a few frames later), scroll it into place instantly, then let the highlight
  // glide there in one move. Scroll events are ignored while a step is settling, so the
  // highlight never chases intermediate layouts.
  const settling = useRef(false);
  useEffect(() => {
    if (!s) return;
    settling.current = true;
    go(s.route(a)!);
    let raf = 0;
    const t0 = performance.now();
    let last = '';
    let stable = 0;
    const tick = () => {
      const node = document.querySelector(s.selector) as HTMLElement | null;
      const waited = performance.now() - t0;
      if (!node) {
        if (waited < 3000) raf = requestAnimationFrame(tick);
        return;
      }
      const r = node.getBoundingClientRect();
      const sig = `${Math.round(r.width)}x${Math.round(r.height)}`;
      stable = sig === last ? stable + 1 : 0;
      last = sig;
      if (stable < 6 && waited < 1200) { raf = requestAnimationFrame(tick); return; }
      el.current = node;
      const fits = r.height < window.innerHeight * 0.8;
      if (r.top < 70 || r.bottom > window.innerHeight - 20) node.scrollIntoView({ block: fits ? 'center' : 'start', behavior: 'instant' as ScrollBehavior });
      raf = requestAnimationFrame(() => {
        setTracking(false);
        setTarget(measure());
        window.setTimeout(() => { settling.current = false; }, 450);
      });
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [step]); // eslint-disable-line react-hooks/exhaustive-deps

  // Follow the target without animation while the user scrolls or resizes.
  useEffect(() => {
    let idle = 0;
    const follow = () => {
      if (settling.current) return;
      const m = measure();
      if (!m) return;
      setTracking(true);
      setTarget(m);
      window.clearTimeout(idle);
      idle = window.setTimeout(() => setTracking(false), 160);
    };
    window.addEventListener('resize', follow);
    window.addEventListener('scroll', follow, { passive: true });
    return () => { window.removeEventListener('resize', follow); window.removeEventListener('scroll', follow); window.clearTimeout(idle); };
  }, []);

  useLayoutEffect(() => { if (card.current) setCardH(card.current.offsetHeight); }, [step]);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setStep(null);
      if (e.key === 'ArrowRight') setStep(step < steps.length - 1 ? step + 1 : null);
      if (e.key === 'ArrowLeft' && step > 0) setStep(step - 1);
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [step, steps.length, setStep]);

  if (!s) return null;
  const vw = window.innerWidth, vh = window.innerHeight;
  const cardW = Math.min(340, vw - 24);
  const pos = placeCard(target, cardW, cardH, vw, vh);
  const motion = tracking ? 'tour-still' : '';

  return (
    <>
      <div className={`tour-hole ${motion} ${target ? '' : 'hidden'}`} style={target ? { transform: `translate(${target.left}px, ${target.top}px)`, width: target.width, height: target.height } : undefined} />
      <div ref={card} className={`tour-card ${motion}`} role="dialog" aria-modal="true" aria-labelledby="tour-t" style={{ transform: `translate(${pos.left}px, ${pos.top}px)`, width: cardW }}>
        {steps.length > 1 && <div className="tour-progress" aria-hidden="true"><span style={{ width: `${((step + 1) / steps.length) * 100}%` }} /></div>}
        {steps.length > 1 && <span className="eyebrow">Step {step + 1} of {steps.length}</span>}
        <div key={step} className="tour-copy">
          <h3 id="tour-t">{s.title}</h3>
          <p>{s.body}</p>
        </div>
        <div className="tour-foot">
          {steps.length > 1 && <button className="btn ghost sm" onClick={() => setStep(null)}>Skip tour</button>}
          <span className="n" />
          {step > 0 && <button className="btn sm" aria-label="Previous step" onClick={() => setStep(step - 1)}><Icon.back /></button>}
          <button className="btn primary sm" autoFocus onClick={() => setStep(step < steps.length - 1 ? step + 1 : null)}>{step < steps.length - 1 ? 'Next' : finishLabel}</button>
        </div>
      </div>
    </>
  );
}
