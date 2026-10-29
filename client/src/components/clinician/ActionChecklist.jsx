import { SectionCard } from '../common/SectionCard.jsx';
import { ChecklistPicker } from './ChecklistPicker.jsx';

/**
 * Next steps for the patient. The clinician's saved actions are one tick
 * away; ticking assigns the step, unticking takes it back, and anything else
 * can be written for this patient. The patient sees them as "next steps" and
 * ticks them off themselves.
 */
export function ActionChecklist({ templates = [], items = [], onAdd, onRemove }) {
  const selected = items.map((item) => ({
    ...item,
    note: item.doneByPatient ? 'Done by patient' : null,
  }));

  return (
    <SectionCard
      icon="check"
      title="Action Checklist"
      compact
      action={
        <span className="shrink-0 rounded-full bg-sage-surface px-2 py-0.5 text-label-sm uppercase tabular text-sage-ink">
          {items.length} assigned
        </span>
      }
      bodyClassName="p-3"
    >
      <ChecklistPicker
        compact
        templates={templates}
        selected={selected}
        onAdd={onAdd}
        onRemove={onRemove}
        placeholder="Write an action for this patient…"
        emptyHint="Save your usual actions under Checklists to tick them here."
      />
    </SectionCard>
  );
}

export default ActionChecklist;
