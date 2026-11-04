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
  const id = (page[1] === 'visit' ? context?.appointmentId : context?.patientId) || query.get(page[2]);
  return id ? { kind: page[1], id } : null;
}
export async function hashWrittenValue(value) {
  const bytes = new TextEncoder().encode(String(value).trim().replace(/\s+/g, ' '));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(n => n.toString(16).padStart(2, '0')).join('');
}
