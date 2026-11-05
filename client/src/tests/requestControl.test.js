import { it, expect, vi } from 'vitest';
import { createRequestControl } from '../components/assistant/requestControl';
import { runPlan } from '../components/assistant/planRunner';
it('Stop cancels pending network work and pending confirmation listeners', () => {
  const control = createRequestControl(), cancelled = vi.fn();
  control.onStop(cancelled);
  control.stop();
  expect(control.signal.aborted).toBe(true);
  expect(control.stopped()).toBe(true);
  expect(cancelled).toHaveBeenCalledOnce();
});
it('a server deadline expires pending confirmation and cannot be extended', () => {
  vi.useFakeTimers();
  try {
    const control = createRequestControl(), cancelled = vi.fn();
    control.onStop(cancelled);
    control.setDeadline(Date.now() + 100);
    control.setDeadline(Date.now() + 1000);
    vi.advanceTimersByTime(100);
    expect(control.stopped()).toBe(true);
    expect(cancelled).toHaveBeenCalledOnce();
    control.dispose();
  } finally { vi.useRealTimers(); }
});
it('Stop during bridge loading prevents a subsequent fill', async () => {
  const fill = vi.fn();
  let stopped = false;
  const outcome = await runPlan([{ fill: { page: 'test', fields: { field: 'synthetic' } } }], {
    stopped: () => stopped, progress: () => {},
    waitFor: async () => { stopped = true; return { fill }; },
  });
  expect(outcome).toBe('stopped');
  expect(fill).not.toHaveBeenCalled();
});
it('Stop while settling after Confirm prevents a save', async () => {
  const press = vi.fn();
  let stopped = false, confirmed = false;
  const outcome = await runPlan([{ press: { page: 'test', id: 'save', effect: 'save' } }], {
    stopped: () => stopped, progress: () => {}, report: () => {},
    waitFor: async () => ({ hasButton: () => true, summary: () => [], press }),
    confirm: async () => { confirmed = true; return true; },
    settle: async () => { if (confirmed) stopped = true; },
  });
  expect(outcome).toBe('stopped');
  expect(press).not.toHaveBeenCalled();
});
