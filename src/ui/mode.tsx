import { createContext, useContext, useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { GLOSSARY } from './glossary';

export type Mode = 'simple' | 'expert';
export const ModeContext = createContext<Mode>('simple');
export const useMode = () => useContext(ModeContext);

/** A GST term with a dotted underline. Hover, focus or tap shows its plain-language meaning. */
export function T({ k, children }: { k: keyof typeof GLOSSARY | string; children?: ReactNode }) {
  const g = GLOSSARY[k];
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; above: boolean }>({ left: 0, top: 0, above: false });
  const ref = useRef<HTMLButtonElement>(null);
  const id = useId();
  useEffect(() => {
    if (!open) return;
    const close = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', close);
    document.addEventListener('scroll', () => setOpen(false), { once: true, capture: true });
    return () => document.removeEventListener('pointerdown', close);
  }, [open]);
  if (!g) return <>{children}</>;
  const show = () => {
    const r = ref.current!.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 24);
    const above = r.bottom + 190 > window.innerHeight;
    setPos({ left: Math.max(12, Math.min(r.left, window.innerWidth - w - 12)), top: above ? r.top - 8 : r.bottom + 8, above });
    setOpen(true);
  };
  return (
    <>
      <button ref={ref} type="button" className="term" aria-describedby={open ? id : undefined} onMouseEnter={show} onMouseLeave={() => setOpen(false)} onFocus={show} onBlur={() => setOpen(false)} onClick={(e) => { e.stopPropagation(); open ? setOpen(false) : show(); }}>
        {children ?? g.term}
      </button>
      {open && (
        <span role="tooltip" id={id} className="tip" style={{ left: pos.left, top: pos.top, transform: pos.above ? 'translateY(-100%)' : undefined }}>
          <b>{g.term}</b>
          <span>{g.short}</span>
          <span className="tip-why">{g.why}</span>
          {g.example && <span className="tip-ex">{g.example}</span>}
        </span>
      )}
    </>
  );
}
