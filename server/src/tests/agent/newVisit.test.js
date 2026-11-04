const assistant = require('../../services/assistant/assistant.service');
const { validateAgentActions } = require('../../services/assistant/agent/actions');
const { matchingItem } = require('../../services/assistant/execution');
const { classify } = require('../../services/assistant/pageSnapshot');
const FakeProvider = require('../../services/assistant/llm/fakeProvider');
const config = require('../../config/assistant.config');

describe('New Visit Reachable by Name (T3)', () => {
  const patients = [
    {
      id: 'p-asha',
      fullName: 'Asha Example',
      email: 'asha@example.test',
      lastVisit: { appointmentId: 'v-100' },
      nextVisit: { appointmentId: 'v-101' },
    },
  ];
  const page = {
    elements: [
      { ref: 'btn_close_visit', kind: 'button', name: "Back to today's visits", effect: 'ui' },
      { ref: 'btn_end_visit', kind: 'button', name: 'End visit', effect: 'send' },
    ],
  };
  const settings = { ...config, agentLoop: false };

  test.each([
    'open new visit',
    'go to new visit',
    'new visit tab',
    'naya visit kholo',
    'open new appointment',
    'book appointment',
  ])('phrase "%s" opens new_appointment', async (phrase) => {
    const res = await assistant.handleStep({
      message: phrase,
      role: 'clinician',
      userId: 'dr-1',
      directory: async () => patients,
      settings,
    });
    expect(res).toMatchObject({
      type: 'navigate',
      path: '/clinician/appointments/new',
    });
  });

  test('phrase "new visit for Asha Example tomorrow at 5 pm" plans open_new_appointment with patient and date filled', async () => {
    const plan = JSON.stringify({
      action: 'run',
      steps: [
        { do: 'open_new_appointment', page: 'none', patient: 'Asha Example', which: 'none', when: '2026-11-05T17:00' },
      ],
      options: [],
      more: false,
    });
    const provider = new FakeProvider(plan);
    const res = await assistant.handleStep({
      message: 'new visit for Asha Example tomorrow at 5 pm',
      role: 'clinician',
      userId: 'dr-1',
      directory: async () => patients,
      provider,
      settings,
    });
    expect(res.type).toBe('run');
    expect(res.steps[0].path).toBe('/clinician/appointments/new?patient=p-asha');
    expect(res.steps[0].fill.fields.scheduledAt).toBe('2026-11-05T17:00');
  });

  test('phrase "open Asha\'s last visit" resolves to last_visit', async () => {
    const plan = JSON.stringify({
      action: 'run',
      steps: [
        { do: 'open_patient_visit', page: 'none', patient: 'Asha Example', which: 'last', when: '' },
      ],
      options: [],
      more: false,
    });
    const provider = new FakeProvider(plan);
    const res = await assistant.handleStep({
      message: "open Asha's last visit",
      role: 'clinician',
      userId: 'dr-1',
      directory: async () => patients,
      provider,
      settings,
    });
    expect(res.steps[0].path).toBe('/clinician?appointment=v-100');
  });

  test('phrase "open Asha\'s next visit" resolves to next_visit', async () => {
    const plan = JSON.stringify({
      action: 'run',
      steps: [
        { do: 'open_patient_visit', page: 'none', patient: 'Asha Example', which: 'next', when: '' },
      ],
      options: [],
      more: false,
    });
    const provider = new FakeProvider(plan);
    const res = await assistant.handleStep({
      message: "open Asha's next visit",
      role: 'clinician',
      userId: 'dr-1',
      directory: async () => patients,
      provider,
      settings,
    });
    expect(res.steps[0].path).toBe('/clinician?appointment=v-101');
  });

  test('phrase "back to today\'s visits" clicks dashboard close-visit button', async () => {
    const res = await assistant.handleStep({
      message: "back to today's visits",
      role: 'clinician',
      userId: 'dr-1',
      page,
      currentPath: '/clinician',
      directory: async () => patients,
      settings,
    });
    expect(res.type).toBe('run');
    expect(res.steps[0].page.actions[0]).toMatchObject({
      ref: 'btn_close_visit',
      op: 'click',
    });
  });

  test('"end visit" stays Confirm/send', () => {
    const endBtn = page.elements.find((el) => el.name === 'End visit');
    expect(classify(endBtn, 'click')).toBe('confirm');
    expect(endBtn.effect).toBe('send');
  });

  test.each(['new_visit', 'New Visit', 'new visit'])('agent go("%s") resolves to new_appointment', (target) => {
    const res = validateAgentActions([{ op: 'go', page: target }], {}, '', patients, 'clinician', {});
    expect(res.navigationSteps[0]).toMatchObject({
      path: '/clinician/appointments/new',
      pageId: 'new_appointment',
      op: 'go',
    });
  });

  test('checklist "Open new visit" is ticked only by new_appointment', () => {
    const checklist = [{ text: 'Open new visit', done: false }];
    const actNewApp = { op: 'go', pageId: 'new_appointment' };
    const actRecordNewApp = { op: 'open_record', kind: 'new_appointment', recordId: 'p-asha' };
    const actLastVisit = { op: 'open_record', kind: 'last_visit', recordId: 'v-100' };
    const actNextVisit = { op: 'open_record', kind: 'next_visit', recordId: 'v-101' };
    const actSchedule = { op: 'go', pageId: 'schedule' };

    expect(matchingItem(checklist, actNewApp)).toBe(0);
    expect(matchingItem(checklist, actRecordNewApp)).toBe(0);
    expect(matchingItem(checklist, actLastVisit)).toBe(-1);
    expect(matchingItem(checklist, actNextVisit)).toBe(-1);
    expect(matchingItem(checklist, actSchedule)).toBe(-1);
  });
});
