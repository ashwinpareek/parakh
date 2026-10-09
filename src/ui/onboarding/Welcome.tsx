import { useEffect, useState } from 'react';
import type { Analysis } from '../../domain/types';
import { formatINR, formatINRCompact } from '../../lib/format';
import { Icon, Mark } from '../kit';
import type { Mode } from '../mode';
import { MISSIONS } from './missions';
import { BrandIntro } from './BrandIntro';

type Role = 'owner' | 'learner' | 'accountant';
type Scene = 'idea' | 'who' | 'basics' | 'try' | 'owner' | 'mission' | 'pro';
export type WelcomeAction = 'mission' | 'upload' | 'skip' | 'workspace';

/** Each role gets its own path after "Who are you?":
 *  - small business: try one bill, then check your own bills (practice is the second option)
 *  - new to GST / judge: a 3-step money lesson, try one bill, then the guided mission
 *  - accountant / CA: what is automated and the law behind it, then straight into the workspace in Expert mode */
const FLOWS: Record<Role, Scene[]> = {
  owner: ['idea', 'who', 'try', 'owner'],
  learner: ['idea', 'who', 'basics', 'try', 'mission'],
  accountant: ['idea', 'who', 'pro'],
};

export function Welcome({ a, onDone }: { a: Analysis | null; onDone: (r: { action: WelcomeAction; mode: Mode }) => void }) {
  const [step, setStep] = useState(0);
  const [intro, setIntro] = useState(true);
  const [role, setRole] = useState<Role | null>(null);
  const mode: Mode = role === 'accountant' ? 'expert' : 'simple';
  const flow = FLOWS[role ?? 'owner'];
  const scene = flow[step];
  const next = () => setStep((s) => Math.min(flow.length - 1, s + 1));
  const back = () => setStep((s) => Math.max(0, s - 1));

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' && (scene !== 'who' || role)) next();
      if (e.key === 'ArrowLeft') back();
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [step, role]); // eslint-disable-line react-hooks/exhaustive-deps

  if (intro) {
    return (
      <div className="welcome intro" role="dialog" aria-modal="true" aria-label="Welcome to Parakh">
        <BrandIntro onDone={() => setIntro(false)} />
      </div>
    );
  }

  const done = (action: WelcomeAction) => onDone({ action, mode });
  return (
    <div className="welcome" role="dialog" aria-modal="true" aria-label="Welcome to Parakh">
      <div className="welcome-top">
        <div className="brand"><Mark size={26} /><span className="brand-name" style={{ color: 'var(--ink)' }}>Parakh</span></div>
        <div className="w-dots" aria-label={`Step ${step + 1} of ${flow.length}`}>
          {flow.map((_, i) => <span key={i} className={i === step ? 'on' : i < step ? 'past' : ''} />)}
        </div>
        <button className="btn ghost sm" onClick={() => done('skip')}>Skip intro</button>
      </div>

      <div className="welcome-stage" key={`${role}-${step}`}>
        {scene === 'idea' && <SceneIdea onNext={next} />}
        {scene === 'who' && <SceneWho role={role} setRole={(r) => { setRole(r); window.setTimeout(() => setStep(2), 320); }} />}
        {scene === 'basics' && <SceneBasics onNext={next} />}
        {scene === 'try' && <SceneTry onNext={next} role={role} />}
        {scene === 'owner' && <SceneOwner onUpload={() => done('upload')} onPractice={() => done('mission')} />}
        {scene === 'mission' && <SceneMission a={a} onStart={() => done('mission')} onUpload={() => done('upload')} />}
        {scene === 'pro' && <ScenePro a={a} onOpen={() => done('workspace')} onUpload={() => done('upload')} />}
      </div>

      <div className="welcome-foot">
        {step > 0 ? <button className="btn ghost" onClick={back}><Icon.back /> Back</button> : <span />}
      </div>
    </div>
  );
}

/** Small item pictures for the opening cards. */
const ITEM_ICON: Record<string, JSX.Element> = {
  steel: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round"><path d="M3 8l9-4 9 4-9 4z" /><path d="M3 12l9 4 9-4" /><path d="M3 16l9 4 9-4" /></svg>,
  tools: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.4-.6-.6-2.4z" /></svg>,
  box: <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round"><path d="M21 8l-9-5-9 5v8l9 5 9-5z" /><path d="M3 8l9 5 9-5M12 13v8" /></svg>,
};

function SceneIdea({ onNext }: { onNext: () => void }) {
  return (
    <div className="scene scene-idea">
      <div className="scene-copy">
        <span className="eyebrow">1 minute intro</span>
        <h1>Every business bill hides money you can get back.</h1>
        <p>When your business buys something, the supplier adds <b>GST</b> to the bill. The government lets you take that GST back, but <b>only if the bill is correct</b>. Parakh checks every bill for you.</p>
        <button className="btn primary lg" onClick={onNext}>Show me how <Icon.next /></button>
      </div>
      <div className="idea-visual" aria-hidden="true">
        {[
          { name: 'Steel bars', from: 'Deccan Steel, Hyderabad', icon: 'steel', gst: '₹33,409', ok: true },
          { name: 'Cutting tools', from: 'Pune Toolcraft, Pune', icon: 'tools', gst: '₹25,830', ok: true },
          { name: 'Packing boxes', from: 'Kakatiya Packaging, Warangal', icon: 'box', gst: '₹16,641', ok: false },
        ].map((b, i) => (
          <div key={b.name} className={`mini-bill ${b.ok ? 'ok' : 'bad'}`} style={{ animationDelay: `${0.15 + i * 0.35}s` }}>
            <span className="mb-icon">{ITEM_ICON[b.icon]}</span>
            <span className="mb-name">{b.name}<small>{b.from}</small></span>
            <span className="mb-gst">GST {b.gst}</span>
            <span className="mb-stamp" style={{ animationDelay: `${1.3 + i * 0.35}s` }}>{b.ok ? 'Back to you' : 'Stuck'}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function SceneWho({ role, setRole }: { role: Role | null; setRole: (r: Role) => void }) {
  const opts: { id: Role; title: string; sub: string; icon: () => JSX.Element }[] = [
    { id: 'owner', title: 'I run or work in a small business', sub: 'Explain things simply and tell me what to do.', icon: Icon.suppliers },
    { id: 'learner', title: 'I’m new to GST, just exploring', sub: 'Teach me as I go. I’m a student or a judge.', icon: Icon.learn },
    { id: 'accountant', title: 'I’m an accountant or CA', sub: 'Show legal references, rule IDs and risk scores.', icon: Icon.shield },
  ];
  return (
    <div className="scene scene-who">
      <div className="scene-copy center">
        <span className="eyebrow">So we explain things at the right level</span>
        <h1>Who are you?</h1>
      </div>
      <div className="who-grid">
        {opts.map((o) => (
          <button key={o.id} className={`who ${role === o.id ? 'on' : ''}`} onClick={() => setRole(o.id)} aria-pressed={role === o.id}>
            <span className="who-icon"><o.icon /></span>
            <b>{o.title}</b>
            <span>{o.sub}</span>
          </button>
        ))}
      </div>
      <p className="muted center" style={{ fontSize: 12.5 }}>You can switch between Simple and Expert any time, top right.</p>
    </div>
  );
}

const CHECKS = [
  { label: 'Supplier’s GST number is real', ok: true },
  { label: 'Your GST number is on the bill', ok: true },
  { label: 'Quantity × price adds up', ok: true },
  { label: 'Right type of GST charged', ok: false },
];

function SceneTry({ onNext, role }: { onNext: () => void; role: Role | null }) {
  const [shown, setShown] = useState(-1);
  const running = shown >= 0 && shown < CHECKS.length;
  const finished = shown >= CHECKS.length;
  const start = () => {
    setShown(0);
    CHECKS.forEach((_, i) => window.setTimeout(() => setShown(i + 1), 650 * (i + 1)));
  };
  return (
    <div className="scene scene-try">
      <div className="scene-copy">
        <span className="eyebrow">Try it yourself</span>
        <h1>Check this bill.</h1>
        <p>A packaging supplier in Warangal sent this bill to a factory in Hanamkonda. Both are in Telangana. Can the factory get its GST back?</p>
        {!running && !finished && <button className="btn primary lg" onClick={start}><Icon.scan /> Check this bill</button>}
        <ul className="try-checks" aria-live="polite">
          {CHECKS.map((c, i) => (
            <li key={c.label} className={i < shown ? (c.ok ? 'ok' : 'bad') : i === shown ? 'busy' : ''}>
              <span className="tc-dot">{i < shown ? (c.ok ? <Icon.check /> : <Icon.x />) : null}</span>
              {c.label}
            </li>
          ))}
        </ul>
        {finished && (
          <div className="try-result">
            <b>No, not yet. {formatINR(16641)} is stuck.</b>
            <span>Both businesses are in Telangana, so the bill should split GST into CGST + SGST. It charged IGST, which is only for sales between states. The supplier must issue a corrected bill.</span>
            <span className="muted">{role === 'learner' ? 'You just did what Parakh does: check a bill before trusting it. It runs 40+ checks like these on every bill, in seconds.' : 'Parakh runs 40+ checks like these on every bill you upload, in seconds.'}</span>
            <button className="btn primary" onClick={onNext} style={{ justifySelf: 'start', marginTop: 6 }}>Continue <Icon.next /></button>
          </div>
        )}
      </div>
      <div className={`paper ${shown > 0 ? 'scanning' : ''} ${finished ? 'done' : ''}`} aria-label="Sample bill from Kakatiya Packaging Solutions">
        <div className="paper-head"><b>Kakatiya Packaging Solutions</b><span>TAX INVOICE</span></div>
        <div className="paper-row"><span>From</span><span>Warangal, Telangana</span></div>
        <div className={`paper-row ${shown >= 1 ? 'hit-ok' : ''}`}><span>GSTIN</span><span className="mono">36ABDFK5520H1ZH</span></div>
        <div className="paper-row"><span>Bill to</span><span>Hanamkonda, Telangana</span></div>
        <div className={`paper-row ${shown >= 2 ? 'hit-ok' : ''}`}><span>Your GSTIN</span><span className="mono">36AAKCS4821M1ZX</span></div>
        <div className="paper-table">
          <div className={shown >= 3 ? 'hit-ok' : ''}><span>Corrugated boxes · 1,200 × ₹48</span><span>₹57,600</span></div>
          <div className={shown >= 3 ? 'hit-ok' : ''}><span>Stretch film · 85 × ₹410</span><span>₹34,850</span></div>
        </div>
        <div className="paper-row"><span>Taxable value</span><span>₹92,450</span></div>
        <div className={`paper-row strong ${shown >= 4 ? 'hit-bad' : ''}`}><span>IGST 18%</span><span>₹16,641</span></div>
        <div className="paper-row total"><span>Total</span><span>₹1,09,091</span></div>
        <div className="scan-line" />
      </div>
    </div>
  );
}

function SceneMission({ a, onStart, onUpload }: { a: Analysis | null; onStart: () => void; onUpload: () => void }) {
  return (
    <div className="scene scene-mission">
      <div className="scene-copy">
        <span className="eyebrow">Your mission</span>
        <h1>Be the accountant for a day.</h1>
        <p>
          You look after the GST for <b>Sri Venkateswara Precision Components</b>, a practice factory in Hanamkonda with {a ? a.totals.invoices : 30} sample bills from September.
          {' '}It is 9 October. The deadline is in <b>5 days</b>. Find the bills with problems{a ? <> and save as much of the <b>{formatINRCompact(a.totals.itcClaimed)}</b> as you can</> : ''}.
        </p>
        <div className="mission-actions">
          <button className="btn primary lg" onClick={onStart}><Icon.play /> Start the mission</button>
          <button className="btn lg" onClick={onUpload}><Icon.upload /> Use my own bills instead</button>
        </div>
        <p className="muted" style={{ fontSize: 12.5 }}>Seven short missions, about 3 minutes. Each one shows you one thing Parakh does. The company and bills are made up for practice.</p>
      </div>
      <ol className="mission-preview">
        {MISSIONS.map((m, i) => (
          <li key={m.id} style={{ animationDelay: `${0.08 * i}s` }}><span>{i + 1}</span>{m.title}</li>
        ))}
      </ol>
    </div>
  );
}

/** For people new to GST: the money logic in three animated steps. */
function SceneBasics({ onNext }: { onNext: () => void }) {
  const steps = [
    { n: '₹50,000', label: 'GST you collected', sub: 'from your customers on this month’s sales', tone: 'ink' },
    { n: '− ₹42,000', label: 'GST you already paid', sub: 'to suppliers, shown on their bills', tone: 'ok' },
    { n: '= ₹8,000', label: 'All you send the government', sub: 'because the GST on your bills is credited back', tone: 'accent' },
  ];
  return (
    <div className="scene scene-basics">
      <div className="scene-copy">
        <span className="eyebrow">GST in 30 seconds</span>
        <h1>You only pay the difference.</h1>
        <p>The GST on your purchase bills is subtracted from the GST you owe. That subtraction is called <b>input tax credit</b>. But a bill with a mistake cannot be subtracted, so you pay more. That is the problem Parakh solves.</p>
        <button className="btn primary lg" onClick={onNext}>Now try checking a bill <Icon.next /></button>
      </div>
      <div className="basics-sum" aria-label="Example: ₹50,000 collected minus ₹42,000 paid equals ₹8,000 to pay">
        {steps.map((st, i) => (
          <div key={st.label} className={`bs-row ${st.tone}`} style={{ animationDelay: `${0.2 + i * 0.55}s` }}>
            <span className="bs-n">{st.n}</span>
            <span className="bs-l"><b>{st.label}</b><small>{st.sub}</small></span>
          </div>
        ))}
        <div className="bs-warn" style={{ animationDelay: '2s' }}>If one ₹16,641 bill is wrong, you pay <b>₹24,641</b> instead.</div>
      </div>
    </div>
  );
}

/** For business owners: their own bills come first, practice is the alternative. */
function SceneOwner({ onUpload, onPractice }: { onUpload: () => void; onPractice: () => void }) {
  const steps = [
    { t: 'Add your purchase bills', d: 'PDFs, scans or phone photos. A Tally or Excel register works too.' },
    { t: 'Add your GSTR-2B (optional)', d: 'The list your suppliers reported, downloaded from the GST portal.' },
    { t: 'See what is safe and what is stuck', d: 'In rupees, with what to fix and a message to send each supplier.' },
  ];
  return (
    <div className="scene scene-owner">
      <div className="scene-copy">
        <span className="eyebrow">For your business</span>
        <h1>Check your own bills in three steps.</h1>
        <p>Everything runs in your browser. Your bills are not uploaded anywhere unless you choose to let AI read a scanned one.</p>
        <div className="mission-actions">
          <button className="btn primary lg" onClick={onUpload}><Icon.upload /> Check my bills</button>
          <button className="btn lg" onClick={onPractice}><Icon.play /> Practise on sample bills first</button>
        </div>
      </div>
      <ol className="owner-steps">
        {steps.map((st, i) => (
          <li key={st.t} style={{ animationDelay: `${0.1 + i * 0.12}s` }}><span>{i + 1}</span><div><b>{st.t}</b><small>{st.d}</small></div></li>
        ))}
      </ol>
    </div>
  );
}

/** For accountants and CAs: what is automated, with the law behind it, then the workspace. */
function ScenePro({ a, onOpen, onUpload }: { a: Analysis | null; onOpen: () => void; onUpload: () => void }) {
  const items = [
    ['Rule 46 particulars', 'Every mandatory field, HSN length, signature'],
    ['GSTIN', 'Format, base-36 checksum, state, registration status'],
    ['Tax head and POS', 'IGST vs CGST + SGST, Sec 16(2)(b) place of supply'],
    ['Rates after GST 2.0', 'Legacy 12% / 28% and HSN-wise rate checks'],
    ['ITC eligibility', 'Sec 17(5), Sec 16(4) time limit, Rule 37 180 days'],
    ['E-invoice', 'IRN presence, signed QR verified against the print'],
    ['GSTR-2B', 'Fuzzy matching on number, GSTIN, date and value'],
    ['Filing', 'IMS accept / pending / reject and GSTR-3B Table 4 draft'],
  ];
  return (
    <div className="scene scene-pro">
      <div className="scene-copy">
        <span className="eyebrow">For accountants and CAs</span>
        <h1>The month-end checks, done before you open the file.</h1>
        <p>Expert mode is on: citations, rule IDs and risk scores on every finding. The sample workspace has {a ? a.totals.invoices : 30} bills with planted problems, already checked.</p>
        <div className="mission-actions">
          <button className="btn primary lg" onClick={onOpen}><Icon.overview /> Open the sample workspace</button>
          <button className="btn lg" onClick={onUpload}><Icon.upload /> Upload a client’s bills</button>
        </div>
      </div>
      <div className="pro-grid">
        {items.map(([t, d], i) => (
          <div key={t} style={{ animationDelay: `${0.05 * i}s` }}><span className="pro-tick"><Icon.check /></span><b>{t}</b><small>{d}</small></div>
        ))}
      </div>
    </div>
  );
}
