const assistant = require('../../services/assistant/assistant.service');
const config = require('../../config/assistant.config');
const now = Date.parse('2026-11-06T05:00:00Z');
const patients = [
  { id: 'synthetic-a', fullName: 'Other Example', lastVisit: { appointmentId: 'synthetic-visit-a' } },
  { id: 'synthetic-b', fullName: 'Asha Example', lastVisit: { appointmentId: 'synthetic-visit-b' } },
];
const base = { role: 'clinician', userId: 'synthetic-doctor', currentPath: '/clinician',
  currentRecord: { kind: 'visit', id: 'synthetic-visit-a' }, directory: async () => patients,
  recordLookup: async id => patients.find(patient => patient.lastVisit?.appointmentId === id)
    ? { id, patient_id: patients.find(patient => patient.lastVisit?.appointmentId === id).id } : null,
  metricLookup: async () => null, settings: { ...config, agentLoop: true }, now: () => now,
};
const question = 'What is Asha Example\'s ferritin?';
async function queryMemory(overrides = {}) {
  const reply = await assistant.handleStep({ ...base, ...overrides, message: question });
  return { reply, memory: [{ message: question, ...reply.memoryContext, at: now }] };
}

test('query replies identify their own subject and record even when another patient is open', async () => {
  const { reply, memory } = await queryMemory();
  expect(reply.memoryContext).toEqual({ patient: { id: 'synthetic-b', name: 'Asha Example' },
    record: { kind: 'visit', id: 'synthetic-visit-b' } });
  const follow = await assistant.handleStep({ ...base, message: 'Which patient was that?', memory });
  expect(follow.type).toBe('answer');
  expect(follow.text).toContain('Asha Example');
  expect(follow.text).not.toContain('Other Example');
});

test('go back navigates to remembered patient B and verifies completion instead of keeping patient A', async () => {
  const { memory } = await queryMemory();
  const message = 'go back to the last patient';
  const reply = await assistant.handleStep({ ...base, message, memory });
  expect(reply.type).toBe('navigate');
  expect(reply.recordTarget).toMatchObject({ id: 'synthetic-visit-b', patientId: 'synthetic-b' });
  const done = await assistant.handleStep({ ...base, message, memory, round: 1, mode: reply.mode,
    continuationToken: reply.continuationToken, currentRecord: { kind: 'visit', id: 'synthetic-visit-b' },
    results: [{ actionId: reply.actionId, result: 'ok' }], acknowledgeOnly: true });
  expect(done.type).toBe('done');
  expect(done.checklist.every(item => item.done)).toBe(true);
});

test('also add first opens the remembered patient and still requires Confirm for the save', async () => {
  const { memory } = await queryMemory();
  const provider = { complete: jest.fn(async () => JSON.stringify({ status: 'continue', note: '', actions: [{ op: 'click', ref: 'r1' }] })) };
  const message = 'also add calcium';
  const reply = await assistant.handleStep({ ...base, message, memory, provider });
  expect(reply.type).toBe('navigate');
  expect(reply.recordTarget.patientId).toBe('synthetic-b');
  expect(reply.checklist[0].done).toBe(false);
  expect(provider.complete).not.toHaveBeenCalled();
  const action = await assistant.handleStep({ ...base, message, memory, provider, round: 1, mode: reply.mode,
    continuationToken: reply.continuationToken, currentRecord: { kind: 'visit', id: 'synthetic-visit-b' },
    results: [{ actionId: reply.actionId, result: 'ok' }],
    page: { elements: [{ ref: 'r1', name: 'Calcium', kind: 'button', effect: 'save' }] },
  });
  expect(action.type).toBe('run');
  expect(action.steps[0].page.actions[0].risk).toBe('confirm');
});

test('memory without a usable record asks rather than acting on the different open patient', async () => {
  const { memory } = await queryMemory();
  memory[0].record = null;
  const provider = { complete: jest.fn() };
  const reply = await assistant.handleStep({ ...base, message: 'also add calcium', memory, provider });
  expect(reply.type).toBe('clarify');
  expect(reply.steps).toBeUndefined();
  expect(provider.complete).not.toHaveBeenCalled();
});

test('a remembered visit belonging to another patient cannot override the remembered identity', async () => {
  const { memory } = await queryMemory();
  memory[0].record.id = 'synthetic-visit-a';
  const reply = await assistant.handleStep({ ...base, message: 'go back to the last patient', memory });
  expect(reply.type).toBe('clarify');
  expect(reply.recordTarget).toBeUndefined();
});

test('a pronoun follow-up asks which patient when the last subject differs from the open record', async () => {
  const { memory } = await queryMemory();
  const metricLookup = jest.fn(async () => null);
  const message = 'What is her haemoglobin?';
  const choice = await assistant.handleStep({ ...base, message, memory, metricLookup });
  expect(choice.type).toBe('choose');
  expect(choice.options.map(option => option.patientChoice.id)).toEqual(['synthetic-b', 'synthetic-a']);
  expect(metricLookup).not.toHaveBeenCalled();

  const reply = await assistant.handleStep({ ...base, message, memory, metricLookup,
    patientChoice: choice.options[0].patientChoice });
  expect(reply.type).toBe('answer');
  expect(metricLookup).toHaveBeenCalledWith('synthetic-doctor', 'synthetic-b', 'haemoglobin');
  expect(reply.text).toContain('Asha Example');
});

test('a pronoun follow-up uses the open record when it is the patient last asked about', async () => {
  const { memory } = await queryMemory({ currentRecord: { kind: 'visit', id: 'synthetic-visit-b' } });
  const metricLookup = jest.fn(async () => null);
  const reply = await assistant.handleStep({ ...base, currentRecord: { kind: 'visit', id: 'synthetic-visit-b' },
    message: 'What is her haemoglobin?', memory, metricLookup });
  expect(reply.type).toBe('answer');
  expect(metricLookup).toHaveBeenCalledWith('synthetic-doctor', 'synthetic-b', 'haemoglobin');
});

test('a pronoun follow-up with no open record uses the patient last asked about', async () => {
  const { memory } = await queryMemory();
  const metricLookup = jest.fn(async () => null);
  const reply = await assistant.handleStep({ ...base, currentRecord: null,
    message: 'What is her haemoglobin?', memory, metricLookup });
  expect(reply.type).toBe('answer');
  expect(metricLookup).toHaveBeenCalledWith('synthetic-doctor', 'synthetic-b', 'haemoglobin');
});

test('a pronoun follow-up choice cannot be replayed for a patient that was not offered', async () => {
  const { memory } = await queryMemory();
  const message = 'What is her haemoglobin?';
  const choice = await assistant.handleStep({ ...base, message, memory });
  const reply = await assistant.handleStep({ ...base, message, memory,
    patientChoice: { ...choice.options[0].patientChoice, id: 'not-offered' } });
  expect(reply.type).toBe('unsupported');
});

test('a dictated note that states a finding is not refused as a diagnosis request', async () => {
  const provider = { complete: jest.fn(async () => JSON.stringify({ status: 'continue', note: '', actions: [] })) };
  const reply = await assistant.handleStep({ ...base, provider, message: 'Add to notes: BP is normal, review in 2 weeks' });
  expect(reply.source).not.toBe('clinical_record');
  expect(reply.message || '').not.toContain('do not diagnose');
});
