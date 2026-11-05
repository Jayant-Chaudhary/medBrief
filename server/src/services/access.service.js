const supabaseAdmin = require('../config/supabaseAdminClient');

/**
 * Every route runs on the service-role key, which bypasses row level
 * security, so "may this user touch this row" has to be answered here.
 * Results use one shape — { ok, status, error, ...data } — so a controller
 * can hand a refusal straight back to the client.
 */

function deny(status, error) {
  return { ok: false, status, error };
}

/** A patient may act on their own appointments; a clinician on the ones they run. */
function isParticipant(appointment, user) {
  return user.role === 'clinician'
    ? appointment.clinician_id === user.id
    : appointment.patient_id === user.id;
}

async function assertAppointmentAccess(appointmentId, user) {
  if (!appointmentId) return deny(400, 'appointmentId is required');

  const { data: appointment, error } = await supabaseAdmin
    .from('appointments')
    .select('id, patient_id, clinician_id, status, scheduled_at')
    .eq('id', appointmentId)
    .maybeSingle();

  if (error) throw error;
  if (!appointment) return deny(404, 'Appointment not found');
  if (!isParticipant(appointment, user)) return deny(403, 'Not authorized for this appointment');

  return { ok: true, appointment };
}

/** Whether a clinician has at least one appointment with this patient. */
async function clinicianHasPatient(clinicianId, patientId) {
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('clinician_id', clinicianId)
    .eq('patient_id', patientId)
    .limit(1);

  if (error) throw error;
  return (data || []).length > 0;
}

/**
 * The patient a request is about. Patients are always themselves; a clinician
 * names one (query or body `patientId`) and must be treating them.
 */
async function resolvePatientScope(req) {
  if (req.user.role !== 'clinician') return { ok: true, patientId: req.user.id };

  const patientId = req.query.patientId || req.body?.patientId;
  if (!patientId) return deny(400, 'patientId is required');

  if (!(await clinicianHasPatient(req.user.id, patientId))) {
    return deny(403, 'Not authorized for this patient');
  }
  return { ok: true, patientId };
}

/**
 * Access to a row that hangs off an appointment (checklist item, action item):
 * load the row's appointment_id, then apply the appointment rule.
 */
async function assertRowAccessViaAppointment(table, rowId, user) {
  const { data: row, error } = await supabaseAdmin
    .from(table)
    .select('id, appointment_id')
    .eq('id', rowId)
    .maybeSingle();

  if (error) throw error;
  if (!row) return deny(404, 'Item not found');

  return assertAppointmentAccess(row.appointment_id, user);
}

module.exports = {
  assertAppointmentAccess,
  assertRowAccessViaAppointment,
  clinicianHasPatient,
  resolvePatientScope,
};
