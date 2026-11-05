import { it, expect } from 'vitest';
import { createMaternityReaders } from '../components/assistant/maternityReaders';
import { runPlan } from '../components/assistant/planRunner';

it('verifies actual maternity changes through the registered readers', async () => {
  const state = { patient: { gravida: '' }, investigations: { hb: '' }, delivery: { weight: '' }, pending: {} };
  const controls = createMaternityReaders({ readState: () => state, patientFields: ['gravida'], baselineFields: ['hb'], deliveryFields: ['weight'], rowFields: { visits: ['weight', 'systolic', 'diastolic'] }, rowKinds: { visit: 'visits' } });
  const fields = { 'visit.weight': '62', 'visit.systolic': '110', 'visit.diastolic': '70' };
  const recorded = [];
  await runPlan([{ fill: { page: 'maternity', fields, actionIds: Object.fromEntries(Object.keys(fields).map(id => [id, id])) } }], {
    stopped: () => false, settle: async () => {}, highlight: () => {}, progress: () => {}, record: result => recorded.push(result),
    waitFor: async () => ({
      get: id => controls[id]?.get(),
      fill: values => { state.pending.visits = { values: Object.fromEntries(Object.entries(values).map(([id, value]) => [id.split('.')[1], value])) }; },
    }),
  });
  expect(recorded).toHaveLength(3);
  expect(recorded.every(result => result.result === 'ok')).toBe(true);
  state.investigations.hb = '10.5';
  state.patient.gravida = '2';
  state.delivery.weight = '3.1';
  expect(controls['baseline.hb'].get()).toBe('10.5');
  expect(controls['patient.gravida'].get()).toBe('2');
  expect(controls['delivery.weight'].get()).toBe('3.1');
  expect(controls['patient.name']).toBeUndefined();
});
