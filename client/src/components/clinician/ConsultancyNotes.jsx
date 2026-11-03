import { useEffect, useState } from 'react';
import { SectionCard } from '../common/SectionCard.jsx';
import { useAutosave } from '../../hooks/useAutosave.js';
import { ChecklistPicker } from './ChecklistPicker.jsx';
import { draftToNotesText } from '../../utils/draftNotes.js';

const STATUS_TEXT = {
  idle: '',
  pending: 'Unsaved changes',
  saving: 'Saving…',
  saved: 'Auto-saved',
  error: 'Save failed — retry',
};

/**
 * The consultation record: the clinician's standard items ticked off, plus
 * free-text observations for this patient, auto-saved so nothing is lost
 * mid-consult.
 */
export function ConsultancyNotes({
  notes,
  onSave,
  templates = [],
  checkedItems = [],
  onCheckItem,
  onUncheckItem,
  flushRef,
  draft = null,
  draftBusy = false,
  draftError = null,
  draftStalled = false,
  draftWaiting = false,
  onGenerateDraft,
  onApproveDraft,
  onRejectDraft,
}) {
  const [text, setText] = useState(notes?.text ?? '');
  const { status, savedAt, schedule, flush } = useAutosave(onSave);

  // Lets the dashboard save unsaved notes before it ends the visit.
  useEffect(() => {
    if (flushRef) flushRef.current = flush;
  }, [flushRef, flush]);

  // Re-seed when the clinician switches patients.
  useEffect(() => {
    setText(notes?.text ?? '');
  }, [notes?.text]);

  function onChange(event) {
    setText(event.target.value);
    schedule(event.target.value);
  }

  const draftText = draft?.status === 'needs_review' ? draftToNotesText(draft.doctor_notes) : '';

  // Approve first (the server stores the draft text), then save the doctor's
  // combined text so an existing note is never overwritten by the draft alone.
  async function insertDraft() {
    try {
      await onApproveDraft?.();
    } catch {
      return;
    }
    const next = text.trim() ? `${text.trim()}\n\n${draftText}` : draftText;
    setText(next);
    schedule(next);
  }

  const savedLabel =
    status === 'saved' && savedAt
      ? `Auto-saved ${savedAt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })}`
      : STATUS_TEXT[status];

  return (
    <SectionCard
      icon="notes"
      title="Consultancy Notes"
      compact
      action={
        savedLabel && (
          <span
            className={`flex shrink-0 items-center gap-1.5 text-body-sm ${
              status === 'error' ? 'text-terracotta' : 'text-ink-3'
            }`}
          >
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                status === 'error' ? 'bg-terracotta' : status === 'saved' ? 'bg-sage' : 'bg-olive'
              }`}
            />
            {savedLabel}
          </span>
        )
      }
      bodyClassName="p-3"
    >
      <details className="mb-3">
        <summary className="mb-2 cursor-pointer text-label-sm text-ink-3">Consultation checklist ({checkedItems.length} selected)</summary>
        <ChecklistPicker
          compact
          templates={templates}
          selected={checkedItems}
          onAdd={onCheckItem}
          onRemove={onUncheckItem}
          placeholder="Add an item for this consultation…"
          emptyHint="Save your standard consultation items under Checklists to tick them here."
        />
      </details>

      {draftText && (
        <div className="mb-3 rounded-xl border border-indigo-200 bg-gradient-to-r from-indigo-50/70 to-purple-50/40 p-4 shadow-xs" role="region" aria-label="Draft from consultation audio">
          <div className="flex items-center gap-1.5 text-label-sm font-bold uppercase tracking-wider text-indigo-900">
            <span>🎙️ Ambient Audio Draft</span>
          </div>
          <p className="mt-1 text-body-sm text-slate-600">
            Generated from the ambient consultation recording. Review and edit before inserting into notes:
          </p>
          <pre className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap font-sans text-body-sm text-slate-800 bg-white/80 p-3 rounded-lg border border-indigo-100">{draftText}</pre>
          {draftError && <p className="mt-2 text-body-sm text-rose-600">{draftError}</p>}
          <div className="mt-3 flex gap-2">
            <button
              type="button"
              className="rounded-xl bg-indigo-600 px-3.5 py-1.5 text-label-md font-semibold text-white shadow-xs hover:bg-indigo-700 disabled:opacity-60 transition-all active:scale-95"
              disabled={draftBusy}
              onClick={insertDraft}
            >
              Insert into notes
            </button>
            <button
              type="button"
              className="rounded-xl border border-slate-200 bg-white px-3.5 py-1.5 text-label-md font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-60 transition-all"
              disabled={draftBusy}
              onClick={() => onRejectDraft?.().catch(() => {})}
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {!draftText && !draft && (draftWaiting || draftBusy) && (
        <div className="mb-3 flex items-center gap-2.5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3.5 shadow-xs" role="status">
          <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-indigo-600 border-t-transparent" aria-hidden="true" />
          <p className="text-body-sm font-medium text-indigo-900">Generating AI consultation summary… please wait.</p>
        </div>
      )}

      {!draftText && !draft && draftStalled && !draftBusy && (
        <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/60 p-3.5" role="status">
          <p className="text-body-sm text-amber-900">The summary is taking longer than expected.</p>
          {draftError && <p className="mt-1 text-body-sm text-rose-600">{draftError}</p>}
          <button
            type="button"
            onClick={() => onGenerateDraft?.()}
            className="mt-2 rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-label-md font-medium text-slate-700 hover:bg-slate-50 shadow-xs"
          >
            Try again
          </button>
        </div>
      )}

      <h3 className="mb-2 text-label-sm font-semibold uppercase tracking-wider text-slate-500">Consultation Observations</h3>
      <label className="sr-only" htmlFor="consultancy-notes">
        Consultancy notes
      </label>
      <textarea
        id="consultancy-notes"
        data-assistant-id="dashboard.notes"
        value={text}
        onChange={onChange}
        rows={4}
        placeholder="Subjective, objective, assessment, plan…"
        className="field min-h-[120px] w-full resize-y p-3.5 text-body-md leading-relaxed border border-slate-200 rounded-xl focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 shadow-2xs"
      />
    </SectionCard>
  );
}

export default ConsultancyNotes;
