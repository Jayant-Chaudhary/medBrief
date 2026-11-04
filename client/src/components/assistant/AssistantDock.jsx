import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, Send, X } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext.jsx';
import { assistantService } from '../../services/assistantService';
import { assistantVisibleOn } from './assistantRoutes';
import { useAssistantBridge } from './AssistantBridge.jsx';
import { runPlan } from './planRunner';
import { readPage } from './pageReader';
import { executeAction } from './pageActions';
import { readRecord, recordPath, hashWrittenValue } from './recordContext';
import { capturePage, observeAction } from './actionEvidence';
import ConfirmCard from './ConfirmCard.jsx';
import AssistantMark from './AssistantMark.jsx';

const ENABLED = import.meta.env.VITE_ASSISTANT_ENABLED === 'true';
const MAX_CHARS = 600;
const UNAVAILABLE = 'The assistant is not available right now. You can still use the menu.';
// Long enough to see each page open, short enough not to feel slow.
const STEP_DELAY_MS = 500;
// How long to wait for a page to load before giving up on filling its form.
const PAGE_READY_TIMEOUT_MS = 8000;
// Time for the page to re-render after a fill, before reading or outlining it.
const SETTLE_MS = 50;
// How long a filled field stays outlined.
const FLASH_MS = 2500;
// Before reading the page again for the next round: a panel opening or a page loading.
const ROUND_SETTLE_MS = 700;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function waitForSettle(quietMs = 350, timeoutMs = 4000) {
  return new Promise((resolve) => {
    const start = Date.now();
    let timer = null;
    let observer = null;

    const isLoading = () => {
      if (typeof document === 'undefined') return false;
      const spinners = document.querySelectorAll('[role="status"][aria-label="Loading"], .animate-spin, [aria-busy="true"]');
      return spinners.length > 0;
    };

    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (observer) observer.disconnect();
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      if (Date.now() - start >= timeoutMs) {
        cleanup();
        resolve();
        return;
      }
      if (isLoading()) {
        timer = setTimeout(schedule, 100);
        return;
      }
      timer = setTimeout(() => {
        if (isLoading()) {
          schedule();
          return;
        }
        cleanup();
        resolve();
      }, quietMs);
    };

    if (typeof document !== 'undefined' && document.body) {
      observer = new MutationObserver(() => {
        schedule();
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
    }

    schedule();
  });
}
const DONE_VERB = { click: 'Pressed', type: 'Typed in', append: 'Added to', replace: 'Changed in', select: 'Chose in', check: 'Ticked' };

/** What a finished round did, in labels only, for the next round's "already done". */
function doneLines(reply) {
  if (reply.type === 'navigate') return [`Opened ${reply.label}`];
  return (reply.steps || []).flatMap((s) => [
    ...(s.path ? [`Opened ${s.label}`] : []),
    ...(s.fill ? [`Filled ${Object.keys(s.fill.fields).join(', ')} on ${s.label}`] : []),
    ...(s.press ? [`Pressed ${s.press.label}`] : []),
    ...(s.page?.actions || []).map((a) => `${DONE_VERB[a.op]} "${a.name}"`),
  ]);
}

/** A name for the open page in the action log ("clinician_maternity"). */
const pageIdOf = (pathname) => pathname.replace(/^\/+|\/+$/g, '').replace(/[^a-z]+/gi, '_').toLowerCase().slice(0, 40) || 'home';

/** Outlines the fields the assistant just filled (pages mark them with data-assistant-id) and scrolls to the first. */
function highlight(ids) {
  const elements = ids.map((id) => document.querySelector(`[data-assistant-id="${CSS.escape(id)}"]`)).filter(Boolean);
  elements[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  elements.forEach((element) => {
    element.dataset.assistantFlash = 'on';
    setTimeout(() => delete element.dataset.assistantFlash, FLASH_MS);
  });
}

/**
 * Floating assistant: type what you want, and it opens pages and records,
 * fills the page's declared fields and, after you confirm, presses its button.
 * The server decides what is allowed; nothing is saved or sent without Confirm.
 */
export default function AssistantDock({ enabled = ENABLED }) {
  const { user, role, profile, loading } = useAuthContext();
  const location = useLocation();
  const navigate = useNavigate();
  const bridge = useAssistantBridge();
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [steps, setSteps] = useState([]);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const warmed = useRef(false);
  const wasOpen = useRef(false);
  // Pending Confirm cards by entry id; stopped requests by request id (a request may take several rounds).
  const confirmers = useRef(new Map());
  const stopped = useRef(new Set());
  // The path now, for rounds that start after the page changed.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const verified = profile?.clinicianDetails?.is_verified === true;
  const visible = enabled && !loading && Boolean(user) && assistantVisibleOn(location.pathname, { role, verified });

  useEffect(() => {
    if (!open) {
      // The button only exists while the panel is closed, so focus it after it renders.
      if (wasOpen.current) buttonRef.current?.focus();
      return;
    }
    wasOpen.current = true;
    inputRef.current?.focus();
    if (!warmed.current) {
      warmed.current = true;
      assistantService.warm().catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [steps]);

  if (!visible) return null;

  function close() {
    setOpen(false);
  }

  const update = (entryId, change) => setSteps((current) => current.map((s) => (s.id === entryId ? { ...s, ...change } : s)));

  function go(path, entryId, keepOpen = false) {
    update(entryId, { chosen: path });
    navigate(path);
    if (!keepOpen && window.innerWidth < 640) setOpen(false);
  }

  function answer(entryId, yes) {
    const resolve = confirmers.current.get(entryId);
    confirmers.current.delete(entryId);
    update(entryId, { confirm: null });
    resolve?.(yes);
  }

  function stop(entry) {
    stopped.current.add(entry.requestId);
    answer(entry.id, false);
  }

  /** Runs the plan step by step, so the user sees each page open and each field fill. */
  async function execute(plan, entryId, requestId, names = new Map()) {
    const actionResults = [];
    const results = [];
    update(entryId, { running: true, progress: 0, results: [] });
    const outcome = await runPlan(plan, {
      pageId: pageIdOf(pathRef.current),
      // Acts only if the element still has the label it had when the page was read.
      pageAction: (action) => observeAction(() => executeAction({ ...action, name: names.get(action.ref) || action.name }), waitForSettle),
      record: result => actionResults.push(result),
      capture: capturePage,
      arrive: async path => {
        await waitForSettle();
        return window.location.pathname + window.location.search === path && !document.querySelector('[aria-busy="true"], [role="status"][aria-label="Loading"]');
      },
      navigate: (path, state) => navigate(path, state ? { state } : undefined),
      // A fill after opening a page waits until that page shows the intended record
      // (a named patient, or none), never the one that was open before.
      waitFor: (page, context) => bridge.waitFor(
        page,
        PAGE_READY_TIMEOUT_MS,
        context
          ? (actions) => Object.entries(context).every(([key, value]) => (actions.context()?.[key] ?? null) === value)
          : undefined
      ),
      pause: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      settle: () => new Promise((resolve) => setTimeout(resolve, SETTLE_MS)),
      highlight,
      confirm: (card) => new Promise((resolve) => {
        confirmers.current.set(entryId, resolve);
        update(entryId, { confirm: card });
      }),
      report: (page, button, result, errorCode) => assistantService.event(page, button, result, errorCode).catch(() => {}),
      progress: (index, result) => {
        results[index] = result;
        update(entryId, { progress: index + 1, results: [...results] });
      },
      stopped: () => stopped.current.has(requestId),
    }, { stepDelayMs: STEP_DELAY_MS });
    update(entryId, { running: false, confirm: null, outcome });
    return { outcome, actionResults };
  }

  /**
   * One round of a request: read the open page (doctors; labels only), ask,
   * run what comes back. If the server says the request isn't finished (a
   * panel had to open, a page had to load), read the page again and go on.
   */
  async function runRound({ message, requestId, round, progress, mode, continuationToken, startedAt = Date.now(), originRecord = null, written = [], checklist = [], note = '', results = [] }) {
    const id = crypto.randomUUID();
    setSteps((current) => [...current, { id, requestId, message, round, progress, mode, continuationToken, startedAt, originRecord, written, checklist, note, results, continued: round > 0, reply: null }]);
    const { page, names } = role === 'clinician' ? readPage() : { page: undefined, names: new Map() };
    let reply;
    setBusy(true);
    try {
      reply = await assistantService.ask(message, pathRef.current, { page, currentRecord: readRecord(window.location, bridge), round, progress, mode, continuationToken, startedAt, originRecord, written, checklist, note, results });
    } catch (err) {
      const errNote = err?.status === 429 ? 'Too many requests. Please wait a moment.' : UNAVAILABLE;
      update(id, { reply: { type: 'unavailable', message: errNote } });
      inputRef.current?.focus();
      setBusy(false);
      return;
    }
    const currentChecklist = reply.checklist || checklist;
    const currentNote = reply.note || note;
    update(id, { reply, names, checklist: currentChecklist, note: currentNote });

    let outcome = 'done';
    let actionResults = [];
    if (reply.type === 'navigate') {
      const targetPath = reply.recordTarget ? recordPath(reply.recordTarget) : reply.path;
      if (!targetPath) { setBusy(false); return; }
      go(targetPath, id, reply.continue);
      await waitForSettle();
      const arrived = window.location.pathname + window.location.search === targetPath && !document.querySelector('[aria-busy="true"], [role="status"][aria-label="Loading"]');
      actionResults = [{ actionId: reply.actionId, result: arrived ? 'ok' : 'no_change' }];
    } else if (reply.type === 'run') {
      ({ outcome, actionResults } = await execute(reply.steps, id, requestId, names));
    }
    const nextWritten = [...written];
    for (const action of (reply.steps || []).flatMap(step => step.page?.actions || [])) {
      if (!action.field || !actionResults.some(r => r.actionId === action.actionId && r.result === 'ok')) continue;
      const hash = await hashWrittenValue(action.value);
      if (!nextWritten.some(w => w.field === action.field && w.hash === hash)) nextWritten.push({ field: action.field, op: action.op, hash });
    }
    for (const step of reply.steps || []) {
      for (const item of step.fill?.filled || []) {
        const actionId = step.fill.actionIds?.[item.id];
        const rawVal = step.fill.fields?.[item.id] ?? item.value;
        if (!item.field || !actionResults.some(r => r.actionId === actionId && r.result === 'ok')) continue;
        const hash = await hashWrittenValue(rawVal);
        if (!nextWritten.some(w => w.field === item.field && w.hash === hash)) nextWritten.push({ field: item.field, op: 'fill', hash });
      }
    }
    await continueAfter(reply, outcome, {
      message,
      requestId,
      round,
      progress,
      mode, continuationToken, startedAt, originRecord, written: nextWritten,
      checklist: currentChecklist,
      note: currentNote,
      results: actionResults,
    });
  }

  async function continueAfter(reply, outcome, { message, requestId, round, progress, mode, continuationToken, startedAt = Date.now(), originRecord = null, written = [], checklist = [], note = '', results = [] }) {
    if (!reply.continue || stopped.current.has(requestId)) {
      setBusy(false);
      if (outcome === 'done' && !reply.continue && window.innerWidth < 640) setOpen(false);
      // Back to the message box only when the request is over: moving focus mid-request would
      // close what the page just opened (a list of templates, a menu).
      inputRef.current?.focus();
      return;
    }
    await waitForSettle(350, 4000);
    if (stopped.current.has(requestId)) return;
    await runRound({
      message,
      requestId,
      round: round + 1,
      progress,
      mode: reply.mode, continuationToken: reply.continuationToken, startedAt, originRecord, written,
      checklist,
      note,
      results,
    });
  }

  async function choose(option, entry) {
    const reply = { ...entry.reply, type: 'run', steps: option.steps };
    update(entry.id, { reply, progress: 0 });
    const { outcome, actionResults } = await execute(option.steps, entry.id, entry.requestId, entry.names);
    await continueAfter(reply, outcome, { ...entry, results: actionResults });
  }

  function submit(event) {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText('');
    runRound({ message, requestId: crypto.randomUUID(), round: 0, progress: [], originRecord: readRecord(window.location, bridge) });
  }

  return (
    <>
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
          data-assistant-panel=""
          className="assistant-button fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-card transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <AssistantMark size={30} />
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Assistant"
          // The page reader never reads or acts on the assistant itself.
          data-assistant-panel=""
          onKeyDown={(event) => event.key === 'Escape' && close()}
          className="fixed inset-0 z-50 flex flex-col border border-line bg-raised text-ink shadow-card sm:inset-auto sm:bottom-5 sm:right-5 sm:h-[480px] sm:w-[360px] sm:rounded-card"
        >
          <header className="flex items-center justify-between border-b border-line px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="assistant-button flex h-8 w-8 shrink-0 items-center justify-center rounded-full">
                <AssistantMark size={20} sparkle={false} />
              </span>
              <div>
                <h2 className="text-base font-semibold">Assistant</h2>
                <p className="text-xs text-ink-soft">
                  {role === 'clinician' ? 'Opens records and fills in forms for you to check' : 'Tell me which page to open'}
                </p>
              </div>
            </div>
            <button type="button" onClick={close} aria-label="Close assistant" className="rounded-full p-2 text-ink-soft hover:bg-canvas">
              <X size={18} aria-hidden="true" />
            </button>
          </header>

          <ol ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
            {steps.length === 0 && (
              <li className="text-sm text-ink-soft">
                {role === 'clinician'
                  ? 'Try “show today’s schedule”, “book <patient name> tomorrow at 10 am” or “add question “any swelling?” as a written answer”.'
                  : 'Try “open my reports”, “mere reports dikhao” or “go to my profile”.'}
              </li>
            )}
            {steps.map((step) => (
              <li key={step.id} className="space-y-1.5">
                {step.continued
                  ? <p className="text-xs uppercase tracking-wide text-ink-soft">Continuing on the page</p>
                  : <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-canvas px-3 py-2 text-sm">{step.message}</p>}
                <Reply
                  step={step}
                  onChoose={(path) => go(path, step.id)}
                  onPickPatient={(option) => choose(option, step)}
                  onAnswer={(yes) => answer(step.id, yes)}
                  onStop={() => stop(step)}
                />
              </li>
            ))}
          </ol>

          <form onSubmit={submit} className="flex items-center gap-2 border-t border-line p-3">
            <input
              ref={inputRef}
              value={text}
              onChange={(event) => setText(event.target.value)}
              maxLength={MAX_CHARS}
              placeholder="Type what you want to do"
              aria-label="Message to the assistant"
              className="min-w-0 flex-1 rounded-xl border border-line bg-canvas px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button
              type="submit"
              disabled={busy || !text.trim()}
              aria-label="Send"
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-white disabled:opacity-40"
            >
              <Send size={16} aria-hidden="true" />
            </button>
          </form>
        </section>
      )}
    </>
  );
}

const MORE_NOTE = 'I couldn’t do all of that, so please do the last step yourself.';
const FILLED_NOTE = 'Filled in the date and time. Check them, then press Create visit and invite yourself.';
const CHECK_NOTE = 'Check the highlighted fields before you save.';
const FILL_FAILED_NOTE = 'I could not fill in the form, so please enter the details yourself.';

function Line({ done, children }) {
  return (
    <span className={`flex items-start gap-1.5 ${done ? 'text-primary' : 'text-ink-soft'}`}>
      {done ? <Check size={15} className="mt-0.5 shrink-0" aria-hidden="true" /> : <span aria-hidden="true" className="inline-block w-[15px] shrink-0 text-center">·</span>}
      <span>{children}</span>
    </span>
  );
}

const Note = ({ children }) => <span className="block pl-5 text-ink-soft">{children}</span>;

function PressLine({ press, state }) {
  if (state === 'done') return <Line done>{press.effect === 'ui' ? `Pressed ${press.label}` : `${press.label}: done`}</Line>;
  if (state === 'cancelled') return <Note>Cancelled. Nothing was saved or sent.</Note>;
  if (state === 'failed') return <Note>{press.label} did not go through. Please check the page.</Note>;
  if (state === 'unavailable') return <Note>{press.label} isn’t ready yet. Complete the form, then press it yourself.</Note>;
  if (state === 'confirming') return null;
  return <Line done={false}>Next: press {press.label}</Line>;
}

const PENDING_VERB = { click: 'press', type: 'type in', append: 'add to', replace: 'change in', select: 'choose in', check: 'tick' };

/** Actions on elements read from the page: done, waiting, refused. */
function PageLines({ page, states = [], confirm, onAnswer }) {
  return (
    <>
      {page.actions.map((action, j) => {
        const state = states[j];
        const label = action.op === 'replace'
          ? `"${action.name}": “${action.find}” → “${action.value}”`
          : `"${action.name}"${action.value !== undefined ? `: ${action.value}` : ''}`;
        return (
          <span key={`${action.ref}-${j}`} className="block space-y-1">
            {state === 'done' && <Line done>{DONE_VERB[action.op]} {label}</Line>}
            {state === 'cancelled' && <Note>Cancelled. Nothing was pressed or saved.</Note>}
            {state === 'failed' && (action.op === 'replace'
              ? <Note>I couldn’t find “{action.find}” in “{action.name}”, so nothing was changed.</Note>
              : <Note>“{action.name}” changed or disappeared, so I stopped. Please check the page.</Note>)}
            {!state && <Line done={false}>Next: {PENDING_VERB[action.op]} {label}</Line>}
            {state === 'confirming' && confirm && states.indexOf('confirming') === j && (
              <ConfirmCard {...confirm} onConfirm={() => onAnswer(true)} onCancel={() => onAnswer(false)} />
            )}
          </span>
        );
      })}
      {page.refused.map((item) => <Note key={item.name}>Didn’t touch “{item.name}”: {item.reason}.</Note>)}
    </>
  );
}

function Reply({ step, onChoose, onPickPatient, onAnswer, onStop }) {
  const { reply, chosen, progress = 0, results = [], confirm, running } = step;
  if (!reply) return <p className="text-sm text-ink-soft">{step.continued ? 'Reading the page…' : 'Working…'}</p>;

  const checklist = step.checklist || reply.checklist || [];

  if (reply.type === 'unsupported') {
    return (
      <div className="space-y-1 text-sm text-ink-soft">
        {checklist.length > 0 && (
          <ul className="mb-2 space-y-1 rounded-lg border border-line bg-canvas p-2 text-xs">
            {checklist.map((item, i) => (
              <li key={i} className={`flex items-start gap-1.5 ${item.done ? 'text-primary' : 'text-ink-soft'}`}>
                {item.done ? <Check size={13} className="mt-0.5 shrink-0" /> : <span className="inline-block w-[13px] shrink-0 text-center">·</span>}
                <span className={item.done ? 'line-through opacity-70' : ''}>{item.text || item.item}</span>
              </li>
            ))}
          </ul>
        )}
        <p>{reply.message || 'Couldn’t complete this request.'}</p>
      </div>
    );
  }

  if (reply.type === 'answer') {
    return (
      <div className="space-y-0.5 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">Assistant tip</p>
        <p className="text-ink">{reply.text}</p>
      </div>
    );
  }

  if (reply.type === 'done') return <p style={{ whiteSpace: 'pre-line' }} className="flex items-center gap-1.5 text-sm text-primary"><Check size={15} aria-hidden="true" />{reply.message || 'Completed.'}</p>;

  if (reply.type === 'run') {
    const finished = !running && progress >= reply.steps.length;
    const filledFields = reply.steps.some((item, index) => item.fill?.filled && results[index]?.fill === 'filled');
    const saves = reply.steps.some((item) => item.press && item.press.effect !== 'ui');
    return (
      <div className="space-y-1 text-sm">
        {checklist.length > 0 && (
          <ul className="mb-2 space-y-1 rounded-lg border border-line bg-canvas p-2 text-xs">
            {checklist.map((item, i) => (
              <li key={i} className={`flex items-start gap-1.5 ${item.done ? 'text-primary' : 'text-ink-soft'}`}>
                {item.done ? <Check size={13} className="mt-0.5 shrink-0" /> : <span className="inline-block w-[13px] shrink-0 text-center">·</span>}
                <span className={item.done ? 'line-through opacity-70' : ''}>{item.text || item.item}</span>
              </li>
            ))}
          </ul>
        )}
        <ol className="space-y-1">
          {reply.steps.map((item, index) => {
            const started = index < progress;
            const result = results[index] || {};
            return (
              <li key={`${item.path ?? 'here'}-${index}`} className="space-y-1">
                {(item.path || (!started && !item.page)) && <Line done={started}>{started ? 'Opened' : 'Next:'} {item.label}</Line>}
                {item.page && <PageLines page={item.page} states={result.page} confirm={confirm} onAnswer={onAnswer} />}
                {result.fill === 'filled' && (item.fill.filled
                  ? item.fill.filled.map((field) => <Line key={field.id} done>{field.label}: {field.value}</Line>)
                  : <Note>{FILLED_NOTE}</Note>)}
                {result.fill === 'failed' && <Note>{FILL_FAILED_NOTE}</Note>}
                {result.fill === 'cancelled' && <Note>Cancelled. Nothing was filled or saved.</Note>}
                {confirm && result.fill === 'confirming' && (
                  <ConfirmCard {...confirm} onConfirm={() => onAnswer(true)} onCancel={() => onAnswer(false)} />
                )}
                {started && item.skipped?.map((skip) => <Note key={skip.label}>Didn’t fill {skip.label}: {skip.reason}.</Note>)}
                {started && item.notice && <Note>{item.notice}</Note>}
                {item.press && <PressLine press={item.press} state={result.press} />}
                {confirm && result.press === 'confirming' && (
                  <ConfirmCard {...confirm} onConfirm={() => onAnswer(true)} onCancel={() => onAnswer(false)} />
                )}
              </li>
            );
          })}
        </ol>
        {running && (
          <button type="button" onClick={onStop} className="rounded-full border border-line px-3 py-1 text-ink-soft hover:border-primary hover:text-primary">
            Stop
          </button>
        )}
        {finished && step.outcome === 'stopped' && <p className="text-ink-soft">Stopped. The form is left as it is.</p>}
        {finished && filledFields && !saves && <p className="text-ink-soft">{CHECK_NOTE}</p>}
        {finished && reply.more && <p className="text-ink-soft">{MORE_NOTE}</p>}
        {finished && reply.continue && step.outcome === 'done' && <p className="text-ink-soft">Reading the page again for the rest…</p>}
      </div>
    );
  }

  if (reply.type === 'choose') {
    return (
      <div className="space-y-1.5 text-sm">
        <p className="text-ink-soft">{reply.prompt}</p>
        <div className="flex flex-col gap-2">
          {reply.options.map((option) => (
            <button
              key={option.steps[0]?.path ?? option.label}
              type="button"
              onClick={() => onPickPatient(option)}
              className="rounded-xl border border-line px-3 py-2 text-left hover:border-primary"
            >
              <span className="block font-medium text-ink">{option.label}</span>
              {option.detail && <span className="block text-xs text-ink-soft">{option.detail}</span>}
            </button>
          ))}
        </div>
      </div>
    );
  }

  if (reply.type === 'navigate') {
    return (
      <div className="space-y-1 text-sm">
        <p className="flex items-center gap-1.5 text-primary">
          <Check size={15} aria-hidden="true" /> Opened {reply.label}
        </p>
        {reply.more && <p className="text-ink-soft">{MORE_NOTE}</p>}
      </div>
    );
  }

  if (reply.type === 'clarify') {
    return (
      <div className="space-y-1.5 text-sm">
        <p className="text-ink-soft">Did you mean:</p>
        <div className="flex flex-wrap gap-2">
          {reply.options.map((option) => (
            <button
              key={option.path}
              type="button"
              onClick={() => onChoose(option.path)}
              aria-pressed={chosen === option.path}
              className="rounded-full border border-line px-3 py-1 hover:border-primary hover:text-primary aria-pressed:border-primary aria-pressed:text-primary"
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
    );
  }

  return <p className="text-sm text-ink-soft">{reply.message}</p>;
}
