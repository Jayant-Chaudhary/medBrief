import { request, upload } from './apiClient.js';
import { buildFlowsheet, reviewReason } from '../utils/flowsheet.js';
import { fileKindOf } from '../utils/sourceCrop.js';

/** Create an appointment, attach its questionnaire and invite the patient. */
export async function createAppointment({
  patientEmail,
  patientFullName,
  scheduledAt,
  questionnaireTemplateIds,
  newQuestions,
}) {
  return request('/api/appointments', {
    method: 'POST',
    body: { patientEmail, patientFullName, scheduledAt, questionnaireTemplateIds, newQuestions },
  });
}

// ---------------------------------------------------------------------------
// The clinician's own lists: pre-visit questions, consultation and action items
// ---------------------------------------------------------------------------

export async function getQuestionnaireTemplates() {
  return request('/api/questionnaire/templates');
}

/** `responseType` is 'yes_no' (answered Yes/No) or 'text' (answered in writing). */
export async function createQuestion({ questionText, responseType = 'yes_no', isRedFlagTrigger = false }) {
  return request('/api/questionnaire/templates', {
    method: 'POST',
    body: { questionText, responseType, isRedFlagTrigger },
  });
}

export async function updateQuestion(id, changes) {
  return request(`/api/questionnaire/templates/${id}`, { method: 'PATCH', body: changes });
}

export async function deleteQuestion(id) {
  return request(`/api/questionnaire/templates/${id}`, { method: 'DELETE' });
}

/** `kind` is 'consultation' or 'action'. */
export async function getTemplates(kind) {
  return request(`/api/templates?kind=${kind}`);
}

export async function createTemplate(kind, label) {
  return request('/api/templates', { method: 'POST', body: { kind, label } });
}

export async function updateTemplate(id, changes) {
  return request(`/api/templates/${id}`, { method: 'PATCH', body: changes });
}

export async function deleteTemplate(id) {
  return request(`/api/templates/${id}`, { method: 'DELETE' });
}

/** Everyone who has accepted a visit with this clinician. */
export async function fetchMyPatients() {
  return request('/api/patients');
}

/** Patients in the clinician's queue, for the sidebar and search. */
export async function fetchPatients() {
  const appointments = await request('/api/appointments');

  return appointments.map((appointment) => ({
    id: appointment.patient_id,
    name: appointment.patient?.full_name ?? appointment.invited_email ?? 'Invited patient',
    email: appointment.invited_email ?? null,
    // Nothing to open until the patient has accepted and been linked.
    isPending: !appointment.patient_id,
    scheduledAt: appointment.scheduled_at,
    status: appointment.status,
    acuity: 'pending',
    appointmentId: appointment.id,
  }));
}

/**
 * Everything the dashboard needs for one appointment, in one call.
 * The API pieces are fetched in parallel and stitched into the view model the
 * components consume.
 */
export async function fetchPatientDashboard(patientId, appointmentId) {
  const [appointment, responses, reports, postVisit, consultationTemplates, actionTemplates] = await Promise.all([
    request(`/api/appointments/${appointmentId}`),
    request(`/api/questionnaire/responses/${appointmentId}`),
    // Only what the patient chose to share with this appointment.
    request(`/api/lab-reports?appointmentId=${appointmentId}`),
    request(`/api/post-visit/${appointmentId}`),
    getTemplates('consultation'),
    getTemplates('action'),
  ]);

  // Every report shared with any of this doctor's visits, for the history
  // grid. Falls back to this visit's reports if the patient isn't linked yet
  // or the history call fails — the grid then just has one column.
  const history = patientId
    ? await request(`/api/lab-reports/history?patientId=${patientId}`).catch(() => reports)
    : reports;

  return {
    patient: buildPatient(appointment, patientId),
    appointment,
    questionnaire: {
      submittedAt: responses[0]?.created_at ?? null,
      answers: responses.map((response) => {
        const template = response.questionnaire_templates;
        return {
          id: response.id,
          question: template?.question_text ?? '',
          shortLabel: template?.question_text ?? '',
          responseType: template?.response_type ?? 'yes_no',
          answer: response.answer,
          answerText: response.answer_text ?? '',
          isRedFlagTrigger: template?.is_red_flag_trigger ?? false,
          detail: response.detail ?? '',
        };
      }),
    },
    metrics: buildMetrics(reports),
    // Kept so a resolved value can rebuild the grid without a refetch.
    historyReports: history,
    flowsheet: buildFlowsheet(history, appointmentId),
    triageAlerts: buildTriageAlerts(reports),
    notes: { text: postVisit?.notes?.notes_text ?? '', updatedAt: postVisit?.notes?.updated_at ?? null },
    // What the clinician ticked during this consultation.
    consultationItems: (postVisit?.consultationChecklist ?? []).map((item) => ({ id: item.id, label: item.label })),
    consultationTemplates: consultationTemplates.map((t) => t.label),
    // Actions assigned to the patient; they become the patient's next steps.
    actionItems: (postVisit?.actionItems ?? []).map((item) => ({
      id: item.id,
      label: item.label,
      doneByPatient: item.is_completed,
    })),
    actionTemplates: actionTemplates.map((t) => t.label),
    prescriptions: postVisit?.prescriptions ?? [],
    notifications: [],
  };
}

/** Historical series for one metric, for the expanded row chart. */
export async function fetchMetricTrend(standardKey, patientId) {
  const rows = await request(`/api/lab-reports/trend/${standardKey}?patientId=${patientId}`);

  return rows.map((row) => ({
    date: row.lab_reports?.report_date ?? row.created_at,
    value: Number(row.reviewed_value ?? row.parsed_value),
  }));
}

export async function saveConsultancyNotes(appointmentId, notesText) {
  return request(`/api/post-visit/${appointmentId}/notes`, { method: 'PUT', body: { notesText } });
}

export async function addActionItem(appointmentId, label) {
  return request(`/api/post-visit/${appointmentId}/action-items`, { method: 'POST', body: { label } });
}

export async function removeActionItem(itemId) {
  return request(`/api/post-visit/action-items/${itemId}`, { method: 'DELETE' });
}

export async function addConsultationItem(appointmentId, label) {
  return request(`/api/post-visit/${appointmentId}/consultation-items`, { method: 'POST', body: { label } });
}

export async function removeConsultationItem(itemId) {
  return request(`/api/post-visit/consultation-items/${itemId}`, { method: 'DELETE' });
}

export async function uploadPrescription(appointmentId, file, typedInstructions = '') {
  const form = new FormData();
  form.append('file', file);
  if (typedInstructions) form.append('typedInstructions', typedInstructions);
  return upload(`/api/post-visit/${appointmentId}/prescriptions/upload`, form);
}

/** Doctor types in a value the OCR pipeline could not read confidently. */
/**
 * End the consultation. Marking the visit completed is what publishes the
 * notes, consultation items, next steps and prescriptions to the patient's
 * visit summary.
 */
export async function endVisit(appointmentId) {
  return request(`/api/appointments/${appointmentId}/status`, { method: 'PATCH', body: { status: 'completed' } });
}

export async function resolveTriageAlert(metricId, { standardKey, reviewedValue }) {
  return request(`/api/lab-reports/metrics/${metricId}/review`, {
    method: 'PATCH',
    body: {
      reviewedValue,
      ...(standardKey ? { standardKey } : {}),
    },
  });
}

// ---------------------------------------------------------------------------
// API → view-model helpers
// ---------------------------------------------------------------------------

function first(value) {
  return (Array.isArray(value) ? value[0] : value) ?? null;
}

/** Whole years since the date of birth, or null when none is on file. */
function ageFrom(dateOfBirth) {
  if (!dateOfBirth) return null;
  const dob = new Date(dateOfBirth);
  if (Number.isNaN(dob.getTime())) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const beforeBirthday =
    now.getMonth() < dob.getMonth() || (now.getMonth() === dob.getMonth() && now.getDate() < dob.getDate());
  if (beforeBirthday) age -= 1;
  return age;
}

/**
 * The header card's patient. Only what is actually on file: a field the
 * patient has not filled in is null, and the card leaves it out.
 */
function buildPatient(appointment, patientId) {
  const profile = appointment.patient;
  const details = first(profile?.patient_details);

  return {
    id: profile?.id ?? patientId,
    name: profile?.full_name ?? appointment.invited_email ?? 'Invited patient',
    email: appointment.invited_email ?? null,
    phone: profile?.phone || null,
    age: ageFrom(details?.date_of_birth),
    bloodType: details?.blood_type || null,
    visitAt: appointment.scheduled_at,
    visitStatus: appointment.status,
  };
}

/**
 * Latest value per standard_key, with the full series attached for charting.
 * Tests the dictionary does not know are grouped by their printed name, so a
 * confident reading is never dropped just because it went unmatched.
 */
function buildMetrics(reports = []) {
  const byKey = new Map();

  for (const report of reports) {
    for (const metric of report.lab_report_metrics ?? []) {
      const key = metric.standard_key ?? `raw:${(metric.raw_key ?? '').trim().toLowerCase()}`;

      const value = metric.reviewed_value ?? metric.parsed_value;
      const entry = byKey.get(key) ?? {
        key,
        // Only dictionary metrics have a server-side trend to fetch.
        standardKey: metric.standard_key ?? null,
        name: metric.metric_dictionary?.display_name ?? metric.raw_key,
        source: report.source_name ?? 'Lab report',
        unit: metric.unit_standard ?? metric.unit_raw ?? '',
        needsReview: false,
        history: [],
      };

      if (metric.needs_review) entry.needsReview = true;
      // Qualitative results ("Negative", "Trace") have no number; show them as printed.
      const takenAt = new Date(report.report_date ?? report.uploaded_at);
      if (!entry.printedAt || takenAt >= entry.printedAt) {
        entry.printedAt = takenAt;
        entry.printed = metric.raw_value ?? null;
      }
      // An unreadable value stays out of the series rather than charting as 0.
      if (value != null) {
        entry.history.push({ date: report.report_date ?? report.uploaded_at, value: Number(value) });
      }
      byKey.set(key, entry);
    }
  }

  return [...byKey.values()].map(({ printed, printedAt, ...entry }) => {
    entry.history.sort((a, b) => new Date(a.date) - new Date(b.date));
    const latest = entry.history.at(-1);
    return {
      ...entry,
      value: latest?.value != null ? String(latest.value) : printed,
      recordedAt: latest?.date ?? printedAt?.toISOString() ?? null,
    };
  });
}

/** Metrics the OCR pipeline flagged for human review. */
function buildTriageAlerts(reports = []) {
  return reports.flatMap((report) =>
    (report.lab_report_metrics ?? [])
      .filter((metric) => metric.needs_review)
      .map((metric) => ({
        id: metric.id,
        labReportId: report.id,
        metricId: metric.id,
        standardKey: metric.standard_key ?? '',
        // Same grouping key buildMetrics uses, so resolving updates the right row.
        metricKey: metric.standard_key ?? `raw:${(metric.raw_key ?? '').trim().toLowerCase()}`,
        label: metric.metric_dictionary?.display_name ?? metric.raw_key,
        reportName: report.source_name ?? 'Uploaded lab report',
        reportDate: report.report_date ?? report.uploaded_at,
        confidence: metric.confidence_score ?? null,
        reason: reviewReason(metric),
        imageUrl: report.signed_url ?? null,
        sourcePage: metric.source_page ?? null,
        sourceBox: metric.source_box ?? null,
        fileKind: fileKindOf(report.storage_path),
        printed: [metric.raw_value, metric.unit_raw].filter(Boolean).join(' '),
      }))
  );
}

// ---------- Maternity card ----------
// :section is visits | labs | scans | vaccines. Values use the card's own field names.

/** The patient's whole maternity card; empty lists when none was started. */
export async function fetchMaternityCard(patientId) {
  return request(`/api/maternity/${patientId}`);
}

/** Patient details and first-attendance baseline. */
export async function saveMaternityDetails(patientId, values) {
  return request(`/api/maternity/${patientId}`, { method: 'PUT', body: values });
}

export async function saveMaternityDelivery(patientId, values) {
  return request(`/api/maternity/${patientId}/delivery`, { method: 'PUT', body: values });
}

export async function addMaternityRow(patientId, section, values) {
  return request(`/api/maternity/${patientId}/${section}`, { method: 'POST', body: values });
}

export async function updateMaternityRow(patientId, section, rowId, values) {
  return request(`/api/maternity/${patientId}/${section}/${rowId}`, { method: 'PATCH', body: values });
}

export async function deleteMaternityRow(patientId, section, rowId) {
  return request(`/api/maternity/${patientId}/${section}/${rowId}`, { method: 'DELETE' });
}

/** Pull confirmed values from newly shared lab reports onto the card; returns the investigations list. */
export async function importMaternityReports(patientId) {
  return request(`/api/maternity/${patientId}/import-reports`, { method: 'POST' });
}
