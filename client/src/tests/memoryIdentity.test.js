import { it, expect } from 'vitest';
import { rememberRecord } from '../components/assistant/recordContext';
const location = { pathname: '/clinician', search: '?appointment=synthetic-visit' };
const bridge = { context: () => ({ appointmentId: 'synthetic-visit', patientId: 'synthetic-patient' }) };
it('stores the patient id separately from the visit id', () => {
  const memory = rememberRecord(location, bridge);
  expect(memory.patient.id).toBe('synthetic-patient');
  expect(memory.record.id).toBe('synthetic-visit');
});
it('retains the last patient when the request ends on Patients', () => {
  const previous = rememberRecord(location, bridge);
  expect(rememberRecord({ pathname: '/clinician/patients', search: '' }, bridge, previous)).toEqual(previous);
});
it('does not manufacture patient identity from a visit URL while loading', () => {
  const memory = rememberRecord(location, { context: () => null });
  expect(memory.patient).toBeNull();
  expect(memory.record.id).toBe('synthetic-visit');
});
it('never carries the previous patient onto a different pending visit', () => {
  const previous = rememberRecord(location, bridge);
  expect(rememberRecord({ ...location, search: '?appointment=another-visit' }, { context: () => null }, previous).patient).toBeNull();
});
it('a stale bridge registration cannot override a newly selected visit URL', () => {
  const previous = rememberRecord(location, bridge);
  const pending = rememberRecord({ ...location, search: '?appointment=another-visit' }, bridge, previous);
  expect(pending.record.id).toBe('another-visit');
  expect(pending.patient).toBeNull();
});
