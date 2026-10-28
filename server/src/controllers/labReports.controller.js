const supabaseAdmin = require('../config/supabaseAdminClient');
const { standardizeMetrics } = require('../services/standardization/standardizeLabReport.service');
const { maybeFlagReportForTriage, getTriageQueue } = require('../services/triage.service');
const { processDocument } = require('../services/ocrService');
const {
  shareAllReportsWithAppointment,
  reportIdsSharedWithClinician,
} = require('../services/reportSharing.service');
const {
  LAB_REPORTS_BUCKET,
  uploadFile,
  createSignedUrl,
  removeFile,
} = require('../services/storage.service');
const { metricSourceSchema } = require('../validators/labReports.validators');
const {
  assertAppointmentAccess,
  clinicianHasPatient,
  resolvePatientScope,
} = require('../services/access.service');

/** Metric rows carry the dictionary's display name so the UI need not guess one. */
const METRIC_COLUMNS = '*, metric_dictionary ( display_name, category )';

/**
 * An appointment a report may be attached to: the caller must be part of it,
 * and it must be the report's patient's appointment.
 */
async function assertAppointmentForPatient(appointmentId, patientId, user) {
  const access = await assertAppointmentAccess(appointmentId, user);
  if (!access.ok) return access;
  if (access.appointment.patient_id !== patientId) {
    return { ok: false, status: 403, error: 'That appointment belongs to a different patient' };
  }
  return access;
}

/**
 * Writes one report and its standardized metrics.
 *
 * Shared by the JSON ingest route (an external pipeline posting a payload)
 * and the file-upload route, so both land in the database identically.
 */
async function persistReport({ patientId, appointmentId, storagePath, reportDate, ocrStatus, metrics, rawPayload }) {
  const { data: labReport, error: reportError } = await supabaseAdmin
    .from('lab_reports')
    .insert({
      patient_id: patientId,
      appointment_id: appointmentId || null,
      storage_path: storagePath,
      report_date: reportDate || null,
      ocr_status: ocrStatus,
      raw_ocr_payload: rawPayload,
    })
    .select()
    .single();

  if (reportError) throw reportError;

  const standardized = await standardizeMetrics(metrics || []);

  let savedMetrics = [];
  if (standardized.length > 0) {
    // standardizeMetrics keeps input order but not extra fields, so each
    // value's printed location is joined back by index. Uploads reach here
    // without passing the request validator, so the shape is checked here;
    // a malformed box is dropped rather than stored.
    const rows = standardized.map((m, i) => {
      const source = metricSourceSchema.safeParse(metrics[i]?.source);
      return {
        ...m,
        lab_report_id: labReport.id,
        source_page: source.success ? source.data.page : null,
        source_box: source.success ? { row: source.data.row, value: source.data.value ?? null } : null,
      };
    });
    const { data: insertedMetrics, error: metricsError } = await supabaseAdmin
      .from('lab_report_metrics')
      .insert(rows)
      .select(METRIC_COLUMNS);

    if (metricsError) throw metricsError;
    savedMetrics = insertedMetrics;
  }

  // Uploading against an appointment shares it with that appointment too.
  if (appointmentId) {
    await supabaseAdmin
      .from('appointment_lab_reports')
      .upsert({ appointment_id: appointmentId, lab_report_id: labReport.id }, { onConflict: 'appointment_id,lab_report_id' });
  }

  await maybeFlagReportForTriage({ labReport, metrics: savedMetrics });

  return { labReport, metrics: savedMetrics };
}

/**
 * Receives a file, stores it, and runs the extraction pipeline over it.
 *
 * The upload is recorded even when extraction fails: losing a patient's
 * document because OCR had a bad day is worse than a report the clinician
 * has to read manually.
 */
async function uploadReport(req, res, next) {
  let storagePath = null;

  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const scope = await resolvePatientScope(req);
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
    const { patientId } = scope;

    const appointmentId = req.body.appointmentId || null;
    if (appointmentId) {
      const access = await assertAppointmentForPatient(appointmentId, patientId, req.user);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
    }

    storagePath = await uploadFile({
      bucket: LAB_REPORTS_BUCKET,
      ownerId: patientId,
      buffer: req.file.buffer,
      originalName: req.file.originalname,
      contentType: req.file.mimetype,
    });

    const extracted = await processDocument({
      buffer: req.file.buffer,
      filename: req.file.originalname,
      contentType: req.file.mimetype,
      storagePath,
      appointmentId,
      requestId: req.id,
    });

    const result = await persistReport({
      patientId,
      appointmentId,
      storagePath,
      reportDate: extracted.reportDate,
      ocrStatus: extracted.ocrStatus,
      metrics: extracted.metrics,
      // The pipeline's full envelope; on failure, the error that caused it.
      rawPayload: extracted.raw ?? { error: extracted.error ?? null },
    });

    res.status(201).json({
      ...result,
      signedUrl: await createSignedUrl(LAB_REPORTS_BUCKET, storagePath),
      fileName: req.file.originalname,
    });
  } catch (err) {
    // Do not leave an orphaned object behind if the database write failed.
    if (storagePath) await removeFile(LAB_REPORTS_BUCKET, storagePath);
    next(err);
  }
}

/** Share an already-uploaded report with one of the patient's appointments. */
async function shareReportWithAppointment(req, res, next) {
  try {
    const { appointmentId } = req.validated;
    const { reportId } = req.params;

    const owned = await assertReportOwnedBy(reportId, req.user);
    if (!owned.ok) return res.status(owned.status).json({ error: owned.error });

    const appointment = await assertAppointmentForPatient(appointmentId, owned.report.patient_id, req.user);
    if (!appointment.ok) return res.status(appointment.status).json({ error: appointment.error });

    const { error } = await supabaseAdmin
      .from('appointment_lab_reports')
      .upsert({ appointment_id: appointmentId, lab_report_id: reportId }, { onConflict: 'appointment_id,lab_report_id' });

    if (error) throw error;

    res.status(200).json({ appointmentId, reportId, shared: true });
  } catch (err) {
    next(err);
  }
}

/**
 * Share the patient's whole report library with one of their appointments.
 * Called when the pre-visit check-in starts, so the clinician can see reports
 * uploaded before this visit was booked.
 */
async function shareAllReports(req, res, next) {
  try {
    const { appointmentId } = req.validated;

    const access = await assertAppointmentForPatient(appointmentId, req.user.id, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const shared = await shareAllReportsWithAppointment(req.user.id, appointmentId);
    res.status(200).json({ appointmentId, shared });
  } catch (err) {
    next(err);
  }
}

/** Stop sharing a report with an appointment. The report itself is untouched. */
async function unshareReportFromAppointment(req, res, next) {
  try {
    const { reportId, appointmentId } = req.params;

    const owned = await assertReportOwnedBy(reportId, req.user);
    if (!owned.ok) return res.status(owned.status).json({ error: owned.error });

    const { error } = await supabaseAdmin
      .from('appointment_lab_reports')
      .delete()
      .eq('appointment_id', appointmentId)
      .eq('lab_report_id', reportId);

    if (error) throw error;

    res.status(200).json({ appointmentId, reportId, shared: false });
  } catch (err) {
    next(err);
  }
}

/** Delete a report, its metrics (cascade), its shares (cascade) and its file. */
async function deleteReport(req, res, next) {
  try {
    const owned = await assertReportOwnedBy(req.params.reportId, req.user);
    if (!owned.ok) return res.status(owned.status).json({ error: owned.error });

    const { error } = await supabaseAdmin.from('lab_reports').delete().eq('id', req.params.reportId);
    if (error) throw error;

    await removeFile(LAB_REPORTS_BUCKET, owned.report.storage_path);

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

/**
 * Sharing and deleting are the patient's decisions about their own library,
 * so only the patient who uploaded a report may change it.
 */
async function assertReportOwnedBy(reportId, user) {
  const { data: report, error } = await supabaseAdmin
    .from('lab_reports')
    .select('id, patient_id, storage_path')
    .eq('id', reportId)
    .maybeSingle();

  if (error) throw error;
  if (!report) return { ok: false, status: 404, error: 'Report not found' };
  if (report.patient_id !== user.id) {
    return { ok: false, status: 403, error: 'Not authorized for this report' };
  }
  return { ok: true, report };
}

async function ingestReport(req, res, next) {
  try {
    const { appointmentId, storagePath, reportDate, metrics, ocrStatus } = req.validated;

    if (appointmentId) {
      const access = await assertAppointmentForPatient(appointmentId, req.user.id, req.user);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
    }

    const result = await persistReport({
      patientId: req.user.id,
      appointmentId,
      storagePath,
      reportDate,
      ocrStatus,
      metrics,
      rawPayload: req.body,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * The patient's report library, or just the reports shared with one
 * appointment when `appointmentId` is given.
 *
 * A clinician reading an appointment sees only what the patient chose to
 * share with it — that choice is the whole point of the join table, so it is
 * enforced here rather than left to the caller. A clinician therefore always
 * reads through an appointment of their own, never the whole library.
 */
async function listReportsForPatient(req, res, next) {
  try {
    const { appointmentId } = req.query;
    const isClinician = req.user.role === 'clinician';

    if (isClinician && !appointmentId) {
      return res.status(400).json({ error: 'appointmentId is required' });
    }

    let patientId = req.user.id;
    if (appointmentId) {
      const access = await assertAppointmentAccess(appointmentId, req.user);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
      if (isClinician) patientId = access.appointment.patient_id;
      if (!patientId) return res.json([]);
    }

    let sharedReportIds = null;
    if (appointmentId) {
      const { data: shares, error: shareError } = await supabaseAdmin
        .from('appointment_lab_reports')
        .select('lab_report_id')
        .eq('appointment_id', appointmentId);

      if (shareError) throw shareError;
      sharedReportIds = shares.map((row) => row.lab_report_id);

      if (sharedReportIds.length === 0) return res.json([]);
    }

    let query = supabaseAdmin
      .from('lab_reports')
      .select(`*, lab_report_metrics ( ${METRIC_COLUMNS} ), appointment_lab_reports ( appointment_id )`)
      .eq('patient_id', patientId)
      .order('uploaded_at', { ascending: false });

    if (sharedReportIds) query = query.in('id', sharedReportIds);

    const { data, error } = await query;
    if (error) throw error;

    // Signed URLs expire, so they are minted per response rather than stored.
    const withUrls = await Promise.all(
      data.map(async (report) => ({
        ...report,
        signed_url: await createSignedUrl(LAB_REPORTS_BUCKET, report.storage_path),
        shared_appointment_ids: (report.appointment_lab_reports || []).map((s) => s.appointment_id),
      }))
    );

    res.json(withUrls);
  } catch (err) {
    next(err);
  }
}

/**
 * Every report a patient has shared with any of this clinician's visits, for
 * the dashboard's history grid. The same sharing rule as getMetricTrend: a
 * clinician never sees a report the patient kept back from all their visits.
 */
async function listSharedHistory(req, res, next) {
  try {
    const scope = await resolvePatientScope(req);
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
    const { patientId } = scope;

    const sharedIds = await reportIdsSharedWithClinician(req.user.id, patientId);
    if (sharedIds.length === 0) return res.json([]);

    const { data, error } = await supabaseAdmin
      .from('lab_reports')
      .select(`*, lab_report_metrics ( ${METRIC_COLUMNS} ), appointment_lab_reports ( appointment_id )`)
      .eq('patient_id', patientId)
      .in('id', sharedIds)
      .order('uploaded_at', { ascending: false });
    if (error) throw error;

    const withUrls = await Promise.all(
      (data || []).map(async (report) => ({
        ...report,
        signed_url: await createSignedUrl(LAB_REPORTS_BUCKET, report.storage_path),
        shared_appointment_ids: (report.appointment_lab_reports || []).map((s) => s.appointment_id),
      }))
    );

    // Newest first by the date the test was taken, falling back to upload.
    const takenAt = (report) => new Date(report.report_date ?? report.uploaded_at).getTime();
    withUrls.sort((a, b) => takenAt(b) - takenAt(a));

    res.json(withUrls);
  } catch (err) {
    next(err);
  }
}

async function getMetricTrend(req, res, next) {
  try {
    const { standardKey } = req.params;

    const scope = await resolvePatientScope(req);
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
    const { patientId } = scope;

    let query = supabaseAdmin
      .from('lab_report_metrics')
      .select(
        'parsed_value, reviewed_value, unit_standard, created_at, lab_reports!inner ( patient_id, uploaded_at, report_date )'
      )
      .eq('standard_key', standardKey)
      .eq('lab_reports.patient_id', patientId)
      .order('created_at', { ascending: true });

    // A clinician's history is built only from reports shared with them.
    if (req.user.role === 'clinician') {
      const sharedIds = await reportIdsSharedWithClinician(req.user.id, patientId);
      if (sharedIds.length === 0) return res.json([]);
      query = query.in('lab_report_id', sharedIds);
    }

    const { data, error } = await query;

    if (error) throw error;

    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function reviewMetric(req, res, next) {
  try {
    const { standardKey, reviewedValue } = req.validated;

    const { data: metric, error: metricError } = await supabaseAdmin
      .from('lab_report_metrics')
      .select('id, lab_report_id, lab_reports ( patient_id )')
      .eq('id', req.params.metricId)
      .maybeSingle();

    if (metricError) throw metricError;
    if (!metric) return res.status(404).json({ error: 'Metric not found' });

    const sharedIds = await reportIdsSharedWithClinician(req.user.id, metric.lab_reports?.patient_id);
    if (!sharedIds.includes(metric.lab_report_id)) {
      return res.status(403).json({ error: 'Not authorized for this report' });
    }

    const changes = {
      reviewed_value: reviewedValue,
      reviewed_by: req.user.id,
      needs_review: false,
    };
    // Only overwrite the matched metric when the clinician chose one.
    if (standardKey) changes.standard_key = standardKey;

    const { data, error } = await supabaseAdmin
      .from('lab_report_metrics')
      .update(changes)
      .eq('id', req.params.metricId)
      .select()
      .single();

    if (error) throw error;

    res.json(data);
  } catch (err) {
    next(err);
  }
}

async function listTriageQueue(req, res, next) {
  try {
    const data = await getTriageQueue(req.user.id);
    res.json(data);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  ingestReport,
  uploadReport,
  listReportsForPatient,
  listSharedHistory,
  getMetricTrend,
  reviewMetric,
  listTriageQueue,
  shareReportWithAppointment,
  shareAllReports,
  unshareReportFromAppointment,
  deleteReport,
};
