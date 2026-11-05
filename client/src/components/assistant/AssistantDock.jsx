import { useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Check, Send, X } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext.jsx';
import { assistantService } from '../../services/assistantService';
import { assistantVisibleOn } from './assistantRoutes';
import { useAssistantBridge } from './AssistantBridge.jsx';
import { createRequestControl } from './requestControl';
import { showVerifiedProgress } from './sequentialProgress';
import { settlePage, pageIsLoading } from './settlePage';
import { runPlan } from './planRunner';
import { readPage } from './pageReader';
import { executeAction } from './pageActions';
import { readRecord, rememberRecord, recordPath, hashWrittenValue } from './recordContext';
import { pruneMemory, buildMemoryEntry, appendMemory } from './memoryState';
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
// How long a filled field stays outlined.
const FLASH_MS = 2500;

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Two frames ensure React's checklist commit reaches the screen before planning.
const paintProgress = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
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
  const [memory, setMemory] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dockPos, setDockPos] = useState(() => {
    try {
      const saved = localStorage.getItem('assistant_dock_pos');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (typeof parsed?.x === 'number' && typeof parsed?.y === 'number') return parsed;
      }
    } catch (_) {}
    return null;
  });
  const dragRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const inputRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const warmed = useRef(false);
  const wasOpen = useRef(false);
  // Pending Confirm cards by entry id; stopped requests by request id (a request may take several rounds).
  const confirmers = useRef(new Map());
  const stopped = useRef(new Set());
  const controls = useRef(new Map());
  const activeRequest = useRef(null);
  const memoryContexts = useRef(new Map());
  const choosing = useRef(new Set());
  const uiTiming = useRef({ settleQuietMs: 300, settleTimeoutMs: 3000, progressPauseMs: 500 });
  // The path now, for rounds that start after the page changed.
  const pathRef = useRef(location.pathname);
  pathRef.current = location.pathname;

  const verified = profile?.clinicianDetails?.is_verified === true;
  const visible = enabled && !loading && Boolean(user) && assistantVisibleOn(location.pathname, { role, verified });

  useEffect(() => {
    if (!user) {
      controls.current.forEach(control => control.stop());
      memoryContexts.current.clear();
      setMemory([]);
      setSteps([]);
    }
  }, [user]);

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

  const handlePointerDown = (e) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const btn = buttonRef.current;
    if (!btn) return;
    const rect = btn.getBoundingClientRect();
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
      hasMoved: false,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handlePointerMove = (e) => {
    if (!dragRef.current) return;
    const dx = e.clientX - dragRef.current.startX;
    const dy = e.clientY - dragRef.current.startY;
    if (!dragRef.current.hasMoved && Math.hypot(dx, dy) > 4) {
      dragRef.current.hasMoved = true;
      setIsDragging(true);
    }
    if (dragRef.current.hasMoved) {
      const maxX = Math.max(12, window.innerWidth - 68);
      const maxY = Math.max(12, window.innerHeight - 68);
      const newX = Math.min(Math.max(12, dragRef.current.originX + dx), maxX);
      const newY = Math.min(Math.max(12, dragRef.current.originY + dy), maxY);
      setDockPos({ x: newX, y: newY });
    }
  };

  const handlePointerUp = (e) => {
    if (!dragRef.current) return;
    const moved = dragRef.current.hasMoved;
    dragRef.current = null;
    setIsDragging(false);
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    if (moved) {
      setDockPos((curr) => {
        if (curr) {
          try {
            localStorage.setItem('assistant_dock_pos', JSON.stringify(curr));
          } catch (_) {}
        }
        return curr;
      });
    } else {
      setOpen(true);
    }
  };

  const handlePointerCancel = () => {
    dragRef.current = null;
    setIsDragging(false);
  };

  function close() {
    setOpen(false);
  }

  const dialogDragRef = useRef(null);

  const handleDialogPointerDown = (e) => {
    if (e.target.closest('button, input, textarea, a')) return;
    if (e.button !== 0 && e.pointerType === 'mouse') return;
    const dialog = e.currentTarget.closest('section');
    if (!dialog) return;
    const rect = dialog.getBoundingClientRect();
    dialogDragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      originX: rect.left,
      originY: rect.top,
    };
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch (_) {}
  };

  const handleDialogPointerMove = (e) => {
    if (!dialogDragRef.current) return;
    const dx = e.clientX - dialogDragRef.current.startX;
    const dy = e.clientY - dialogDragRef.current.startY;
    const maxX = Math.max(12, window.innerWidth - 372);
    const maxY = Math.max(12, window.innerHeight - 492);
    const newX = Math.min(Math.max(12, dialogDragRef.current.originX + dx), maxX);
    const newY = Math.min(Math.max(12, dialogDragRef.current.originY + dy), maxY);
    // Align button position with the bottom-right of the dialog
    setDockPos({ x: newX + 360 - 56, y: newY + 480 - 56 });
  };

  const handleDialogPointerUp = (e) => {
    if (!dialogDragRef.current) return;
    dialogDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch (_) {}
    setDockPos((curr) => {
      if (curr) {
        try {
          localStorage.setItem('assistant_dock_pos', JSON.stringify(curr));
        } catch (_) {}
      }
      return curr;
    });
  };

  function getDialogStyle() {
    if (!dockPos || typeof window === 'undefined' || window.innerWidth < 640) return undefined;
    const DIALOG_W = 360;
    const DIALOG_H = 480;
    let left = dockPos.x + 56 > window.innerWidth / 2 ? dockPos.x + 56 - DIALOG_W : dockPos.x;
    let top = dockPos.y + 56 > window.innerHeight / 2 ? dockPos.y + 56 - DIALOG_H : dockPos.y;
    left = Math.max(12, Math.min(window.innerWidth - DIALOG_W - 12, left));
    top = Math.max(12, Math.min(window.innerHeight - DIALOG_H - 12, top));
    return {
      position: 'fixed',
      left: `${left}px`,
      top: `${top}px`,
      bottom: 'auto',
      right: 'auto',
    };
  }

  function forgetMemory() {
    setMemory([]);
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
    controls.current.get(entry.requestId)?.stop();
    if (activeRequest.current === entry.requestId) setBusy(false);
    answer(entry.id, false);
  }

  function requestControl(requestId) {
    if (!controls.current.has(requestId)) {
      const control = createRequestControl();
      controls.current.set(requestId, control);
      control.onStop(reason => {
        const message = {
          MISSING_DEADLINE: 'The assistant backend did not provide an expiry time. Restart the backend server, refresh this page, and try again.',
          EXPIRED: 'The assistant request timed out. Please start again.',
          RECORD_CHANGED: 'The open page or patient changed while the assistant was working. Please start again on the intended record.',
          INVALID_TARGET: 'The assistant could not resolve the destination. Please start again.',
          PAGE_LOADING: 'The page did not finish loading. I stopped before the next action. Please check the page.',
          ACK_FAILED: 'I could not verify the last action. I stopped to avoid repeating it. Please check the page before starting again.',
          STOPPED: 'Stopped.',
        }[reason] || 'Stopped. Please start again.';
        stopped.current.add(requestId);
        setSteps(current => current.map(entry => entry.requestId === requestId
          ? { ...entry, waiting: false, running: false, outcome: 'stopped', confirm: null, reply: { type: 'unsupported', message, checklist: entry.reply?.checklist || entry.checklist } }
          : entry));
        if (activeRequest.current === requestId) setBusy(false);
      });
    }
    return controls.current.get(requestId);
  }

  function waitForSettle(signal) {
    return settlePage({ quietMs: uiTiming.current.settleQuietMs, timeoutMs: uiTiming.current.settleTimeoutMs, signal });
  }

  /** Runs the plan step by step, so the user sees each page open and each field fill. */
  async function execute(plan, entryId, requestId, names = new Map()) {
    const control = requestControl(requestId);
    const pageScope = () => JSON.stringify([pathRef.current, readRecord(window.location, bridge)]);
    const expectedScope = pageScope();
    const actionResults = [];
    const results = [];
    update(entryId, { running: true, progress: 0, results: [] });
    const outcome = await runPlan(plan, {
      pageId: pageIdOf(pathRef.current),
      // Acts only if the element still has the label it had when the page was read.
      pageAction: (action) => {
        if (control.stopped() || pageScope() !== expectedScope) {
          if (!control.stopped()) control.stop('RECORD_CHANGED');
          return { result: 'refused' };
        }
        return observeAction(() => executeAction({ ...action, name: names.get(action.ref) || action.name }), () => waitForSettle(control.signal));
      },
      record: result => actionResults.push(result),
      capture: capturePage,
      arrive: async path => {
        const settled = await waitForSettle(control.signal);
        return settled && window.location.pathname + window.location.search === path && !pageIsLoading();
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
      settle: () => waitForSettle(control.signal),
      highlight,
      confirm: (card) => new Promise((resolve) => {
        if (control.stopped()) { resolve(false); return; }
        let unsubscribe = () => {};
        const finish = yes => {
          unsubscribe();
          confirmers.current.delete(entryId);
          update(entryId, { confirm: null });
          resolve(yes && !control.stopped());
        };
        confirmers.current.set(entryId, finish);
        update(entryId, { confirm: card });
        unsubscribe = control.onStop(() => finish(false));
      }),
      report: (page, button, result, errorCode) => assistantService.event(page, button, result, errorCode).catch(() => {}),
      progress: (index, result) => {
        results[index] = result;
        update(entryId, { progress: index + 1, results: [...results] });
      },
      stopped: () => stopped.current.has(requestId) || control.stopped(),
    }, { stepDelayMs: STEP_DELAY_MS });
    update(entryId, { running: false, waiting: true, confirm: null, outcome });
    return { outcome, actionResults };
  }

  /**
   * One round of a request: read the open page (doctors; labels only), ask,
   * run what comes back. If the server says the request isn't finished (a
   * panel had to open, a page had to load), read the page again and go on.
   */
  async function runRound({ message, requestId, round, progress, mode, continuationToken, startedAt = Date.now(), originRecord = null, written = [], checklist = [], note = '', results = [] }) {
    const control = requestControl(requestId);
    if (control.stopped()) return;
    const requestPath = pathRef.current;
    const requestRecord = JSON.stringify(readRecord(window.location, bridge));
    memoryContexts.current.set(requestId, rememberRecord(window.location, bridge, memoryContexts.current.get(requestId)));
    const id = crypto.randomUUID();
    setSteps((current) => [...current.map(entry => entry.requestId === requestId ? { ...entry, waiting: false } : entry), { id, requestId, message, round, progress, mode, continuationToken, startedAt, originRecord, written, checklist, note, results, waiting: true, continued: round > 0, reply: null }]);
    const { page, names } = role === 'clinician' ? readPage() : { page: undefined, names: new Map() };
    let reply;
    setBusy(true);
    try {
      const activeMemory = pruneMemory(memory);
      if (activeMemory.length !== memory.length) setMemory(activeMemory);
      reply = await assistantService.ask(message, pathRef.current, { page, signal: control.signal, currentRecord: readRecord(window.location, bridge), round, progress, mode, continuationToken, startedAt, originRecord, written, memory: activeMemory, checklist, note, results });
    } catch (err) {
      if (control.stopped()) return;
      const errNote = err?.status === 429 ? 'Too many requests. Please wait a moment.' : UNAVAILABLE;
      update(id, { waiting: false, reply: { type: 'unavailable', message: errNote } });
      inputRef.current?.focus();
      setBusy(false);
      return;
    }
    if (control.stopped()) return;
    control.setDeadline(reply.expiresAt);
    if (control.stopped()) return;
    if (reply.uiTiming) uiTiming.current = reply.uiTiming;
    if (requestPath !== pathRef.current || requestRecord !== JSON.stringify(readRecord(window.location, bridge))) {
      control.stop('RECORD_CHANGED'); return;
    }
    const currentChecklist = reply.checklist || checklist;
    const currentNote = reply.note || note;
    // Earlier rounds belong to the same request. Show the latest verified
    // checklist on every card instead of leaving old copies unticked.
    setSteps(current => current.map(entry => entry.requestId === requestId
      ? { ...entry, checklist: currentChecklist, ...(entry.id === id ? { reply, names, note: currentNote } : {}) }
      : entry));

    // Paint the plan before executing it; patient choices wait for a selection.
    await paintProgress();
    if (control.stopped()) return;
    if (reply.type === 'choose') { update(id, { waiting: false }); return; }

    let outcome = 'done';
    let actionResults = [];
    if (reply.type === 'navigate') {
      const targetPath = reply.recordTarget ? recordPath(reply.recordTarget) : reply.path;
      if (!targetPath) { control.stop('INVALID_TARGET'); return; }
      if (reply.state) {
        update(id, { chosen: targetPath });
        navigate(targetPath, { state: reply.state });
      } else go(targetPath, id, reply.continue);
      const settled = await waitForSettle(control.signal);
      const arrived = settled && window.location.pathname + window.location.search === targetPath && !pageIsLoading();
      actionResults = [{ actionId: reply.actionId, result: arrived ? 'ok' : 'no_change' }];
    } else if (reply.type === 'run') {
      ({ outcome, actionResults } = await execute(reply.steps, id, requestId, names));
    }
    if (control.stopped()) return;
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
    const control = requestControl(requestId);
    if (control.stopped()) return;
    if (!reply.continue || stopped.current.has(requestId)) {
      control.dispose();
      setSteps(current => current.map(entry => entry.requestId === requestId ? { ...entry, waiting: false } : entry));
      if (role === 'clinician' && reply && reply.type !== 'unavailable') {
        const endContext = rememberRecord(window.location, bridge, memoryContexts.current.get(requestId));
        const entry = buildMemoryEntry({
          message,
          patient: endContext?.patient || null,
          record: endContext?.record || null,
          page: pageIdOf(pathRef.current),
          checklist: reply.checklist || checklist,
        });
        setMemory((prev) => appendMemory(prev, entry));
      }
      memoryContexts.current.delete(requestId);
      setBusy(false);
      if (outcome === 'done' && !(reply.checklist || checklist).length && window.innerWidth < 640) setOpen(false);
      // Back to the message box only when the request is over: moving focus mid-request would
      // close what the page just opened (a list of templates, a menu).
      inputRef.current?.focus();
      return;
    }
    const settled = await waitForSettle(control.signal);
    if (!settled && !control.stopped()) control.stop('PAGE_LOADING');
    if (stopped.current.has(requestId) || control.stopped()) {
      if (activeRequest.current === requestId) setBusy(false);
      return;
    }
    // A fast signed receipt updates the checklist BEFORE the next model call.
    // Never send these results again to the planning request.
    const requestPath = pathRef.current;
    const record = readRecord(window.location, bridge);
    const { page } = role === 'clinician' ? readPage() : {};
    let receipt;
    try {
      receipt = await assistantService.ask(message, requestPath, {
        page, signal: control.signal, currentRecord: record, round: round + 1,
        mode: reply.mode, continuationToken: reply.continuationToken, acknowledgeOnly: true,
        startedAt, originRecord, written, checklist, note, results,
      });
    } catch {
      if (!control.stopped()) control.stop('ACK_FAILED');
      return;
    }
    if (control.stopped()) return;
    control.setDeadline(receipt.expiresAt);
    if (control.stopped()) return;
    if (requestPath !== pathRef.current || JSON.stringify(record) !== JSON.stringify(readRecord(window.location, bridge))) {
      control.stop('RECORD_CHANGED'); return;
    }
    if (!['checkpoint', 'done', 'unsupported'].includes(receipt.type) ||
        (receipt.continue && (receipt.type !== 'checkpoint' || !receipt.continuationToken))) {
      control.stop('ACK_FAILED'); return;
    }
    const verifiedChecklist = receipt.checklist || checklist;
    const shown = await showVerifiedProgress({
      publish: () => setSteps(current => {
        const lastId = current.filter(entry => entry.requestId === requestId).at(-1)?.id;
        return current.map(entry => entry.requestId === requestId ? {
          ...entry, checklist: verifiedChecklist, waiting: entry.id === lastId && Boolean(receipt.continue),
          ...(entry.id === lastId && !receipt.continue ? { reply: receipt } : {}),
        } : entry);
      }),
      paint: paintProgress, pause, stopped: () => control.stopped(), delayMs: uiTiming.current.progressPauseMs,
    });
    if (!shown) return;
    if (!receipt.continue) {
      await continueAfter(receipt, outcome, { message, requestId, round, progress, startedAt, originRecord, written, checklist: verifiedChecklist, note });
      return;
    }
    await runRound({
      message,
      requestId,
      round: round + 1,
      progress,
      mode: receipt.mode, continuationToken: receipt.continuationToken, startedAt, originRecord, written,
      checklist: verifiedChecklist,
      note,
      results: [],
    });
  }

  async function choose(option, entry) {
    if (requestControl(entry.requestId).stopped() || choosing.current.has(entry.id)) return;
    choosing.current.add(entry.id);
    const reply = { ...entry.reply, type: 'run', steps: option.steps };
    update(entry.id, { reply, progress: 0, chosen: true });
    const { outcome, actionResults } = await execute(option.steps, entry.id, entry.requestId, entry.names);
    await continueAfter(reply, outcome, { ...entry, results: actionResults });
  }

  function submit(event) {
    event.preventDefault();
    const message = text.trim();
    if (!message || busy) return;
    setText('');
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    runRound({ message, requestId, round: 0, progress: [], originRecord: readRecord(window.location, bridge) });
  }

  return (
    <>
      {!open && (
        <div
          style={dockPos ? { left: `${dockPos.x}px`, top: `${dockPos.y}px`, bottom: 'auto', right: 'auto' } : undefined}
          className={`${dockPos ? 'fixed' : 'fixed bottom-5 right-5'} z-40 touch-none select-none`}
        >
          {/* Animated Glow Highlight Ring */}
          <span
            className="assistant-highlight-ring absolute -inset-1.5 rounded-full pointer-events-none"
            aria-hidden="true"
          />
          {/* Subtle Outer Highlight Ring */}
          <span
            className="absolute -inset-0.5 rounded-full border border-teal-300/80 pointer-events-none"
            aria-hidden="true"
          />
          <button
            ref={buttonRef}
            type="button"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={handlePointerUp}
            onPointerCancel={handlePointerCancel}
            aria-label="Open assistant"
            data-assistant-panel=""
            className={`assistant-button relative flex h-14 w-14 items-center justify-center rounded-full shadow-lg transition-transform focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 ${isDragging ? 'cursor-grabbing scale-105' : 'cursor-grab hover:scale-105'}`}
          >
            <AssistantMark size={36} />
          </button>
        </div>
      )}

      {open && (
        <section
          role="dialog"
          aria-label="Assistant"
          style={getDialogStyle()}
          // The page reader never reads or acts on the assistant itself.
          data-assistant-panel=""
          onKeyDown={(event) => event.key === 'Escape' && close()}
          className={`fixed inset-0 z-50 flex flex-col border border-line bg-raised text-ink shadow-card ${dockPos ? '' : 'sm:bottom-5 sm:right-5'} sm:inset-auto sm:h-[480px] sm:w-[360px] sm:rounded-card`}
        >
          <header
            onPointerDown={handleDialogPointerDown}
            onPointerMove={handleDialogPointerMove}
            onPointerUp={handleDialogPointerUp}
            className="flex cursor-grab items-center justify-between border-b border-line px-4 py-3 active:cursor-grabbing touch-none select-none"
          >
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
            <div className="flex items-center gap-1">
              {role === 'clinician' && memory.length > 0 && (
                <button
                  type="button"
                  onClick={forgetMemory}
                  aria-label="Forget session memory"
                  className="rounded-full px-2.5 py-1 text-xs font-medium text-ink-soft hover:bg-canvas hover:text-ink"
                >
                  Forget
                </button>
              )}
              <button type="button" onClick={close} aria-label="Close assistant" className="rounded-full p-2 text-ink-soft hover:bg-canvas">
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          </header>

          <ol ref={listRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-3" aria-live="polite">
            {steps.length === 0 && (
              <li className="text-sm text-ink-soft">
                {role === 'clinician'
                  ? 'Try “show today’s schedule”, “book <patient name> tomorrow at 10 am” or “add question “any swelling?” as a written answer”.'
                  : 'Try “open my reports”, “mere reports dikhao” or “go to my profile”.'}
              </li>
            )}
            {steps.map((step, index) => (
              <li key={step.id} className="space-y-1.5">
                {step.continued
                  ? <p className="text-xs uppercase tracking-wide text-ink-soft">Continuing on the page</p>
                  : <p className="ml-auto w-fit max-w-[85%] rounded-2xl bg-canvas px-3 py-2 text-sm">{step.message}</p>}
                {!steps.slice(index + 1).some(entry => entry.requestId === step.requestId) && (
                  <RequestChecklist items={step.checklist || step.reply?.checklist || []} />
                )}
                <Reply
                  step={step}
                  onChoose={(path) => { if (!requestControl(step.requestId).stopped()) go(path, step.id); }}
                  onPickPatient={(option) => choose(option, step)}
                  onAnswer={(yes) => answer(step.id, yes)}
                  onStop={() => stop(step)}
                />
                {step.waiting && !step.running && (
                  <button type="button" onClick={() => stop(step)} className="rounded-full border border-line px-3 py-1 text-sm text-ink-soft">
                    Stop
                  </button>
                )}
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

function RequestChecklist({ items }) {
  if (!items.length) return null;
  return (
    <ul aria-label="Request progress" className="mb-2 space-y-1 rounded-lg border border-line bg-canvas p-2 text-xs">
      {items.map((item, i) => (
        <li key={item.id || i} className={`flex items-start gap-1.5 ${item.done ? 'text-primary' : 'text-ink-soft'}`}>
          {item.done ? <Check size={13} className="mt-0.5 shrink-0" /> : <span className="inline-block w-[13px] shrink-0 text-center">·</span>}
          <span className={item.done ? 'line-through opacity-70' : ''}>{item.text || item.item}</span>
        </li>
      ))}
    </ul>
  );
}

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

  if (reply.type === 'unsupported') {
    return (
      <div className="space-y-1 text-sm text-ink-soft">
        <p>{reply.message || 'Couldn’t complete this request.'}</p>
      </div>
    );
  }

  if (reply.type === 'answer') {
    return (
      <div className="space-y-1.5 text-sm">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-soft">
          {reply.source === 'clinical_record' ? 'Patient Record' : 'Assistant tip'}
        </p>
        <p className="text-ink leading-relaxed">{reply.text}</p>
        {reply.recordPath && (
          <button
            type="button"
            onClick={() => onChoose?.(reply.recordPath)}
            className="mt-1 inline-flex items-center gap-1 rounded-full border border-teal-500/30 bg-teal-500/10 px-3 py-1 text-xs font-medium text-teal-700 hover:bg-teal-500/20 dark:text-teal-300"
          >
            {reply.recordLabel || 'View Record'} →
          </button>
        )}
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
              disabled={running || step.chosen}
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
    const options = reply.options || [];
    return (
      <div className="space-y-1.5 text-sm">
        <p className="text-ink-soft">{reply.message || (options.length ? 'Did you mean:' : 'Please clarify what you want to do.')}</p>
        {options.length > 0 && <div className="flex flex-wrap gap-2">
          {options.map((option) => (
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
        </div>}
      </div>
    );
  }

  return <p className="text-sm text-ink-soft">{reply.message}</p>;
}
