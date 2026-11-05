const supabaseAdmin = require('../config/supabaseAdminClient');

/** Statuses that mean the visit is still ahead of the patient. */
const UPCOMING_STATUSES = new Set(['invited', 'active', 'checked_in']);

function first(value) {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/**
 * Every patient who has an account linked to one of this clinician's
 * appointments, one row per patient, with enough to find and re-book them.
 *
 * The email comes from the invite the clinic sent: it is the address the
 * clinic already knows, and reading it avoids an auth-admin call per patient.
 */
async function listClinicianPatients(clinicianId) {
  const { data, error } = await supabaseAdmin
    .from('appointments')
    .select(
      'id, patient_id, scheduled_at, status, patient:profiles!appointments_patient_id_fkey ( id, full_name, phone ), appointment_invites ( patient_email )'
    )
    .eq('clinician_id', clinicianId)
    .not('patient_id', 'is', null)
    .order('scheduled_at', { ascending: true });

  if (error) throw error;

  const now = Date.now();
  const byPatient = new Map();

  for (const appointment of data || []) {
    const entry = byPatient.get(appointment.patient_id) ?? {
      id: appointment.patient_id,
      fullName: appointment.patient?.full_name ?? null,
      phone: appointment.patient?.phone ?? null,
      email: null,
      visitCount: 0,
      lastVisit: null,
      nextVisit: null,
    };

    entry.email = entry.email ?? first(appointment.appointment_invites)?.patient_email ?? null;
    if (appointment.status !== 'cancelled') entry.visitCount += 1;

    const at = new Date(appointment.scheduled_at).getTime();
    const summary = { appointmentId: appointment.id, scheduledAt: appointment.scheduled_at, status: appointment.status };

    // Rows are oldest first, so the last past visit seen is the latest,
    // and the first upcoming one seen is the soonest.
    if (at <= now || appointment.status === 'completed') {
      if (appointment.status !== 'cancelled') entry.lastVisit = summary;
    } else if (UPCOMING_STATUSES.has(appointment.status) && !entry.nextVisit) {
      entry.nextVisit = summary;
    }

    byPatient.set(appointment.patient_id, entry);
  }

  return [...byPatient.values()].sort((a, b) =>
    (a.fullName || a.email || '').localeCompare(b.fullName || b.email || '')
  );
}

module.exports = { listClinicianPatients };
