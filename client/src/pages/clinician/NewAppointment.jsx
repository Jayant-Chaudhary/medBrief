import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CalendarPlus, Copy, Check, Trash2, Search, X } from 'lucide-react';
import {
  createAppointment,
  fetchMyPatients,
  getQuestionnaireTemplates,
} from '../../services/clinicianService';
import { useToast } from '../../context/ToastContext';
import { Sidebar } from '../../components/layout/Sidebar.jsx';
import { SectionCard } from '../../components/common/SectionCard.jsx';
import { Button } from '../../components/common/Button.jsx';
import { formatDate } from '../../utils/format.js';
import { useAssistantControls } from '../../components/assistant/AssistantBridge.jsx';

const EMPTY_FORM = { patientFullName: '', patientEmail: '', scheduledAt: '' };

const TYPE_LABEL = { yes_no: 'Yes / No', text: 'Written answer' };

const WHEN_FMT = { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' };

/** "t…@example.com": enough to recognise the address on a confirmation card. */
function maskEmail(email) {
  const [local, domain] = String(email || '').split('@');
  return domain ? `${local.slice(0, 1)}…@${domain}` : '—';
}

/**
 * Schedule a visit and invite the patient to it.
 *
 * A returning patient is found by name among the clinician's own patients;
 * anyone not found is entered by name and email. The pre-visit questions
 * default to the clinician's whole library, and extra ones can be written
 * for this patient alone.
 *
 * The invite link is shown after creating the appointment because SMTP is
 * best-effort: if the email does not go out, the clinic still needs a link it
 * can hand over.
 */
export default function NewAppointment() {
  const [collapsed, setCollapsed] = useState(false);
  const [searchParams] = useSearchParams();
  const { showToast } = useToast();

  const [patients, setPatients] = useState([]);
  const [mode, setMode] = useState('search'); // 'search' | 'manual'
  const [query, setQuery] = useState('');
  const [chosenPatient, setChosenPatient] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);

  const [library, setLibrary] = useState([]);
  const [selectedQuestionIds, setSelectedQuestionIds] = useState(new Set());
  const [newQuestions, setNewQuestions] = useState([]);
  const [draftQuestion, setDraftQuestion] = useState('');
  const [saveDraftToLibrary, setSaveDraftToLibrary] = useState(false);
  const [draftType, setDraftType] = useState('yes_no');

  const [result, setResult] = useState(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);

  // The assistant may use these once patients have loaded. Ids match the
  // server's controls registry. It only presses Create visit and invite after
  // the clinician confirms the summary below.
  const [loaded, setLoaded] = useState(false);
  const setText = (key) => (value) => setForm((f) => ({ ...f, [key]: String(value) }));
  const setNewPatient = (key) => (value) => {
    // A name or email means someone not in the list, so the form switches to entering them.
    setChosenPatient(null);
    setMode('manual');
    setText(key)(value);
  };
  useAssistantControls('new_appointment', {
    // Which returning patient is chosen, so a fill meant for one patient never lands on another.
    context: () => ({ patientId: mode === 'search' ? chosenPatient?.id ?? null : null }),
    controls: {
      scheduledAt: { get: () => form.scheduledAt, set: setText('scheduledAt') },
      patientFullName: { get: () => form.patientFullName, set: setNewPatient('patientFullName') },
      patientEmail: { get: () => form.patientEmail, set: setNewPatient('patientEmail') },
      newQuestion: { get: () => draftQuestion, set: (value) => setDraftQuestion(String(value)) },
      newQuestionType: { get: () => draftType, set: (value) => TYPE_LABEL[value] && setDraftType(value) },
      saveQuestionToLibrary: { get: () => saveDraftToLibrary, set: (value) => setSaveDraftToLibrary(value === true) },
    },
    buttons: {
      add_question: { run: () => Boolean(addDraftQuestion()) },
      create_visit: {
        available: () => patientReady && Boolean(form.scheduledAt) && !saving,
        run: submitAppointment,
        summary: () => [
          { label: 'Patient', value: (mode === 'search' ? chosenPatient?.fullName : form.patientFullName.trim()) || '—' },
          { label: 'Invite to', value: maskEmail(mode === 'search' ? chosenPatient?.email : form.patientEmail.trim()) },
          { label: 'Date and time', value: formatDate(form.scheduledAt, WHEN_FMT) },
          { label: 'Pre-visit questions', value: String(selectedQuestionIds.size + newQuestions.length) },
        ],
      },
    },
  }, { ready: loaded });

  useEffect(() => {
    Promise.all([fetchMyPatients(), getQuestionnaireTemplates()])
      .then(([patientRows, questionRows]) => {
        setPatients(patientRows);
        setLibrary(questionRows);
        // Every saved question is asked by default; the doctor unticks exceptions.
        setSelectedQuestionIds(new Set(questionRows.map((q) => q.id)));

        // Arriving from the patient list pre-selects that patient.
        const preselect = patientRows.find((p) => p.id === searchParams.get('patient'));
        if (preselect) setChosenPatient(preselect);
        // With no returning patients there is nothing to search.
        if (patientRows.length === 0) setMode('manual');
        setLoaded(true);
      })
      .catch((err) => showToast(err.message || 'Could not load your patients and questions.', 'error'));
  }, [searchParams, showToast]);

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return patients.slice(0, 8);
    return patients.filter((p) => (p.fullName || '').toLowerCase().includes(needle)).slice(0, 8);
  }, [patients, query]);

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  function switchToManual() {
    // Carry the typed name across so the doctor does not type it twice.
    setForm((f) => ({ ...f, patientFullName: f.patientFullName || query.trim() }));
    setChosenPatient(null);
    setMode('manual');
  }

  function toggleQuestion(id) {
    setSelectedQuestionIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** @returns {boolean} whether a question was added */
  function addDraftQuestion() {
    const text = draftQuestion.trim();
    if (!text) return false;
    setNewQuestions((current) => [
      ...current,
      { key: `${Date.now()}`, text, responseType: draftType, saveToList: saveDraftToLibrary },
    ]);
    setDraftQuestion('');
    setSaveDraftToLibrary(false);
    return true;
  }

  const patientReady =
    mode === 'search' ? Boolean(chosenPatient?.email) : Boolean(form.patientFullName.trim() && form.patientEmail.trim());

  function handleSubmit(event) {
    event.preventDefault();
    submitAppointment();
  }

  /**
   * Creates the visit and sends the invite. The form's button and the
   * assistant (after the clinician confirms) both call this.
   * @returns {Promise<boolean>} whether the visit was created
   */
  async function submitAppointment() {
    if (!patientReady || !form.scheduledAt || saving) return false;

    setSaving(true);
    setResult(null);

    const patient =
      mode === 'search'
        ? { patientFullName: chosenPatient.fullName || chosenPatient.email, patientEmail: chosenPatient.email }
        : { patientFullName: form.patientFullName.trim(), patientEmail: form.patientEmail.trim() };

    try {
      const created = await createAppointment({
        ...patient,
        scheduledAt: new Date(form.scheduledAt).toISOString(),
        questionnaireTemplateIds: [...selectedQuestionIds],
        newQuestions: newQuestions.map(({ text, responseType, saveToList }) => ({ text, responseType, saveToList })),
      });

      setResult(created);
      setForm(EMPTY_FORM);
      setChosenPatient(null);
      setQuery('');
      setNewQuestions([]);
      setSelectedQuestionIds(new Set(library.map((q) => q.id)));
      showToast(
        created.isReturningPatient
          ? 'Appointment added to the existing patient record.'
          : created.inviteEmailSent ? 'Appointment created and invite sent.' : 'Appointment created; email was not sent. Copy the invite link.'
      );
      return true;
    } catch (err) {
      showToast(err.message || 'Could not create the appointment.', 'error');
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function copyLink() {
    await navigator.clipboard.writeText(result.inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((v) => !v)} />

      <main className="flex-1 overflow-y-auto px-8 py-6">
        <div className="mx-auto max-w-2xl space-y-4">
          {result?.inviteLink && (
            <SectionCard icon="check" title="Visit created" bodyClassName="p-5">
              <p className="mb-3 text-body-md text-ink-2">
                {result.isReturningPatient
                  ? 'Added to the patient’s account — they will see it when they sign in.'
                  : result.inviteEmailSent
                    ? 'The invite was emailed. Copy the link here if you need to send it another way.'
                    : 'The invite email was not sent. Copy the link to share it with the patient.'}
              </p>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded-xl border border-line bg-subcanvas px-3 py-2 text-body-sm text-ink">
                  {result.inviteLink}
                </code>
                <Button type="button" variant="secondary" onClick={copyLink}>
                  {copied ? <Check size={16} /> : <Copy size={16} />}
                  {copied ? 'Copied' : 'Copy'}
                </Button>
              </div>
              <p className="mt-3 text-body-sm">
                <Link to="/clinician/schedule" className="text-cypress hover:underline">
                  View schedule
                </Link>
              </p>
            </SectionCard>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            <SectionCard icon="users" title="Patient" subtitle="Find a returning patient, or enter a new one" bodyClassName="p-5">
              {mode === 'search' ? (
                chosenPatient ? (
                  <div className="flex items-center justify-between gap-3 rounded-xl border border-sage-border bg-sage-surface px-4 py-3">
                    <div className="min-w-0">
                      <p className="font-display text-label-lg text-ink">{chosenPatient.fullName || 'Unnamed patient'}</p>
                      <p className="truncate text-body-sm text-ink-2">
                        {chosenPatient.email ?? 'No email on file'}
                        {chosenPatient.lastVisit && ` · last visit ${formatDate(chosenPatient.lastVisit.scheduledAt)}`}
                      </p>
                      {!chosenPatient.email && (
                        <button type="button" onClick={switchToManual} className="text-label-md text-cypress hover:underline">
                          Enter their email to invite them
                        </button>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => setChosenPatient(null)}
                      aria-label="Choose a different patient"
                      className="rounded-lg p-1.5 text-ink-3 hover:bg-line/60 hover:text-ink"
                    >
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <label htmlFor="patient-search" className="block text-label-md text-ink-2">
                      Search your patients by name
                    </label>
                    <div className="relative">
                      <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
                      <input
                        id="patient-search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Start typing a name…"
                        className="field h-10 pl-9"
                        autoComplete="off"
                      />
                    </div>

                    {matches.length > 0 ? (
                      <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line" data-assistant-private="">
                        {matches.map((patient) => (
                          <li key={patient.id}>
                            <button
                              type="button"
                              onClick={() => setChosenPatient(patient)}
                              className="flex w-full items-center justify-between gap-3 bg-raised px-4 py-2.5 text-left hover:bg-subcanvas"
                            >
                              <span className="min-w-0">
                                <span className="block truncate text-body-md text-ink">
                                  {patient.fullName || 'Unnamed patient'}
                                </span>
                                <span className="block truncate text-body-sm text-ink-3">{patient.email}</span>
                              </span>
                              {patient.lastVisit && (
                                <span className="shrink-0 text-body-sm text-ink-3">
                                  Last visit {formatDate(patient.lastVisit.scheduledAt)}
                                </span>
                              )}
                            </button>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-body-sm text-ink-3">No patient of yours matches “{query}”.</p>
                    )}

                    <button type="button" onClick={switchToManual} className="text-label-md text-cypress hover:underline">
                      Can’t find them? Enter their name and email instead
                    </button>
                  </div>
                )
              ) : (
                <div className="space-y-4">
                  <div>
                    <label htmlFor="patient-name" className="mb-1.5 block text-label-md text-ink-2">
                      Patient name
                    </label>
                    <input
                      id="patient-name"
                      data-assistant-id="patientFullName"
                      value={form.patientFullName}
                      onChange={set('patientFullName')}
                      className="field h-10"
                      required
                    />
                  </div>
                  <div>
                    <label htmlFor="patient-email" className="mb-1.5 block text-label-md text-ink-2">
                      Patient email
                    </label>
                    <input
                      id="patient-email"
                      data-assistant-id="patientEmail"
                      type="email"
                      value={form.patientEmail}
                      onChange={set('patientEmail')}
                      className="field h-10"
                      required
                    />
                    <p className="mt-1 text-body-sm text-ink-3">
                      If this email already has an account, the visit is added to it — their password keeps working.
                    </p>
                  </div>
                  {patients.length > 0 && (
                    <button type="button" onClick={() => setMode('search')} className="text-label-md text-cypress hover:underline">
                      Search my patients by name instead
                    </button>
                  )}
                </div>
              )}
            </SectionCard>

            <SectionCard icon="calendar" title="Date and time" bodyClassName="p-5">
              <input
                id="scheduled-at"
                data-assistant-id="scheduledAt"
                aria-label="Date and time"
                type="datetime-local"
                value={form.scheduledAt}
                onChange={set('scheduledAt')}
                className="field h-10"
                required
              />
            </SectionCard>

            <SectionCard
              icon="notes"
              title="Pre-visit questions"
              subtitle="Asked before the visit; untick any that don't apply"
              bodyClassName="p-5"
              action={
                library.length > 0 && (
                  <span className="shrink-0 rounded-full bg-subcanvas px-3 py-1 text-label-sm uppercase text-ink-2">
                    {selectedQuestionIds.size + newQuestions.length} selected
                  </span>
                )
              }
            >
              {library.length === 0 ? (
                <p className="mb-3 text-body-sm text-ink-3">
                  Your question library is empty. Save the questions you ask everyone under{' '}
                  <Link to="/clinician/checklists" className="text-cypress hover:underline">Checklists</Link>, or write
                  one below.
                </p>
              ) : (
                <ul className="mb-3 max-h-64 space-y-1 overflow-y-auto pr-1">
                  {library.map((question) => (
                    <li key={question.id}>
                      <label className="flex cursor-pointer items-start gap-3 rounded-lg p-2 hover:bg-subcanvas">
                        <input
                          type="checkbox"
                          checked={selectedQuestionIds.has(question.id)}
                          onChange={() => toggleQuestion(question.id)}
                          className="mt-1 h-4 w-4 accent-cypress"
                        />
                        <span className="text-body-md text-ink">
                          {question.question_text}
                          <span className="ml-2 text-label-sm uppercase text-ink-3">
                            {TYPE_LABEL[question.response_type] ?? TYPE_LABEL.yes_no}
                          </span>
                          {question.is_red_flag_trigger && (
                            <span className="ml-2 text-label-sm uppercase text-terracotta">red flag</span>
                          )}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              )}

              {newQuestions.length > 0 && (
                <ul className="mb-3 space-y-2">
                  {newQuestions.map((question) => (
                    <li key={question.key} className="flex items-start gap-3 rounded-xl border border-line bg-raised p-3">
                      <div className="min-w-0 flex-1">
                        <p className="text-body-md text-ink">{question.text}</p>
                        <p className="text-body-sm text-ink-3">
                          {TYPE_LABEL[question.responseType]} ·{' '}
                          {question.saveToList ? 'also saved to your library' : 'only for this patient'}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setNewQuestions((current) => current.filter((q) => q.key !== question.key))}
                        aria-label="Remove question"
                        className="text-ink-3 hover:text-terracotta"
                      >
                        <Trash2 size={16} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              <div className="space-y-2 rounded-xl border border-line bg-subcanvas p-3">
                <input
                  value={draftQuestion}
                  onChange={(e) => setDraftQuestion(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addDraftQuestion();
                    }
                  }}
                  placeholder="Write a question for this patient…"
                  aria-label="New question"
                  data-assistant-id="newQuestion"
                  className="field h-10"
                />
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <select
                    value={draftType}
                    onChange={(e) => setDraftType(e.target.value)}
                    aria-label="How the patient answers"
                    data-assistant-id="newQuestionType"
                    className="field h-8 w-auto"
                  >
                    <option value="yes_no">{TYPE_LABEL.yes_no}</option>
                    <option value="text">{TYPE_LABEL.text}</option>
                  </select>
                  <label data-assistant-id="saveQuestionToLibrary" className="flex cursor-pointer items-center gap-2 rounded-md text-body-sm text-ink-2">
                    <input
                      type="checkbox"
                      checked={saveDraftToLibrary}
                      onChange={(e) => setSaveDraftToLibrary(e.target.checked)}
                      className="h-4 w-4 accent-cypress"
                    />
                    Also save to my library
                  </label>
                  <Button type="button" size="sm" variant="secondary" onClick={addDraftQuestion} disabled={!draftQuestion.trim()}>
                    Add question
                  </Button>
                </div>
              </div>
            </SectionCard>

            <Button type="submit" disabled={saving || !patientReady || !form.scheduledAt} className="w-full">
              <CalendarPlus size={16} />
              {saving ? 'Creating…' : 'Create visit and invite'}
            </Button>
          </form>
        </div>
      </main>
    </div>
  );
}
