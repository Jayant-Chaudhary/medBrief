import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, Send, X } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext.jsx';
import { assistantService } from '../../services/assistantService';
import { assistantVisibleOn } from './assistantRoutes';
import { useAssistantBridge } from './AssistantBridge.jsx';
import { runPlan } from './planRunner';
import ConfirmCard from './ConfirmCard.jsx';
import AssistantMark from './AssistantMark.jsx';

const ENABLED = import.meta.env.VITE_ASSISTANT_ENABLED === 'true';
const MAX_CHARS = 300;
const UNAVAILABLE = 'The assistant is not available right now. You can still use the menu.';
// Long enough to see each page open, short enough not to feel slow.
const STEP_DELAY_MS = 500;
// How long to wait for a page to load before giving up on filling its form.
const PAGE_READY_TIMEOUT_MS = 8000;
// Time for the page to re-render after a fill, before reading or outlining it.
const SETTLE_MS = 50;
// How long a filled field stays outlined.
const FLASH_MS = 2500;

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
  // Pending Confirm cards and stopped runs, by entry id.
  const confirmers = useRef(new Map());
  const stopped = useRef(new Set());

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

  function go(path, entryId) {
    update(entryId, { chosen: path });
    navigate(path);
    if (window.innerWidth < 640) setOpen(false);
  }

  function answer(entryId, yes) {
    const resolve = confirmers.current.get(entryId);
    confirmers.current.delete(entryId);
    update(entryId, { confirm: null });
    resolve?.(yes);
  }

  function stop(entryId) {
    stopped.current.add(entryId);
    answer(entryId, false);
  }

  /** Runs the plan step by step, so the user sees each page open and each field fill. */
  async function execute(plan, entryId) {
    const results = [];
    update(entryId, { running: true, progress: 0, results: [] });
    const outcome = await runPlan(plan, {
      navigate: (path, state) => navigate(path, state ? { state } : undefined),
      // A fill after opening a page waits until that page shows the intended record
      // (a named patient, or none), never the one that was open before.
      waitFor: (page, context) => bridge.waitFor(
        page,
        PAGE_READY_TIMEOUT_MS,
        context ? (actions) => (actions.context()?.patientId ?? null) === context.patientId : undefined
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
      stopped: () => stopped.current.has(entryId),
    }, { stepDelayMs: STEP_DELAY_MS });
    update(entryId, { running: false, confirm: null, outcome });
    if (outcome === 'done' && window.innerWidth < 640) setOpen(false);
  }

  function choose(option, entryId, more) {
    update(entryId, { reply: { type: 'run', steps: option.steps, ...(more && { more }) }, progress: 0 });
    execute(option.steps, entryId);
  }

  async function submit(event) {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    const id = crypto.randomUUID();
    setSteps((current) => [...current, { id, message, reply: null }]);
    setText('');
    setBusy(true);
    try {
      const reply = await assistantService.ask(message, location.pathname);
      setSteps((current) => current.map((s) => (s.id === id ? { ...s, reply } : s)));
      if (reply.type === 'navigate') go(reply.path, id);
      if (reply.type === 'run') execute(reply.steps, id);
    } catch (err) {
      const note = err?.status === 429 ? 'Too many requests. Please wait a moment.' : UNAVAILABLE;
      setSteps((current) => current.map((s) => (s.id === id ? { ...s, reply: { type: 'unavailable', message: note } } : s)));
    } finally {
      setBusy(false);
      inputRef.current?.focus();
    }
  }

  return (
    <>
      {!open && (
        <button
          ref={buttonRef}
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open assistant"
          className="assistant-button fixed bottom-5 right-5 z-40 flex h-12 w-12 items-center justify-center rounded-full shadow-card transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
        >
          <AssistantMark size={30} />
        </button>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Assistant"
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
                <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-canvas px-3 py-2 text-sm">{step.message}</p>
                <Reply
                  step={step}
                  onChoose={(path) => go(path, step.id)}
                  onPickPatient={(option) => choose(option, step.id, step.reply?.more)}
                  onAnswer={(yes) => answer(step.id, yes)}
                  onStop={() => stop(step.id)}
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

function Reply({ step, onChoose, onPickPatient, onAnswer, onStop }) {
  const { reply, chosen, progress = 0, results = [], confirm, running } = step;
  if (!reply) return <p className="text-sm text-ink-soft">Working…</p>;

  if (reply.type === 'run') {
    const finished = !running && progress >= reply.steps.length;
    const filledFields = reply.steps.some((item, index) => item.fill?.filled && results[index]?.fill === 'filled');
    const saves = reply.steps.some((item) => item.press && item.press.effect !== 'ui');
    return (
      <div className="space-y-1 text-sm">
        <ol className="space-y-1">
          {reply.steps.map((item, index) => {
            const started = index < progress;
            const result = results[index] || {};
            return (
              <li key={`${item.path ?? 'here'}-${index}`} className="space-y-1">
                {(item.path || !started) && <Line done={started}>{started ? 'Opened' : 'Next:'} {item.label}</Line>}
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
