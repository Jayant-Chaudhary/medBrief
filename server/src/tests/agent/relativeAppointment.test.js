const { checkValue } = require('../../services/assistant/resolvers/values');
const { findControl } = require('../../services/assistant/controls.registry');
const { nextNavigation } = require('../../services/assistant/navigationRules');
const execution = require('../../services/assistant/execution');
const continuation = require('../../services/assistant/continuation');
const assistant = require('../../services/assistant/assistant.service');
const config = require('../../config/assistant.config');

// It is Nov 6 in the doctor's time zone, while UTC is still Nov 5.
const now = Date.parse('2026-11-05T20:00:00Z');
const clock = { now: new Date(now), timeZone: 'Asia/Kolkata', maxDays: 365 };
const control = findControl('clinician', 'new_appointment', 'scheduledAt');
const patients = [{ id: 'synthetic-p', fullName: 'Tara Example' }];
const currentRecord = { kind: 'new_appointment', id: 'synthetic-p', patientId: 'synthetic-p' };

test.each([
  ['tomorrow at 5 pm', '2026-11-07T17:00'],
  ['tomorrow at 5:30 pm', '2026-11-07T17:30'],
  ['tomorrow at 17:45', '2026-11-07T17:45'],
  ['tomorrow at noon', '2026-11-07T12:00'],
  ['tomorrow at midnight', '2026-11-07T00:00'],
  ['day after tomorrow at 9 am', '2026-11-08T09:00'],
  ['kal at 5 pm', '2026-11-07T17:00'],
])('relative time is grounded and resolved in the doctor time zone: %s', (phrase, expected) => {
  expect(checkValue(control, phrase, `Prepare an appointment ${phrase}`, clock)).toMatchObject({ ok: true, value: expected });
});

test.each(['tomorrow', 'tomorrow at 5', 'tomorrow at 13 pm', 'tomorrow at 5:99 pm', 'tomorrow at 5 pm or 6 pm', 'today or tomorrow at 5 pm'])('does not guess an ambiguous or invalid clock time: %s', phrase => {
  expect(checkValue(control, phrase, phrase, clock).ok).toBe(false);
});

test('relative conversion cannot introduce a day or time not in the request, or a past time', () => {
  expect(checkValue(control, 'tomorrow at 6 pm', 'tomorrow at 5 pm', clock).ok).toBe(false);
  expect(checkValue(control, 'today at midnight', 'today at midnight', clock).ok).toBe(false);
});

test('on the named appointment form the pending date is filled without a model calculation or a save', () => {
  const message = 'Open schedule, then prepare a new appointment for Tara tomorrow at 5 pm. Leave it as a draft only.';
  const checklist = [{ text: 'Prepare new appointment for Tara tomorrow at 5 pm', done: false }];
  execution.prepareRequirements(checklist, '/clinician/appointments/new', currentRecord, null, message);
  const reply = nextNavigation({ checklist, message, patients, currentPath: '/clinician/appointments/new', currentRecord, clock });
  expect(reply.steps[0].fill.fields).toEqual({ scheduledAt: '2026-11-07T17:00' });
  expect(reply.steps[0].fill.context).toEqual({ patientId: 'synthetic-p' });
  expect(reply.steps[0].press).toBeUndefined();
});

test('deterministic date fill cannot run on a different patient or repeat a verified field', () => {
  const message = 'Prepare a new appointment for Tara tomorrow at 5 pm';
  const checklist = [{ text: message, done: false, required: ['new_appointment:scheduledAt'] }];
  const other = nextNavigation({ checklist, message, patients, currentPath: '/clinician/appointments/new', currentRecord: { ...currentRecord, patientId: 'other-p' }, clock });
  expect((other?.steps || []).some(step => step.fill)).toBe(false);
  checklist[0].completed = ['new_appointment:scheduledAt'];
  expect(nextNavigation({ checklist, message, patients, currentPath: '/clinician/appointments/new', currentRecord, clock })).toBeNull();
});

test('later-round appointment arrival is followed by a verified date fill before completion', async () => {
  const userId = 'synthetic-doctor';
  const message = 'Open schedule, then prepare a new appointment for Tara tomorrow at 5 pm. Leave it as a draft only.';
  const checklist = execution.initializeChecklist([
    { text: 'Open schedule', done: true }, { text: 'Prepare new appointment for Tara tomorrow at 5 pm (draft only)', done: false },
  ]);
  const navigation = { type: 'navigate', op: 'open_record', kind: 'new_appointment', recordId: 'synthetic-p', path: '/clinician/appointments/new?patient=synthetic-p' };
  const pending = execution.pendingActions(navigation, checklist, 6, '/clinician/schedule');
  const token = continuation.issue(userId, message, { round: 7, startedAt: now, checklist, pending, history: { pages: {}, actions: {} } });
  const provider = { complete: jest.fn(() => { throw new Error('Unexpected model call'); }) };
  const base = { message, userId, role: 'clinician', timeZone: clock.timeZone, currentPath: '/clinician/appointments/new',
    currentRecord, page: { elements: [] }, provider, directory: async () => patients, now: () => now,
    settings: { ...config, agentLoop: true } };
  const receipt = await assistant.handleStep({ ...base, mode: 'agent', round: 7, continuationToken: token, acknowledgeOnly: true,
    results: [{ actionId: navigation.actionId, result: 'ok' }] });
  expect(receipt.type).toBe('checkpoint');
  expect(receipt.checklist[1].done).toBe(false);
  const plan = await assistant.handleStep({ ...base, mode: 'agent', round: 7, continuationToken: receipt.continuationToken });
  expect(plan.type).toBe('run');
  expect(plan.steps[0].fill.fields).toEqual({ scheduledAt: '2026-11-07T17:00' });
  expect(plan.steps.some(step => step.press)).toBe(false);
  const done = await assistant.handleStep({ ...base, mode: 'agent', round: 8, continuationToken: plan.continuationToken, acknowledgeOnly: true,
    results: [{ actionId: plan.steps[0].fill.actionIds.scheduledAt, result: 'ok' }] });
  expect(done.type).toBe('done');
  expect(done.checklist.every(item => item.done)).toBe(true);
  expect(provider.complete).not.toHaveBeenCalled();
});
