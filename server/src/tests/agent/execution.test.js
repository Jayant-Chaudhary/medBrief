const assistant = require('../../services/assistant/assistant.service');
const config = require('../../config/assistant.config');
const tokens = require('../../services/assistant/continuation');
const execution = require('../../services/assistant/execution');
const now = () => 1000000;
const base = { role: 'clinician', userId: 'dr-test', message: 'open notes then write rest in notes', directory: async () => [], now,
  settings: { ...config, agentLoop: true }, currentPath: '/clinician' };
const list = [{ text: 'Open notes', done: true }, { text: 'Write rest in notes', done: false }];
const pending = [{ actionId: '0:0', op: 'append', name: 'Consultancy notes', itemIndex: 1, fingerprint: 'notes' }];
function follow(state = {}, more = {}) {
  return assistant.handleStep({ ...base, round: 1, mode: 'agent', continuationToken: tokens.issue(base.userId, base.message, { round: 1, startedAt: now(), checklist: list, pending, ...state }), ...more });
}
test('model done cannot tick remaining items; one retry then an honest stop', async () => {
  const provider = { complete: jest.fn(async () => JSON.stringify({ actions: [], status: 'done', done: true })) };
  const reply = await follow({}, { provider, checklist: list.map(c => ({ ...c, done: true })) });
  expect(reply.type).toBe('unsupported');
  expect(reply.checklist[1].done).toBe(false);
  expect(reply.message).toContain("Couldn't: Write rest in notes because");
  expect(provider.complete).toHaveBeenCalledTimes(2);
});
test('only issued results can tick matching items', async () => {
  const provider = { complete: jest.fn() };
  const done = await follow({}, { provider, results: [{ actionId: '0:0', result: 'ok' }] });
  expect(done.type).toBe('done');
  expect(provider.complete).not.toHaveBeenCalled();
  expect(execution.acceptResults({ pending }, [{ actionId: 'invented', result: 'ok' }])).toEqual([]);
  expect(execution.matchingItem(list, { op: 'check', name: 'BP check' })).toBe(-1);
  expect(execution.matchingItem(list, { op: 'click', name: 'Consultation notes' })).toBe(-1);
});
test('cancelled confirmation stops without a tick or model call', async () => {
  const provider = { complete: jest.fn() };
  const reply = await follow({}, { provider, results: [{ actionId: '0:0', result: 'cancelled' }] });
  expect(reply.checklist[1].done).toBe(false);
  expect(reply.message).toContain('confirmation was cancelled');
  expect(provider.complete).not.toHaveBeenCalled();
});
test('signed start time cannot be reset by a later client request', async () => {
  const provider = { complete: jest.fn() };
  const reply = await follow({ startedAt: now() - config.requestTimeoutMs }, { startedAt: now(), provider });
  expect(reply.message).toContain('time limit');
  expect(provider.complete).not.toHaveBeenCalled();
});
test('same action twice without progress stops', async () => {
  const reply = await follow({ history: { pages: {}, actions: { notes: 1 } } }, { results: [{ actionId: '0:0', result: 'no_change' }] });
  expect(reply.message).toContain('same action repeated');
});
test('third page arrival stops page ping-pong', async () => {
  const path = '/clinician/patients';
  const reply = await follow({ pending: [{ actionId: '0:0', op: 'go', path, fingerprint: 'patients', itemIndex: -1 }], history: { pages: { [tokens.digest(path)]: 2 }, actions: {} } }, { results: [{ actionId: '0:0', result: 'ok' }] });
  expect(reply.message).toContain('same page');
});
test('provider that ignores timeout is still bounded', async () => {
  const provider = execution.boundProvider({ complete: () => new Promise(() => {}) }, Date.now() + 1000, { modelCallTimeoutMs: 15 });
  await expect(provider.complete({})).rejects.toMatchObject({ code: 'MODEL_TIMEOUT' });
});
test('round limit lists pending items instead of claiming done', async () => {
  const reply = await follow({ round: config.maxRounds }, { round: config.maxRounds });
  expect(reply.type).toBe('unsupported');
  expect(reply.message).toContain('round limit');
});
