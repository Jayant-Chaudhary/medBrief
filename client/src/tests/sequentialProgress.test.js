import { describe, it, expect, vi } from 'vitest';
import { showVerifiedProgress } from '../components/assistant/sequentialProgress';

describe('sequential checklist display', () => {
  it('publishes, paints and leaves the update visible before the next plan can run', async () => {
    const events = [];
    let finishPaint;
    const done = showVerifiedProgress({
      publish: () => events.push('verified checklist'),
      paint: () => new Promise(resolve => { finishPaint = resolve; }),
      pause: async ms => events.push(`visible for ${ms}`),
      stopped: () => false, delayMs: 500,
    }).then(advance => { if (advance) events.push('next plan'); });
    expect(events).toEqual(['verified checklist']);
    finishPaint();
    await done;
    expect(events).toEqual(['verified checklist', 'visible for 500', 'next plan']);
  });

  it('Stop after paint prevents another plan', async () => {
    let stopped = false;
    const pause = vi.fn();
    const advance = await showVerifiedProgress({
      publish: vi.fn(), paint: async () => { stopped = true; }, pause,
      stopped: () => stopped, delayMs: 500,
    });
    expect(advance).toBe(false);
    expect(pause).not.toHaveBeenCalled();
  });
});
