import { useState, type DragEvent } from 'react';
import type { Company } from '../../domain/types';
import { checkGstin } from '../../domain/gstin';
import { Icon, Spinner } from '../kit';
import type { WorkspaceApi } from '../workspace';
import { saveGeminiKey, savedGeminiKey } from '../../ai/provider';

function Drop({ id, title, hint, accept, multiple, files, onFiles }: { id: string; title: string; hint: string; accept: string; multiple?: boolean; files: File[]; onFiles: (f: File[]) => void }) {
  const [over, setOver] = useState(false);
  const onDrop = (e: DragEvent) => { e.preventDefault(); setOver(false); onFiles([...e.dataTransfer.files]); };
  return (
    <label className={`drop ${over ? 'over' : ''}`} htmlFor={id} onDragOver={(e) => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
      <Icon.upload />
      <b>{title}</b>
      <span className="hint">{hint}</span>
      {files.length > 0 && <span className="files">{files.length > 3 ? `${files.length} files` : files.map((f) => f.name).join('\n')}</span>}
      <input id={id} type="file" accept={accept} multiple={multiple} onChange={(e) => onFiles([...(e.target.files ?? [])])} />
    </label>
  );
}

export function NewCheck({ api, onClose, onDone }: { api: WorkspaceApi; onClose: () => void; onDone: () => void }) {
  const prev = api.ws?.sample ? null : api.ws?.company;
  const [name, setName] = useState(prev?.name ?? '');
  const [gstin, setGstin] = useState(prev?.gstin ?? '');
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const [period, setPeriod] = useState(`${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`);
  const [invoices, setInvoices] = useState<File[]>([]);
  const [register, setRegister] = useState<File[]>([]);
  const [twoB, setTwoB] = useState<File[]>([]);
  const [running, setRunning] = useState(false);
  const g = gstin.trim() ? checkGstin(gstin) : null;
  const ready = !!g?.valid && (invoices.length > 0 || register.length > 0);

  const run = async () => {
    if (!g?.valid) return;
    setRunning(true);
    const company: Company = { name: name.trim() || 'My business', gstin: g.gstin, stateCode: g.stateCode };
    await api.ingest({ company, period, invoiceFiles: invoices, register: register[0] ?? null, gstr2b: twoB[0] ?? null });
    setRunning(false);
    onDone();
  };

  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="nc-title" onClick={(e) => e.target === e.currentTarget && !running && onClose()}>
      <div className="modal">
        <div className="modal-h"><h2 id="nc-title">New purchase check</h2><button className="btn ghost sm x" onClick={onClose} disabled={running} aria-label="Close"><Icon.x /></button></div>
        {!running ? (
          <div className="modal-b">
            <div className="form-row">
              <label className="field" htmlFor="nc-name">Business name<input id="nc-name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="As registered under GST" /></label>
              <label className="field" htmlFor="nc-period">Return period<input id="nc-period" className="input" type="month" value={period} onChange={(e) => setPeriod(e.target.value)} /></label>
            </div>
            <label className="field" htmlFor="nc-gstin">Your GSTIN
              <input id="nc-gstin" className="input mono" value={gstin} onChange={(e) => setGstin(e.target.value.toUpperCase())} placeholder="36AAKCS4821M1ZX" maxLength={15} aria-invalid={!!g && !g.valid} />
              <span style={{ fontWeight: 400, fontSize: 11.5, color: g ? (g.valid ? 'var(--ok)' : 'var(--crit)') : 'var(--ink-3)' }}>
                {g ? (g.valid ? `Valid · ${g.stateName} · ${g.entityType ?? ''}` : g.problems[0] ?? 'Invalid GSTIN') : 'Used to check the recipient on every invoice and the place of supply.'}
              </span>
            </label>
            <div className="drops">
              <Drop id="nc-inv" title="Purchase invoices" hint="PDF, JPG or PNG. Scans and photos are read by AI." accept=".pdf,image/*" multiple files={invoices} onFiles={setInvoices} />
              <Drop id="nc-reg" title="Purchase register" hint="Optional. CSV or Excel export from Tally, Zoho or Busy." accept=".csv,.xlsx,.xls" files={register} onFiles={(f) => setRegister(f.slice(0, 1))} />
              <Drop id="nc-2b" title="GSTR-2B" hint="Optional. JSON or Excel downloaded from the GST portal." accept=".json,.xlsx,.xls" files={twoB} onFiles={(f) => setTwoB(f.slice(0, 1))} />
            </div>
            <p className="muted" style={{ fontSize: 12 }}>Files are processed in your browser. Only scans you choose to send to AI leave this page.</p>
          </div>
        ) : null}
        {running && (
          <div className="modal-b">
            <div className="pipeline">
              {api.jobs.map((j) => (
                <div className="job" key={j.id}>
                  {j.stage === 'done' ? <span style={{ color: 'var(--ok)' }}><Icon.check /></span> : j.stage === 'error' ? <span style={{ color: 'var(--crit)' }}><Icon.x /></span> : j.stage === 'needs-ai' ? <span style={{ color: 'var(--info)' }}><Icon.scan /></span> : j.stage === 'queued' ? <span className="dot" /> : <Spinner />}
                  <span className="fn">{j.fileName}</span>
                  <span className="muted" style={{ fontSize: 11.5 }}>{j.detail ?? j.stage}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="modal-f">
          <button className="btn ghost" style={{ marginRight: 'auto' }} onClick={async () => { setRunning(true); await api.loadSample(); setRunning(false); onDone(); }} disabled={running}>Load sample workspace</button>
          <button className="btn" onClick={onClose} disabled={running}>Cancel</button>
          <button className="btn primary" onClick={run} disabled={!ready || running}>{running ? <Spinner /> : null} Run check</button>
        </div>
      </div>
    </div>
  );
}

export function Settings({ api, onClose, theme, setTheme }: { api: WorkspaceApi; onClose: () => void; theme: 'light' | 'dark'; setTheme: (t: 'light' | 'dark') => void }) {
  const [key, setKey] = useState(savedGeminiKey());
  const inClaude = api.ai?.id === 'claude';
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="st-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(560px, 100%)' }}>
        <div className="modal-h"><h2 id="st-title">Settings</h2><button className="btn ghost sm x" onClick={onClose} aria-label="Close"><Icon.x /></button></div>
        <div className="modal-b">
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="eyebrow">AI provider</div>
            <div className="callout" style={{ padding: '10px 12px' }}>
              <span className={`dot ${api.ai ? 'on' : ''}`} style={{ marginTop: 6 }} />
              <div className="body" style={{ fontSize: 12.5 }}>
                <b>{api.ai ? `${api.ai.label} connected` : 'No AI connected'}</b>
                <span className="ink2">{inClaude ? 'Running inside Claude. AI calls use your Claude account and ask for permission the first time.' : api.ai ? 'Using your Gemini API key from this browser.' : 'Rule checks, PDF parsing and reconciliation work without AI. Add a key to read scans and run AI reviews.'}</span>
              </div>
            </div>
            {!inClaude && (
              <label className="field" htmlFor="st-key">Gemini API key (for running Parakh outside Claude)
                <div style={{ display: 'flex', gap: 8 }}>
                  <input id="st-key" className="input mono" style={{ flex: 1 }} type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder="AIza…" autoComplete="off" />
                  <button className="btn" onClick={async () => { saveGeminiKey(key.trim()); const p = await api.refreshAi(); api.flash(p ? `${p.label} connected` : 'Key removed'); }}>Save</button>
                </div>
                <span style={{ fontWeight: 400, fontSize: 11.5, color: 'var(--ink-3)' }}>Stored only in this browser. Free keys are available from Google AI Studio.</span>
              </label>
            )}
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            <div className="eyebrow">Appearance</div>
            <div className="seg" role="group" aria-label="Theme">
              {(['light', 'dark'] as const).map((t) => <button key={t} aria-pressed={theme === t} onClick={() => setTheme(t)}>{t[0].toUpperCase() + t.slice(1)}</button>)}
            </div>
          </div>
          <div style={{ display: 'grid', gap: 6 }}>
            <div className="eyebrow">What Parakh checks</div>
            <p className="ink2" style={{ fontSize: 12.5 }}>
              Rule 46 invoice particulars · GSTIN format, checksum and registration status · tax head vs place of supply · line and total arithmetic · rates against the 22 Sep 2025 structure · Sec 17(5) blocked credit · Sec 16(4) time limit · 180-day payment rule · e-invoice IRN for mandated suppliers · duplicates · GSTR-2B matching with fuzzy invoice numbers · IMS action and GSTR-3B Table 4 draft.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
