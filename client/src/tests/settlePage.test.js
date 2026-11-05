import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { settlePage } from '../components/assistant/settlePage';

let mutate;
let disconnect;
beforeEach(() => {
  vi.useFakeTimers();
  disconnect = vi.fn();
  vi.stubGlobal('document', { body: {}, querySelectorAll: () => [] });
  vi.stubGlobal('MutationObserver', class {
    constructor(callback) { mutate = callback; }
    observe() {}
    disconnect() { disconnect(); }
  });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

it('continuous page mutations hit the hard deadline instead of advancing', async () => {
  const result = settlePage({ quietMs: 300, timeoutMs: 1000 });
  for (let i = 0; i < 10; i += 1) {
    mutate([{ target: { nodeType: 1, closest: () => null } }]);
    await vi.advanceTimersByTimeAsync(100);
  }
  expect(await result).toBe(false);
  expect(disconnect).toHaveBeenCalledOnce();
});

it('checklist painting does not extend the page quiet period', async () => {
  const result = settlePage({ quietMs: 300, timeoutMs: 1000 });
  await vi.advanceTimersByTimeAsync(200);
  mutate([{ target: { nodeType: 1, closest: () => ({}) } }]);
  await vi.advanceTimersByTimeAsync(100);
  expect(await result).toBe(true);
});

it('Stop cancels a pending page wait', async () => {
  const controller = new AbortController();
  const result = settlePage({ quietMs: 300, timeoutMs: 1000, signal: controller.signal });
  controller.abort();
  expect(await result).toBe(false);
  expect(disconnect).toHaveBeenCalledOnce();
});
