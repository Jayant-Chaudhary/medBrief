const assistant = require('../../services/assistant/assistant.service');
const config = require('../../config/assistant.config');
const patients = [
  { id: 'synthetic-a', fullName: 'Asha Example', email: 'first@example.test' },
  { id: 'synthetic-b', fullName: 'Asha Example', email: 'second@example.test' },
];
const now = Date.parse('2026-11-05T10:00:00Z');
const base = { message: 'What is Asha Example\'s ferritin?', userId: 'synthetic-doctor', role: 'clinician',
  currentPath: '/clinician/patients', directory: async () => patients, settings: config, now: () => now,
  provider: { complete: jest.fn(() => { throw new Error('Unexpected model call'); }) } };

test('duplicate names show choices before any metric lookup, even with an open matching record', async () => {
  const metricLookup = jest.fn(async () => ({ value: 28 }));
  const reply = await assistant.handleStep({ ...base, metricLookup,
    currentRecord: { kind: 'maternity', id: 'synthetic-a' } });
  expect(reply.type).toBe('choose');
  expect(reply.options.map(option => option.patientChoice.id)).toEqual(['synthetic-a', 'synthetic-b']);
  expect(JSON.stringify(reply)).not.toContain('first@example.test');
  expect(JSON.stringify(reply)).not.toContain('second@example.test');
  expect(metricLookup).not.toHaveBeenCalled();
});

test('a signed choice retrieves only the selected patient, and does not open another record', async () => {
  const metricLookup = jest.fn(async () => ({ name: 'Ferritin', value: 28, unit: 'ng/mL', date: '2026-11-04', source: 'Synthetic report', sourceType: 'maternity' }));
  const choices = await assistant.handleStep({ ...base, metricLookup });
  const reply = await assistant.handleStep({ ...base, metricLookup, patientChoice: choices.options[1].patientChoice });
  expect(reply.type).toBe('answer');
  expect(metricLookup).toHaveBeenCalledTimes(1);
  expect(metricLookup).toHaveBeenCalledWith(base.userId, 'synthetic-b', 'ferritin');
  expect(reply.steps).toBeUndefined();
  expect(reply.recordPath).toContain('synthetic-b');
});

test('a choice is bound to the clinician, original question, allowed ids and expiry', async () => {
  const metricLookup = jest.fn();
  const choices = await assistant.handleStep({ ...base, metricLookup });
  const patientChoice = choices.options[0].patientChoice;
  for (const change of [
    { userId: 'another-doctor' }, { message: 'What is her weight?' },
    { patientChoice: { ...patientChoice, id: 'not-offered' } },
    { now: () => now + config.requestTimeoutMs + 1 },
  ]) {
    const reply = await assistant.handleStep({ ...base, metricLookup, patientChoice, ...change });
    expect(reply.type).toBe('unsupported');
  }
  expect(metricLookup).not.toHaveBeenCalled();
});

test('a previously offered patient removed from the directory cannot be queried', async () => {
  const metricLookup = jest.fn();
  const choices = await assistant.handleStep({ ...base, metricLookup });
  const reply = await assistant.handleStep({ ...base, metricLookup, directory: async () => patients.slice(0, 1),
    patientChoice: choices.options[1].patientChoice });
  expect(reply.type).toBe('clarify');
  expect(metricLookup).not.toHaveBeenCalled();
});
