import { useEffect, useId } from 'react';

/** The Parakh mark, animated: the touchstone settles, gold is drawn across it as a tick, and a
 *  glint runs along the streak, the moment a jeweller sees the gold is real. */
export function AnimatedMark({ size = 120, delay = 0 }: { size?: number; delay?: number }) {
  const id = useId().replace(/:/g, '');
  const d = (s: number) => ({ animationDelay: `${delay + s}s` });
  return (
    <svg className="amark" width={size} height={size} viewBox="0 0 32 32" role="img" aria-label="Parakh logo">
      <defs>
        <linearGradient id={`ast${id}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#3f484c" />
          <stop offset="1" stopColor="#1a1f22" />
        </linearGradient>
        <linearGradient id={`aau${id}`} x1="0" y1="1" x2="1" y2="0">
          <stop offset="0" stopColor="#a87a22" />
          <stop offset=".55" stopColor="#e9c56d" />
          <stop offset="1" stopColor="#c99b3b" />
        </linearGradient>
        <radialGradient id={`ash${id}`} cx=".3" cy=".25" r=".8">
          <stop offset="0" stopColor="#fff" stopOpacity=".16" />
          <stop offset="1" stopColor="#fff" stopOpacity="0" />
        </radialGradient>
      </defs>
      <g className="amark-stone" style={d(0)}>
        <path d="M6.5 3.2 C 13 1.6, 22 2.2, 27 4.6 C 30.4 6.4, 30.6 13, 30 19.5 C 29.4 25.6, 27.4 29.6, 20.5 30.4 C 13.5 31.2, 6.2 30.6, 3.4 27.2 C 1.2 24.4, 1.2 15, 1.8 10 C 2.2 6.4, 3.6 4, 6.5 3.2 Z" fill={`url(#ast${id})`} stroke="rgba(255,255,255,.14)" strokeWidth=".6" />
        <path d="M6.5 3.2 C 13 1.6, 22 2.2, 27 4.6 C 30.4 6.4, 30.6 13, 30 19.5 C 29.4 25.6, 27.4 29.6, 20.5 30.4 C 13.5 31.2, 6.2 30.6, 3.4 27.2 C 1.2 24.4, 1.2 15, 1.8 10 C 2.2 6.4, 3.6 4, 6.5 3.2 Z" fill={`url(#ash${id})`} />
        <path d="M5 22 C 9 21, 12 24, 17 23" stroke="#fff" strokeOpacity=".05" strokeWidth=".6" fill="none" />
        <path d="M18 6 C 22 6.5, 25 8, 27 11" stroke="#fff" strokeOpacity=".05" strokeWidth=".6" fill="none" />
      </g>
      <path className="amark-dust" style={d(0.55)} d="M9.6 19.4 L 13.4 23 L 22.6 13.6" fill="none" stroke="#e3bd62" strokeOpacity=".3" strokeWidth="1" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
      <path className="amark-streak" style={d(0.45)} d="M8.6 16.8 L 13.6 21.6 L 24 10.4" fill="none" stroke={`url(#aau${id})`} strokeWidth="3.4" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
      <path className="amark-glint" style={d(1.25)} d="M8.6 16.8 L 13.6 21.6 L 24 10.4" fill="none" stroke="#fff8e1" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" pathLength={1} />
    </svg>
  );
}

/** Opening moment of the intro: the logo plays, then the name and its meaning appear. */
export function BrandIntro({ onDone }: { onDone: () => void }) {
  useEffect(() => {
    const reduce = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    const t = window.setTimeout(onDone, reduce ? 2000 : 3800);
    return () => window.clearTimeout(t);
  }, [onDone]);
  return (
    <button className="brand-intro" onClick={onDone} aria-label="Parakh. Every bill, tested before you trust it. Click to continue.">
      <AnimatedMark size={132} />
      <div className="bi-word" aria-hidden="true">
        {'Parakh'.split('').map((ch, i) => <span key={i} style={{ animationDelay: `${1.05 + i * 0.06}s` }}>{ch}</span>)}
      </div>
      <div className="bi-tag" aria-hidden="true">Every bill, tested before you trust it.</div>
      <span className="bi-skip" aria-hidden="true">Click anywhere to continue</span>
    </button>
  );
}
