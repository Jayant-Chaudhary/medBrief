const supabaseAdmin = require('../config/supabaseAdminClient');
const { clinicianHasPatient } = require('./access.service');

const COLLECTIONS = Object.freeze({
  antenatal_visits: { table: 'antenatal_visits' },
  pregnancy_investigations: { table: 'pregnancy_investigations' },
  pregnancy_ultrasounds: { table: 'pregnancy_ultrasounds' },
  pregnancy_vaccinations: { table: 'pregnancy_vaccinations' },
});

function notFound() {
  return { ok: false, status: 404, error: 'Pregnancy record not found' };
}

async function assertPatientAccess(clinicianId, patientId) {
  if (!(await clinicianHasPatient(clinicianId, patientId))) {
    return { ok: false, status: 403, error: 'Not authorized for this patient' };
  }
  return { ok: true };
}

async function getOwnedEpisode(episodeId, clinicianId) {
  const { data, error } = await supabaseAdmin
    .from('pregnancy_episodes')
    .select('*')
    .eq('id', episodeId)
    .eq('clinician_id', clinicianId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function getPatientRecord(clinicianId, patientId) {
  const access = await assertPatientAccess(clinicianId, patientId);
  if (!access.ok) return access;

  const { data: episodes, error: episodeError } = await supabaseAdmin
    .from('pregnancy_episodes')
    .select('*')
    .eq('patient_id', patientId)
    .eq('clinician_id', clinicianId)
    .order('created_at', { ascending: false });
  if (episodeError) throw episodeError;

  const episodeIds = (episodes || []).map((episode) => episode.id);
  const record = { episodes: episodes || [], antenatal_visits: [], investigations: [], ultrasounds: [], vaccinations: [], deliveries: [] };
  if (episodeIds.length) {
    const [visits, investigations, ultrasounds, vaccinations, deliveries] = await Promise.all([
      supabaseAdmin.from('antenatal_visits').select('*').in('pregnancy_episode_id', episodeIds).order('visit_date', { ascending: false }),
      supabaseAdmin.from('pregnancy_investigations').select('*').in('pregnancy_episode_id', episodeIds).order('performed_on', { ascending: false }),
      supabaseAdmin.from('pregnancy_ultrasounds').select('*').in('pregnancy_episode_id', episodeIds).order('performed_on', { ascending: false }),
      supabaseAdmin.from('pregnancy_vaccinations').select('*').in('pregnancy_episode_id', episodeIds).order('administered_on', { ascending: false }),
      supabaseAdmin.from('pregnancy_deliveries').select('*').in('pregnancy_episode_id', episodeIds),
    ]);
    for (const result of [visits, investigations, ultrasounds, vaccinations, deliveries]) {
      if (result.error) throw result.error;
    }
    record.antenatal_visits = visits.data || [];
    record.investigations = investigations.data || [];
    record.ultrasounds = ultrasounds.data || [];
    record.vaccinations = vaccinations.data || [];
    record.deliveries = deliveries.data || [];
  }

  record.lab_report_summaries = await getSharedLabReportSummaries(clinicianId, patientId);
  return { ok: true, record };
}

async function getSharedLabReportSummaries(clinicianId, patientId) {
  const { data: appointments, error: appointmentError } = await supabaseAdmin
    .from('appointments')
    .select('id')
    .eq('clinician_id', clinicianId)
    .eq('patient_id', patientId);
  if (appointmentError) throw appointmentError;
  const appointmentIds = (appointments || []).map((item) => item.id);
  if (!appointmentIds.length) return [];

  const { data: shares, error: shareError } = await supabaseAdmin
    .from('appointment_lab_reports')
    .select('lab_report_id')
    .in('appointment_id', appointmentIds);
  if (shareError) throw shareError;
  const reportIds = [...new Set((shares || []).map((item) => item.lab_report_id))];
  if (!reportIds.length) return [];

  const { data, error } = await supabaseAdmin
    .from('lab_reports')
    .select(`id, report_date, uploaded_at, ocr_status, lab_report_metrics ( id, raw_key, raw_value, standard_key, parsed_value, reviewed_value, unit_raw, unit_standard, needs_review, metric_dictionary ( display_name, category ) )`)
    .eq('patient_id', patientId)
    .in('id', reportIds)
    .order('report_date', { ascending: false });
  if (error) throw error;

  return (data || []).map((report) => ({
    id: report.id,
    reportDate: report.report_date,
    uploadedAt: report.uploaded_at,
    ocrStatus: report.ocr_status,
    metrics: (report.lab_report_metrics || []).map((metric) => ({
      id: metric.id,
      name: metric.metric_dictionary?.display_name || metric.raw_key,
      rawKey: metric.raw_key,
      standardKey: metric.standard_key,
      rawValue: metric.raw_value,
      value: metric.reviewed_value ?? metric.parsed_value,
      unit: metric.unit_standard || metric.unit_raw || '',
      needsReview: metric.needs_review,
      category: metric.metric_dictionary?.category || null,
    })),
  }));
}

async function createEpisode({ clinicianId, patientId, changes }) {
  const access = await assertPatientAccess(clinicianId, patientId);
  if (!access.ok) return access;
  const { data, error } = await supabaseAdmin
    .from('pregnancy_episodes')
    .insert({ ...changes, patient_id: patientId, clinician_id: clinicianId })
    .select()
    .single();
  if (error) throw error;
  return { ok: true, data };
}

async function updateEpisode({ clinicianId, episodeId, changes }) {
  const episode = await getOwnedEpisode(episodeId, clinicianId);
  if (!episode) return notFound();
  const { data, error } = await supabaseAdmin
    .from('pregnancy_episodes')
    .update({ ...changes, updated_at: new Date().toISOString() })
    .eq('id', episodeId)
    .eq('clinician_id', clinicianId)
    .select()
    .single();
  if (error) throw error;
  return { ok: true, data };
}

async function createRecord({ clinicianId, episodeId, collection, changes }) {
  const episode = await getOwnedEpisode(episodeId, clinicianId);
  if (!episode) return notFound();
  const descriptor = COLLECTIONS[collection];
  if (!descriptor) return { ok: false, status: 400, error: 'Unsupported record collection' };

  if (collection === 'antenatal_visits' && changes.appointment_id) {
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .select('id, patient_id, clinician_id')
      .eq('id', changes.appointment_id)
      .maybeSingle();
    if (appointmentError) throw appointmentError;
    if (!appointment || appointment.clinician_id !== clinicianId || appointment.patient_id !== episode.patient_id) {
      return { ok: false, status: 403, error: 'Appointment is not linked to this patient and clinician' };
    }
  }

  if (collection === 'pregnancy_investigations' && changes.lab_report_id) {
    const sharedReports = await getSharedLabReportSummaries(clinicianId, episode.patient_id);
    if (!sharedReports.some((report) => report.id === changes.lab_report_id)) {
      return { ok: false, status: 403, error: 'Lab report is not shared with this clinician' };
    }
  }

  const { data, error } = await supabaseAdmin
    .from(descriptor.table)
    .insert({ ...changes, pregnancy_episode_id: episodeId, created_by: clinicianId })
    .select()
    .single();
  if (error) throw error;
  return { ok: true, data };
}

async function updateRecord({ clinicianId, recordId, collection, changes, remove = false }) {
  const descriptor = COLLECTIONS[collection];
  if (!descriptor) return { ok: false, status: 400, error: 'Unsupported record collection' };
  const { data: row, error: rowError } = await supabaseAdmin
    .from(descriptor.table)
    .select('id, pregnancy_episode_id')
    .eq('id', recordId)
    .maybeSingle();
  if (rowError) throw rowError;
  const episode = row ? await getOwnedEpisode(row.pregnancy_episode_id, clinicianId) : null;
  if (!row || !episode) return notFound();

  if (collection === 'antenatal_visits' && changes.appointment_id) {
    const { data: appointment, error: appointmentError } = await supabaseAdmin
      .from('appointments')
      .select('id, patient_id, clinician_id')
      .eq('id', changes.appointment_id)
      .maybeSingle();
    if (appointmentError) throw appointmentError;
    if (!appointment || appointment.clinician_id !== clinicianId || appointment.patient_id !== episode.patient_id) {
      return { ok: false, status: 403, error: 'Appointment is not linked to this patient and clinician' };
    }
  }
  if (collection === 'pregnancy_investigations' && changes.lab_report_id) {
    const sharedReports = await getSharedLabReportSummaries(clinicianId, episode.patient_id);
    if (!sharedReports.some((report) => report.id === changes.lab_report_id)) {
      return { ok: false, status: 403, error: 'Lab report is not shared with this clinician' };
    }
  }

  let query = supabaseAdmin.from(descriptor.table).delete().eq('id', recordId);
  if (!remove) query = supabaseAdmin.from(descriptor.table).update({ ...changes, updated_at: new Date().toISOString() }).eq('id', recordId);
  const { data, error } = await query.select().maybeSingle();
  if (error) throw error;
  return { ok: true, data };
}

async function saveDelivery({ clinicianId, episodeId, changes }) {
  const episode = await getOwnedEpisode(episodeId, clinicianId);
  if (!episode) return notFound();
  const { data, error } = await supabaseAdmin
    .from('pregnancy_deliveries')
    .upsert({ ...changes, pregnancy_episode_id: episodeId, updated_by: clinicianId, updated_at: new Date().toISOString() }, { onConflict: 'pregnancy_episode_id' })
    .select()
    .single();
  if (error) throw error;
  return { ok: true, data };
}

module.exports = {
  COLLECTIONS,
  getPatientRecord,
  createEpisode,
  updateEpisode,
  createRecord,
  updateRecord,
  saveDelivery,
};
