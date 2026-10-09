import { useEffect, useRef, useState } from 'react';
import type { Analysis } from '../../domain/types';
import { formatINRCompact } from '../../lib/format';
import { Icon } from '../kit';
import { MISSIONS, loadDone, saveDone, type Mission, type MissionId } from './missions';

/** Floating mission checklist. Small and out of the way; each mission has a "Show me" that
 *  spotlights where to act, and ticks itself off when the user does it. */
export function Missions({ a, onShow, open, setOpen, onUpload }: { a: Analysis; onShow: (m: Mission) => void; open: boolean; setOpen: (v: boolean) => void; onUpload: () => void }) {
  const [done, setDone] = useState<MissionId[]>(loadDone);
  const [flash, setFlash] = useState<Mission | null>(null);
  const timer = useRef(0);

  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<MissionId>).detail;
      setDone((d) => {
        if (d.includes(id)) return d;
        const next = [...d, id];
        saveDone(next);
        const m = MISSIONS.find((x) => x.id === id)!;
        setFlash(m);
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(() => setFlash(null), 4200);
        return next;
      });
    };
    window.addEventListener('parakh:mission', on);
    return () => window.removeEventListener('parakh:mission', on);
  }, []);

  const count = done.length;
  const total = MISSIONS.length;
  const next = MISSIONS.find((m) => !done.includes(m.id));
  const all = count === total;
  const r = 15, c = 2 * Math.PI * r;

  return (
    <div className={`missions ${open ? 'open' : ''}`} aria-live="polite">
      {flash && !open && (
        <div className="mission-flash" role="status">
          <span className="mf-check"><Icon.check /></span>
          <div><b>Mission done: {flash.title}</b><span>You learned {flash.learn.charAt(0).toLowerCase() + flash.learn.slice(1)}</span></div>
        </div>
      )}
      {open ? (
        <section className="missions-panel" aria-label="Missions">
          <header>
            <svg width="38" height="38" viewBox="0 0 38 38" aria-hidden="true">
              <circle cx="19" cy="19" r={r} className="ring-bg" />
              <circle cx="19" cy="19" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - count / total)} transform="rotate(-90 19 19)" />
            </svg>
            <div>
              <b>{all ? 'All missions done' : 'Your missions'}</b>
              <span>{all ? 'You have seen everything Parakh does.' : `${count} of ${total} done · about ${Math.max(1, Math.ceil(((total - count) * 25) / 60))} min left`}</span>
            </div>
            <button className="btn ghost sm" onClick={() => setOpen(false)} aria-label="Minimise missions"><Icon.x /></button>
          </header>
          {all ? (
            <div className="mission-done-all">
              <p>You found <b>{formatINRCompact(a.totals.itcAtRisk)}</b> of stuck GST across {a.totals.invoices} bills, saw why, and know what to file. That is the whole job, done in minutes.</p>
              <button className="btn primary sm" onClick={onUpload}><Icon.upload /> Try it with your own bills</button>
            </div>
          ) : (
            <ol>
              {MISSIONS.map((m, i) => {
                const isDone = done.includes(m.id);
                const isNext = next?.id === m.id;
                return (
                  <li key={m.id} className={`${isDone ? 'done' : ''} ${isNext ? 'next' : ''}`}>
                    <span className="m-dot">{isDone ? <Icon.check /> : i + 1}</span>
                    <div className="m-body">
                      <span className="m-title">{m.title}</span>
                      {isNext && <span className="m-why">{m.why} You will learn: {m.learn.charAt(0).toLowerCase() + m.learn.slice(1)}</span>}
                    </div>
                    {!isDone && <button className={`btn sm ${isNext ? 'primary' : 'ghost'}`} onClick={() => onShow(m)}>{isNext ? 'Show me' : 'Go'}</button>}
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      ) : (
        <button className="missions-pill" onClick={() => setOpen(true)}>
          <svg width="24" height="24" viewBox="0 0 38 38" aria-hidden="true">
            <circle cx="19" cy="19" r={r} className="ring-bg" />
            <circle cx="19" cy="19" r={r} className="ring-fg" strokeDasharray={c} strokeDashoffset={c * (1 - count / total)} transform="rotate(-90 19 19)" />
          </svg>
          {all ? 'Missions complete' : <>Missions <b>{count}/{total}</b>{next ? <span className="pill-next">Next: {next.title}</span> : null}</>}
        </button>
      )}
    </div>
  );
}
