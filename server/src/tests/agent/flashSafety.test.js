const { validateAgentActions } = require('../../services/assistant/agent/actions');
const { matchingItem } = require('../../services/assistant/execution');

describe('Flash Safety Tests (T2)', () => {
  const page = { elements: [] };
  const patients = [
    { id: 'p-asha', fullName: 'Asha Example', lastVisit: { appointmentId: 'v-100' }, nextVisit: { appointmentId: 'v-101' } },
    { id: 'p-other', fullName: 'Asha Other', lastVisit: { appointmentId: 'v-200' }, nextVisit: { appointmentId: 'v-201' } },
  ];

  test('An open_record action with no patient, for the message "open the visit", must give "Which patient?". It must not pick from the directory.', () => {
    const raw = [{ op: 'open_record', kind: 'last_visit' }];
    const res = validateAgentActions(raw, page, 'open the visit', patients, 'clinician', {});
    expect(res.disambiguation).toBeDefined();
    expect(res.disambiguation.type).toBe('clarify');
    expect(res.disambiguation.message).toBe('Which patient?');
    expect(res.navigationSteps).toHaveLength(0);
  });

  test('With two directory patients "Asha Example" and "Asha Other", a message "open Asha\'s last visit" must give a choose card. It must never pick one.', () => {
    const raw = [{ op: 'open_record', kind: 'last_visit', patient: 'Asha' }];
    const res = validateAgentActions(raw, page, "open Asha's last visit", patients, 'clinician', {});
    expect(res.disambiguation).toBeDefined();
    expect(res.disambiguation.type).toBe('choose');
    expect(res.disambiguation.options.length).toBe(2);
    expect(res.navigationSteps).toHaveLength(0);
  });

  test('An open_record with no kind must be refused or asked. No kind is guessed from the message.', () => {
    const raw = [{ op: 'open_record', patient: 'Asha Example' }];
    const res = validateAgentActions(raw, page, "open Asha Example's last visit", patients, 'clinician', {});
    expect(res.navigationSteps).toHaveLength(0);
    expect(res.refused.length > 0 || Boolean(res.disambiguation)).toBe(true);
  });

  test('Checklist "Open next visit" must not be ticked by a last_visit result, and "Open last visit" must not be ticked by next_visit or new_appointment.', () => {
    const checklistNext = [{ text: 'Open next visit', done: false }];
    const checklistLast = [{ text: 'Open last visit', done: false }];

    const actionLastVisit = { op: 'open_record', kind: 'last_visit', recordId: 'v-100' };
    const actionNextVisit = { op: 'open_record', kind: 'next_visit', recordId: 'v-101' };
    const actionNewApp = { op: 'open_record', kind: 'new_appointment', recordId: 'v-new' };

    expect(matchingItem(checklistNext, actionLastVisit)).toBe(-1);
    expect(matchingItem(checklistLast, actionNextVisit)).toBe(-1);
    expect(matchingItem(checklistLast, actionNewApp)).toBe(-1);
  });

  test('A patient-row open must not tick "Write notes" or other items that don\'t name opening that patient.', () => {
    const checklist = [
      { text: 'Write notes for Asha', done: false },
      { text: 'Tick BP check', done: false },
      { text: 'Find Soham in patients', done: false },
      { text: 'Open Asha Example in patients', done: false },
    ];

    const actionOpenAshaRow = { op: 'open_row', patient: 'Asha Example', value: 'Asha Example' };

    expect(matchingItem([checklist[0]], actionOpenAshaRow)).toBe(-1);
    expect(matchingItem([checklist[1]], actionOpenAshaRow)).toBe(-1);
    expect(matchingItem([checklist[2]], actionOpenAshaRow)).toBe(-1);
    expect(matchingItem([checklist[3]], actionOpenAshaRow)).toBe(0);
  });
});
