// One tab request owns cancellation and a server-provided absolute deadline.
export function createRequestControl() {
  const controller = new AbortController();
  let deadline = Infinity;
  let timer;
  let reason = null;
  const listeners = new Set();
  function stop(code = 'STOPPED') {
    if (controller.signal.aborted) return;
    clearTimeout(timer);
    reason = code;
    controller.abort();
    for (const listener of listeners) listener(reason);
    listeners.clear();
  }
  return {
    signal: controller.signal,
    get reason() { return reason; },
    stop,
    stopped: () => controller.signal.aborted || Date.now() >= deadline,
    setDeadline(value) {
      if (!Number.isFinite(value)) { stop('MISSING_DEADLINE'); return; }
      deadline = Math.min(deadline, value);
      clearTimeout(timer);
      if (Date.now() >= deadline) stop('EXPIRED');
      else timer = setTimeout(() => stop('EXPIRED'), deadline - Date.now());
    },
    onStop(listener) {
      if (controller.signal.aborted || Date.now() >= deadline) { listener(reason || 'EXPIRED'); return () => {}; }
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    dispose() { clearTimeout(timer); listeners.clear(); },
  };
}
