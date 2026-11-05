const assistant = require('../../services/assistant/assistant.service');
const execution = require('../../services/assistant/execution');
const continuation = require('../../services/assistant/continuation');
const { navigateRound, NAVIGATOR_SCHEMA } = require('../../services/assistant/agent/navigator');
const config = require('../../config/assistant.config');

const now = 1900000000000;
const base = {
  message: 'open schedule then open Patients', role: 'clinician', userId: 'synthetic-doctor',
  now: () => now, settings: { ...config, agentLoop: true },
};

function issued(overrides = {}) {
  const checklist = execution.initializeChecklist([
    { text: 'Open schedule', done: false }, { text: 'Open Patients', done: false },
  ]);
  const reply = { type: 'navigate', op: 'go', pageId: 'schedule', path: '/clinician/schedule' };
  const pending = execution.pendingActions(reply, checklist, 0, '/clinician');
  const state = { round: 1, startedAt: now, checklist, pending, history: { pages: {}, actions: {} }, ...overrides };
  return { state, actionId: reply.actionId, token: continuation.issue(base.userId, base.message, state) };
}

test('receipt returns verified progress without calling the model, directory or record lookup', async () => {
  const { token, actionId } = issued();
  const provider = { complete: jest.fn(() => { throw new Error('Unexpected model call'); }) };
  const directory = jest.fn(() => { throw new Error('Unexpected directory call'); });
  const recordLookup = jest.fn(() => { throw new Error('Unexpected record lookup'); });
  const receipt = await assistant.handleStep({
    ...base, provider, directory, recordLookup, mode: 'agent', continuationToken: token, round: 1,
    acknowledgeOnly: true, currentPath: '/clinician/schedule', results: [{ actionId, result: 'ok' }],
  });
  expect(receipt.type).toBe('checkpoint');
  expect(receipt.checklist.map(item => item.done)).toEqual([true, false]);
  expect(receipt.steps).toBeUndefined();
  expect(provider.complete).not.toHaveBeenCalled();
  expect(directory).not.toHaveBeenCalled();
  expect(recordLookup).not.toHaveBeenCalled();
  const state = continuation.read(receipt.continuationToken, base.userId, base.message);
  expect(state.round).toBe(1);
  expect(state.pending).toEqual([]);
  expect(state.feedback[0].result).toBe('ok');
  expect(state.successes).toContain(issued().state.pending[0].replay);
});

test('receipt never ticks a failed or missing action and cannot invent a continuation', async () => {
  const { token, actionId } = issued();
  const failed = await assistant.handleStep({ ...base, mode: 'agent', continuationToken: token, round: 1,
    acknowledgeOnly: true, results: [{ actionId, result: 'no_change' }] });
  expect(failed.checklist.every(item => !item.done)).toBe(true);
  const missing = await assistant.handleStep({ ...base, mode: 'agent', continuationToken: token, round: 1,
    acknowledgeOnly: true, results: [{ actionId: 'invented', result: 'ok' }] });
  expect(missing.type).toBe('unsupported');
  expect(missing.checklist.every(item => !item.done)).toBe(true);
  const unsigned = await assistant.handleStep({ ...base, acknowledgeOnly: true });
  expect(unsigned.type).toBe('unsupported');
  expect(unsigned.continuationToken).toBeUndefined();
});

test('cancelled Confirm stops during acknowledgment without planning another action', async () => {
  const { token, actionId } = issued();
  const provider = { complete: jest.fn() };
  const receipt = await assistant.handleStep({ ...base, provider, mode: 'agent', continuationToken: token, round: 1,
    acknowledgeOnly: true, results: [{ actionId, result: 'cancelled' }] });
  expect(receipt.type).toBe('unsupported');
  expect(receipt.message).toContain('confirmation was cancelled');
  expect(receipt.continue).toBeUndefined();
  expect(provider.complete).not.toHaveBeenCalled();
});

test('navigator issues one action even when a provider returns a batch', async () => {
  const provider = { complete: jest.fn(async () => JSON.stringify({
    status: 'continue', note: '', actions: [{ op: 'go', page: 'schedule' }, { op: 'go', page: 'patients' }],
  })) };
  const result = await navigateRound({ ...base, provider, checklist: issued().state.checklist });
  expect(NAVIGATOR_SCHEMA.properties.actions.maxItems).toBe(1);
  expect(result.actions).toEqual([{ op: 'go', page: 'schedule' }]);
  expect(provider.complete.mock.calls[0][0].messages[0].content).toContain('FIRST unfinished checklist item');
});

test('receipt preserves successful write hashes and consumes the issued result once', async () => {
  const checklist = execution.initializeChecklist([
    { text: 'Write synthetic observation in notes', done: false }, { text: 'Open schedule', done: false },
  ]);
  const action = { op: 'append', ref: 'r1', name: 'Consultancy notes', value: 'synthetic observation', field: 'a'.repeat(64), hash: continuation.digest('synthetic observation') };
  const reply = { type: 'run', steps: [{ page: { actions: [action] } }] };
  const pending = execution.pendingActions(reply, checklist, 0, '/clinician');
  const token = continuation.issue(base.userId, base.message, {
    round: 1, startedAt: now, checklist, pending, history: { pages: {}, actions: {} },
  });
  const receipt = await assistant.handleStep({ ...base, mode: 'agent', continuationToken: token, round: 1,
    acknowledgeOnly: true, results: [{ actionId: action.actionId, result: 'ok' }] });
  const state = continuation.read(receipt.continuationToken, base.userId, base.message);
  expect(state.written).toEqual([{ field: action.field, op: 'append', hash: action.hash }]);
  expect(state.checklist.map(item => item.done)).toEqual([true, false]);
  expect(execution.acceptResults(state, [{ actionId: action.actionId, result: 'ok' }])).toEqual([]);
  expect(state.feedback[0]).not.toHaveProperty('value');
});
