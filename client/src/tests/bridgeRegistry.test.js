import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBridgeRegistry } from '../components/assistant/bridgeRegistry';

describe('createBridgeRegistry', () => {
  afterEach(() => vi.useRealTimers());

  it('waits past a registration it does not accept, for the right record', async () => {
    const bridge = createBridgeRegistry();
    const forAsha = (actions) => actions.patientId === 'p-asha';
    bridge.register('maternity', { patientId: 'p-other' });
    const waiting = bridge.waitFor('maternity', 1000, forAsha);
    const asha = { patientId: 'p-asha' };
    bridge.register('maternity', asha);
    await expect(waiting).resolves.toBe(asha);
  });

  it('gives up if the right record never loads', async () => {
    vi.useFakeTimers();
    const bridge = createBridgeRegistry();
    bridge.register('maternity', { patientId: 'p-other' });
    const waiting = bridge.waitFor('maternity', 100, (actions) => actions.patientId === 'p-asha');
    vi.advanceTimersByTime(101);
    await expect(waiting).rejects.toThrow('not ready');
  });

  it('gives the actions of a page that is already registered', async () => {
    const bridge = createBridgeRegistry();
    const actions = { fill: vi.fn() };
    bridge.register('new_appointment', actions);
    await expect(bridge.waitFor('new_appointment', 100)).resolves.toBe(actions);
  });

  it('waits for a page that registers after being asked for', async () => {
    const bridge = createBridgeRegistry();
    const waiting = bridge.waitFor('new_appointment', 1000);
    const actions = { fill: vi.fn() };
    bridge.register('new_appointment', actions);
    await expect(waiting).resolves.toBe(actions);
  });

  it('gives up when the page never becomes ready', async () => {
    vi.useFakeTimers();
    const bridge = createBridgeRegistry();
    const waiting = bridge.waitFor('new_appointment', 8000);
    vi.advanceTimersByTime(8001);
    await expect(waiting).rejects.toThrow('not ready');
  });

  it('forgets a page once it unregisters, without dropping a newer registration', async () => {
    vi.useFakeTimers();
    const bridge = createBridgeRegistry();
    const first = { fill: vi.fn() };
    const second = { fill: vi.fn() };
    const unregisterFirst = bridge.register('new_appointment', first);
    bridge.register('new_appointment', second);
    unregisterFirst();
    await expect(bridge.waitFor('new_appointment', 10)).resolves.toBe(second);
  });

  it('keeps pages apart', async () => {
    vi.useFakeTimers();
    const bridge = createBridgeRegistry();
    bridge.register('other_page', { fill: vi.fn() });
    const waiting = bridge.waitFor('new_appointment', 50);
    vi.advanceTimersByTime(51);
    await expect(waiting).rejects.toThrow();
  });
});
