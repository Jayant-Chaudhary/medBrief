const { validateAgentActions, isGrounded } = require('../../services/assistant/agent/actions');
const { redact, checkPageActions } = require('../../services/assistant/pageSnapshot');
const { resolveRecord } = require('../../services/assistant/recordContext');
const writes = require('../../services/assistant/writes');
const assistant = require('../../services/assistant/assistant.service');
const config = require('../../config/assistant.config');
const patients = [{ id: 'p-test', fullName: 'Asha Example', lastVisit: { appointmentId: 'v-test' } }];
const page = { elements: [{ ref: 'r1', kind: 'textarea', name: 'Consultancy notes', section: 'Notes', effect: 'save' }] };
const context = { currentRecord: { kind: 'visit', id: 'v-test', patientId: 'p-test' }, originRecord: { kind: 'visit', id: 'v-test', patientId: 'p-test' } };
test('type on textarea is append through both validation paths', () => {
  const raw = [{ ref: 'r1', op: 'type', value: 'resting pulse 78 bpm' }];
  expect(validateAgentActions(raw, page, 'write resting pulse 78 bpm', patients).pageActions[0].op).toBe('append');
  expect(checkPageActions(raw, page, 'write resting pulse 78 bpm', { maxActions: 8 }).actions[0].op).toBe('append');
});
test('grounding preserves numbers and word order, including short values', () => {
  expect(isGrounded('99', 'write 78')).toBe(false);
  expect(isGrounded('pulse 99 bpm', 'pulse 78 bpm')).toBe(false);
  expect(isGrounded('Asha', 'Natasha')).toBe(false);
  expect(isGrounded('no pain', 'pain, no fever')).toBe(false);
  expect(isGrounded('78 bpm', 'write 78 bpm')).toBe(true);
});
test('replace requires both phrases from the request', () => {
  for (const find of ['', 'invented']) expect(validateAgentActions([{ ref: 'r1', op: 'replace', find, text: 'rest' }], page, 'write rest', patients).pageActions).toHaveLength(0);
});
test.each(['click','type','select','check','append','key'])('private %s remains refused after redaction', op => {
  const snapshot = redact({ elements: [{ ref: 'r1', kind: 'button', name: 'Asha Example', private: true, effect: 'free' }] }, patients);
  expect(snapshot.elements[0].private).toBe(true);
  expect(validateAgentActions([{ ref: 'r1', op, text: 'Asha' }], snapshot, 'open Asha', patients).pageActions).toHaveLength(0);
  expect(checkPageActions([{ ref: 'r1', op }], snapshot, 'open Asha', { maxActions: 8 }).actions).toHaveLength(0);
});
test('patient records require a grounded name or the checked current record', () => {
  expect(validateAgentActions([{ op: 'open_record', kind: 'last_visit', patient: 'Asha' }], page, 'open last visit', patients).navigationSteps).toHaveLength(0);
  expect(validateAgentActions([{ op: 'open_record', kind: 'last_visit' }], page, 'open last visit', patients).disambiguation.message).toBe('Which patient?');
  expect(validateAgentActions([{ op: 'open_record', kind: 'last_visit' }], page, 'open last visit', patients, 'clinician', context).navigationSteps[0].recordId).toBe('v-test');
});
test('return uses checked id, never a model URL', () => {
  const result = validateAgentActions([{ op: 'go', page: 'return', path: 'https://evil.test' }], page, 'return to the record', patients, 'clinician', context);
  expect(result.navigationSteps[0]).toMatchObject({ op: 'return_record', recordTarget: context.originRecord });
  expect(result.navigationSteps[0].path).toBeUndefined();
});
test('foreign and nonexistent records are refused', async () => {
  const lookup = jest.fn(async () => ({ id: 'foreign', patient_id: 'foreign-patient' }));
  expect(await resolveRecord({ kind: 'visit', id: 'foreign' }, patients, 'doctor', lookup)).toBeNull();
  expect(lookup).toHaveBeenCalledWith('foreign', 'doctor');
  expect(await resolveRecord({ kind: 'maternity', id: 'foreign' }, patients, 'doctor')).toBeNull();
});
test('duplicate write is blocked even when DOM ref and operation change', () => {
  const ctx = { record: context.currentRecord, path: '/clinician' };
  const first = writes.guard([{ ref: 'r1', op: 'append', name: 'Notes', value: 'resting pulse 78 bpm' }], [], ctx).actions[0];
  const next = writes.guard([{ ref: 'r44', op: 'type', name: 'Notes', value: 'resting pulse 78 bpm' }], [first], ctx);
  expect(next.actions).toHaveLength(0);
  expect(next.refused[0].reason).toBe('already written');
  expect(writes.guard([{ ...first, value: 'rest' }], [first], ctx).actions).toHaveLength(1);
});
test('duplicate-notes trace remembers successful hashes despite omitted client written history', async () => {
  const message = 'write resting pulse 78 bpm in notes then open schedule';
  const provider = { complete: jest.fn(async ({ schema }) => JSON.stringify(schema.properties.checklist
    ? { checklist: ['Write resting pulse 78 bpm in notes', 'Open schedule'] }
    : { status: 'continue', actions: [{ op: 'type', ref: 'r1', text: 'resting pulse 78 bpm' }] })) };
  const base = { message, role: 'clinician', userId: 'doctor', currentPath: '/clinician', currentRecord: { kind: 'visit', id: 'v-test' }, originRecord: { kind: 'visit', id: 'v-test' }, directory: async () => patients, recordLookup: async () => ({ id: 'v-test', patient_id: 'p-test' }), settings: { ...config, agentLoop: true }, page, provider };
  const first = await assistant.handleStep(base);
  const action = first.steps[0].page.actions[0];
  expect(action.op).toBe('append');
  const next = await assistant.handleStep({ ...base, round: 1, mode: first.mode, continuationToken: first.continuationToken, results: [{ actionId: action.actionId, result: 'ok' }], written: [] });
  expect(next.type).toBe('unsupported');
  expect(next.message).toContain('already written');
  expect(next.checklist[0].done).toBe(true);
  expect(next.checklist[1].done).toBe(false);
});
test('patient-specific notes with no record or named patient ask first', async () => {
  const result = await assistant.handleStep({ message: 'notes: rest', role: 'clinician', userId: 'doctor', currentPath: '/clinician', page, directory: async () => patients, settings: { ...config, agentLoop: true }, provider: { complete: jest.fn() } });
  expect(result.message).toBe('Which patient?');
  expect(result.steps).toBeUndefined();
});
