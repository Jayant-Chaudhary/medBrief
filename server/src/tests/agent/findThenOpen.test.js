const assistant = require('../../services/assistant/assistant.service');
const execution = require('../../services/assistant/execution');
const config = require('../../config/assistant.config');
const { validateAgentActions } = require('../../services/assistant/agent/actions');
const patients = [{ id: 'synthetic-p', fullName: 'Sarthak Test', lastVisit: { appointmentId: 'synthetic-v' } }];
const checklist = ['Find Sarthak in patients', 'Open his last visit', 'Open his consultation notes'];
const base = { role: 'clinician', userId: 'synthetic-doctor', directory: async () => patients, settings: { ...config, agentLoop: true }, message: 'find Sarthak in patients and open his last visit and then open his consultation notes' };
test('named search navigation ticks find, plain Patients navigation does not', () => {
  const list = [{ text: checklist[0], done: false }];
  expect(execution.matchingItem(list, { op: 'go', path: '/clinician/patients', state: { assistantQuery: 'Sarthak' } })).toBe(0);
  expect(execution.matchingItem(list, { op: 'go', pageId: 'patients' })).toBe(-1);
  expect(execution.matchingItem(list, { op: 'fill', control: 'query', page: 'patients', value: 'Someone Else' })).toBe(-1);
});
test('BP and Hb remain target words without adding bare record matching', () => {
  expect(execution.matchingItem([{ text: 'tick BP check', done: false }], { op: 'check', name: 'BP check' })).toBe(0);
  expect(execution.matchingItem([{ text: 'tick iron check', done: false }], { op: 'check', name: 'BP check' })).toBe(-1);
  expect(execution.matchingItem([{ text: 'open record', done: false }], { op: 'open_record', kind: 'last_visit', recordId: 'v' })).toBe(-1);
});
test('declared query ref uses checked fill; an unknown ref stays refused', () => {
  const result = validateAgentActions([{ op: 'type', ref: 'query', text: 'Sarthak' }, { op: 'type', ref: 'unknown', text: 'Sarthak' }], {}, base.message, patients, 'clinician', { onPage: 'patients' });
  expect(result.formStep.fill.fields.query).toBe('Sarthak');
  expect(result.refused).toHaveLength(1);
});
test('search, successful repeat, last visit and notes finish all three items', async () => {
  const actions = [
    { op: 'type', ref: 'query', text: 'Sarthak' },
    { op: 'fill', control: 'query', value: 'Sarthak' },
    { op: 'open_record', kind: 'last_visit', patient: 'Sarthak' },
    { op: 'click', ref: 'r1' },
  ];
  const provider = { complete: jest.fn(async ({ schema }) => JSON.stringify(schema.properties.checklist ? { checklist } : { actions: [actions.shift()], status: 'continue', note: '' })) };
  let reply = await assistant.handleStep({ ...base, provider, currentPath: '/clinician/patients' });
  const step = reply.steps.find(s => s.fill);
  reply = await assistant.handleStep({ ...base, provider, currentPath: '/clinician/patients', round: 1, mode: reply.mode, continuationToken: reply.continuationToken, results: [{ actionId: step.fill.actionIds.query, result: 'ok' }] });
  expect(reply.type).not.toBe('unsupported');
  expect(reply.checklist[0].done).toBe(true);
  expect(reply.steps.some(s => s.fill)).toBe(false);
  reply = await assistant.handleStep({ ...base, provider, currentPath: '/clinician/patients', round: 2, mode: reply.mode, continuationToken: reply.continuationToken });
  const visitAction = reply.actionId;
  reply = await assistant.handleStep({ ...base, provider, currentPath: '/clinician', currentRecord: { kind: 'visit', id: 'synthetic-v' }, recordLookup: async () => ({ id: 'synthetic-v', patient_id: 'synthetic-p' }), page: { elements: [{ ref: 'r1', name: 'Consultation notes', kind: 'button', effect: 'free' }] }, round: 3, mode: reply.mode, continuationToken: reply.continuationToken, results: [{ actionId: visitAction, result: 'ok' }] });
  const noteAction = reply.steps[0].page.actions[0].actionId;
  reply = await assistant.handleStep({ ...base, provider, currentPath: '/clinician', round: 4, mode: reply.mode, continuationToken: reply.continuationToken, results: [{ actionId: noteAction, result: 'ok' }] });
  expect(reply.type).toBe('done');
  expect(reply.checklist.every(c => c.done)).toBe(true);
});
test('one refused round continues with feedback; two stop with specific reasons', async () => {
  const provider = { complete: jest.fn(async ({ schema }) => JSON.stringify(schema.properties.checklist ? { checklist } : { actions: [{ op: 'type', ref: 'missing', text: 'Sarthak' }], status: 'continue' })) };
  const first = await assistant.handleStep({ ...base, provider, currentPath: '/clinician/patients' });
  expect(first.continue).toBe(true);
  const second = await assistant.handleStep({ ...base, provider, currentPath: '/clinician/patients', round: 1, mode: first.mode, continuationToken: first.continuationToken });
  expect(second.type).toBe('unsupported');
  expect(second.checklist[0].reason).toContain('not present');
  expect(second.checklist[1].reason).toBe('not reached');
  expect(JSON.stringify(provider.complete.mock.calls.at(-1))).toContain('refused');
});
