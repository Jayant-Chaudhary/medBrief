import { useCallback, useEffect, useState } from 'react';
import { Sidebar } from '../../components/layout/Sidebar.jsx';
import { SectionCard } from '../../components/common/SectionCard.jsx';
import { Icon } from '../../components/common/Icon.jsx';
import { Spinner } from '../../components/common/Spinner.jsx';
import { useToast } from '../../context/ToastContext';
import { useAssistantControls } from '../../components/assistant/AssistantBridge.jsx';
import {
  getQuestionnaireTemplates,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  getTemplates,
  createTemplate,
  updateTemplate,
  deleteTemplate,
} from '../../services/clinicianService.js';

/** How the patient answers a pre-visit question. */
const QUESTION_TYPES = [
  { value: 'yes_no', label: 'Yes / No' },
  { value: 'text', label: 'Written answer' },
];

/**
 * One editable list: add, rename in place, remove. `extra` renders per-row
 * controls (type and red flag for questions); `addControls` sits beside the
 * add box (the question-type choice).
 */
function EditableList({ items, onAdd, onRename, onRemove, placeholder, emptyText, extra, addControls, inputAssistantId, buttonAssistantId }) {
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editText, setEditText] = useState('');
  const [busy, setBusy] = useState(false);

  async function run(action) {
    setBusy(true);
    try {
      await action();
    } finally {
      setBusy(false);
    }
  }

  async function add(event) {
    event.preventDefault();
    const text = draft.trim();
    if (!text) return;
    await run(async () => {
      await onAdd(text);
      setDraft('');
    });
  }

  async function saveEdit(item) {
    const text = editText.trim();
    if (!text || text === item.label) {
      setEditingId(null);
      return;
    }
    await run(async () => {
      await onRename(item, text);
      setEditingId(null);
    });
  }

  return (
    <div>
      {items.length === 0 ? (
        <p className="pb-3 text-body-sm text-ink-3">{emptyText}</p>
      ) : (
        <ul className="mb-3 divide-y divide-line overflow-hidden rounded-xl border border-line">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-3 bg-raised px-3 py-2">
              {editingId === item.id ? (
                <input
                  autoFocus
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => saveEdit(item)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') saveEdit(item);
                    if (e.key === 'Escape') setEditingId(null);
                  }}
                  aria-label="Edit item"
                  className="field h-9 flex-1"
                />
              ) : (
                <button
                  type="button"
                  onClick={() => {
                    setEditingId(item.id);
                    setEditText(item.label);
                  }}
                  title="Click to edit"
                  className="min-w-0 flex-1 truncate text-left text-body-md text-ink hover:text-cypress"
                >
                  {item.label}
                </button>
              )}
              {extra?.(item, run)}
              <button
                type="button"
                onClick={() => run(() => onRemove(item))}
                disabled={busy}
                aria-label={`Remove ${item.label}`}
                className="shrink-0 rounded-lg p-1.5 text-ink-3 hover:bg-terracotta-surface hover:text-terracotta disabled:opacity-40"
              >
                <Icon name="minus" size={16} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <form onSubmit={add} className="flex items-center gap-2">
        {addControls}
        <input
          value={draft}
          data-assistant-id={inputAssistantId}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="field h-10 flex-1"
        />
        <button
          type="submit"
          data-assistant-id={buttonAssistantId}
          disabled={!draft.trim() || busy}
          aria-label="Add"
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cypress text-surface hover:bg-cypress-deep disabled:opacity-40"
        >
          <Icon name="plus" size={16} />
        </button>
      </form>
    </div>
  );
}

/**
 * The clinician's reusable lists. Pre-visit questions are offered (all
 * ticked) whenever a visit is created; consultation and action items are
 * one tick away during the consultation itself.
 */
export function ClinicianChecklists() {
  const [collapsed, setCollapsed] = useState(false);
  const [questions, setQuestions] = useState([]);
  const [consultation, setConsultation] = useState([]);
  const [actions, setActions] = useState([]);
  const [newQuestionType, setNewQuestionType] = useState('yes_no');
  const [loading, setLoading] = useState(true);
  const [draftQuestionText, setDraftQuestionText] = useState('');
  const [draftConsultationItem, setDraftConsultationItem] = useState('');
  const [draftActionItem, setDraftActionItem] = useState('');
  const { showToast } = useToast();

  useEffect(() => {
    Promise.all([getQuestionnaireTemplates(), getTemplates('consultation'), getTemplates('action')])
      .then(([questionRows, consultationRows, actionRows]) => {
        setQuestions(questionRows);
        setConsultation(consultationRows);
        setActions(actionRows);
      })
      .catch((err) => showToast(err.message || 'Could not load your checklists.', 'error'))
      .finally(() => setLoading(false));
  }, [showToast]);

  useAssistantControls(
    'checklists',
    {
      controls: {
        questionText: {
          get: () => draftQuestionText,
          set: (val) => setDraftQuestionText(val ?? ''),
        },
        questionType: {
          get: () => newQuestionType,
          set: (val) => setNewQuestionType(val || 'yes_no'),
        },
        consultationItem: {
          get: () => draftConsultationItem,
          set: (val) => setDraftConsultationItem(val ?? ''),
        },
        actionItem: {
          get: () => draftActionItem,
          set: (val) => setDraftActionItem(val ?? ''),
        },
      },
      buttons: {
        add_question: {
          run: async () => {
            if (!draftQuestionText.trim()) return false;
            const created = await createQuestion({ questionText: draftQuestionText.trim(), responseType: newQuestionType });
            setQuestions((list) => [...list, created]);
            setDraftQuestionText('');
            showToast('Question template added.', 'success');
            return true;
          },
          summary: () => [{ label: 'Question', value: draftQuestionText }],
        },
        add_consultation_item: {
          run: async () => {
            if (!draftConsultationItem.trim()) return false;
            const created = await createTemplate('consultation', draftConsultationItem.trim());
            setConsultation((list) => [...list, created]);
            setDraftConsultationItem('');
            showToast('Consultation checklist item added.', 'success');
            return true;
          },
          summary: () => [{ label: 'Item', value: draftConsultationItem }],
        },
        add_action_item: {
          run: async () => {
            if (!draftActionItem.trim()) return false;
            const created = await createTemplate('action', draftActionItem.trim());
            setActions((list) => [...list, created]);
            setDraftActionItem('');
            showToast('Action checklist item added.', 'success');
            return true;
          },
          summary: () => [{ label: 'Item', value: draftActionItem }],
        },
      },
    },
    { ready: !loading }
  );

  /** Any failed change surfaces as a toast; the list only changes on success. */
  const guarded = useCallback(
    (fn) =>
      async (...args) => {
        try {
          await fn(...args);
        } catch (err) {
          showToast(err.message || 'Could not save that change.', 'error');
        }
      },
    [showToast]
  );

  const templateHandlers = (kind, setList) => ({
    onAdd: guarded(async (label) => {
      const created = await createTemplate(kind, label);
      setList((list) => [...list, created]);
    }),
    onRename: guarded(async (item, label) => {
      const updated = await updateTemplate(item.id, { label });
      setList((list) => list.map((row) => (row.id === item.id ? updated : row)));
    }),
    onRemove: guarded(async (item) => {
      await deleteTemplate(item.id);
      setList((list) => list.filter((row) => row.id !== item.id));
    }),
  });

  const questionItems = questions.map((q) => ({ ...q, label: q.question_text }));

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />

      <main className="flex-1 overflow-y-auto px-6 py-5">
        <div className="mx-auto max-w-3xl space-y-4">
          <header>
            <h1 className="font-display text-head-lg text-ink">Pre-visit &amp; Consultancy Checklist</h1>
            <p className="text-body-md text-ink-2">
              Save what you ask and do for every patient once. Each visit starts from these lists, and you can
              still add anything specific to that patient.
            </p>
          </header>

          {loading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-ink-3">
              <Spinner /> Loading your checklists…
            </div>
          ) : (
            <>
              <SectionCard
                icon="notes"
                title="Pre-visit questions"
                subtitle="Sent to the patient before each visit — all ticked by default when you create one"
                bodyClassName="p-5"
              >
                <EditableList
                  items={questionItems}
                  inputAssistantId="checklists.questionText"
                  buttonAssistantId="checklists.add_question"
                  placeholder="Add a question, e.g. Any new medication since your last visit?"
                  emptyText="No questions yet. Patients skip the questionnaire until you add some."
                  onAdd={guarded(async (text) => {
                    const created = await createQuestion({ questionText: text, responseType: newQuestionType });
                    setQuestions((list) => [...list, created]);
                  })}
                  addControls={
                    <select
                      value={newQuestionType}
                      data-assistant-id="checklists.questionType"
                      onChange={(e) => setNewQuestionType(e.target.value)}
                      aria-label="How the patient answers"
                      className="field h-10 w-auto shrink-0"
                    >
                      {QUESTION_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                          {type.label}
                        </option>
                      ))}
                    </select>
                  }
                  onRename={guarded(async (item, text) => {
                    const updated = await updateQuestion(item.id, { questionText: text });
                    setQuestions((list) => list.map((q) => (q.id === item.id ? updated : q)));
                  })}
                  onRemove={guarded(async (item) => {
                    await deleteQuestion(item.id);
                    setQuestions((list) => list.filter((q) => q.id !== item.id));
                  })}
                  extra={(item, run) => (
                    <>
                      <span className="pill shrink-0 border-line bg-subcanvas text-ink-2">
                        {item.response_type === 'text' ? 'Written' : 'Yes / No'}
                      </span>
                      {item.response_type !== 'text' && (
                        <button
                          type="button"
                          onClick={() =>
                            run(
                              guarded(async () => {
                                const updated = await updateQuestion(item.id, {
                                  isRedFlagTrigger: !item.is_red_flag_trigger,
                                });
                                setQuestions((list) => list.map((q) => (q.id === item.id ? updated : q)));
                              })
                            )
                          }
                          title="A “Yes” to a red-flag question is highlighted on your dashboard"
                          className={`pill shrink-0 ${
                            item.is_red_flag_trigger
                              ? 'border-terracotta-border bg-terracotta-surface text-terracotta'
                              : 'border-line bg-subcanvas text-ink-3'
                          }`}
                        >
                          Red flag
                        </button>
                      )}
                    </>
                  )}
                />
              </SectionCard>

              <SectionCard
                icon="check"
                title="Consultation checklist"
                subtitle="Ticked during the consultation, next to your notes"
                bodyClassName="p-5"
              >
                <EditableList
                  items={consultation}
                  inputAssistantId="checklists.consultationItem"
                  buttonAssistantId="checklists.add_consultation_item"
                  placeholder="Add an item, e.g. Blood pressure checked"
                  emptyText="No consultation items yet."
                  {...templateHandlers('consultation', setConsultation)}
                />
              </SectionCard>

              <SectionCard
                icon="history"
                title="Action checklist"
                subtitle="Assigned to the patient as next steps after the visit"
                bodyClassName="p-5"
              >
                <EditableList
                  items={actions}
                  inputAssistantId="checklists.actionItem"
                  buttonAssistantId="checklists.add_action_item"
                  placeholder="Add an action, e.g. Repeat blood test in 2 weeks"
                  emptyText="No actions yet."
                  {...templateHandlers('action', setActions)}
                />
              </SectionCard>
            </>
          )}
        </div>
      </main>
    </div>
  );
}

export default ClinicianChecklists;
