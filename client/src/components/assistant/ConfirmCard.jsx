import { useEffect, useRef } from 'react';
import { AlertTriangle } from 'lucide-react';

/**
 * Shown before the assistant presses a button that saves or sends. Lists what
 * the page will submit, as the page itself reports it, and what happens next
 * (for example an invite email). Nothing runs until Confirm is clicked.
 */
export default function ConfirmCard({ label, rows = [], sideEffect, changed, onConfirm, onCancel }) {
  const headingRef = useRef(null);
  // Focus the card, not the Confirm button, so Enter in the panel cannot confirm by accident.
  useEffect(() => headingRef.current?.focus(), []);
  const rowList = Array.isArray(rows) ? rows : [];

  return (
    <div className="space-y-2 rounded-xl border border-primary/40 bg-canvas p-3 text-sm">
      <p ref={headingRef} tabIndex={-1} className="font-semibold text-ink outline-none">
        Confirm: {label}
      </p>
      {changed && <p className="text-ink-soft">The form changed after you looked. Please check it again.</p>}
      {rowList.length > 0 && (
        <dl className="grid grid-cols-[auto,1fr] gap-x-3 gap-y-1">
          {rowList.map((row) => (
            <div key={row.label} className="contents">
              <dt className="text-ink-soft">{row.label}</dt>
              <dd className="break-words text-ink">{row.value}</dd>
            </div>
          ))}
        </dl>
      )}
      {sideEffect && (
        <p className="flex items-start gap-1.5 text-ink">
          <AlertTriangle size={15} className="mt-0.5 shrink-0 text-terracotta" aria-hidden="true" />
          {sideEffect}
        </p>
      )}
      <div className="flex gap-2 pt-1">
        <button type="button" onClick={onConfirm} className="rounded-full bg-primary px-4 py-1.5 text-white hover:bg-primary-dark">
          Confirm
        </button>
        <button type="button" onClick={onCancel} className="rounded-full border border-line px-4 py-1.5 text-ink hover:bg-raised">
          Cancel
        </button>
      </div>
    </div>
  );
}
