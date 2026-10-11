import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Analysis } from '../domain/types';
import { buildPlan } from '../domain/recovery';
import { formatINR, formatINRCompact, formatPeriod } from '../lib/format';
import { describeAiError } from '../ai/provider';
import { Icon, Spinner } from './kit';
import type { WorkspaceApi } from './workspace';
import type { Route } from './App';
import { table4 } from './views/Actions';

interface Hit { id: string; group: string; label: ReactNode; sub?: string; run: () => void }

const SUGGESTIONS = [
  'How much GST can I safely claim this month?',
  'Which bills should I reject in IMS?',
  'Which supplier is causing the most trouble?',
  'What should I do first?',
];

/** Facts about the month, compact enough to send with a question. Only numbers Parakh already computed. */
function facts(a: Analysis) {
  const plan = buildPlan(a);
  const t4 = table4(a);
  const bills = a.invoices.filter((i) => i.extraction.method !== 'pending').map((inv) => {
    const v = a.verdicts[inv.id];
    const fs = a.findings.filter((f) => f.invoiceId === inv.id).sort((x, y) => y.itcAtRisk - x.itcAtRisk);
    return { no: inv.invoiceNo, supplier: inv.supplier.name, date: inv.invoiceDate, gst: v.itcClaimed, stuck: v.itcAtRisk, ims: v.ims, problems: fs.slice(0, 3).map((f) => f.title) };
  }).filter((b) => b.stuck > 0 || b.problems.length).slice(0, 40);
  return {
    business: a.company.name, month: formatPeriod(a.period), bills: a.totals.invoices,
    gstOnBills: a.totals.itcClaimed, safeToClaim: a.totals.itcSafe, stuck: a.totals.itcAtRisk,
    gstr3bNetItc: t4.net,
    recovery: { suppliersMustFix: plan.totals.supplier, youCanUnlock: plan.totals.you, doNotClaim: plan.totals.lost },
    suppliers: a.vendors.slice(0, 12).map((v) => ({ name: v.name, score: v.score, stuck: v.itcAtRisk, bills: v.invoices, notIn2B: v.missingIn2b })),
    problemBills: bills,
  };
}

/** Answers for the common questions without AI, from the same numbers. */
function localAnswer(a: Analysis, q: string): string | null {
  const s = q.toLowerCase();
  const plan = buildPlan(a);
  if (/claim|safe|how much/.test(s)) return `You can safely claim ${formatINR(a.totals.itcSafe)} of the ${formatINR(a.totals.itcClaimed)} GST on your bills. ${formatINR(a.totals.itcAtRisk)} is stuck: ${formatINR(plan.totals.supplier)} needs supplier fixes, ${formatINR(plan.totals.you)} you can unlock yourself, and ${formatINR(plan.totals.lost)} must not be claimed.`;
  if (/reject|ims/.test(s)) {
    const rej = a.invoices.filter((i) => a.verdicts[i.id]?.ims === 'reject');
    return rej.length ? `Reject ${rej.length} bill${rej.length > 1 ? 's' : ''} in IMS: ${rej.slice(0, 8).map((i) => `${i.invoiceNo} (${i.supplier.name})`).join(', ')}.` : 'No bill needs to be rejected in IMS this month.';
  }
  if (/supplier|vendor|trouble|worst/.test(s)) {
    const v = [...a.vendors].sort((x, y) => y.itcAtRisk - x.itcAtRisk)[0];
    if (!v || v.itcAtRisk <= 0) return 'No supplier has stuck credit this month.';
    const chase = plan.supplier[0];
    const vGroup = plan.supplier.find((g) => g.gstin === v.gstin);
    const head = `${v.name} holds the most stuck credit: ${formatINR(v.itcAtRisk)} across its ${v.invoices} bill${v.invoices > 1 ? 's' : ''} (supplier score ${v.score}/100).`;
    if (vGroup && chase && chase.gstin === v.gstin) return `${head} Message them first from the Recovery plan.`;
    const lostPart = plan.lost.filter((i) => i.inv.supplier.gstin === v.gstin).reduce((t, i) => t + i.itc, 0);
    return `${head}${lostPart > 0 ? ` ${formatINR(lostPart)} of that is on bills you should not claim (duplicates, time-barred or blocked).` : ''}${chase ? ` The supplier to chase first is ${chase.name}, with ${formatINR(chase.itc)} that a corrected bill would release.` : ''}`;
  }
  if (/first|start|priority|do now/.test(s)) {
    const g = plan.supplier[0];
    return g ? `Start with ${g.name}: ${formatINR(g.itc)} is stuck on ${g.items.length} bill${g.items.length > 1 ? 's' : ''} (${g.items[0].f.title.toLowerCase()}). Ask them to fix it before the 11th, then work down the Recovery plan.` : 'Nothing is stuck. Go to Filing actions and file.';
  }
  return null;
}

export function CommandBar({ a, api, go, onClose }: { a: Analysis; api: WorkspaceApi; go: (r: Route) => void; onClose: () => void }) {
  const [q, setQ] = useState('');
  const [sel, setSel] = useState(0);
  const [answer, setAnswer] = useState<{ q: string; text: string; source: 'ai' | 'rules'; note: string } | null>(null);
  const [thinking, setThinking] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => { input.current?.focus(); }, []);

  const nav = (r: Route) => { go(r); onClose(); };
  const hits = useMemo<Hit[]>(() => {
    const s = q.trim().toLowerCase();
    const pages: [Route['view'], string][] = [['overview', 'Overview'], ['recovery', 'Recovery plan'], ['invoices', 'Invoices'], ['recon', 'Reconciliation'], ['suppliers', 'Suppliers'], ['actions', 'Filing actions'], ['report', 'Report'], ['learn', 'Learn GST'], ['reliability', 'Reliability']];
    const out: Hit[] = [];
    for (const [v, l] of pages) if (!s || l.toLowerCase().includes(s)) out.push({ id: `p-${v}`, group: 'Go to', label: l, run: () => nav({ view: v } as Route) });
    if (s) {
      for (const inv of a.invoices) {
        const hay = `${inv.invoiceNo ?? ''} ${inv.supplier.name} ${inv.supplier.gstin ?? ''} ${inv.source.fileName}`.toLowerCase();
        if (hay.includes(s)) {
          const v = a.verdicts[inv.id];
          out.push({ id: `i-${inv.id}`, group: 'Bills', label: <><span className="mono">{inv.invoiceNo ?? inv.source.fileName}</span> · {inv.supplier.name}</>, sub: v?.itcAtRisk ? `${formatINR(v.itcAtRisk)} stuck` : 'OK', run: () => nav({ view: 'invoice', id: inv.id }) });
        }
      }
      for (const v of a.vendors) if (`${v.name} ${v.gstin}`.toLowerCase().includes(s)) out.push({ id: `s-${v.gstin}`, group: 'Suppliers', label: v.name, sub: `score ${v.score}/100`, run: () => nav({ view: 'suppliers', focus: v.gstin }) });
    }
    return out.slice(0, 12);
  }, [q, a]); // eslint-disable-line react-hooks/exhaustive-deps

  const looksLikeQuestion = q.trim().length > 3 && (/\?$/.test(q.trim()) || /^(how|what|which|why|when|who|can|should|is|are|do|does|list|show|explain)\b/i.test(q.trim()) || hits.length === 0);
  const items: Hit[] = q.trim() ? [...(looksLikeQuestion ? [{ id: 'ask', group: 'Ask', label: <>Ask Parakh: “{q.trim()}”</>, run: () => void ask(q.trim()) }] : []), ...hits, ...(!looksLikeQuestion ? [{ id: 'ask', group: 'Ask', label: <>Ask Parakh: “{q.trim()}”</>, run: () => void ask(q.trim()) }] : [])] : hits;

  async function ask(question: string) {
    setThinking(true); setAnswer(null);
    const local = localAnswer(a, question);
    try {
      if (!api.ai) throw Object.assign(new Error('no ai'), { code: 'none' });
      const prompt = `You are Parakh, a GST assistant for a small Indian business. Answer the owner's question using ONLY the data below (amounts are rupees). Be specific: name invoice numbers, suppliers and rupee amounts. At most 5 short sentences, plain words, no markdown headings. If the data cannot answer it, say so and suggest which Parakh page to open (Overview, Recovery plan, Invoices, Reconciliation, Suppliers, Filing actions, Learn GST). Reply in the language of the question.
<data>${JSON.stringify(facts(a))}</data>
Question: ${question}`;
      const text = await api.ai.text(prompt, { tier: 'quick' });
      setAnswer({ q: question, text: text.trim(), source: 'ai', note: `Answered by ${api.ai.label} from this month’s data. Check important figures on the bill itself.` });
    } catch (e) {
      const why = (e as { code?: string }).code === 'none' ? 'AI is off, so this answer comes from Parakh’s own numbers.' : `${describeAiError(e)} Answered from Parakh’s own numbers instead.`;
      setAnswer({ q: question, text: local ?? 'I could not answer that without AI. Try the pages listed below, or ask about claims, rejections, suppliers or what to do first.', source: 'rules', note: why });
    } finally { setThinking(false); }
  }

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); setSel((x) => Math.min(items.length - 1, x + 1)); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setSel((x) => Math.max(0, x - 1)); }
    else if (e.key === 'Enter') { e.preventDefault(); items[sel]?.run(); }
    else if (e.key === 'Escape') onClose();
  };

  // Invoice numbers inside an answer become links to that bill.
  const linkify = (text: string) => {
    const nos = a.invoices.filter((i) => i.invoiceNo && i.invoiceNo.length > 3).map((i) => ({ no: i.invoiceNo!, id: i.id }));
    if (!nos.length) return text;
    const re = new RegExp(`(${nos.map((n) => n.no.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')).join('|')})`, 'g');
    return text.split(re).map((part, k) => {
      const hit = nos.find((n) => n.no === part);
      return hit ? <button key={k} className="cb-link mono" onClick={() => nav({ view: 'invoice', id: hit.id })}>{part}</button> : <span key={k}>{part}</span>;
    });
  };

  let lastGroup = '';
  return (
    <div className="cb-scrim" onMouseDown={onClose}>
      <div className="cb" role="dialog" aria-label="Search or ask Parakh" onMouseDown={(e) => e.stopPropagation()}>
        <div className="cb-input">
          <Icon.command />
          <input ref={input} value={q} onChange={(e) => { setQ(e.target.value); setSel(0); }} onKeyDown={onKey} placeholder="Search bills and suppliers, or ask a question…" aria-label="Search or ask" />
          <kbd>Esc</kbd>
        </div>
        {(thinking || answer) && (
          <div className="cb-answer" aria-live="polite">
            {thinking ? <span className="muted"><Spinner /> Parakh is looking at your {a.totals.invoices} bills…</span> : answer && (
              <>
                <div className="cb-q">{answer.q}</div>
                <p>{linkify(answer.text)}</p>
                <div className="cb-by"><span className="ai-badge">{answer.source === 'ai' ? 'AI' : 'Rules'}</span> {answer.note}</div>
              </>
            )}
          </div>
        )}
        {!q.trim() && !answer && !thinking && (
          <div className="cb-sugg">
            <div className="cb-group">Try asking</div>
            <div className="cb-chips">{SUGGESTIONS.map((s) => <button key={s} className="cb-chip" onClick={() => { setQ(s); void ask(s); }}>{s}</button>)}</div>
          </div>
        )}
        <div className="cb-list" role="listbox">
          {items.map((h, k) => {
            const head = h.group !== lastGroup ? <div className="cb-group" key={`g-${h.group}-${k}`}>{h.group}</div> : null;
            lastGroup = h.group;
            return (
              <div key={h.id}>
                {head}
                <button role="option" aria-selected={k === sel} className={`cb-item ${k === sel ? 'sel' : ''}`} onMouseEnter={() => setSel(k)} onClick={h.run}>
                  <span className="cb-label">{h.label}</span>{h.sub && <span className="muted">{h.sub}</span>}
                </button>
              </div>
            );
          })}
        </div>
        <div className="cb-foot"><span><kbd>↑</kbd><kbd>↓</kbd> move</span><span><kbd>Enter</kbd> open</span><span className="spacer" /><span>{formatINRCompact(a.totals.itcAtRisk)} stuck this month</span></div>
      </div>
    </div>
  );
}
