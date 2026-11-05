const { formatMetricAnswer } = require('../../services/assistant/patientQuery.service');
const assistant = require('../../services/assistant/assistant.service');
const config = require('../../config/assistant.config');
const record = { name: 'Ferritin', value: 28, date: '2026-11-04', sourceType: 'lab_report', source: 'Lab Report', reportId: 'synthetic-report' };

test('report history links use the registered appointment dashboard and requested history tab', () => {
  const reply = formatMetricAnswer('Synthetic Patient', 'ferritin', record, 'synthetic-p', { appointmentId: 'synthetic-visit' });
  const target = new URL(reply.recordPath, 'http://synthetic.test');
  expect(target.pathname).toBe('/clinician');
  expect(target.searchParams.get('appointment')).toBe('synthetic-visit');
  expect(target.searchParams.get('tab')).toBe('flowsheet');
  expect(reply.recordLabel).toBe('Open Report History');
});

test('a missing verified visit omits the report link instead of generating an invalid route', () => {
  expect(formatMetricAnswer('Synthetic Patient', 'ferritin', record, 'synthetic-p').recordPath).toBeNull();
});

test('appointment ids are encoded without allowing query or path injection', () => {
  const id = 'synthetic&tab=consultation';
  const reply = formatMetricAnswer('Synthetic Patient', 'ferritin', record, 'synthetic-p', { appointmentId: id });
  const target = new URL(reply.recordPath, 'http://synthetic.test');
  expect(target.searchParams.get('appointment')).toBe(id);
  expect(target.searchParams.getAll('tab')).toEqual(['flowsheet']);
});

test('a result for a named patient cannot link to a different patient currently open', async () => {
  const reply = await assistant.handleStep({ message: 'What is Asha Example\'s ferritin?', role: 'clinician', userId: 'synthetic-doctor',
    currentPath: '/clinician', currentRecord: { kind: 'visit', id: 'other-visit' },
    directory: async () => [
      { id: 'synthetic-p', fullName: 'Asha Example', lastVisit: { appointmentId: 'correct-visit' } },
      { id: 'other-p', fullName: 'Other Example' },
    ], recordLookup: async () => ({ id: 'other-visit', patient_id: 'other-p' }),
    metricLookup: async () => record, provider: { complete: jest.fn() }, settings: config });
  expect(reply.type).toBe('answer');
  expect(reply.recordPath).toBe('/clinician?appointment=correct-visit&tab=flowsheet');
});
