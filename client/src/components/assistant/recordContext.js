// Only registered routes are built; the server returns a checked record id.
export function recordPath(record) {
  if (!record?.id) return null;
  const id = encodeURIComponent(record.id);
  if (record.kind === 'visit') return `/clinician?appointment=${id}`;
  if (record.kind === 'maternity') return `/clinician/maternity?patientId=${id}`;
  if (record.kind === 'new_appointment') return `/clinician/appointments/new?patient=${id}`;
  return null;
}
export function readRecord(location, bridge) {
  const query = new URLSearchParams(location.search);
  const pages = { '/clinician': ['dashboard','visit','appointment'], '/clinician/maternity': ['maternity','maternity','patientId'], '/clinician/appointments/new': ['new_appointment','new_appointment','patient'] };
  const page = pages[location.pathname];
  if (!page) return null;
  const context = bridge?.context?.(page[0]);
  const contextId = page[1] === 'visit' ? context?.appointmentId : context?.patientId;
  const id = page[1] === 'new_appointment' ? contextId || query.get(page[2]) : query.get(page[2]) || contextId;
  return id ? { kind: page[1], id } : null;
}

// A visit id identifies an appointment, never the patient. Only a loaded
// matching bridge can provide the patient for that visit.
export function rememberRecord(location, bridge, previous = null) {
  const record = readRecord(location, bridge);
  if (!record) return previous;
  const pageId = { visit: 'dashboard', maternity: 'maternity', new_appointment: 'new_appointment' }[record.kind];
  const context = bridge?.context?.(pageId);
  const patientId = record.kind === 'visit'
    ? (context?.appointmentId === record.id ? context.patientId : null)
    : record.id;
  if (patientId) return { record, patient: { id: patientId } };
  const sameRecord = previous?.record?.kind === record.kind && previous.record.id === record.id;
  return { record, patient: sameRecord ? previous.patient : null };
}
export async function hashWrittenValue(value) {
  const bytes = new TextEncoder().encode(String(value).trim().replace(/\s+/g, ' '));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}
