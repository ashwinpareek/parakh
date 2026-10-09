import { useEffect, useState } from 'react';
import { useWorkspace } from './workspace';
import { Icon, Spinner } from './kit';
import { Overview } from './views/Overview';
import { Invoices } from './views/Invoices';
import { InvoiceDetail } from './views/InvoiceDetail';
import { Reconciliation } from './views/Reconciliation';
import { Suppliers } from './views/Suppliers';
import { Actions } from './views/Actions';
import { Report } from './views/Report';
import { NewCheck, Settings } from './views/Modals';
import { Learn } from './views/Learn';
import { Reliability } from './views/Reliability';
import { Tour } from './Tour';
import { ModeContext, type Mode } from './mode';
import { Welcome, type WelcomeAction } from './onboarding/Welcome';
import { AnimatedMark } from './onboarding/BrandIntro';
import { Missions } from './onboarding/Missions';
import { PageHint, resetHints } from './onboarding/PageHint';
import { MISSIONS, completeMission, missionForRoute, type Mission } from './onboarding/missions';

export type Route =
  | { view: 'overview' }
  | { view: 'invoices' }
  | { view: 'invoice'; id: string }
  | { view: 'recon' }
  | { view: 'suppliers'; focus?: string }
  | { view: 'actions' }
  | { view: 'report' }
  | { view: 'learn' }
  | { view: 'reliability' };

type Theme = 'light' | 'dark';
const THEME_KEY = 'parakh.theme.v2';
const MODE_KEY = 'parakh.mode';
// Per visit: every new tab or visit starts with the intro; a refresh inside the same visit does not.
const ONBOARD_KEY = 'parakh.onboarded.session';

export default function App() {
  const api = useWorkspace();
  const [route, setRoute] = useState<Route>({ view: 'overview' });
  const [modal, setModal] = useState<'new' | 'settings' | null>(null);
  const [theme, setThemeState] = useState<Theme>(() => { try { return (localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'); } catch { return 'light'; } });

  const [mode, setModeState] = useState<Mode>(() => { try { return (localStorage.getItem(MODE_KEY) as Mode) || 'simple'; } catch { return 'simple'; } });
  const setMode = (m: Mode) => { setModeState(m); try { localStorage.setItem(MODE_KEY, m); } catch { /* storage unavailable */ } };
  const [tour, setTour] = useState<number | null>(null);
  const [welcome, setWelcome] = useState(() => { try { return sessionStorage.getItem(ONBOARD_KEY) !== '1'; } catch { return true; } });
  const [missionsOpen, setMissionsOpen] = useState(false);
  const [spot, setSpot] = useState<Mission | null>(null);
  const finishWelcome = ({ action, mode: m }: { action: WelcomeAction; mode: Mode }) => {
    try { sessionStorage.setItem(ONBOARD_KEY, '1'); } catch { /* storage unavailable */ }
    setMode(m);
    setWelcome(false);
    go({ view: action === 'workspace' ? 'invoices' : 'overview' });
    if (action === 'upload') setModal('new');
    if (action === 'mission') window.setTimeout(() => setSpot(MISSIONS[0]), 500);
  };
  useEffect(() => { void api.loadSample(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem(THEME_KEY, theme); } catch { /* storage unavailable */ }
  }, [theme]);

  const go = (r: Route) => {
    setRoute(r);
    document.querySelector('.main')?.scrollTo({ top: 0 });
    const m = missionForRoute(r);
    if (m) completeMission(m);
  };
  const a = api.analysis;
  const ws = api.ws;
  const flagged = a ? Object.values(a.verdicts).filter((v) => v.band !== 'clear').length : 0;
  const nav: { id: Route['view']; label: string; icon: () => JSX.Element; count?: number }[] = [
    { id: 'overview', label: 'Overview', icon: Icon.overview },
    { id: 'invoices', label: 'Invoices', icon: Icon.invoices, count: a ? a.invoices.length : undefined },
    { id: 'recon', label: 'Reconciliation', icon: Icon.recon, count: a ? a.totals.recon.mismatch + a.totals.recon['missing-in-2b'] + a.totals.recon['missing-in-books'] : undefined },
    { id: 'suppliers', label: 'Suppliers', icon: Icon.suppliers, count: a ? a.vendors.length : undefined },
    { id: 'actions', label: 'Filing actions', icon: Icon.actions },
    { id: 'report', label: 'Report', icon: Icon.report },
  ];
  const nav2: typeof nav = [
    { id: 'learn', label: 'Learn GST', icon: Icon.learn },
    { id: 'reliability', label: 'Reliability', icon: Icon.shield },
  ];
  const current = route.view === 'invoice' ? 'invoices' : route.view;
  const title = [...nav, ...nav2].find((n) => n.id === current)?.label;

  return (
    <ModeContext.Provider value={mode}>
    <div className="shell">
      <aside className="side">
        <div className="brand">
          <AnimatedMark size={28} delay={0.2} />
          <div><div className="brand-name">Parakh <span className="deva brand-deva">परख</span></div><div className="brand-sub">tests every GST bill like gold</div></div>
        </div>
        <nav className="nav" aria-label="Main">
          <div className="nav-label">Workspace</div>
          {nav.map((n) => (
            <button key={n.id} aria-current={current === n.id ? 'page' : undefined} onClick={() => go({ view: n.id } as Route)} disabled={!a}>
              <n.icon /> {n.label}
              {n.count != null && <span className="count">{n.count}</span>}
            </button>
          ))}
          <div className="nav-label" style={{ marginTop: 14 }}>Understand</div>
          {nav2.map((n) => (
            <button key={n.id} aria-current={current === n.id ? 'page' : undefined} onClick={() => go({ view: n.id } as Route)} disabled={!a}>
              <n.icon /> {n.label}
            </button>
          ))}
          <button onClick={() => setTour(0)} disabled={!a}><Icon.play /> Take the tour</button>
          <button onClick={() => { resetHints(); setWelcome(true); }}><Icon.learn /> Replay the intro</button>
        </nav>
        <div className="side-foot">
          <button className="btn primary" onClick={() => setModal('new')}><Icon.upload /> New check</button>
          <div className="ai-status" title={api.ai ? `${api.ai.label} is available for scans and reviews` : 'Rules-only mode'}>
            <span className={`dot ${api.ai ? 'on' : ''}`} />
            {api.ai ? `AI: ${api.ai.label}` : api.aiChecked ? 'AI off · rules only' : 'Checking AI…'}
          </div>
          <button className="side-link" onClick={() => setModal('settings')}><Icon.settings /> Settings</button>
        </div>
      </aside>

      <main className="main">
        <div className="topbar">
          <div className="crumbs">
            <b>{title ?? 'Overview'}</b>
            {ws?.sample && !['learn', 'reliability'].includes(route.view) && (
              <span className="pill info practice" title={`You are practising on made-up bills of ${ws.company.name}, a sample factory. Use New check to load your own bills.`}>Practice data</span>
            )}
          </div>
          <span className="spacer" />
          {api.busy && <span className="crumbs" role="status"><Spinner /> {api.busy}</span>}
          {flagged > 0 && !api.busy && <span className="pill high-risk"><span className="pip" />{flagged} bills need attention</span>}
          <div className="mode-switch" data-tour="mode">
            <span className="sr-only" id="mode-l">Explanation level</span>
            <div className="seg" role="group" aria-labelledby="mode-l">
              <button aria-pressed={mode === 'simple'} onClick={() => setMode('simple')} title="Plain-language explanations for anyone">Simple</button>
              <button aria-pressed={mode === 'expert'} onClick={() => setMode('expert')} title="Legal references, rule IDs and risk scores for accountants">Expert</button>
            </div>
          </div>
        </div>
        {!a && (
          <div className="page">
            <div className="empty" style={{ minHeight: 320 }}>
              <Spinner />
              <span>{api.busy ?? 'Preparing workspace'}</span>
              {api.jobs.length > 0 && <span className="mono" style={{ fontSize: 12 }}>{api.jobs.filter((j) => j.stage !== 'queued' && j.stage !== 'reading').length} / {api.jobs.length} documents</span>}
            </div>
          </div>
        )}
        {a && <div className="hint-wrap"><PageHint view={route.view} /></div>}
        {a && route.view === 'overview' && <Overview a={a} api={api} go={go} onTour={() => setTour(0)} />}
        {a && route.view === 'learn' && <Learn a={a} api={api} />}
        {a && route.view === 'reliability' && <Reliability a={a} api={api} go={go} />}
        {a && route.view === 'invoices' && <Invoices a={a} api={api} go={go} />}
        {a && route.view === 'invoice' && <InvoiceDetail a={a} api={api} id={route.id} go={go} />}
        {a && route.view === 'recon' && <Reconciliation a={a} api={api} go={go} />}
        {a && route.view === 'suppliers' && <Suppliers a={a} api={api} focus={route.focus} go={go} />}
        {a && route.view === 'actions' && <Actions a={a} go={go} />}
        {a && route.view === 'report' && <Report a={a} api={api} />}
      </main>

      {modal === 'new' && <NewCheck api={api} onClose={() => setModal(null)} onDone={() => { setModal(null); go({ view: 'overview' }); }} />}
      {modal === 'settings' && <Settings api={api} onClose={() => setModal(null)} theme={theme} setTheme={setThemeState} />}
      {api.toast && <div className="toast" role="status">{api.toast}</div>}
      {a && tour != null && <Tour a={a} step={tour} setStep={setTour} go={go} />}
      {a && spot && <Tour a={a} steps={[spot.spotlight]} step={0} finishLabel="Got it" setStep={() => { if (spot.id === 'stuck') completeMission('stuck'); setSpot(null); }} go={go} />}
      {a && !welcome && <Missions a={a} open={missionsOpen} setOpen={setMissionsOpen} onUpload={() => setModal('new')} onShow={(m) => { setMissionsOpen(false); setSpot(m); }} />}
      {welcome && <Welcome a={a} onDone={finishWelcome} />}
    </div>
    </ModeContext.Provider>
  );
}

