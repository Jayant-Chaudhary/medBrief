const supabaseAdmin = require('../config/supabaseAdminClient');
const log = require('../utils/logger').child({ scope: 'report-sharing' });

/**
 * Shares every report a patient has already uploaded with one appointment.
 *
 * A clinician reads reports only through `appointment_lab_reports`, so a
 * report uploaded before the appointment existed (or against an earlier
 * visit) is invisible to them until it is shared. Starting the pre-visit
 * check-in is the patient bringing their history to this visit, so the whole
 * library is shared then. The patient can still unshare any report from the
 * Reports page. Idempotent: existing shares are left as they are.
 *
 * @returns {Promise<number>} how many reports are now shared with the appointment
 */
async function shareAllReportsWithAppointment(patientId, appointmentId) {
  const { data: reports, error } = await supabaseAdmin
    .from('lab_reports')
    .select('id')
    .eq('patient_id', patientId);
  if (error) throw error;

  const rows = (reports || []).map((report) => ({ appointment_id: appointmentId, lab_report_id: report.id }));
  if (rows.length === 0) return 0;

  const { error: shareError } = await supabaseAdmin
    .from('appointment_lab_reports')
    .upsert(rows, { onConflict: 'appointment_id,lab_report_id', ignoreDuplicates: true });
  if (shareError) throw shareError;

  log.info('shared prior reports with appointment', { patientId, appointmentId, count: rows.length });
  return rows.length;
}

/** Ids of the reports a patient has shared with any of this clinician's appointments. */
async function reportIdsSharedWithClinician(clinicianId, patientId) {
  const { data: appointments, error } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('clinician_id', clinicianId)
    .eq('patient_id', patientId);
  if (error) throw error;

  const appointmentIds = (appointments || []).map((a) => a.id);
  if (appointmentIds.length === 0) return [];

  const { data: shares, error: shareError } = await supabaseAdmin
    .from('appointment_lab_reports')
    .select('lab_report_id')
    .in('appointment_id', appointmentIds);
  if (shareError) throw shareError;

  return [...new Set((shares || []).map((row) => row.lab_report_id))];
}

module.exports = { shareAllReportsWithAppointment, reportIdsSharedWithClinician };
