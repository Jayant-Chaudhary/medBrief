const { patientScopeError } = require('../../services/assistant/patientScope');
const { replayKey } = require('../../services/assistant/execution');
const patients = [{ id: 'p-a', fullName: 'Asha Example' }, { id: 'p-b', fullName: 'Bina Sample' }];
const record = { kind: 'visit', id: 'visit-a', patientId: 'p-a' };
const reply = { steps: [{ page: { actions: [{ op: 'append', name: 'Notes', value: 'synthetic text' }] } }] };
test('a named different patient cannot write into the open record', () => {
  expect(patientScopeError(reply, '/clinician', record, patients, 'write synthetic text for Bina')).toContain('Open the named');
  expect(patientScopeError(reply, '/clinician', record, patients, 'write synthetic text for Asha')).toBeNull();
  expect(patientScopeError(reply, '/clinician', record, patients, 'write synthetic text')).toBeNull();
});
test('ordinary navigation and closing the old visit remain available', () => {
  const navigation = { steps: [{ page: { actions: [{ op: 'click', kind: 'link', name: 'Patients', section: 'Menu', risk: 'free' }] } }] };
  expect(patientScopeError(navigation, '/clinician', record, patients, 'find Bina in patients')).toBeNull();
  expect(patientScopeError({ steps: [{ press: { page: 'dashboard', id: 'close_visit', effect: 'ui' } }] }, '/clinician', record, patients, 'close this and open Bina')).toBeNull();
});
test('an explicit bridge context can target the named patient after navigation', () => {
  const plan = { steps: [{ fill: { page: 'maternity', context: { patientId: 'p-b' }, fields: { 'visit.weight': '62' } } }] };
  expect(patientScopeError(plan, '/clinician', record, patients, 'fill Bina weight 62')).toBeNull();
});
test('ambiguous names cannot authorize a patient write', () => {
  const directory = [patients[0], { id: 'p-other', fullName: 'Asha Other' }];
  expect(patientScopeError(reply, '/clinician', record, directory, 'write synthetic text for Asha')).toContain('full name');
});
test('repeat evidence is distinct for each visit and patient', () => {
  const action = reply.steps[0].page.actions[0];
  expect(replayKey(action, '/clinician', record)).not.toBe(replayKey(action, '/clinician', { ...record, id: 'visit-b', patientId: 'p-b' }));
  expect(replayKey(action, '/clinician', record)).not.toBe(replayKey(action, '/clinician', { ...record, id: 'another-visit' }));
  expect(replayKey(action, '/clinician', record)).toBe(replayKey(action, '/clinician', record));
});
