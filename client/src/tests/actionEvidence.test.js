import { it, expect, vi } from 'vitest';
import { observeAction } from '../components/assistant/actionEvidence';
import { runPlan } from '../components/assistant/planRunner';
it('click with no observed effect is no_change', async () => {
  expect(await observeAction(() => ({ result: 'ok' }), async () => {}, () => 'same')).toEqual({ result: 'no_change' });
});
it('observes changes after asynchronous UI settling', async () => {
  let state = 'closed';
  expect(await observeAction(() => ({ result: 'ok' }), async () => { state = 'open'; }, () => state)).toEqual({ result: 'ok' });
});
it('keeps each actual result when a later action fails', async () => {
  const record = vi.fn();
  const outcome = await runPlan([{ page: { actions: [{ actionId: 'a', op: 'click', risk: 'free' }, { actionId: 'b', op: 'click', risk: 'free' }] } }], {
    stopped: () => false, progress: () => {}, settle: async () => {}, record,
    pageAction: async a => ({ result: a.actionId === 'a' ? 'ok' : 'label_changed' }),
  });
  expect(outcome).toBe('failed');
  expect(record.mock.calls.map(c => c[0])).toEqual([{ actionId: 'a', result: 'ok' }, { actionId: 'b', result: 'label_changed' }]);
});
it('cancelled Confirm reports cancellation and executes nothing', async () => {
  const record = vi.fn(), pageAction = vi.fn();
  await runPlan([{ page: { actions: [{ actionId: 'a', op: 'append', name: 'Notes', value: 'synthetic', risk: 'confirm' }] } }], {
    stopped: () => false, progress: () => {}, record, pageAction, confirm: async () => false, report: () => {},
  });
  expect(record).toHaveBeenCalledWith({ actionId: 'a', result: 'cancelled' });
  expect(pageAction).not.toHaveBeenCalled();
});
it('bridge fields report observed values independently', async () => {
  const values = { a: '', b: '' }, record = vi.fn();
  await runPlan([{ fill: { page: 'test', fields: { a: 'one', b: 'two' }, actionIds: { a: 'a', b: 'b' } } }], {
    stopped: () => false, progress: () => {}, settle: async () => {}, highlight: () => {}, record,
    waitFor: async () => ({ get: id => values[id], fill: fields => { values.a = fields.a; } }),
  });
  expect(record.mock.calls.map(c => c[0])).toEqual([{ actionId: 'a', result: 'ok' }, { actionId: 'b', result: 'no_change' }]);
});
