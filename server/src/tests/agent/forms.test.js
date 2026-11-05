const assistant = require('../../services/assistant/assistant.service');
const { buildNavigatorMessages } = require('../../services/assistant/agent/navigator');
const { validateAgentActions } = require('../../services/assistant/agent/actions');
const config = require('../../config/assistant.config');

const now = () => Date.parse('2026-11-04T04:00:00Z');
const clock = { now: new Date(now()), timeZone: 'Asia/Kolkata', maxDays: 365 };
const settings = { ...config, agentLoop: true, actionsEnabled: true };
const patients = [
  { id: 'p-asha', fullName: 'Asha Example', email: 'asha@example.test', lastVisit: { appointmentId: 'a-last' }, nextVisit: { appointmentId: 'a-next' } },
];

describe('Slice 4: forms and buttons inside the agent loop', () => {
  test('navigator prompt includes declared controls, options, date format and current date/time', () => {
    const messages = buildNavigatorMessages({
      message: 'set appointment for tomorrow 5 pm',
      checklist: [{ text: 'Set appointment for tomorrow 5 pm', done: false }],
      page: { title: 'New appointment', elements: [] },
      onPage: 'new_appointment',
      clock,
      role: 'clinician',
    });
    const sys = messages[0].content;
    const usr = messages[1].content;
    expect(sys).toContain('YYYY-MM-DDTHH:mm');
    expect(sys).toContain('Now is');
    expect(usr).toContain('scheduledAt: "Date and time" (datetime (format: YYYY-MM-DDTHH:mm))');
    expect(usr).toContain('newQuestionType: "How the patient answers" (select) [options: Yes / No, Written answer]');
    expect(usr).toContain('create_visit: "Create visit and invite" (send)');
  });

  test("1. open Asha Example's new appointment and set it for tomorrow 5 pm", async () => {
    const message = "open Asha Example's new appointment and set it for tomorrow 5 pm";
    let call = 0;
    const provider = {
      complete: jest.fn(async ({ schema }) => {
        if (schema.properties.checklist) {
          return JSON.stringify({
            checklist: ["Open Asha Example's new appointment", 'Set appointment for tomorrow 5 pm'],
          });
        }
        call += 1;
        if (call === 1) {
          return JSON.stringify({
            note: 'Open new appointment for Asha',
            actions: [{ op: 'open_record', kind: 'new_appointment', patient: 'Asha Example' }],
            status: 'continue',
          });
        }
        return JSON.stringify({
          note: 'Fill scheduledAt for tomorrow 5 pm',
          actions: [{ op: 'fill', control: 'scheduledAt', value: '2026-11-05T17:00' }],
          status: 'continue',
        });
      }),
    };

    const r0 = await assistant.handleStep({
      message,
      role: 'clinician',
      userId: 'dr-1',
      timeZone: clock.timeZone,
      currentPath: '/clinician',
      page: { title: 'Dashboard', elements: [] },
      directory: async () => patients,
      settings,
      now,
      provider,
    });

    expect(r0.type).toBe('navigate');
    expect(r0.path).toBe('/clinician/appointments/new?patient=p-asha');
    expect(r0.continue).toBe(true);

    const r1 = await assistant.handleStep({
      message,
      role: 'clinician',
      userId: 'dr-1',
      timeZone: clock.timeZone,
      currentPath: '/clinician/appointments/new',
      currentRecord: { kind: 'new_appointment', id: 'p-asha' },
      page: { title: 'New appointment', elements: [] },
      round: 1,
      mode: r0.mode,
      continuationToken: r0.continuationToken,
      results: [{ actionId: r0.actionId, result: 'ok' }],
      directory: async () => patients,
      settings,
      now,
      provider,
    });

    expect(r1.type).toBe('run');
    expect(r1.checklist[0].done).toBe(true);
    expect(r1.steps[0].fill.fields).toEqual({ scheduledAt: '2026-11-05T17:00' });
    expect(r1.steps[0].fill.context).toEqual({ patientId: 'p-asha' });

    const r2 = await assistant.handleStep({
      message,
      role: 'clinician',
      userId: 'dr-1',
      timeZone: clock.timeZone,
      currentPath: '/clinician/appointments/new',
      currentRecord: { kind: 'new_appointment', id: 'p-asha' },
      page: { title: 'New appointment', elements: [] },
      round: 2,
      mode: r1.mode,
      continuationToken: r1.continuationToken,
      results: [{ actionId: r1.steps[0].fill.actionIds.scheduledAt, result: 'ok' }],
      directory: async () => patients,
      settings,
      now,
      provider,
    });

    expect(r2.type).toBe('done');
    expect(r2.checklist.every((c) => c.done)).toBe(true);
  });

  test("2. open Asha Example's maternity card, BP 110/70, weight 62, add the visit (Confirm)", async () => {
    const message = "open Asha Example's maternity card, then fill BP 110/70 and weight 62, and add the visit";
    let call = 0;
    const provider = {
      complete: jest.fn(async ({ schema }) => {
        if (schema.properties.checklist) {
          return JSON.stringify({
            checklist: [
              "Open Asha Example's maternity card",
              'Fill BP 110/70 and weight 62',
              'Add the visit',
            ],
          });
        }
        call += 1;
        if (call === 1) {
          return JSON.stringify({
            note: 'Open maternity card for Asha',
            actions: [{ op: 'open_record', kind: 'maternity', patient: 'Asha Example' }],
            status: 'continue',
          });
        }
        return JSON.stringify({
          note: 'Fill BP, weight and press Add visit',
          actions: [
            { op: 'fill', control: 'visit.systolic', value: '110' },
            { op: 'fill', control: 'visit.weight', value: '62' },
            { op: 'press', button: 'save_visit' },
          ],
          status: 'continue',
        });
      }),
    };

    const r0 = await assistant.handleStep({
      message,
      role: 'clinician',
      userId: 'dr-1',
      timeZone: clock.timeZone,
      currentPath: '/clinician',
      page: { title: 'Dashboard', elements: [] },
      directory: async () => patients,
      settings,
      now,
      provider,
    });

    expect(r0.type).toBe('navigate');
    expect(r0.path).toBe('/clinician/maternity?patientId=p-asha');

    const r1 = await assistant.handleStep({
      message,
      role: 'clinician',
      userId: 'dr-1',
      timeZone: clock.timeZone,
      currentPath: '/clinician/maternity',
      currentRecord: { kind: 'maternity', id: 'p-asha' },
      page: { title: 'Maternity card', elements: [] },
      round: 1,
      mode: r0.mode,
      continuationToken: r0.continuationToken,
      results: [{ actionId: r0.actionId, result: 'ok' }],
      directory: async () => patients,
      settings,
      now,
      provider,
    });

    expect(r1.type).toBe('run');
    const formStep = r1.steps.find((s) => s.fill || s.press);
    expect(formStep).toBeDefined();
    expect(formStep.fill.fields).toEqual({
      'visit.systolic': '110',
      'visit.diastolic': '70',
      'visit.weight': '62',
    });
    expect(formStep.press).toMatchObject({
      page: 'maternity',
      id: 'save_visit',
      label: 'Add visit',
      effect: 'save',
      context: { patientId: 'p-asha' },
    });
  });

  test('3. a date given in round 2+ is converted and checked properly', async () => {
    const message = 'go to schedule and then set the schedule date to tomorrow';
    let call = 0;
    const provider = {
      complete: jest.fn(async ({ schema }) => {
        if (schema.properties.checklist) {
          return JSON.stringify({
            checklist: ['Go to schedule', 'Set schedule date to tomorrow'],
          });
        }
        call += 1;
        if (call === 1) {
          return JSON.stringify({
            note: 'Open schedule',
            actions: [{ op: 'go', page: 'schedule' }],
            status: 'continue',
          });
        }
        return JSON.stringify({
          note: 'Fill date on schedule',
          actions: [{ op: 'fill', control: 'date', value: '2026-11-05' }],
          status: 'continue',
        });
      }),
    };

    const checked = validateAgentActions(
      [{ op: 'fill', control: 'scheduledAt', value: '2026-11-04T17:00' }],
      { title: 'New appointment', elements: [] },
      'open new appointment and set time for kal 5 pm',
      patients,
      'clinician',
      { onPage: 'new_appointment', clock, currentRecord: { kind: 'new_appointment', id: 'p-asha', patientId: 'p-asha' } },
    );
    expect(checked.formStep.fill.fields.scheduledAt).toBe('2026-11-05T17:00');
  });

  test('4. a value not in the request is refused', () => {
    const res = validateAgentActions(
      [
        { op: 'fill', control: 'visit.weight', value: '68' },
        { op: 'fill', control: 'visit.advice', value: 'Invented advice' },
      ],
      { title: 'Maternity card', elements: [] },
      'record weight 62 kg and advice rest',
      patients,
      'clinician',
      { onPage: 'maternity', clock },
    );
    expect(res.formStep).toBeNull();
    expect(res.refused.length).toBe(2);
    expect(res.refused[0].reason).toContain('could not find that value');
    expect(res.refused[1].reason).toContain('could not find that value');
  });

  test('5. the past date rule refuses past booking dates and future delivery dates', () => {
    const pastBooking = validateAgentActions(
      [{ op: 'fill', control: 'scheduledAt', value: '2026-11-03T10:00' }],
      { title: 'New appointment', elements: [] },
      'book appointment for yesterday at 10 am',
      patients,
      'clinician',
      { onPage: 'new_appointment', clock },
    );
    expect(pastBooking.formStep).toBeNull();
    expect(pastBooking.refused[0].reason).toContain('future');

    const futureDelivery = validateAgentActions(
      [{ op: 'fill', control: 'delivery.when', value: '2026-11-05T10:00' }],
      { title: 'Maternity card', elements: [] },
      'delivery tomorrow at 10 am',
      patients,
      'clinician',
      { onPage: 'maternity', clock },
    );
    expect(futureDelivery.formStep).toBeNull();
    expect(futureDelivery.refused[0].reason).toContain('cannot be in the future');
  });
});
