import { useState } from 'react';
import { Icon } from '../common/Icon.jsx';

/**
 * A tick-list built from the clinician's saved defaults plus anything written
 * for this one patient.
 *
 * `templates` are the default labels. `selected` are the entries recorded for
 * this visit ({ id, label, note? }); a label is ticked when an entry with that
 * label exists. Custom entries (not among the templates) are listed after the
 * defaults. Ticking calls `onAdd(label)`, unticking `onRemove(entry)`.
 */
export function ChecklistPicker({ templates = [], selected = [], onAdd, onRemove, placeholder, emptyHint, compact = false }) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(null);

  const byLabel = new Map(selected.map((entry) => [entry.label, entry]));
  const templateSet = new Set(templates);
  const rows = [
    ...templates.map((label) => ({ label, entry: byLabel.get(label) ?? null })),
    ...selected.filter((entry) => !templateSet.has(entry.label)).map((entry) => ({ label: entry.label, entry })),
  ];

  async function toggle(row) {
    if (busy) return;
    setBusy(row.label);
    try {
      if (row.entry) await onRemove?.(row.entry);
      else await onAdd?.(row.label);
    } finally {
      setBusy(null);
    }
  }

  async function submit(event) {
    event.preventDefault();
    const label = draft.trim();
    if (!label || byLabel.has(label)) {
      setDraft('');
      return;
    }
    setBusy(label);
    try {
      await onAdd?.(label);
      setDraft('');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      {rows.length === 0 ? (
        emptyHint && <p className="pb-2 text-body-sm text-ink-3">{emptyHint}</p>
      ) : (
        <ul className={compact ? "max-h-40 space-y-1.5 overflow-y-auto pr-1" : "space-y-2"}>
          {rows.map((row) => {
            const checked = Boolean(row.entry);
            return (
              <li key={row.label}>
                <label
                  className={`flex cursor-pointer items-start rounded-xl border transition-colors ${compact ? 'gap-2 p-2' : 'gap-3 p-3'}
                              ${busy === row.label ? 'opacity-60' : ''}
                              ${checked ? 'border-sage-border bg-sage-surface' : 'border-line bg-subcanvas hover:border-line-strong'}`}
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    disabled={Boolean(busy)}
                    onChange={() => toggle(row)}
                    className="sr-only"
                  />
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border-[1.5px]
                                ${checked ? 'border-cypress bg-cypress text-surface' : 'border-line-strong bg-raised'}`}
                  >
                    {checked && <Icon name="check" size={12} strokeWidth={2.5} />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className={`block ${compact ? 'text-body-sm' : 'text-body-md'} ${checked ? 'text-sage-ink' : 'text-ink'}`}>{row.label}</span>
                    {row.entry?.note && <span className="block text-body-sm text-ink-3">{row.entry.note}</span>}
                  </span>
                </label>
              </li>
            );
          })}
        </ul>
      )}

      <form onSubmit={submit} className={`${compact ? 'mt-2' : 'mt-3'} flex items-center gap-2`}>
        <input
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          placeholder={placeholder}
          aria-label={placeholder}
          className="field h-9 flex-1"
        />
        <button
          type="submit"
          aria-label="Add"
          disabled={!draft.trim() || Boolean(busy)}
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cypress text-surface
                     transition-colors hover:bg-cypress-deep disabled:opacity-40"
        >
          <Icon name="plus" size={16} />
        </button>
      </form>
    </div>
  );
}

export default ChecklistPicker;
