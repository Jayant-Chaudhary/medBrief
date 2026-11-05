const supabase = require('../../config/supabaseAdminClient');
async function appointmentOwner(id, clinicianId) {
  const { data, error } = await supabase.from('appointments').select('id,patient_id').eq('id', id).eq('clinician_id', clinicianId).maybeSingle();
  return error ? null : data;
}
async function resolveRecord(record, patients, clinicianId, lookup = appointmentOwner) {
  if (!record || !['visit','maternity','new_appointment'].includes(record.kind) || !record.id) return null;
  if (record.kind === 'visit') {
    const visit = await lookup(record.id, clinicianId);
    return visit?.patient_id && patients.some(p => p.id === visit.patient_id)
      ? { kind: 'visit', id: visit.id, patientId: visit.patient_id } : null;
  }
  return patients.some(p => p.id === record.id) ? { kind: record.kind, id: record.id, patientId: record.id } : null;
}
module.exports = { resolveRecord, appointmentOwner };
