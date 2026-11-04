const assistant = require('../../services/assistant/assistant.service');
const { CONTROLS } = require('../../services/assistant/controls.registry');
const config = require('../../config/assistant.config');
const tokens = require('../../services/assistant/continuation');
const now = () => Date.parse('2026-11-04T04:00:00Z');
const clock = { now: new Date(now()), timeZone: 'Asia/Kolkata', maxDays: 365 };
const settings = { ...config, agentLoop: true, actionsEnabled: true };
const base = { role: 'clinician', userId: 'test-doctor', settings, now, directory: async () => [], timeZone: clock.timeZone };
const plan = (page, fields, press = 'none') => JSON.stringify({ action: 'run', steps: [{ do: 'fill_form', page, fields, press, patient: '', which: 'none', when: '' }], options: [], more: false });

test('every example field and button belongs to its form', () => {
  for (const page of Object.keys(CONTROLS)) {
    const messages = assistant.buildMessages('fill this form', 'clinician', clock, page);
    for (const m of messages.filter(m => m.role === 'assistant')) {
      for (const step of JSON.parse(m.content).steps || []) {
        if (step.do !== 'fill_form') continue;
        const form = CONTROLS[step.page];
        expect(form).toBeDefined();
        for (const field of step.fields || []) expect(form.controls.map(c => c.id)).toContain(field.control);
        if (step.press !== 'none') expect(form.buttons.filter(b => !b.internal).map(b => b.id)).toContain(step.press);
      }
    }
  }
});
test.each([
  ['set the time to tomorrow at 5 pm', '2026-11-05T17:00'],
  ['kal 11 baje', '2026-11-05T11:00'],
  ['10 November 11 am', '2026-11-10T11:00'],
])('single form date: %s', async (message, value) => {
  const provider = { complete: jest.fn().mockResolvedValue(plan('new_appointment', [{ control: 'scheduledAt', value }])) };
  const result = await assistant.handleStep({ ...base, message, currentPath: '/clinician/appointments/new', provider });
  expect(result.steps[0].fill.fields.scheduledAt).toBe(value);
  expect(provider.complete).toHaveBeenCalledTimes(1);
});
test('maternity values retain registered ids and Confirm effects', async () => {
  const provider = { complete: jest.fn().mockResolvedValue(plan('maternity', [
    { control: 'visit.systolic', value: '110' }, { control: 'visit.diastolic', value: '70' }, { control: 'visit.weight', value: '62' },
  ], 'save_visit')) };
  const result = await assistant.handleStep({ ...base, message: 'BP 110/70 weight 62 kg, save', currentPath: '/clinician/maternity', provider });
  expect(result.steps[0].fill.fields).toMatchObject({ 'visit.systolic': '110', 'visit.diastolic': '70', 'visit.weight': '62' });
  expect(result.steps[0].press.effect).toBe('save');
});
test('commas and multiple field values do not force the agent', () => {
  expect(assistant.hasMultipleInstructions('book new patient Riya Test, riya@example.test, tomorrow 4 pm')).toBe(false);
  expect(assistant.hasMultipleInstructions('open patients then open schedule')).toBe(true);
});
test('client cannot forge agent mode or use another request token', async () => {
  const provider = { complete: jest.fn() };
  for (const continuationToken of [undefined, 'fake', tokens.issue('someone-else', 'open patients', { round: 1 })]) {
    const result = await assistant.handleStep({ ...base, message: 'open patients', mode: 'agent', round: 1, continuationToken, provider });
    expect(result.type).toBe('unsupported');
  }
  expect(provider.complete).not.toHaveBeenCalled();
});
test('compound starts at round zero, signed continuation stays in agent', async () => {
  const provider = { complete: jest.fn(async ({ schema }) => JSON.stringify(schema.properties.checklist
    ? { checklist: ['Open patients', 'Open schedule'] }
    : { status: 'continue', note: '', actions: [{ op: 'go', page: 'patients' }] })) };
  const first = await assistant.handleStep({ ...base, message: 'open patients then open schedule', provider });
  expect(first).toMatchObject({ source: 'agent', mode: 'agent', continue: true });
  const next = await assistant.handleStep({ ...base, message: 'open patients then open schedule', provider, round: 1, mode: first.mode, continuationToken: first.continuationToken });
  expect(next.source).toBe('agent');
  const disabled = await assistant.handleStep({ ...base, settings: { ...settings, agentLoop: false }, message: 'open patients then open schedule', provider, round: 1, mode: first.mode, continuationToken: first.continuationToken });
  expect(disabled.type).toBe('unsupported');
});

test('agent loop config defaults to on, false turns it off', () => {
  const orig = process.env.ASSISTANT_AGENT_LOOP;
  try {
    delete process.env.ASSISTANT_AGENT_LOOP;
    jest.resetModules();
    expect(require('../../config/assistant.config').agentLoop).toBe(true);

    process.env.ASSISTANT_AGENT_LOOP = 'false';
    jest.resetModules();
    expect(require('../../config/assistant.config').agentLoop).toBe(false);

    process.env.ASSISTANT_AGENT_LOOP = 'true';
    jest.resetModules();
    expect(require('../../config/assistant.config').agentLoop).toBe(true);
  } finally {
    if (orig !== undefined) process.env.ASSISTANT_AGENT_LOOP = orig;
    else delete process.env.ASSISTANT_AGENT_LOOP;
    jest.resetModules();
  }
});

