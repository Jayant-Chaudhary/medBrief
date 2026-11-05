// Read the same local state that applyMany changes. No values leave the bridge.
export function createMaternityReaders({ readState, patientFields, baselineFields, deliveryFields, rowFields, rowKinds }) {
  const controls = {};
  function section(prefix, fields, readSection) {
    for (const key of fields) controls[`${prefix}.${key}`] = { get: () => readSection(readState())?.[key] ?? '' };
  }
  section('patient', patientFields, state => state.patient);
  section('baseline', baselineFields, state => state.investigations);
  section('delivery', deliveryFields, state => state.delivery);
  for (const [prefix, kind] of Object.entries(rowKinds)) {
    section(prefix, rowFields[kind], state => state.pending?.[kind]?.values);
  }
  return controls;
}
