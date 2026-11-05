const { nextNavigation } = require('../../services/assistant/navigationRules');
const { patientPrerequisite } = require('../../services/assistant/patientScope');
const execution = require('../../services/assistant/execution');
const patients = [{ id: 'synthetic-p', fullName: 'Sarthak Example', lastVisit: { appointmentId: 'synthetic-v' } }];
const message = 'Open Patients, find Sarthak, open his last visit, append synthetic notes, then open a new appointment for Sarthak';
test('the next search routes to Patients from any other page', () => {
  const result = nextNavigation({ checklist: [{ text: 'Find Sarthak in patients', done: false }], message, patients, currentPath: '/clinician/maternity' });
  expect(result.path).toBe('/clinician/patients');
  expect(result.state.assistantQuery).toBe('Sarthak');
});
test('search on Patients uses a checked declared control without a patient context', () => {
  const result = nextNavigation({ checklist: [{ text: 'Find Sarthak in patients', done: false }], message, patients, currentPath: '/clinician/patients' });
  expect(result.steps[0].fill.fields.query).toBe('Sarthak');
  expect(result.steps[0].fill.context).toBeUndefined();
});
test('search navigation and search fill share repeat identity', () => {
  const navigate = { op: 'go', path: '/clinician/patients', state: { assistantQuery: 'Sarthak' } };
  const fill = { op: 'fill', page: 'patients', control: 'query', value: 'Sarthak' };
  expect(execution.replayKey(navigate, '/clinician/maternity')).toBe(execution.replayKey(fill, '/clinician/patients'));
});
test('after finding a patient, the next step opens their requested visit', () => {
  const result = nextNavigation({ checklist: [{ text: 'Find Sarthak', done: true }, { text: 'Open his last visit', done: false }], message, patients, currentPath: '/clinician/patients' });
  expect(result.path).toBe('/clinician?appointment=synthetic-v');
});
test('a future booking instruction cannot replace the visit needed for notes', () => {
  const result = patientPrerequisite([{ text: 'Open his last visit', done: true }, { text: 'Open consultation notes', done: false }, { text: 'Open a new appointment', done: false }], message, patients, '/clinician/maternity');
  expect(result.path).toBe('/clinician?appointment=synthetic-v');
});
test('search completion cannot acquire clinical form requirements', () => {
  const list = [{ text: 'Find Sarthak in patients', done: false }];
  execution.prepareRequirements(list, '/clinician/patients', null, null, message);
  expect(list[0].required || []).not.toContain('patients:query');
});
test('consultation notes do not become maternity advice', () => {
  const list = [{ text: 'Write synthetic text in consultation notes', done: false }];
  execution.prepareRequirements(list, '/clinician/maternity', null, null, message);
  expect(list[0].required || []).not.toContain('maternity:visit.advice');
});
