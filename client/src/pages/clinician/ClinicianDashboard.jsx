import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sidebar } from '../../components/layout/Sidebar.jsx';
import { Topbar } from '../../components/layout/Topbar.jsx';
import { PatientHeaderCard } from '../../components/clinician/PatientHeaderCard.jsx';
import { PreVisitQuestionnairePanel } from '../../components/clinician/PreVisitQuestionnairePanel.jsx';
import { OcrTriageAlert } from '../../components/clinician/OcrTriageAlert.jsx';
import { HistoryGrid } from '../../components/clinician/HistoryGrid.jsx';
import { SlideOver } from '../../components/ui/SlideOver.jsx';
import { Modal } from '../../components/ui/Modal.jsx';
import { useToast } from '../../context/ToastContext';
import { ConsultancyNotes } from '../../components/clinician/ConsultancyNotes.jsx';
import { ActionChecklist } from '../../components/clinician/ActionChecklist.jsx';
import { PrescriptionUpload } from '../../components/clinician/PrescriptionUpload.jsx';
import { Spinner } from '../../components/common/Spinner.jsx';
import { usePatientDashboard } from '../../hooks/usePatientDashboard.js';
import { Plus, ArrowLeft, Clock, User, CheckCircle, NotebookPen, CircleStop, BadgeCheck, UserCheck, Heart } from 'lucide-react';
import { buildFlowsheet } from '../../utils/flowsheet.js';
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
} from '../../services/clinicianService.js';

/**
 * Where a visit is in its day, for the badge on today's cards. `isPending`
 * wins over the stored status: an unaccepted invite cannot be opened yet.
 */
function visitStage(appointment) {
  if (appointment.isPending) {
    return { label: 'Pending', note: 'Invited patient', Icon: Clock, badge: 'bg-attention-light text-attention-dark' };
  }
  switch (appointment.status) {
    case 'completed':
      return { label: 'Completed', note: 'Visit completed', Icon: BadgeCheck, badge: 'bg-sage-surface text-sage-ink' };
    case 'checked_in':
      return { label: 'Checked in', note: 'Ready to be seen', Icon: UserCheck, badge: 'bg-primary-light text-primary-dark' };
    default:
      return { label: 'Accepted', note: 'Registered patient', Icon: CheckCircle, badge: 'bg-success-light text-success-dark' };
  }
}

function isToday(value) {
  return value && new Date(value).toDateString() === new Date().toDateString();
}

/**
 * Clinician command centre.
 *
 * Without a visit selected it shows today's appointments. The open visit
 * lives in the URL (`?appointment=<id>`), so the schedule and patient list can
 * link straight into it and the browser's back button returns to the cards.
 */
export function ClinicianDashboard() {
  const [collapsed, setCollapsed] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const closeNotes = useCallback(() => setNotesOpen(false), []);
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
    setNotesOpen(false);
    setSearchParams({});
  };

  const { data, loading, error, patch } = usePatientDashboard(selected?.id, selected?.appointmentId);
  const appointmentId = data?.appointment?.id;

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
      setNotesOpen(false);
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
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {todays.map((appointment) => {
            const isPending = appointment.isPending;
            const isCompleted = !isPending && appointment.status === 'completed';
            const stage = visitStage(appointment);

            return (
              <div
                key={appointment.appointmentId}
                onClick={() => open(appointment)}
                className={`card p-6 flex flex-col gap-4 border transition-all duration-200 ${
                  isPending
                    ? 'border-ink-soft/20 bg-canvas-alt opacity-75 cursor-not-allowed'
                    : isCompleted
                      ? 'border-sage-border bg-sage-surface/40 cursor-pointer hover:shadow-md'
                      : 'border-primary/10 hover:border-primary/30 hover:shadow-md cursor-pointer'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-primary-light text-primary flex items-center justify-center font-bold">
                      {appointment.name?.charAt(0) || <User className="w-5 h-5" />}
                    </div>
                    <div>
                      <h3 className="font-semibold text-ink">{appointment.name}</h3>
                      <p className="text-xs text-ink-soft truncate w-32">{stage.note}</p>
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
      return (
        <div className="card flex flex-1 flex-col items-center justify-center gap-2 p-8 text-center">
          <p className="font-display text-head-sm text-terracotta">Could not reach the clinic API</p>
          <p className="max-w-md text-body-md text-ink-2">{queueError.message}</p>
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
        <div className="flex flex-1 items-center justify-center gap-3 text-ink-3">
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
        <div className="flex items-center gap-4 mb-4">
          <button onClick={close} aria-label="Back to dashboard" className="p-2 hover:bg-canvas-alt rounded-full transition-colors">
            <ArrowLeft className="w-5 h-5 text-ink-soft" />
          </button>
          <h1 className="text-xl font-display font-semibold text-ink">Report Analysis</h1>

          <div className="ml-auto flex items-center gap-3">
            <Link
              to={`/clinician/maternity?patientId=${data.patient.id}&patientName=${encodeURIComponent(data.patient.name || '')}&phone=${encodeURIComponent(data.patient.phone || '')}`}
              className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-label-lg text-cypress transition-colors hover:border-cypress hover:bg-subcanvas"
              title="Open Antenatal Maternity Record"
            >
              <Heart className="h-4 w-4 text-terracotta" />
              Maternity card
            </Link>

            <button
              type="button"
              onClick={() => setNotesOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={notesOpen}
              className="flex items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-label-lg text-cypress
                         transition-colors hover:border-cypress hover:bg-subcanvas"
            >
              <NotebookPen className="h-4 w-4" />
              Consultation notes
              {(data.notes.text.trim() || data.actionItems.length > 0 || data.prescriptions.length > 0) && (
                <span className="h-2 w-2 rounded-full bg-sage" aria-label="has content" />
              )}
            </button>
          </div>

          {data.appointment?.status === 'completed' ? (
            <span className="flex items-center gap-2 rounded-xl border border-sage-border bg-sage-surface px-4 py-2 text-label-lg text-sage-ink">
              <BadgeCheck className="h-4 w-4" />
              Visit ended · summary shared
            </span>
          ) : (
            <button
              type="button"
              onClick={() => {
                setEndError(null);
                setConfirmEnd(true);
              }}
              className="flex items-center gap-2 rounded-xl bg-cypress px-4 py-2 text-label-lg text-white transition-colors hover:bg-cypress-deep"
            >
              <CircleStop className="h-4 w-4" />
              End visit
            </button>
          )}
        </div>

        {/*
          Only the action bar above stays put. Patient details and the
          questionnaire scroll away with the data, so the clinical history
          gets the whole height once the doctor starts reading it.
        */}
        <div className="scroll-column min-h-0 flex-1 space-y-4 pr-1">
          <PatientHeaderCard patient={data.patient} />
          {data.questionnaire.answers.length > 0 && <PreVisitQuestionnairePanel questionnaire={data.questionnaire} />}
          <OcrTriageAlert alerts={data.triageAlerts} onResolve={handleResolveAlert} />
          <HistoryGrid flowsheet={data.flowsheet} patientId={data.patient.id} onResolve={handleResolveAlert} />
        </div>

        <SlideOver
          open={notesOpen}
          onClose={closeNotes}
          title="Consultation"
          subtitle={`Notes, actions and prescription for ${data.patient.name ?? 'this visit'}`}
        >
          <ConsultancyNotes
            notes={data.notes}
            onSave={handleSaveNotes}
            flushRef={flushNotesRef}
            templates={data.consultationTemplates}
            checkedItems={data.consultationItems}
            onCheckItem={handleCheckConsultation}
            onUncheckItem={handleUncheckConsultation}
          />
          <ActionChecklist
            templates={data.actionTemplates}
            items={data.actionItems}
            onAdd={handleAddAction}
            onRemove={handleRemoveAction}
          />
          <PrescriptionUpload prescriptions={data.prescriptions} onUpload={handleUploadPrescription} />
        </SlideOver>

        <Modal isOpen={confirmEnd} onClose={() => !ending && setConfirmEnd(false)} title="End this visit?">
          <p className="text-body-md text-ink-2">
            {data.patient.name} will see this on their visit history as soon as you end the visit:
          </p>
          <ul className="mt-3 space-y-1.5 text-body-md text-ink">
            <li>
              <span className="font-semibold">Doctor's notes:</span>{' '}
              {data.notes.text.trim() ? 'included' : <span className="text-ink-3">none written</span>}
            </li>
            <li>
              <span className="font-semibold">Covered in the consultation:</span> {data.consultationItems.length} item
              {data.consultationItems.length === 1 ? '' : 's'}
            </li>
            <li>
              <span className="font-semibold">Next steps for the patient:</span> {data.actionItems.length}
            </li>
            <li>
              <span className="font-semibold">Prescriptions:</span> {data.prescriptions.length}
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
              className="rounded-xl bg-cypress px-4 py-2 text-label-lg text-white hover:bg-cypress-deep disabled:opacity-60"
            >
              {ending ? 'Ending…' : 'End visit and share summary'}
            </button>
          </div>
        </Modal>
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
