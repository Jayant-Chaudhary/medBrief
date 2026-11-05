const PANEL = '[data-assistant-panel]';
const LOADING = '[role="status"][aria-label="Loading"], .animate-spin, [aria-busy="true"]';

export function pageIsLoading() {
  return [...document.querySelectorAll(LOADING)].some(node =>
    !node.closest(PANEL) && !node.closest('[hidden], [aria-hidden="true"]') && node.getClientRects().length > 0);
}

/** A hard deadline remains active even if the DOM keeps mutating. */
export function settlePage({ quietMs, timeoutMs, signal }) {
  return new Promise(resolve => {
    let quietTimer;
    let deadlineTimer;
    let observer;
    let finished = false;
    const finish = ready => {
      if (finished) return;
      finished = true;
      clearTimeout(quietTimer);
      clearTimeout(deadlineTimer);
      observer?.disconnect();
      signal?.removeEventListener('abort', abort);
      resolve(ready);
    };
    const abort = () => finish(false);
    const schedule = () => {
      clearTimeout(quietTimer);
      quietTimer = setTimeout(() => {
        if (pageIsLoading()) schedule();
        else finish(true);
      }, quietMs);
    };
    if (signal?.aborted) { finish(false); return; }
    signal?.addEventListener('abort', abort, { once: true });
    observer = new MutationObserver(changes => {
      // Checklist painting, Confirm cards, and field outlines are not page loads.
      if (changes.some(change => {
        const node = change.target.nodeType === 1 ? change.target : change.target.parentElement;
        return !node?.closest(PANEL) && change.attributeName !== 'data-assistant-flash';
      })) schedule();
    });
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, characterData: true });
    deadlineTimer = setTimeout(() => finish(false), timeoutMs);
    schedule();
  });
}
