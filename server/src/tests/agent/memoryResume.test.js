const { resolveMemoryFollowUp } = require('../../services/assistant/memory');
const assistant = require('../../services/assistant/assistant.service');
const config = require('../../config/assistant.config');

test.each([{ memory: [] }, { memory: [{ message: 'Synthetic prior request', checklist: [] }] }, { memory: [{ message: 'Synthetic prior request', checklist: [{ text: 'Save synthetic entry', done: true }] }] }])('finish what failed never replays a request with no pending checklist items', ({ memory }) => {
  const reply = resolveMemoryFollowUp('finish what failed', memory);
  expect(reply.kind).toBe('answer');
  expect(reply.expandedMessage).toBeUndefined();
});
test('a completed request answers without contacting the model or proposing actions', async () => {
  const provider = { complete: jest.fn() };
  const reply = await assistant.handleStep({
    message: 'finish what failed', role: 'clinician', userId: 'synthetic-doctor', directory: async () => [], provider,
    settings: { ...config, agentLoop: true },
    memory: [{ message: 'Save synthetic entry', at: Date.now(), checklist: [{ text: 'Save synthetic entry', done: true }] }],
  });
  expect(reply.type).toBe('answer');
  expect(reply.steps).toBeUndefined();
  expect(provider.complete).not.toHaveBeenCalled();
});
test('only pending items are offered for resumption', () => {
  const reply = resolveMemoryFollowUp('finish what failed', [{ message: 'Synthetic request', checklist: [{ text: 'Open page', done: true }, { text: 'Write synthetic text', done: false }] }]);
  expect(reply.kind).toBe('rewrite');
  expect(reply.checklist).toEqual([{ text: 'Write synthetic text', done: false }]);
});
