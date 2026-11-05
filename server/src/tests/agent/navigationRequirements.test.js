const execution = require('../../services/assistant/execution');
const assistant = require('../../services/assistant/assistant.service');
const continuation = require('../../services/assistant/continuation');
const config = require('../../config/assistant.config');

const message = 'Find Tara in Patients, open her last visit, open consultation notes, append "Synthetic checkpoint: ready!" in notes, open schedule, return to Tara\'s last visit, prepare a new appointment for Tara tomorrow at 5 pm (draft only)';
const demoChecklist = () => execution.initializeChecklist([
  { text: 'Find Tara in Patients', done: true },
  { text: "Open Tara's last visit", done: true },
  { text: 'Open consultation notes', done: true },
  { text: 'Append "Synthetic checkpoint: ready!" in notes', done: true },
  { text: 'Open schedule', done: false },
  { text: "Return to Tara's last visit", done: false },
  { text: 'Prepare new appointment for Tara tomorrow at 5 pm (draft only)', done: false },
]);

test('future booking date never becomes a requirement of Open schedule', () => {
  const checklist = demoChecklist();
  execution.prepareRequirements(checklist, '/clinician/schedule', null, null, message);
  expect(checklist[4].required || []).toEqual([]);
  expect(checklist.some(item => item.required?.includes('schedule:date'))).toBe(false);
  const reply = { type: 'navigate', op: 'go', pageId: 'schedule', path: '/clinician/schedule' };
  const pending = execution.pendingActions(reply, checklist, 4, '/clinician');
  const result = execution.applyResults(checklist, [{ ...pending[0], result: 'ok' }]);
  expect(result.map(item => item.done)).toEqual([true, true, true, true, true, false, false]);
});

test('draft appointment date still needs verified field evidence on its own form', () => {
  const checklist = demoChecklist();
  checklist[4].done = true;
  checklist[5].done = true;
  execution.prepareRequirements(checklist, '/clinician/appointments/new', null, null, message);
  expect(checklist[6].required).toContain('new_appointment:scheduledAt');
  const navigation = { op: 'open_record', kind: 'new_appointment', recordId: 'synthetic-p', itemIndex: 6, taskId: checklist[6].id, result: 'ok' };
  expect(execution.applyResults(checklist, [navigation])[6].done).toBe(false);
  const fill = { type: 'run', steps: [{ fill: { page: 'new_appointment', fields: { scheduledAt: '2030-05-02T17:00' } } }] };
  const pending = execution.pendingActions(fill, checklist, 6, '/clinician/appointments/new');
  expect(execution.applyResults(checklist, [{ ...pending[0], result: 'ok' }])[6].done).toBe(true);
});

test('an explicit Schedule date change still requires that field', () => {
  const checklist = [{ text: 'Set schedule date to tomorrow', done: false }];
  execution.prepareRequirements(checklist, '/clinician/schedule', null, null, checklist[0].text);
  expect(checklist[0].required).toContain('schedule:date');
});

test('a completely omitted form instruction is recovered without changing the navigation task', () => {
  const checklist = [{ text: 'Open schedule', done: false }];
  execution.prepareRequirements(checklist, '/clinician/appointments/new', null, null,
    'Open schedule, then prepare a new appointment for Tara tomorrow at 5 pm');
  expect(checklist[0].required || []).toEqual([]);
  expect(checklist[1].required).toContain('new_appointment:scheduledAt');
  expect(checklist[1].done).toBe(false);
});

test('reaching the same page after verified task progress is not a navigation loop', async () => {
  const now = 1900000000000;
  const userId = 'synthetic-doctor';
  const request = 'Open schedule then open Patients';
  const checklist = execution.initializeChecklist([
    { text: 'Open schedule', done: false }, { text: 'Open Patients', done: false },
  ]);
  const reply = { type: 'navigate', op: 'go', pageId: 'schedule', path: '/clinician/schedule' };
  const pending = execution.pendingActions(reply, checklist, 0, '/clinician');
  const token = continuation.issue(userId, request, { round: 1, startedAt: now, checklist, pending,
    history: { pages: { [continuation.digest('/clinician/schedule')]: config.maxPageVisits - 1 }, actions: {} } });
  const provider = { complete: jest.fn() };
  const result = await assistant.handleStep({ message: request, userId, role: 'clinician', currentPath: '/clinician/schedule',
    mode: 'agent', continuationToken: token, round: 1, acknowledgeOnly: true, now: () => now,
    settings: { ...config, agentLoop: true }, provider, results: [{ actionId: reply.actionId, result: 'ok' }] });
  expect(result.type).toBe('checkpoint');
  expect(result.checklist.map(item => item.done)).toEqual([true, false]);
  expect(provider.complete).not.toHaveBeenCalled();
});

test('returning to a page repeatedly without a verified tick still stops', async () => {
  const now = 1900000000000;
  const userId = 'synthetic-doctor';
  const request = 'Open Patients then open profile';
  const checklist = execution.initializeChecklist([{ text: 'Open Patients', done: false }, { text: 'Open profile', done: false }]);
  const reply = { type: 'navigate', op: 'go', pageId: 'schedule', path: '/clinician/schedule' };
  const pending = execution.pendingActions(reply, checklist, 0, '/clinician');
  const token = continuation.issue(userId, request, { round: 1, startedAt: now, checklist, pending,
    history: { pages: { [continuation.digest('/clinician/schedule')]: config.maxPageVisits - 1 }, actions: {} } });
  const result = await assistant.handleStep({ message: request, userId, role: 'clinician', currentPath: '/clinician/schedule',
    mode: 'agent', continuationToken: token, round: 1, acknowledgeOnly: true, now: () => now,
    settings: { ...config, agentLoop: true }, provider: { complete: jest.fn() }, results: [{ actionId: reply.actionId, result: 'ok' }] });
  expect(result.type).toBe('unsupported');
  expect(result.message).toContain('the same page was reached repeatedly');
  expect(result.checklist.every(item => !item.done)).toBe(true);
});
