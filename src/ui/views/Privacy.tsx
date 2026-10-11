import { Icon } from '../kit';

/** "Where does my data go?" An honest map of what stays in the browser and what is sent, and when. */
export function Privacy({ onClose, aiOn }: { onClose: () => void; aiOn: boolean }) {
  const rows: { where: 'device' | 'ai'; what: string; detail: string }[] = [
    { where: 'device', what: 'Reading your PDFs, Excel and CSV files', detail: 'Text, tables and QR codes are read by code running in this browser tab. The files are not uploaded.' },
    { where: 'device', what: 'All 40+ GST rule checks', detail: 'GSTIN checksums, tax maths, rates, time limits and duplicates run on this device.' },
    { where: 'device', what: 'Matching with GSTR-2B', detail: 'Your bills are compared with the GSTR-2B file you load, inside this tab.' },
    { where: 'device', what: 'E-invoice QR signature check', detail: 'The government signature on the QR code is verified in the browser with WebCrypto.' },
    { where: 'device', what: 'Recovery plan progress and settings', detail: 'Saved only in this browser (local storage). Clearing site data removes it.' },
    { where: 'ai', what: 'Reading a photo or scan with AI', detail: 'Only when you press “Read scan”: that one image is sent to Google Gemini to be read.' },
    { where: 'ai', what: 'AI review, supplier messages and “Ask Parakh”', detail: 'Only when you press the button: the bill details or a short summary of the month are sent to Google Gemini.' },
  ];
  return (
    <div className="scrim" role="dialog" aria-modal="true" aria-labelledby="pv-title" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal" style={{ width: 'min(620px, 100%)' }}>
        <div className="modal-h"><h2 id="pv-title"><Icon.lock /> Where your data goes</h2><button className="btn ghost sm x" onClick={onClose} aria-label="Close"><Icon.x /></button></div>
        <div className="modal-b">
          <p className="pv-lead">Parakh has no account and no database. Your bills are checked <b>inside this browser tab</b>. Something leaves your device only when you press an AI button, and every AI result is labelled.</p>
          <div className="pv-list">
            {rows.map((r) => (
              <div key={r.what} className={`pv-row ${r.where}`}>
                <span className="pv-tag">{r.where === 'device' ? 'Stays on device' : 'Sent to AI'}</span>
                <div><b>{r.what}</b><span>{r.detail}</span></div>
              </div>
            ))}
          </div>
          <p className="muted" style={{ fontSize: 12 }}>AI is {aiOn ? 'available' : 'currently off'} here. With AI off, every check, the reconciliation and the recovery plan still work. The practice data’s sample scan is read ahead of time to save waiting; your own bills never are.</p>
        </div>
      </div>
    </div>
  );
}
