const execution = require('../../services/assistant/execution');
const record = { kind: 'maternity', id: 'synthetic-patient', patientId: 'synthetic-patient' };
function issue(checklist, fields, round = 0) {
  const reply = { type: 'run', steps: [{ fill: { page: 'maternity', fields } }] };
  return execution.pendingActions(reply, checklist, round, '/clinician/maternity', record);
}
test('an omitted weight field leaves BP-and-weight task incomplete', () => {
  const list = [{ text: 'Set BP 110/70 weight 62', done: false }];
  const pending = issue(list, { 'visit.systolic': '110', 'visit.diastolic': '70' });
  const partial = execution.applyResults(list, pending.map(action => ({ ...action, result: 'ok' })));
  expect(partial[0].done).toBe(false);
  expect(partial[0].required).toContain('maternity:visit.weight');
  const remaining = issue(partial, { 'visit.weight': '62' }, 1);
  expect(execution.applyResults(partial, remaining.map(action => ({ ...action, result: 'ok' })))[0].done).toBe(true);
});
test('missing or failed results cannot certify all requested fields', () => {
  const list = [{ text: 'Set BP 110/70 weight 62', done: false }];
  const pending = issue(list, { 'visit.systolic': '110', 'visit.diastolic': '70', 'visit.weight': '62' });
  expect(execution.applyResults(list, [{ ...pending[0], result: 'ok' }])[0].done).toBe(false);
  const results = pending.map(action => ({ ...action, result: action.control === 'visit.weight' ? 'no_change' : 'ok' }));
  expect(execution.applyResults(list, results)[0].done).toBe(false);
});
test('booking requirements do not depend on the model proposing email or date', () => {
  const list = [{ text: 'Book new patient Synthetic Person, synthetic@example.test, tomorrow 5 pm', done: false }];
  const reply = { type: 'run', steps: [{ fill: { page: 'new_appointment', fields: { patientFullName: 'Synthetic Person' } } }] };
  const pending = execution.pendingActions(reply, list, 0, '/clinician/appointments/new');
  expect(list[0].required).toEqual(expect.arrayContaining(['new_appointment:patientFullName', 'new_appointment:patientEmail', 'new_appointment:scheduledAt']));
  expect(execution.applyResults(list, pending.map(action => ({ ...action, result: 'ok' })))[0].done).toBe(false);
});
test('a field omitted from the checklist is recovered from the original request', () => {
  const list = [{ text: 'Set BP 110/70', done: false }];
  execution.prepareRequirements(list, '/clinician/maternity', record, null, 'Set BP 110/70 and weight 62');
  expect(list[0].required).toContain('maternity:visit.weight');
});
