import { useId, type ReactNode } from 'react';
import type { ImsAction, ReconStatus, Severity } from '../domain/types';
import { formatINR } from '../lib/format';
import { useMode } from './mode';
import { RECON_SIMPLE, VERDICT, mustFix } from './plain';

const P = { width: 16, height: 16, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const };

export const Icon = {
  overview: () => <svg {...P}><path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z" /></svg>,
  invoices: () => <svg {...P}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6M8 13h8M8 17h5" /></svg>,
  recon: () => <svg {...P}><path d="M7 4v16M17 4v16M3 8l4-4 4 4M13 16l4 4 4-4" /></svg>,
  suppliers: () => <svg {...P}><path d="M3 21V8l6-4 6 4v13M15 21V12h6v9M3 21h18M7 12h4M7 16h4" /></svg>,
  actions: () => <svg {...P}><path d="M9 11l3 3 8-8" /><path d="M20 12v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h9" /></svg>,
  report: () => <svg {...P}><path d="M12 3v12M7 10l5 5 5-5M5 21h14" /></svg>,
  upload: () => <svg {...P}><path d="M12 15V3M7 8l5-5 5 5M5 21h14" /></svg>,
  settings: () => <svg {...P}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></svg>,
  x: () => <svg {...P}><path d="M18 6L6 18M6 6l12 12" /></svg>,
  back: () => <svg {...P}><path d="M15 18l-6-6 6-6" /></svg>,
  next: () => <svg {...P}><path d="M9 18l6-6-6-6" /></svg>,
  alert: () => <svg {...P}><path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01" /></svg>,
  check: () => <svg {...P}><path d="M20 6L9 17l-5-5" /></svg>,
  copy: () => <svg {...P}><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>,
  mail: () => <svg {...P}><rect x="2" y="4" width="20" height="16" rx="2" /><path d="M22 7l-10 6L2 7" /></svg>,
  scan: () => <svg {...P}><path d="M3 7V5a2 2 0 0 1 2-2h2M17 3h2a2 2 0 0 1 2 2v2M21 17v2a2 2 0 0 1-2 2h-2M7 21H5a2 2 0 0 1-2-2v-2M7 12h10" /></svg>,
  pdf: () => <svg {...P}><path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><path d="M14 3v6h6" /></svg>,
  table: () => <svg {...P}><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M3 9h18M3 15h18M9 3v18" /></svg>,
  search: () => <svg {...P}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>,
  learn: () => <svg {...P}><path d="M2 4h7a3 3 0 0 1 3 3v13a2 2 0 0 0-2-2H2zM22 4h-7a3 3 0 0 0-3 3v13a2 2 0 0 1 2-2h8z" /></svg>,
  shield: () => <svg {...P}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><path d="M9 12l2 2 4-4" /></svg>,
  play: () => <svg {...P}><path d="M6 4l14 8-14 8z" /></svg>,
  edit: () => <svg {...P}><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>,
  qr: () => <svg {...P}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></svg>,
  theme: () => <svg {...P}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>,
};

/** The Parakh mark: a jeweller's touchstone (the dark stone) with a gold streak drawn across it.
 *  Rubbing gold on the stone and reading the streak is how jewellers test if gold is real; that test
 *  is called "parakh". The streak is shaped as a tick: the bill passed. */
export function Mark({ size = 28 }: { size?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id={`st${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3a4246" />
          <stop offset="1" stopColor="#1c2124" />
        </linearGradient>
        <linearGradient id={`au${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#a87a22" />
          <stop offset=".55" stopColor="#e3bd62" />
          <stop offset="1" stopColor="#c99b3b" />
        </linearGradient>
      </defs>
      <path d="M6.5 3.2 C 13 1.6, 22 2.2, 27 4.6 C 30.4 6.4, 30.6 13, 30 19.5 C 29.4 25.6, 27.4 29.6, 20.5 30.4 C 13.5 31.2, 6.2 30.6, 3.4 27.2 C 1.2 24.4, 1.2 15, 1.8 10 C 2.2 6.4, 3.6 4, 6.5 3.2 Z" fill={`url(#st${id})`} stroke="rgba(255,255,255,.14)" strokeWidth=".8" />
      <path d="M8.6 16.8 L 13.6 21.6 L 24 10.4" fill="none" stroke={`url(#au${id})`} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.6 19.4 L 13.4 23 L 22.6 13.6" fill="none" stroke="#e3bd62" strokeOpacity=".28" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10.4 15.4 L 13.8 18.6" fill="none" stroke="#fff3d0" strokeOpacity=".45" strokeWidth=".7" strokeLinecap="round" />
    </svg>
  );
}

/** Why the product is called Parakh, in one short card. */
export function NameStory({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`name-story ${compact ? 'compact' : ''}`}>
      <Mark size={compact ? 30 : 40} />
      <div>
        <b>Why “Parakh”? <span className="deva">परख</span></b>
        <span>Jewellers test gold by rubbing it on a black touchstone. The streak it leaves shows whether the gold is real. That test is called <i>parakh</i>. We do the same for your bills: every one is tested before you trust it with your money.</span>
      </div>
    </div>
  );
}

const SEV_LABEL: Record<Severity, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' };
export function SevPill({ s }: { s: Severity }) {
  const mode = useMode();
  if (mode === 'simple') return <span className={`pill square ${mustFix(s) ? 'critical' : 'medium'}`}>{mustFix(s) ? 'Must fix' : 'Good to fix'}</span>;
  return <span className={`pill square ${s}`}>{SEV_LABEL[s]}</span>;
}

const RECON_LABEL: Record<ReconStatus, string> = { matched: 'Matched', suggested: 'Probable match', mismatch: 'Mismatch', 'missing-in-2b': 'Not in 2B', 'missing-in-books': 'Not in books' };
export function ReconPill({ s }: { s: ReconStatus }) {
  const mode = useMode();
  return <span className={`pill ${s}`}><span className="pip" />{mode === 'simple' ? RECON_SIMPLE[s] : RECON_LABEL[s]}</span>;
}
export const reconLabel = (s: ReconStatus) => RECON_LABEL[s];

const IMS_LABEL: Record<ImsAction, string> = { accept: 'Accept', pending: 'Keep pending', reject: 'Reject', 'n/a': 'No action' };
export const ImsPill = ({ a }: { a: ImsAction }) => <span className={`pill ${a === 'n/a' ? 'na' : a}`}>{IMS_LABEL[a]}</span>;
export const imsLabel = (a: ImsAction) => IMS_LABEL[a];

export function RiskMeter({ value, band }: { value: number; band: 'clear' | 'review' | 'high' }) {
  const mode = useMode();
  if (mode === 'simple') return <BandPill band={band} />;
  const color = band === 'high' ? 'var(--crit)' : band === 'review' ? 'var(--med)' : 'var(--ok)';
  return (
    <span className="risk" title={`Risk score ${value} of 100`}>
      <span className="risk-num" style={{ color }}>{value}</span>
      <span className="risk-track"><span className="risk-fill" style={{ width: `${Math.max(4, value)}%`, background: color, display: 'block' }} /></span>
    </span>
  );
}

export const BandPill = ({ band }: { band: 'clear' | 'review' | 'high' }) => (
  <span className={`pill ${band === 'high' ? 'high-risk' : band}`}><span className="pip" />{VERDICT[band].label}</span>
);

export const Money = ({ v, className = '' }: { v: number; className?: string }) => <span className={`num ${className}`}>{formatINR(v)}</span>;

export function Card({ title, right, children, sub }: { title?: ReactNode; right?: ReactNode; children: ReactNode; sub?: ReactNode }) {
  return (
    <section className="card">
      {(title || right) && (
        <div className="card-h">
          {title && <h2>{title}</h2>}
          {sub && <span className="muted" style={{ fontSize: 12 }}>{sub}</span>}
          {right && <div className="right">{right}</div>}
        </div>
      )}
      {children}
    </section>
  );
}

export function Tabs<T extends string>({ value, onChange, items }: { value: T; onChange: (v: T) => void; items: { id: T; label: ReactNode; count?: number }[] }) {
  return (
    <div className="tabs" role="tablist">
      {items.map((i) => (
        <button key={i.id} role="tab" aria-selected={value === i.id} onClick={() => onChange(i.id)}>
          {i.label}
          {i.count != null && <span className="count">{i.count}</span>}
        </button>
      ))}
    </div>
  );
}

export function Spinner() { return <span className="spin" aria-label="Working" />; }
