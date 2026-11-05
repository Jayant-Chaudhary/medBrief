import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sidebar } from '../../components/layout/Sidebar.jsx';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { PatientHeaderCard } from '../../components/clinician/PatientHeaderCard.jsx';
import { PreVisitQuestionnairePanel } from '../../components/clinician/PreVisitQuestionnairePanel.jsx';
import { PreVisitAiBriefCard } from '../../components/clinician/PreVisitAiBriefCard.jsx';
import { SimilarCasesTriageCard } from '../../components/clinician/SimilarCasesTriageCard.jsx';
import { WearableMetricsCard } from '../../components/clinician/WearableMetricsCard.jsx';
import { OcrTriageAlert } from '../../components/clinician/OcrTriageAlert.jsx';
import { HistoryGrid } from '../../components/clinician/HistoryGrid.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { useToast } from '../../context/ToastContext';
import { ConsultancyNotes } from '../../components/clinician/ConsultancyNotes.jsx';
import { ActionChecklist } from '../../components/clinician/ActionChecklist.jsx';
import { PrescriptionTemplates } from '../../components/prescriptions/PrescriptionTemplates.jsx';
import { PrescriptionUpload } from '../../components/clinician/PrescriptionUpload.jsx';
import { Spinner } from '../../components/common/Spinner.jsx';
import { usePatientDashboard } from '../../hooks/usePatientDashboard.js';
import { Plus, ArrowLeft, Clock, User, CheckCircle, NotebookPen, CircleStop, BadgeCheck, UserCheck, Mic, FileAudio, Heart, Table, Users } from 'lucide-react';
import { DoctorConsultationModal } from '../../components/consultAudio/DoctorConsultationModal.jsx';
import { useConsultDraft } from '../../hooks/useConsultDraft.js';
import { buildFlowsheet } from '../../utils/flowsheet.js';
import { buildSimilarityQueryPatient } from '../../utils/similarityInputBuilder.js';
import {
  evaluatePatientSimilarity,
  isPatientSimilarityEnabled,
  isSimilaritySyntheticDataAllowed,
} from '../../services/patientSimilarityClient.js';
import { useAssistantControls } from '../../components/assistant/AssistantBridge.jsx';
import {
  fetchPatients,
  saveConsultancyNotes,
  addActionItem,
  removeActionItem,
  addConsultationItem,
  removeConsultationItem,
  uploadPrescription,
  resolveTriageAlert,
  endVisit,
  generatePreVisitSummary,
} from '../../services/clinicianService.js';

/**
 * Where a visit is in its day, for the badge on today's cards. `isPending`
 * wins over the stored status: an unaccepted invite cannot be opened yet.
 */
function visitStage(appointment) {
  if (appointment.isPending) {
    return { label: 'Pending', note: 'Invited patient', Icon: Clock, badge: 'border border-amber-200 bg-amber-50 text-amber-800' };
  }
  switch (appointment.status) {
    case 'completed':
      return { label: 'Completed', note: 'Visit completed', Icon: BadgeCheck, badge: 'border border-emerald-200 bg-emerald-50 text-emerald-800' };
    case 'checked_in':
      return { label: 'Checked in', note: 'Ready to be seen', Icon: UserCheck, badge: 'border border-sky-200 bg-sky-50 text-sky-800' };
    default:
      return { label: 'Accepted', note: 'Registered patient', Icon: CheckCircle, badge: 'border border-teal-200 bg-teal-50 text-teal-800' };
  }
}

const AVATAR_GRADIENTS = [
  'bg-gradient-to-br from-indigo-500 to-blue-600 text-white shadow-sm ring-2 ring-indigo-100',
  'bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-sm ring-2 ring-rose-100',
  'bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-sm ring-2 ring-emerald-100',
  'bg-gradient-to-br from-amber-500 to-orange-600 text-white shadow-sm ring-2 ring-amber-100',
  'bg-gradient-to-br from-violet-500 to-purple-600 text-white shadow-sm ring-2 ring-violet-100',
  'bg-gradient-to-br from-cyan-500 to-teal-600 text-white shadow-sm ring-2 ring-cyan-100',
];

function isToday(value) {
  return value && new Date(value).toDateString() === new Date().toDateString();
}

// Clinical query extraction logic is extracted and unit-tested in similarityInputBuilder.js


/**
 * Clinician command centre.
 *
 * Without a visit selected it shows today's appointments. The open visit
 * lives in the URL (`?appointment=<id>`), so the schedule and patient list can
 * link straight into it and the browser's back button returns to the cards.
 */
export function ClinicianDashboard() {
  const [collapsed, setCollapsed] = useState(false);
  const [audioConsultOpen, setAudioConsultOpen] = useState(false);
  const [generatingBrief, setGeneratingBrief] = useState(false);
  const [audioConsultTab, setAudioConsultTab] = useState('RECORD');
  const [confirmEnd, setConfirmEnd] = useState(false);
  const [ending, setEnding] = useState(false);
  const [endError, setEndError] = useState(null);
  // Set by ConsultancyNotes: saves any notes still waiting on the autosave.
  const flushNotesRef = useRef(null);
  const { showToast } = useToast();
  const [appointments, setAppointments] = useState([]);
  const [queueError, setQueueError] = useState(null);
  const [queueLoading, setQueueLoading] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();

  const selectedAppointmentId = searchParams.get('appointment');

  const loadAppointments = useCallback(() => {
    setQueueLoading(true);
    fetchPatients()
      .then(setAppointments)
      .catch(setQueueError)
      .finally(() => setQueueLoading(false));
  }, []);

  useEffect(() => {
    loadAppointments();
  }, [loadAppointments]);

  const todays = useMemo(
    () =>
      appointments
        .filter((a) => isToday(a.scheduledAt) && a.status !== 'cancelled')
        .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)),
    [appointments]
  );

  const selected = appointments.find((a) => a.appointmentId === selectedAppointmentId && !a.isPending) ?? null;

  const open = (appointment) => {
    if (!appointment.isPending) setSearchParams({ appointment: appointment.appointmentId });
  };
  const close = () => {
    setActiveDashboardTab('overview');
    setSearchParams({});
  };

  const { data, loading, error, patch } = usePatientDashboard(selected?.id, selected?.appointmentId);
  const appointmentId = data?.appointment?.id;
  const consultDraft = useConsultDraft(appointmentId, Boolean(selected));
  // The previous visit's data stays on screen while the next one loads; nothing is
  // filled until the open visit's own data has arrived.
  const visitLoaded = Boolean(selected) && appointmentId === selectedAppointmentId;

  // Notes typed but not yet autosaved belong to the visit they were typed in: save them
  // before another visit opens, so the debounce cannot land them on the next one.
  useEffect(() => () => flushNotesRef.current?.(), [selectedAppointmentId]);

  useAssistantControls(
    'dashboard',
    {
      context: () => ({ patientId: visitLoaded ? selected.id : null, appointmentId: visitLoaded ? selectedAppointmentId : null }),
      // The notes box itself is read and edited by the assistant's page reader, through its own
      // onChange (so autosave runs as if typed), after the doctor confirms.
      buttons: {
        open_notes: {
          run: () => {
            setActiveDashboardTab('consultation');
            return true;
          },
          summary: () => [{ label: 'Action', value: 'Open consultation notes' }],
          available: () => Boolean(selected),
        },
        close_notes: {
          run: () => {
            setActiveDashboardTab('overview');
            return true;
          },
          summary: () => [{ label: 'Action', value: 'Return to patient overview' }],
          available: () => Boolean(selected) && activeDashboardTab === 'consultation',
        },
        save_notes: {
          run: async () => {
            if (flushNotesRef.current) await flushNotesRef.current();
            return true;
          },
          summary: () => [{ label: 'Action', value: 'Save consultation notes' }],
          available: () => Boolean(selected),
        },
        open_transcript_logs: {
          run: () => {
            setAudioConsultTab('TRANSCRIPT');
            setAudioConsultOpen(true);
            return true;
          },
          summary: () => [{ label: 'Action', value: 'Open transcript logs' }],
          available: () => Boolean(selected),
        },
        open_audio_consult: {
          run: () => {
            setAudioConsultTab('RECORD');
            setAudioConsultOpen(true);
            return true;
          },
          summary: () => [{ label: 'Action', value: 'Open audio consultation' }],
          available: () => Boolean(selected),
        },
        close_visit: {
          run: () => {
            close();
            return true;
          },
          summary: () => [{ label: 'Action', value: 'Return to dashboard cards' }],
          available: () => Boolean(selected),
        },
      },
    },
    { ready: !queueLoading && (!selected || visitLoaded) }
  );

  const [activeDashboardTab, setActiveDashboardTab] = useState('overview'); // 'overview' | 'flowsheet' | 'consultation'
  const [consultationSubView, setConsultationSubView] = useState('both'); // 'both' | 'notes' | 'rx'
  const [similarityData, setSimilarityData] = useState(null);
  const [similarityLoading, setSimilarityLoading] = useState(false);
  const [similarityError, setSimilarityError] = useState(null);

  const loadSimilarity = useCallback(async () => {
    if (!isPatientSimilarityEnabled()) {
      setSimilarityData({ enabled: false, message: 'Similarity model is disabled by configuration' });
      return;
    }
    if (!data?.patient) return;
    try {
      setSimilarityLoading(true);
      setSimilarityError(null);
      const queryPatient = buildSimilarityQueryPatient(data);
      if (!queryPatient) return;

      if (queryPatient.insufficientData) {
        setSimilarityData({
          topMatches: [],
          insufficientData: true,
          missingFactors: queryPatient.missingFactors,
          availableFactors: queryPatient.availableFactors,
          cohortSummary: {
            cohortProvenance: 'synthetic',
            totalCohortCount: 0,
            matchedCohortCount: 0,
          },
          message: 'Insufficient clinical observations recorded for patient matching',
        });
        return;
      }

      const res = await evaluatePatientSimilarity({ queryPatient });
      setSimilarityData({
        ...res,
        missingFactors: queryPatient.missingFactors,
        availableFactors: queryPatient.availableFactors,
      });
    } catch (err) {
      setSimilarityError(err?.message || 'Could not load similar historical cases');
    } finally {
      setSimilarityLoading(false);
    }
  }, [data]);

  const handleLoadDemoScenario = useCallback(async (scenarioKey = 'elevatedBpAndHeadacheScenario') => {
    if (!isPatientSimilarityEnabled() || !isSimilaritySyntheticDataAllowed()) {
      return;
    }
    try {
      setSimilarityLoading(true);
      setSimilarityError(null);
      const sampleQuery =
        scenarioKey === 'elevatedBpAndHeadacheScenario'
          ? {
              gestationalWeeks: 28,
              age: 28,
              gravida: 2,
              para: 1,
              bmi: 26.2,
              blood_group: 'O+',
              vitals: { bp_systolic: 140, bp_diastolic: 90, weight_kg: 67, fundal_height_cm: 28, fetal_heart_rate_bpm: 146 },
              previousVitals: { bp_systolic: 124, bp_diastolic: 78 },
              labs: { hemoglobin: 11.0 },
              previousLabs: { hemoglobin: 11.3 },
              questionnaireResponses: [
                { question: 'Have you noticed ankle or foot swelling?', answer: true, detail: 'Mild ankle swelling in evenings' },
                { question: 'Have you had any vaginal bleeding?', answer: false },
              ],
              transcriptSegments: [
                { segment_id: 's1', speaker: 'patient', text: 'I have had a moderate frontal headache for two days and mild ankle swelling.' },
                { segment_id: 's2', speaker: 'patient', text: 'No blurred vision at all, no epigastric pain.' },
              ],
            }
          : {
              gestationalWeeks: 26,
              age: 26,
              gravida: 2,
              para: 1,
              vitals: { bp_systolic: 110, bp_diastolic: 70, weight_kg: 55, fundal_height_cm: 26, fetal_heart_rate_bpm: 148 },
              labs: { hemoglobin: 8.9 },
              previousLabs: { hemoglobin: 10.2 },
              transcriptSegments: [
                { segment_id: 's1', speaker: 'patient', text: 'I feel severe fatigue and breathlessness climbing stairs, and dizziness.' },
              ],
            };

      const res = await evaluatePatientSimilarity({ queryPatient: sampleQuery });
      setSimilarityData({
        ...res,
        isDemoSample: true,
      });
    } catch (err) {
      setSimilarityError(err?.message || 'Could not load demo scenario');
    } finally {
      setSimilarityLoading(false);
    }
  }, []);

  useEffect(() => {
    if (data?.patient?.id) {
      loadSimilarity();
    }
  }, [data?.patient?.id, loadSimilarity]);

  const handleGenerateAiBrief = useCallback(async () => {
    if (!selectedAppointmentId) return;
    try {
      setGeneratingBrief(true);
      const updatedSummary = await generatePreVisitSummary(selectedAppointmentId);
      patch(() => ({ aiSummary: updatedSummary }));
      showToast('Pre-visit clinical brief generated.', 'success');
    } catch (err) {
      showToast(err?.message || 'Failed to generate AI brief', 'error');
    } finally {
      setGeneratingBrief(false);
    }
  }, [selectedAppointmentId, patch, showToast]);

  const handleSaveNotes = useCallback(
    async (text) => {
      await saveConsultancyNotes(appointmentId, text);
      patch(() => ({ notes: { text, updatedAt: new Date().toISOString() } }));
    },
    [appointmentId, patch]
  );

  const handleCheckConsultation = useCallback(
    async (label) => {
      const created = await addConsultationItem(appointmentId, label);
      patch((current) => ({
        consultationItems: [
          ...current.consultationItems.filter((item) => item.label !== label),
          { id: created.id, label },
        ],
      }));
    },
    [appointmentId, patch]
  );

  const handleUncheckConsultation = useCallback(
    async (item) => {
      await removeConsultationItem(item.id);
      patch((current) => ({
        consultationItems: current.consultationItems.filter((entry) => entry.id !== item.id),
      }));
    },
    [patch]
  );

  const handleAddAction = useCallback(
    async (label) => {
      const created = await addActionItem(appointmentId, label);
      patch((current) => ({
        actionItems: [...current.actionItems, { id: created.id, label, doneByPatient: false }],
      }));
    },
    [appointmentId, patch]
  );

  const handleRemoveAction = useCallback(
    async (item) => {
      await removeActionItem(item.id);
      patch((current) => ({
        actionItems: current.actionItems.filter((entry) => entry.id !== item.id),
      }));
    },
    [patch]
  );

  const handleUploadPrescription = useCallback(
    async (file, instructions) => {
      const saved = await uploadPrescription(appointmentId, file, instructions);
      patch((current) => ({ prescriptions: [...current.prescriptions, saved] }));
    },
    [appointmentId, patch]
  );

  const handleEndVisit = useCallback(async () => {
    setEnding(true);
    setEndError(null);
    try {
      // The summary must carry the last words typed, not the last autosave.
      await flushNotesRef.current?.();
    } catch {
      setEndError("Your latest notes couldn't be saved, so the visit is still open. Try again.");
      setEnding(false);
      return;
    }
    try {
      await endVisit(appointmentId);
      patch((current) => ({
        appointment: { ...current.appointment, status: 'completed' },
        patient: { ...current.patient, visitStatus: 'completed' },
      }));
      setConfirmEnd(false);
      showToast("Visit ended. The summary is now on the patient's visit history.", 'success');
      loadAppointments();
    } catch (err) {
      setEndError(err.message || 'Could not end the visit.');
    } finally {
      setEnding(false);
    }
  }, [appointmentId, patch, showToast, loadAppointments]);

  const handleResolveAlert = useCallback(
    async (alert, rawValue) => {
      const value = Number(rawValue);
      if (!Number.isFinite(value)) throw new Error('Enter the reading as a number.');

      await resolveTriageAlert(alert.metricId, {
        // Unmatched tests have no dictionary key; the server rejects an empty one.
        ...(alert.standardKey && { standardKey: alert.standardKey }),
        reviewedValue: value,
      });
      patch((current) => {
        // The grid is derived from the reports, so update the metric there and rebuild.
        const historyReports = current.historyReports.map((report) => ({
          ...report,
          lab_report_metrics: (report.lab_report_metrics ?? []).map((metric) =>
            metric.id === alert.metricId ? { ...metric, reviewed_value: value, needs_review: false } : metric
          ),
        }));
        return {
          triageAlerts: current.triageAlerts.filter((entry) => entry.id !== alert.id),
          metrics: current.metrics.map((metric) =>
            metric.key === alert.metricKey ? { ...metric, value: String(value), needsReview: false } : metric
          ),
          historyReports,
          flowsheet: buildFlowsheet(historyReports, current.appointment?.id),
        };
      });
    },
    [patch]
  );

  const renderTodaysCards = () => {
    if (todays.length === 0) {
      return (
        <div className="card flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="font-display text-head-sm text-ink">No patients scheduled for today</p>
          <p className="max-w-md text-body-md text-ink-2">
            Upcoming visits are on your <Link to="/clinician/schedule" className="text-cypress hover:underline">schedule</Link>.
          </p>
        </div>
      );
    }

    return (
      <div className="flex-1 overflow-y-auto">
        <div className="mb-6 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-xl font-display font-semibold text-ink">Today's Appointments</h2>
          <p className="text-body-sm text-ink-3 tabular">
            {todays.filter((a) => a.status === 'completed').length} of {todays.length} completed
          </p>
        </div>
        {/* Patient cards: the assistant reaches a visit by the name you type, never by reading these. */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-assistant-private="">
          {todays.map((appointment, idx) => {
            const isPending = appointment.isPending;
            const isCompleted = !isPending && appointment.status === 'completed';
            const stage = visitStage(appointment);
            const avatarGrad = AVATAR_GRADIENTS[idx % AVATAR_GRADIENTS.length];

            return (
              <div
                key={appointment.appointmentId}
                onClick={() => open(appointment)}
                className={`card p-6 flex flex-col gap-4 border transition-all duration-200 ${
                  isPending
                    ? 'border-line bg-subcanvas/60 opacity-75 cursor-not-allowed'
                    : isCompleted
                      ? 'border-emerald-200 bg-emerald-50/30 dark:border-emerald-900/40 dark:bg-emerald-950/20 cursor-pointer hover:shadow-md hover:border-emerald-300'
                      : 'border-line bg-surface hover:border-cypress/50 hover:shadow-md cursor-pointer'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className={`w-11 h-11 rounded-full flex items-center justify-center font-bold text-sm tracking-wide ${avatarGrad}`}>
                      {appointment.name?.charAt(0) || <User className="w-5 h-5" />}
                    </div>
                    <div>
                      <h3 className="font-semibold text-ink text-base">{appointment.name}</h3>
                      <p className="text-xs text-ink-soft truncate w-36">{stage.note}</p>
                    </div>
                  </div>
                  <span
                    className={`inline-flex shrink-0 items-center gap-1 px-2 py-1 rounded-full text-xs font-medium ${stage.badge}`}
                  >
                    <stage.Icon className="w-3 h-3" /> {stage.label}
                  </span>
                </div>

                <div className="flex items-center gap-2 text-sm text-ink-2">
                  <Clock className="w-4 h-4" />
                  <span>
                    {new Date(appointment.scheduledAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                {isPending && (
                  <p className="text-xs text-attention mt-2">
                    Patient has not accepted their invite yet. Report Analysis will be available once they accept.
                  </p>
                )}

                {isCompleted && (
                  <p className="text-xs text-sage-ink mt-2">
                    Summary sent to the patient. Open to review the visit.
                  </p>
                )}
              </div>
            );
          })}
        </div>
      </div>
    );
  };

  const renderBody = () => {
    if (queueLoading) {
      return (
        <div className="flex flex-1 items-center justify-center gap-3 text-ink-3">
          <Spinner /> Loading appointments…
        </div>
      );
    }
    if (queueError) {
      const isAuthError =
        queueError.status === 401 ||
        queueError.message?.toLowerCase().includes('expired') ||
        queueError.message?.toLowerCase().includes('access token');
      return (
        <div className="card flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="font-display text-head-sm text-terracotta">
            {isAuthError ? 'Session Expired' : 'Could not reach the clinic API'}
          </p>
          <p className="max-w-md text-body-md text-ink-2">
            {isAuthError
              ? 'Your clinician session has expired. Please sign in again to reload appointments.'
              : queueError.message}
          </p>
          {isAuthError && (
            <Link
              to="/login"
              className="mt-3 rounded-xl bg-cypress px-4 py-2 text-label-sm font-semibold text-white hover:bg-cypress/90 transition-colors"
            >
              Sign In Again
            </Link>
          )}
        </div>
      );
    }
    if (selectedAppointmentId && !selected) {
      return (
        <div className="card flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="font-display text-head-sm text-ink">This visit can't be opened</p>
          <p className="max-w-md text-body-md text-ink-2">
            It isn't one of your appointments, or the patient hasn't accepted their invite yet.
          </p>
          <button onClick={close} className="mt-4 text-primary font-medium">
            Back to Dashboard
          </button>
        </div>
      );
    }
    if (!selected) return renderTodaysCards();
    if (loading && !data) {
      return (
        <div className="flex flex-1 items-center justify-center gap-3 text-ink-3" role="status" aria-label="Loading" aria-busy="true">
          <Spinner /> Loading patient record…
        </div>
      );
    }
    if (error) {
      return (
        <div className="card flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="font-display text-head-sm text-terracotta">Error loading patient details</p>
          <p className="max-w-md text-body-md text-ink-2">{error.message}</p>
          <button onClick={close} className="mt-4 text-primary font-medium">
            Back to Dashboard
          </button>
        </div>
      );
    }
    if (!data) return null;

    return (
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex flex-wrap items-center justify-between gap-4 mb-4">
          <div className="flex items-center gap-3">
            <button
              onClick={close}
              data-assistant-id="dashboard.close_visit"
              aria-label="Back to dashboard"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-line bg-surface hover:bg-subcanvas text-ink font-medium text-sm transition-all shadow-xs active:scale-95"
            >
              <ArrowLeft className="w-4 h-4 text-ink-3" />
              <span>Visits</span>
            </button>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-display font-semibold text-ink">Report Analysis</h1>
              {data.patient?.name && (
                <span className="hidden sm:inline-block text-sm font-medium text-ink-soft">
                  · {data.patient.name}
                </span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Link
              to={`/clinician/maternity?patientId=${data.patient.id}&patientName=${encodeURIComponent(data.patient.name || '')}&phone=${encodeURIComponent(data.patient.phone || '')}`}
              className="flex items-center gap-2 rounded-xl border border-pink-200 bg-pink-50 px-4 py-2 text-label-lg font-semibold text-pink-800 dark:border-pink-900/50 dark:bg-pink-950/40 dark:text-pink-300 dark:hover:bg-pink-900/40 transition-all hover:bg-pink-100 hover:border-pink-300 hover:shadow-sm active:scale-[0.98]"
              title="Open Antenatal Maternity Record"
            >
              <Heart className="h-4 w-4 text-pink-600 fill-pink-500/20 shrink-0" />
              <span>Maternity card</span>
            </Link>

            <button
              type="button"
              data-assistant-id="dashboard.open_notes"
              data-assistant-effect="free"
              onClick={() => setActiveDashboardTab('consultation')}
              className={`flex items-center gap-2 rounded-xl border px-4 py-2 text-label-lg font-semibold transition-all ${
                activeDashboardTab === 'consultation'
                  ? 'border-emerald-500 bg-emerald-100 text-emerald-950 dark:border-emerald-500 dark:bg-emerald-900/60 dark:text-emerald-100 shadow-xs ring-1 ring-emerald-300'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-900 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-200 dark:hover:bg-emerald-900/40 hover:bg-emerald-100 hover:border-emerald-400 hover:shadow-sm active:scale-[0.98]'
              }`}
              title="Open Consultant Notes & Prescriptions Workspace"
            >
              <NotebookPen className="h-4 w-4 text-emerald-700 shrink-0" />
              <span>Consultation notes</span>
              {(data.notes?.text?.trim() || data.actionItems?.length > 0 || data.prescriptions?.length > 0) && (
                <span className="h-2 w-2 rounded-full bg-emerald-600 animate-pulse" aria-label="has content" />
              )}
            </button>

            {data.appointment?.status === 'completed' ? (
              <span className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-2 text-label-lg font-semibold text-emerald-800">
                <BadgeCheck className="h-4 w-4 text-emerald-600" />
                Visit ended
              </span>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setEndError(null);
                  setConfirmEnd(true);
                }}
                className="flex items-center gap-2 rounded-xl bg-cypress px-4 py-2 text-label-lg font-semibold text-white shadow-sm transition-all hover:bg-cypress-deep hover:shadow active:scale-[0.98]"
              >
                <CircleStop className="h-4 w-4" />
                End visit
              </button>
            )}
          </div>
        </div>

        {/* Segmented Three-Tab Navigation for Patient Dashboard */}
        <div className="flex items-center justify-between border-b border-slate-200 bg-white px-2 pt-1 pb-0 mb-3 rounded-xl shadow-2xs shrink-0 overflow-x-auto">
          <div className="flex items-center gap-1 sm:gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setActiveDashboardTab('overview')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                activeDashboardTab === 'overview'
                  ? 'border-cypress text-cypress'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              <Users className="h-4 w-4" />
              <span>Patient Overview</span>
              {isPatientSimilarityEnabled() && similarityData?.uncheckedFactorsInQuery?.length > 0 && (
                <span
                  className="flex h-2 w-2 rounded-full bg-amber-500 animate-pulse"
                  title={`${similarityData.uncheckedFactorsInQuery.length} unchecked clinical factors recorded in comparable cases`}
                />
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveDashboardTab('flowsheet')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                activeDashboardTab === 'flowsheet'
                  ? 'border-cypress text-cypress'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              <Table className="h-4 w-4" />
              <span>Clinical Flowsheet & Labs</span>
              {data.triageAlerts.length > 0 && (
                <span className="inline-flex items-center px-1.5 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800 border border-amber-200">
                  {data.triageAlerts.length}
                </span>
              )}
            </button>

            <button
              type="button"
              onClick={() => setActiveDashboardTab('consultation')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${
                activeDashboardTab === 'consultation'
                  ? 'border-cypress text-cypress'
                  : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
              }`}
            >
              <NotebookPen className="h-4 w-4" />
              <span>Consultant Notes & Prescriptions</span>
              {(data.notes?.text?.trim() || data.actionItems?.length > 0 || data.prescriptions?.length > 0) && (
                <span
                  className="flex h-2 w-2 rounded-full bg-emerald-500 animate-pulse"
                  title="Consultation notes, action items, or prescriptions drafted"
                />
              )}
            </button>
          </div>

          <div className="text-xs text-slate-400 hidden lg:block pr-3 shrink-0">
            {activeDashboardTab === 'overview'
              ? 'Demographics · AI Brief · Similar Cases · Pre-visit'
              : activeDashboardTab === 'flowsheet'
              ? 'OCR verification · Longitudinal metrics & Trend charts'
              : 'Clinical notes · Ambient AI draft · Prescriptions & Prophylaxis'}
          </div>
        </div>

        {/* Tab 1: Patient Overview */}
        <div className={`h-full min-h-0 overflow-y-auto scroll-column space-y-4 pr-1.5 pb-32 ${activeDashboardTab === 'overview' ? 'block' : 'hidden'}`}>
          <PatientHeaderCard patient={data.patient} />
          <PreVisitAiBriefCard
            summary={data.aiSummary}
            onGenerate={handleGenerateAiBrief}
            isGenerating={generatingBrief}
          />
          <WearableMetricsCard trajectory={data.deviceTrajectory} />
          {isPatientSimilarityEnabled() && (
            <SimilarCasesTriageCard
              similarityData={similarityData}
              loading={similarityLoading}
              error={similarityError}
              onRefresh={loadSimilarity}
              onLoadDemo={handleLoadDemoScenario}
              onResetPatient={loadSimilarity}
              syntheticAllowed={isSimilaritySyntheticDataAllowed()}
            />
          )}
          {data.questionnaire.answers.length > 0 && (
            <PreVisitQuestionnairePanel questionnaire={data.questionnaire} />
          )}
        </div>

        {/* Tab 2: Clinical Flowsheet & Labs */}
        <div className={`h-full min-h-0 overflow-y-auto scroll-column space-y-4 pr-1.5 pb-32 ${activeDashboardTab === 'flowsheet' ? 'block' : 'hidden'}`}>
          <OcrTriageAlert alerts={data.triageAlerts} onResolve={handleResolveAlert} />
          <HistoryGrid flowsheet={data.flowsheet} patientId={data.patient.id} onResolve={handleResolveAlert} />
        </div>

        {/* Tab 3: Consultant Notes & Prescriptions */}
        <div
          className={`min-h-0 flex-1 flex flex-col space-y-3 ${
            activeDashboardTab === 'consultation' ? 'flex' : 'hidden'
          }`}
        >
          {/* Sub-view Controls: Side-by-Side vs Notes vs Prescriptions */}
          <div className="flex flex-wrap items-center justify-between gap-2 bg-slate-50 border border-slate-200/80 px-3.5 py-2 rounded-xl text-xs shrink-0">
            <div className="flex items-center gap-2 font-medium text-slate-700">
              <NotebookPen className="w-4 h-4 text-cypress shrink-0" />
              <span>Consultation Workspace</span>
              <span className="text-slate-300 hidden sm:inline">|</span>
              <span className="text-slate-500 hidden sm:inline">
                Independent side-by-side scrolling for clinical notes & prescriptions
              </span>
            </div>
            <div className="flex items-center gap-1 bg-white border border-slate-200 p-0.5 rounded-lg shadow-2xs">
              <button
                type="button"
                onClick={() => setConsultationSubView('both')}
                className={`px-3 py-1 rounded-md font-semibold transition text-xs ${
                  consultationSubView === 'both'
                    ? 'bg-cypress text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Display Notes & Prescriptions side-by-side with independent scrolling"
              >
                Side-by-Side
              </button>
              <button
                type="button"
                onClick={() => setConsultationSubView('notes')}
                className={`px-3 py-1 rounded-md font-semibold transition text-xs ${
                  consultationSubView === 'notes'
                    ? 'bg-cypress text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Focus on Doctor's Notes & Ambient Audio"
              >
                Notes & Audio
              </button>
              <button
                type="button"
                onClick={() => setConsultationSubView('rx')}
                className={`px-3 py-1 rounded-md font-semibold transition text-xs ${
                  consultationSubView === 'rx'
                    ? 'bg-cypress text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
                title="Focus on Prescriptions & Bundles"
              >
                Prescriptions
              </button>
            </div>
          </div>

          {/* Consultation Workspace Content */}
          <div className="min-h-0 flex-1">
            {/* Side-by-Side View (Default on desktop) */}
            {consultationSubView === 'both' && (
              <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 h-full min-h-0 max-lg:overflow-y-auto max-lg:scroll-column max-lg:pb-32">
                {/* Left Column: Doctor's Clinical Notes, Ambient AI Audio Draft, Checklist & Actions */}
                <div className="lg:col-span-5 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:scroll-column space-y-4 pr-1.5 lg:pb-32">
                  <ConsultancyNotes
                    notes={data.notes}
                    onSave={handleSaveNotes}
                    flushRef={flushNotesRef}
                    templates={data.consultationTemplates}
                    checkedItems={data.consultationItems}
                    onCheckItem={handleCheckConsultation}
                    onUncheckItem={handleUncheckConsultation}
                    draft={consultDraft.draft}
                    draftBusy={consultDraft.busy}
                    draftError={consultDraft.error}
                    draftStalled={consultDraft.stalled}
                    draftWaiting={consultDraft.waiting}
                    onGenerateDraft={consultDraft.generate}
                    onApproveDraft={consultDraft.approve}
                    onRejectDraft={consultDraft.reject}
                    similarityData={similarityData}
                    similarityLoading={similarityLoading}
                  />
                  <ActionChecklist
                    templates={data.actionTemplates}
                    items={data.actionItems}
                    onAdd={handleAddAction}
                    onRemove={handleRemoveAction}
                  />
                </div>

                {/* Right Column: Prescriptions Workspace (Independently Scrollable) */}
                <div className="lg:col-span-7 lg:h-full lg:min-h-0 lg:overflow-y-auto lg:scroll-column pr-1.5 pb-32">
                  <PrescriptionUpload prescriptions={data.prescriptions} onUpload={handleUploadPrescription}>
                    <PrescriptionTemplates
                      patient={data.patient}
                      appointment={data.appointment}
                      appointmentId={selectedAppointmentId}
                      reports={data.historyReports}
                      similarityData={similarityData}
                    />
                  </PrescriptionUpload>
                </div>
              </div>
            )}

            {/* Notes & Audio Focus View */}
            {consultationSubView === 'notes' && (
              <div className="h-full min-h-0 overflow-y-auto scroll-column max-w-4xl mx-auto w-full space-y-4 pr-1.5 pb-32">
                <ConsultancyNotes
                  notes={data.notes}
                  onSave={handleSaveNotes}
                  flushRef={flushNotesRef}
                  templates={data.consultationTemplates}
                  checkedItems={data.consultationItems}
                  onCheckItem={handleCheckConsultation}
                  onUncheckItem={handleUncheckConsultation}
                  draft={consultDraft.draft}
                  draftBusy={consultDraft.busy}
                  draftError={consultDraft.error}
                  draftStalled={consultDraft.stalled}
                  draftWaiting={consultDraft.waiting}
                  onGenerateDraft={consultDraft.generate}
                  onApproveDraft={consultDraft.approve}
                  onRejectDraft={consultDraft.reject}
                  similarityData={similarityData}
                  similarityLoading={similarityLoading}
                />
                <ActionChecklist
                  templates={data.actionTemplates}
                  items={data.actionItems}
                  onAdd={handleAddAction}
                  onRemove={handleRemoveAction}
                />
              </div>
            )}

            {/* Prescriptions Focus View */}
            {consultationSubView === 'rx' && (
              <div className="h-full min-h-0 overflow-y-auto scroll-column max-w-5xl mx-auto w-full pr-1.5 pb-32">
                <PrescriptionUpload prescriptions={data.prescriptions} onUpload={handleUploadPrescription}>
                  <PrescriptionTemplates
                    patient={data.patient}
                    appointment={data.appointment}
                    appointmentId={selectedAppointmentId}
                    reports={data.historyReports}
                    similarityData={similarityData}
                  />
                </PrescriptionUpload>
              </div>
            )}
          </div>
        </div>

        <Modal isOpen={confirmEnd} onClose={() => !ending && setConfirmEnd(false)} title="End this visit?">
          <p className="text-body-md text-ink-2">
            {data.patient.name} will see this on their visit history as soon as you end the visit:
          </p>
          <ul className="mt-3 space-y-1.5 text-body-md text-ink">
            <li>
              <span className="font-semibold">Doctor's notes:</span>{' '}
              {data.notes?.text?.trim() ? 'included' : <span className="text-ink-3">none written</span>}
            </li>
            <li>
              <span className="font-semibold">Covered in the consultation:</span> {data.consultationItems?.length || 0} item
              {(data.consultationItems?.length || 0) === 1 ? '' : 's'}
            </li>
            <li>
              <span className="font-semibold">Next steps for the patient:</span> {data.actionItems?.length || 0}
            </li>
            <li>
              <span className="font-semibold">Prescriptions:</span> {data.prescriptions?.length || 0}
            </li>
          </ul>
          <p className="mt-3 text-body-sm text-ink-3">
            You can still edit the notes afterwards; the patient's summary updates with them.
          </p>
          {endError && <p className="mt-3 text-body-sm text-terracotta">{endError}</p>}
          <div className="mt-5 flex justify-end gap-2">
            <button
              type="button"
              onClick={() => setConfirmEnd(false)}
              disabled={ending}
              className="rounded-xl border border-line px-4 py-2 text-label-lg text-ink-2 hover:bg-subcanvas disabled:opacity-50"
            >
              Keep visit open
            </button>
            <button
              type="button"
              onClick={handleEndVisit}
              disabled={ending}
              data-assistant-effect="send"
              className="rounded-xl bg-cypress px-4 py-2 text-label-lg text-white hover:bg-cypress-deep disabled:opacity-60"
            >
              {ending ? 'Ending…' : 'End visit and share summary'}
            </button>
          </div>
        </Modal>

        <DoctorConsultationModal
          isOpen={audioConsultOpen}
          initialTab={audioConsultTab}
          onClose={() => setAudioConsultOpen(false)}
          appointment={{
            appointmentId: selected?.appointmentId || selected?.id,
            patientFullName: data?.patient?.name || selected?.name,
            scheduledAt: selected?.scheduledAt,
          }}
          onConsultationFinished={() => {
            showToast('Consultation audio recorded and queued for transcription.', 'success');
          }}
        />
      </div>
    );
  };

  return (
    // The frame never scrolls; only the work column does. overflow-clip,
    // not overflow-hidden: a hidden box can still be scrolled by focus or
    // scrollIntoView, which slid the whole shell (sidebar included) up and
    // left a blank band at the bottom.
    <div className="flex h-screen overflow-clip bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />

      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <Topbar patients={todays} onSelectPatient={open} notifications={data?.notifications ?? []} />

        <main className="flex min-h-0 flex-1 flex-col gap-4 overflow-clip px-6 py-5">{renderBody()}</main>
      </div>

      {/* Floating Ambient Consultation Audio Bar when visit is open */}
      {selected && (
        <aside
          aria-label="Ambient Consultation Audio"
          className="fixed bottom-7 left-1/2 -translate-x-1/2 z-40 flex items-center gap-3.5 rounded-full border border-line bg-surface/95 dark:bg-raised/95 px-5 py-2.5 shadow-xl backdrop-blur-md transition-all hover:shadow-2xl ring-1 ring-line/30"
        >
          <div className="flex items-center gap-2 pr-1">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75"></span>
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-rose-600"></span>
            </span>
            <span className="text-[12px] font-bold uppercase tracking-wider text-ink">Ambient AI Audio</span>
          </div>

          <div className="h-4 w-px bg-line" />

          <button
            type="button"
            onClick={() => {
              setAudioConsultTab('RECORD');
              setAudioConsultOpen(true);
            }}
            className="flex items-center gap-2 rounded-full bg-rose-600 px-4 py-2 text-label-md font-semibold text-white shadow-sm transition-all hover:bg-rose-700 hover:shadow active:scale-95"
            data-assistant-id="dashboard.open_audio_consult"
            data-assistant-effect="save"
            data-assistant-side-effect="Opens the recording window and starts a consultation session for this visit. You start the recording yourself."
            title="Record consultation audio with ambient speech-to-text"
          >
            <Mic className="h-4 w-4 shrink-0 text-white" />
            <span>Record Consultation</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setAudioConsultTab('TRANSCRIPT');
              setAudioConsultOpen(true);
            }}
data-assistant-id="dashboard.open_transcript_logs"
            data-assistant-effect="save"
            data-assistant-side-effect="Opens the consultation window and starts a consultation session for this visit if none exists."
            className="flex items-center gap-2 rounded-full border border-indigo-200 bg-indigo-50 dark:border-indigo-800/60 dark:bg-indigo-950/50 dark:text-indigo-200 dark:hover:bg-indigo-900/50 px-4 py-2 text-label-md font-semibold text-indigo-800 transition-all hover:bg-indigo-100 hover:border-indigo-300 active:scale-95"
            title="View consultation audio transcript and speech-to-text processing logs"
          >
            <FileAudio className="h-4 w-4 shrink-0 text-indigo-600" />
            <span>Transcript Logs</span>
          </button>
        </aside>
      )}

      <Link
        to="/clinician/appointments/new"
        className="fixed bottom-8 right-8 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-lg transition-transform hover:scale-105 hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 z-40"
        aria-label="New visit"
        title="New visit"
      >
        <Plus className="h-6 w-6" />
      </Link>
    </div>
  );
}

export default ClinicianDashboard;
