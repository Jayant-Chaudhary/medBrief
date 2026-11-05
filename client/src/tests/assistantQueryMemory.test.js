import { expect, it } from 'vitest';
import { appendMemory, memoryEntryForReply } from '../components/assistant/memoryState';
const openContext = { patient: { id: 'synthetic-a' }, record: { kind: 'visit', id: 'synthetic-visit-a' } };
const queriedContext = { patient: { id: 'synthetic-b', name: 'Asha Example' }, record: { kind: 'visit', id: 'synthetic-visit-b' } };
const input = { message: 'What is Asha Example\'s ferritin?', observedContext: openContext, page: 'clinician', now: 1000 };

it('remembers the Q&A subject instead of the different patient open behind the panel', () => {
  const entry = memoryEntryForReply({ ...input, reply: { type: 'answer', source: 'clinical_record',
    text: 'Synthetic retrieved reading: 28', memoryContext: queriedContext } });
  expect(entry.patient).toEqual(queriedContext.patient);
  expect(entry.record).toEqual(queriedContext.record);
  expect(entry.message).toBe(input.message);
  expect(JSON.stringify(entry)).not.toContain('28');
});

it('does not borrow the open visit when the queried patient has no known record', () => {
  const entry = memoryEntryForReply({ ...input, reply: { type: 'answer', source: 'clinical_record',
    memoryContext: { patient: queriedContext.patient, record: null } } });
  expect(entry.patient.id).toBe('synthetic-b');
  expect(entry.record).toBeNull();
});

it('memory answers and app help do not overwrite the remembered patient on repeated questions', () => {
  let entries = [memoryEntryForReply({ ...input, reply: { type: 'answer', source: 'clinical_record', memoryContext: queriedContext } })];
  for (const source of ['memory', 'memory', 'model']) {
    const entry = memoryEntryForReply({ ...input, message: 'Which patient was that?', reply: { type: 'answer', source } });
    expect(entry).toBeNull();
    entries = appendMemory(entries, entry, { now: 1000 });
  }
  expect(entries).toHaveLength(1);
  expect(entries[0].patient.id).toBe('synthetic-b');
});

it('unresolved or older-backend clinical replies cannot inherit an unrelated patient', () => {
  for (const reply of [
    { type: 'answer', source: 'clinical_record' }, { type: 'clarify', source: 'clinical_record' },
    { type: 'unsupported', source: 'clinical_record' },
  ]) expect(memoryEntryForReply({ ...input, reply })).toBeNull();
});

it('normal actions retain the existing observed record context', () => {
  const entry = memoryEntryForReply({ ...input, reply: { type: 'done', checklist: [{ text: 'Open visit', done: true }] } });
  expect(entry.patient).toEqual(openContext.patient);
  expect(entry.record).toEqual(openContext.record);
  expect(entry.checklist[0].done).toBe(true);
});
