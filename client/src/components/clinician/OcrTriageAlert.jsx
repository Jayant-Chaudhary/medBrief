import { useState } from 'react';
import { Icon } from '../common/Icon.jsx';
import { Button } from '../common/Button.jsx';
import { formatDate } from '../../utils/format.js';
import { SourcePreview } from './SourcePreview.jsx';

/**
 * Human-in-the-loop OCR review.
 *
 * Lists values the pipeline could not parse confidently and lets the clinician
 * type the correct reading in place — the one manual step that keeps a bad
 * scan from silently becoming a missing data point.
 *
 * The header toggles the list, so a long review queue can be folded away
 * while the clinician works through the rest of the brief.
 */
export function OcrTriageAlert({ alerts = [], onResolve }) {
  const [expanded, setExpanded] = useState(true);
  if (alerts.length === 0) return null;

  const listId = 'ocr-triage-list';

  return (
    <section className="rounded-2xl border border-terracotta-border bg-terracotta-surface p-4">
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        aria-expanded={expanded}
        aria-controls={listId}
        className="flex w-full items-start gap-3 text-left"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-terracotta text-white">
          <Icon name="scan" size={16} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-label-lg text-terracotta">
            {alerts.length} value{alerts.length > 1 ? 's' : ''} need{alerts.length > 1 ? '' : 's'} manual review
          </span>
          <span className="block text-body-sm text-terracotta-deep">
            {expanded
              ? 'The OCR engine flagged these as low-confidence. Enter the reading from the scan to resolve.'
              : 'Low-confidence OCR values. Expand to review.'}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-label-md text-terracotta hover:bg-surface/60">
          {expanded ? 'Collapse' : 'Expand'}
          <Icon
            name="chevronDown"
            size={16}
            className={`transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`}
          />
        </span>
      </button>

      {/* Hidden rather than unmounted, so a half-typed correction survives a collapse. */}
      <ul id={listId} hidden={!expanded} className="mt-3 space-y-2 sm:pl-11">
        {alerts.map((alert) => (
          <AlertItem key={alert.id} alert={alert} onResolve={onResolve} />
        ))}
      </ul>
    </section>
  );
}

function AlertItem({ alert, onResolve }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [showSource, setShowSource] = useState(false);

  async function submit(event) {
    event.preventDefault();
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onResolve?.(alert, value.trim());
    } catch (err) {
      setError(err.message || 'Could not save that value.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-xl border border-terracotta-border bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-display text-label-lg text-ink">{alert.label}</p>
        {alert.confidence != null && (
          <span className="rounded-full bg-terracotta-surface px-2 py-0.5 text-label-sm tabular text-terracotta">
            {Math.round(alert.confidence * 100)}% confidence
          </span>
        )}
      </div>
      <p className="mt-0.5 text-body-sm text-ink-3">
        {alert.reportName} · {formatDate(alert.reportDate)}
      </p>
      <p className="mt-1 text-body-sm text-ink-2">{alert.reason}</p>

      <form onSubmit={submit} className="mt-2.5 flex items-center gap-2">
        <label className="sr-only" htmlFor={`ocr-${alert.id}`}>
          Corrected value for {alert.label}
        </label>
        <input
          id={`ocr-${alert.id}`}
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Enter value from scan"
          className="field h-9 flex-1"
        />
        {alert.imageUrl && (
          <button
            type="button"
            onClick={() => setShowSource(true)}
            aria-haspopup="dialog"
            className="shrink-0 rounded-xl border border-line px-3 py-2 text-label-md text-cypress hover:bg-subcanvas"
          >
            View on report
          </button>
        )}
        <Button type="submit" size="sm" disabled={saving || !value.trim()}>
          {saving ? 'Saving…' : 'Resolve'}
        </Button>
      </form>
      {error && <p className="mt-1.5 text-body-sm text-terracotta">{error}</p>}
      {/* The correction box is already right here, so the preview only shows the line. */}
      <SourcePreview
        item={
          showSource
            ? {
                name: alert.label,
                value: alert.printed || '—',
                printed: alert.printed,
                scanUrl: alert.imageUrl,
                fileKind: alert.fileKind,
                sourcePage: alert.sourcePage,
                sourceBox: alert.sourceBox,
              }
            : null
        }
        onClose={() => setShowSource(false)}
      />
    </li>
  );
}

export default OcrTriageAlert;
