import { Fragment, useEffect, useMemo, useState } from 'react';
import { Icon } from '../common/Icon.jsx';
import { EmptyState } from '../common/EmptyState.jsx';
import { TrendChart } from './TrendChart.jsx';
import { useMetricTrend } from '../../hooks/useMetricTrend.js';
import { formatDate } from '../../utils/format.js';
import { SourcePreview } from './SourcePreview.jsx';

const FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'changed', label: 'Changed since last report' },
  { id: 'review', label: 'Needs review' },
];

/** How many report dates fit side by side before the pager takes over. */
function useVisibleColumnCount() {
  const query = '(min-width: 1024px)';
  const [wide, setWide] = useState(() => typeof window === 'undefined' || window.matchMedia(query).matches);
  useEffect(() => {
    const media = window.matchMedia(query);
    const onChange = () => setWide(media.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return wide ? 4 : 3;
}

function shortDate(date) {
  return new Date(date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' });
}

function formatValue(value) {
  if (value == null) return '—';
  const number = Number(value);
  // Trim float noise ("0.30000000000000004") without rounding real precision away.
  return Number.isFinite(number) && String(value).trim() !== '' ? String(Number(number.toPrecision(6))) : String(value);
}

/**
 * Objective guideline reference bands for maternal laboratory tests.
 * FLAGS AND PRIORITISES ONLY; NEVER DIAGNOSES.
 * Highlighting reflects standardized laboratory ranges from clinical guidelines.
 */
function getClinicalBand(standardKey, number, rawValue) {
  if (number == null || !Number.isFinite(number)) {
    if (typeof rawValue === 'string') {
      const lower = rawValue.toLowerCase();
      if (lower.includes('positive') || lower.includes('reactive') || lower.includes('+++') || lower.includes('++')) {
        return 'critical';
      }
      if (lower.includes('+')) return 'warning';
    }
    return 'normal';
  }

  const key = String(standardKey || '').toLowerCase();

  // Fasting Blood Glucose (mg/dL) - NICE NG3: >= 92 elevated, >= 126 diabetes threshold
  if (key.includes('glucose_fasting') || key.includes('fbs') || key.includes('fasting_blood_sugar')) {
    if (number >= 126) return 'critical';
    if (number >= 92) return 'warning';
    return 'normal';
  }

  // Postprandial or Random Blood Glucose (mg/dL) - WHO/ADA: >= 140 elevated, >= 200 severe
  if (key.includes('glucose') || key.includes('rbs') || key.includes('ppbs')) {
    if (number >= 200) return 'critical';
    if (number >= 140) return 'warning';
    return 'normal';
  }

  // Hemoglobin (g/dL) - WHO maternal: normal >= 11, mild/mod anemia 7.0-10.9, severe < 7.0
  if (key.includes('hemoglobin') || key === 'hb') {
    if (number < 7.0) return 'critical';
    if (number < 11.0) return 'warning';
    return 'normal';
  }

  // Blood Pressure Systolic (mmHg) - NICE NG133: >= 160 severe, >= 140 elevated
  if (key.includes('bp_systolic') || key.includes('systolic')) {
    if (number >= 160) return 'critical';
    if (number >= 140) return 'warning';
    return 'normal';
  }

  // Blood Pressure Diastolic (mmHg) - NICE NG133: >= 110 severe, >= 90 elevated
  if (key.includes('bp_diastolic') || key.includes('diastolic')) {
    if (number >= 110) return 'critical';
    if (number >= 90) return 'warning';
    return 'normal';
  }

  // TSH (uIU/mL) - Maternal 1st trimester <= 2.5, 2nd/3rd <= 3.0
  if (key.includes('tsh') || key.includes('thyroid')) {
    if (number > 10.0 || number < 0.1) return 'critical';
    if (number > 3.0) return 'warning';
    return 'normal';
  }

  // Platelet Count (x10^3/uL) - normal 150-450, < 100 thrombocytopenia
  if (key.includes('platelet')) {
    if (number < 100) return 'critical';
    if (number < 150) return 'warning';
    return 'normal';
  }

  return 'normal';
}

function getGroupStyle(groupId) {
  const id = String(groupId || '').toLowerCase();
  if (id.includes('blood') || id.includes('cbc') || id.includes('hematology')) {
    return 'border-l-4 border-l-rose-500 bg-rose-50/40';
  }
  if (id.includes('glucose') || id.includes('sugar') || id.includes('metabolic') || id.includes('diabetes')) {
    return 'border-l-4 border-l-amber-500 bg-amber-50/40';
  }
  if (id.includes('thyroid')) {
    return 'border-l-4 border-l-violet-500 bg-violet-50/40';
  }
  if (id.includes('urine') || id.includes('renal') || id.includes('kidney')) {
    return 'border-l-4 border-l-sky-500 bg-sky-50/40';
  }
  return 'border-l-4 border-l-teal-600 bg-teal-50/30';
}

/**
 * The clinician's history grid: tests down the side, report dates across the
 * top, so every earlier reading sits next to the latest one without a click.
 *
 * Rows are grouped into clinical panels. The newest reading carries a ▲/▼
 * when it moved at least 10% from the previous one, values that need review
 * are highlighted (click to open the scan), and a row opens its full chart.
 * The table is fixed-width: more report dates than fit are paged, never
 * scrolled sideways.
 */
export function HistoryGrid({ flowsheet, patientId, onResolve }) {
  const { columns = [], groups = [], rowCount = 0, changedCount = 0, reviewCount = 0 } = flowsheet ?? {};
  const visible = useVisibleColumnCount();
  const [filter, setFilter] = useState('all');
  const [offset, setOffset] = useState(0);
  const [expandedRow, setExpandedRow] = useState(null);
  // The value whose printed line is being shown (see SourcePreview).
  const [preview, setPreview] = useState(null);

  // Quiet panels (nothing changed, nothing to review) start folded.
  const [openGroups, setOpenGroups] = useState(() => new Set());
  useEffect(() => {
    setOpenGroups(
      new Set(
        groups
          .filter((group) => group.rows.some((row) => row.needsReview || row.change.direction !== 'flat') || groups.length <= 2)
          .map((group) => group.id)
      )
    );
    setOffset(0);
    // Re-derive only when a different patient's grid arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flowsheet]);

  const maxOffset = Math.max(0, columns.length - visible);
  const start = Math.min(offset, maxOffset);
  const shown = columns.slice(start, start + visible);

  const filteredGroups = useMemo(() => {
    const keep = (row) =>
      filter === 'all' ||
      (filter === 'changed' && row.change.direction !== 'flat') ||
      (filter === 'review' && row.needsReview);
    return groups.map((group) => ({ ...group, rows: group.rows.filter(keep) })).filter((group) => group.rows.length > 0);
  }, [groups, filter]);

  const toggleGroup = (id) =>
    setOpenGroups((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // A filter narrows to what matters, so every matching panel is shown open.
  const isOpen = (id) => filter !== 'all' || openGroups.has(id);

  const counts = { all: rowCount, changed: changedCount, review: reviewCount };
  const colSpan = shown.length + 1;

  return (
    <section className="card flex min-h-0 flex-col border border-slate-200/90 shadow-sm bg-white overflow-hidden">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-slate-200 px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-teal-50 text-teal-700 border border-teal-200">
            <Icon name="chart" size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-head-sm font-semibold text-ink">Clinical data flowsheet</h2>
            <p className="mt-0.5 text-body-sm text-slate-500">
              {columns.length} report date{columns.length === 1 ? '' : 's'} · {rowCount} test{rowCount === 1 ? '' : 's'} ·
              select a test for its full chart
            </p>
          </div>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter tests">
          {FILTERS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setFilter(id)}
              aria-pressed={filter === id}
              className={`rounded-full px-3 py-1 text-label-md transition-colors ${
                filter === id
                  ? 'bg-slate-900 text-white font-semibold shadow-xs'
                  : 'border border-slate-200 bg-slate-50 text-slate-700 hover:bg-slate-100'
              }`}
            >
              {label}
              {id !== 'all' && (
                <span
                  className={`ml-1.5 tabular rounded-full px-1.5 py-0.2 text-xs font-semibold ${
                    filter === id
                      ? 'bg-white/20 text-white'
                      : id === 'review'
                        ? 'bg-amber-100 text-amber-800'
                        : 'bg-slate-200 text-slate-700'
                  }`}
                >
                  {counts[id]}
                </span>
              )}
            </button>
          ))}
        </div>
      </header>

      {rowCount === 0 ? (
        <EmptyState
          icon="flask"
          title="No results yet"
          description="Values appear here once a shared report clears the OCR pipeline."
        />
      ) : (
        <table className="w-full table-fixed border-collapse text-left">
          <colgroup>
            <col className="w-[34%]" />
            {shown.map((column) => (
              <col key={column.key} />
            ))}
          </colgroup>
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="text-label-sm text-ink-3">
              <th scope="col" className="py-2.5 pl-5 pr-2 font-semibold uppercase">
                <div className="flex items-center gap-1.5">
                  Test
                  {columns.length > visible && (
                    <span className="ml-auto flex items-center gap-0.5 normal-case">
                      <button
                        type="button"
                        onClick={() => setOffset(Math.max(0, start - 1))}
                        disabled={start === 0}
                        aria-label="Show newer reports"
                        className="rounded-md p-1 text-ink-2 hover:bg-subcanvas disabled:opacity-30"
                      >
                        <Icon name="chevronLeft" size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={() => setOffset(Math.min(maxOffset, start + 1))}
                        disabled={start >= maxOffset}
                        aria-label="Show older reports"
                        className="rounded-md p-1 text-ink-2 hover:bg-subcanvas disabled:opacity-30"
                      >
                        <Icon name="chevronRight" size={14} />
                      </button>
                    </span>
                  )}
                </div>
              </th>
              {shown.map((column, i) => (
                <th
                  key={column.key}
                  scope="col"
                  className={`${i === shown.length - 1 ? 'pl-2 pr-5' : 'px-2'} py-2.5 text-right font-semibold`}
                  title={formatDate(column.date)}
                >
                  {column.isCurrentVisit ? (
                    <span className="inline-block rounded-lg border border-emerald-300 bg-emerald-50 px-2.5 py-0.5 text-xs font-bold text-emerald-800 shadow-2xs">
                      {shortDate(column.date)}
                    </span>
                  ) : (
                    <span className="inline-block rounded-lg border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700 tabular shadow-2xs">
                      {shortDate(column.date)}
                    </span>
                  )}
                  <span className="block mt-0.5 text-[11px] font-normal text-slate-500">
                    {column.isCurrentVisit ? 'this visit' : `${column.reportIds.length} report${column.reportIds.length === 1 ? '' : 's'}`}
                  </span>
                </th>
              ))}
            </tr>
          </thead>

          <tbody>
            {filteredGroups.map((group) => {
              const open = isOpen(group.id);
              const flagged = group.rows.filter((row) => row.needsReview).length;
              const changed = group.rows.filter((row) => row.change.direction !== 'flat').length;
              return (
                <Fragment key={group.id}>
                  <tr className={`border-t border-slate-200 transition-colors ${getGroupStyle(group.id)}`}>
                    <td colSpan={colSpan} className="p-0">
                      <button
                        type="button"
                        onClick={() => toggleGroup(group.id)}
                        aria-expanded={open}
                        disabled={filter !== 'all'}
                        className="flex w-full items-center gap-2 px-5 py-2 text-left disabled:cursor-default"
                      >
                        <Icon
                          name="chevronDown"
                          size={14}
                          className={`text-slate-500 transition-transform ${open ? '' : '-rotate-90'}`}
                        />
                        <span className="font-display text-label-lg font-bold text-slate-900">{group.label}</span>
                        <span className="text-body-sm text-slate-500">
                          · {group.rows.length} test{group.rows.length === 1 ? '' : 's'}
                        </span>
                        {flagged > 0 && (
                          <span className="rounded-full bg-amber-500 text-white font-bold px-2 py-0.5 text-xs shadow-2xs">
                            {flagged} to review
                          </span>
                        )}
                        {changed > 0 && (
                          <span className="rounded-full bg-sky-100 text-sky-800 border border-sky-200 font-semibold px-2 py-0.5 text-xs">
                            {changed} changed
                          </span>
                        )}
                        {!open && flagged === 0 && changed === 0 && (
                          <span className="text-body-sm text-slate-400">— all unchanged</span>
                        )}
                      </button>
                    </td>
                  </tr>

                  {open &&
                    group.rows.map((row) => (
                      <HistoryRow
                        key={row.key}
                        row={row}
                        columns={shown}
                        start={start}
                        patientId={patientId}
                        expanded={expandedRow === row.key}
                        onToggle={() => setExpandedRow((current) => (current === row.key ? null : row.key))}
                        onShowSource={(cell) => setPreview({ ...cell, name: row.name, standardKey: row.standardKey, rowKey: row.key })}
                        colSpan={colSpan}
                      />
                    ))}
                </Fragment>
              );
            })}
            {filteredGroups.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-5 py-8 text-center text-body-sm text-ink-3">
                  {filter === 'review' ? 'Nothing needs review.' : 'Nothing changed since the last report.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}

      <SourcePreview
        item={preview}
        onClose={() => setPreview(null)}
        onResolve={
          onResolve && preview?.needsReview
            ? (value) =>
                onResolve(
                  { id: preview.metricId, metricId: preview.metricId, standardKey: preview.standardKey ?? '', metricKey: preview.rowKey },
                  value
                )
            : undefined
        }
      />
    </section>
  );
}

function HistoryRow({ row, columns, start, patientId, expanded, onToggle, onShowSource, colSpan }) {
  const { series, loading } = useMetricTrend({
    standardKey: row.standardKey,
    patientId,
    enabled: expanded,
    seed: row.series,
  });

  // The arrow sits on the newest reading the change was measured from.
  const newestIndex = row.cells.findIndex((cell) => cell?.number != null && !cell.needsReview);
  const { direction, pct, since } = row.change;
  const changeLabel =
    direction === 'flat' ? null : `${pct > 0 ? '+' : ''}${Math.round(pct * 100)}% since ${shortDate(since)}`;

  return (
    <>
      <tr
        className={`group cursor-pointer border-t border-slate-100 transition-colors hover:bg-indigo-50/30 ${
          expanded ? 'bg-slate-50/80' : ''
        } ${row.needsReview ? 'bg-amber-50/30' : ''}`}
        onClick={onToggle}
      >
        <td className="py-2.5 pl-5 pr-2 align-middle">
          <button
            type="button"
            onClick={(event) => {
              event.stopPropagation();
              onToggle();
            }}
            aria-expanded={expanded}
            className="flex w-full min-w-0 items-center gap-1.5 text-left text-body-md text-ink group-hover:text-indigo-950"
            title={row.name}
          >
            <Icon
              name="chevronRight"
              size={13}
              className={`shrink-0 text-slate-400 transition-transform group-hover:text-indigo-600 ${expanded ? 'rotate-90' : ''}`}
            />
            <span className="truncate font-medium">
              {row.name}
              {row.unit && <span className="ml-1.5 text-body-sm text-slate-400 font-normal">({row.unit})</span>}
            </span>
          </button>
        </td>

        {columns.map((column, i) => {
          const index = start + i;
          // The last date column carries the card's right padding now the trend column is gone.
          const pad = i === columns.length - 1 ? 'pl-2 pr-5' : 'px-2';
          const cell = row.cells[index];
          if (!cell) {
            return (
              <td key={column.key} className={`${pad} py-2.5 text-right text-body-sm text-ink-3`}>
                —
              </td>
            );
          }

          // Every value opens the line of the report it was read from.
          const openSource = (event) => {
            event.stopPropagation();
            onShowSource(cell);
          };

          if (cell.needsReview) {
            return (
              <td key={column.key} className={`${pad} py-2.5 text-right`}>
                <button
                  type="button"
                  onClick={openSource}
                  aria-haspopup="dialog"
                  title={`${cell.reason} Click to see it on the report.`}
                  className="inline-flex max-w-full items-center gap-1 truncate rounded-md border border-terracotta-border bg-terracotta-surface px-1.5 py-0.5 text-body-sm tabular text-terracotta hover:border-terracotta"
                >
                  <span className="truncate">{formatValue(cell.value)}</span>
                  <span className="font-semibold">?</span>
                </button>
              </td>
            );
          }

          const isNewest = index === newestIndex;
          const band = !cell.needsReview ? getClinicalBand(row.standardKey, cell.number, cell.value) : 'normal';

          let cellClass = 'tabular rounded px-2 py-0.5 transition-colors ';
          if (band === 'critical') {
            cellClass += 'bg-rose-50 border border-rose-300 text-rose-700 font-bold shadow-2xs hover:bg-rose-100 ';
          } else if (band === 'warning') {
            cellClass += 'bg-amber-50 border border-amber-300 text-amber-800 font-semibold shadow-2xs hover:bg-amber-100 ';
          } else {
            cellClass += isNewest
              ? 'font-display text-label-lg text-ink hover:bg-slate-100 '
              : 'text-body-sm text-slate-700 hover:bg-slate-100 ';
          }

          return (
            <td key={column.key} className={`${pad} py-2.5 text-right`}>
              <button
                type="button"
                onClick={openSource}
                aria-haspopup="dialog"
                className={cellClass}
                title={`${isNewest && changeLabel ? `${changeLabel}. ` : ''}Click to see it on the report.`}
              >
                {formatValue(cell.value)}
                {isNewest && direction !== 'flat' && (
                  <span
                    className={`ml-1 text-[11px] font-bold ${direction === 'up' ? 'text-rose-600' : 'text-emerald-600'}`}
                    aria-label={changeLabel}
                  >
                    {direction === 'up' ? '▲' : '▼'}
                  </span>
                )}
              </button>
            </td>
          );
        })}
      </tr>

      {expanded && (
        <tr className="border-t border-slate-200 bg-slate-50/50">
          <td colSpan={colSpan} className="px-5 py-4">
            <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-xs">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-lg bg-indigo-50 text-indigo-600">
                  <Icon name="history" size={14} />
                </span>
                <h4 className="font-display text-label-lg font-bold text-slate-900">{row.name} — history</h4>
                {changeLabel && (
                  <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-xs font-semibold text-slate-700">
                    {changeLabel}
                  </span>
                )}
                {loading && <span className="text-body-sm text-slate-400">loading…</span>}
              </div>
              <TrendChart series={series} unit={row.unit} />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export default HistoryGrid;
