/**
 * Where pages register the form actions the assistant may use, and where the
 * assistant waits for a page it just opened to be ready. Plain JavaScript so it
 * can be tested without React.
 *
 * A wait can also say which registration it accepts (for example, "the card of
 * this patient, loaded"), so a fill never lands on the page that was open before.
 */
export function createBridgeRegistry() {
  const actionsByPage = new Map();
  const waiters = new Map();

  return {
    context: pageId => actionsByPage.get(pageId)?.context?.() ?? null,
    /** Returns a function that unregisters, for use as an effect cleanup. */
    register(pageId, actions) {
      actionsByPage.set(pageId, actions);
      const waiting = waiters.get(pageId) || [];
      const still = waiting.filter((waiter) => !waiter.offer(actions));
      if (still.length) waiters.set(pageId, still);
      else waiters.delete(pageId);
      return () => {
        if (actionsByPage.get(pageId) === actions) actionsByPage.delete(pageId);
      };
    },

    /** Resolves with the page's actions once it registers (and `accepts` them); rejects after `timeoutMs`. */
    waitFor(pageId, timeoutMs, accepts = () => true) {
      const ready = actionsByPage.get(pageId);
      if (ready && accepts(ready)) return Promise.resolve(ready);
      return new Promise((resolve, reject) => {
        const waiter = {
          offer(actions) {
            if (!accepts(actions)) return false;
            clearTimeout(timer);
            resolve(actions);
            return true;
          },
        };
        const timer = setTimeout(() => {
          waiters.set(pageId, (waiters.get(pageId) || []).filter((w) => w !== waiter));
          reject(new Error(`Page ${pageId} was not ready`));
        }, timeoutMs);
        waiters.set(pageId, [...(waiters.get(pageId) || []), waiter]);
      });
    },
  };
}
