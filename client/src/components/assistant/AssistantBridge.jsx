import { createContext, useContext, useEffect, useMemo, useRef } from 'react';
import { createBridgeRegistry } from './bridgeRegistry';

const BridgeContext = createContext(null);

/** One registry for the whole app, shared by pages and the assistant panel. */
export function AssistantBridgeProvider({ children }) {
  const registry = useMemo(() => createBridgeRegistry(), []);
  return <BridgeContext.Provider value={registry}>{children}</BridgeContext.Provider>;
}

export function useAssistantBridge() {
  return useContext(BridgeContext);
}

/**
 * Lets the assistant use a page's own form controls and buttons while the page
 * is shown. Only what is listed here exists; there is no general "click
 * anything", and the server lists the same ids.
 *
 *   controls: { [id]: { get(), set(value) } }
 *   applyMany(fields): optional, sets several controls in one update (may throw if the page is not ready)
 *   buttons:  { [id]: { run(): Promise<boolean>|boolean, summary(): [{ label, value }], available?(): boolean } }
 *   context(): optional, which record the page shows ({ patientId }); a fill meant for another record waits
 *   confirmFill(fields): optional, { ids, sideEffect } when filling these fields saves at once (asks first)
 *
 * Register once the page has loaded its data (`ready`), so a fill is not
 * overwritten by the page's own loading. Handlers are read through a ref, so a
 * press always sees the latest form state. A change of record registers again,
 * so a wait for that record is answered.
 */
export function useAssistantControls(pageId, definition, { ready = true } = {}) {
  const bridge = useContext(BridgeContext);
  const latest = useRef(definition);
  latest.current = definition;
  const contextKey = JSON.stringify(definition.context?.() ?? null);

  useEffect(() => {
    if (!bridge || !ready) return undefined;
    return bridge.register(pageId, {
      context: () => latest.current.context?.() ?? null,
      confirmFill: (fields) => latest.current.confirmFill?.(fields) ?? null,
      get: (id) => latest.current.controls?.[id]?.get?.(),
      fill: (fields) => {
        const { applyMany, controls = {} } = latest.current;
        if (applyMany) return applyMany(fields);
        Object.entries(fields).forEach(([id, value]) => controls[id]?.set(value));
        return undefined;
      },
      // A button the page would not let the user press yet (form incomplete, saving) counts as absent.
      hasButton: (id) => {
        const button = latest.current.buttons?.[id];
        return Boolean(button) && (button.available?.() ?? true);
      },
      summary: (id) => latest.current.buttons?.[id]?.summary?.() ?? [],
      press: (id) => latest.current.buttons?.[id]?.run(),
    });
  }, [bridge, pageId, ready, contextKey]);
}
