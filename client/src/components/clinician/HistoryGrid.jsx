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
    <section className="card flex min-h-0 flex-col">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-3 border-b border-line px-5 py-4">
        <div className="flex min-w-0 items-start gap-3">
          <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-subcanvas text-cypress">
            <Icon name="chart" size={16} />
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-head-sm text-ink">Clinical data</h2>
            <p className="mt-0.5 text-body-sm text-ink-3">
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
              className={`rounded-full border px-3 py-1 text-label-md transition-colors ${
                filter === id
                  ? id === 'review'
                    ? 'border-terracotta-border bg-terracotta-surface text-terracotta'
                    : 'border-cypress bg-cypress text-white'
                  : 'border-line text-ink-2 hover:bg-subcanvas'
              }`}
            >
              {label}
              {id !== 'all' && <span className="ml-1 tabular opacity-80">{counts[id]}</span>}
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
                  <span className="block tabular text-ink-2">{shortDate(column.date)}</span>
                  <span className="block text-[11px] font-normal text-ink-3">
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
                  <tr className="border-t border-line bg-subcanvas">
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
                          className={`text-ink-3 transition-transform ${open ? '' : '-rotate-90'}`}
                        />
                        <span className="font-display text-label-lg text-ink">{group.label}</span>
                        <span className="text-body-sm text-ink-3">
                          · {group.rows.length} test{group.rows.length === 1 ? '' : 's'}
                        </span>
                        {flagged > 0 && (
                          <span className="rounded-full bg-terracotta-surface px-2 py-0.5 text-label-sm text-terracotta">
                            {flagged} to review
                          </span>
                        )}
                        {changed > 0 && <span className="text-body-sm text-ink-2">{changed} changed</span>}
                        {!open && flagged === 0 && changed === 0 && (
                          <span className="text-body-sm text-ink-3">— all unchanged</span>
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
        className={`cursor-pointer border-t border-line transition-colors hover:bg-subcanvas/60 ${
          expanded ? 'bg-subcanvas/60' : ''
        } ${row.needsReview ? 'bg-terracotta-surface/40' : ''}`}
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
            className="flex w-full min-w-0 items-center gap-1.5 text-left text-body-md text-ink hover:text-cypress"
            title={row.name}
          >
            <Icon
              name="chevronRight"
              size={13}
              className={`shrink-0 text-ink-3 transition-transform ${expanded ? 'rotate-90' : ''}`}
            />
            <span className="truncate">
              {row.name}
              {row.unit && <span className="ml-1.5 text-body-sm text-ink-3">{row.unit}</span>}
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
          return (
            <td key={column.key} className={`${pad} py-2.5 text-right`}>
              <button
                type="button"
                onClick={openSource}
                aria-haspopup="dialog"
                className={`tabular rounded px-1 underline-offset-4 hover:bg-subcanvas hover:underline ${
                  isNewest ? 'font-display text-label-lg text-ink' : 'text-body-sm text-ink-2'
                }`}
                title={`${isNewest && changeLabel ? `${changeLabel}. ` : ''}Click to see it on the report.`}
              >
                {formatValue(cell.value)}
                {isNewest && direction !== 'flat' && (
                  <span
                    className={`ml-1 text-[11px] ${direction === 'up' ? 'text-terracotta' : 'text-cypress'}`}
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
        <tr className="border-t border-line bg-subcanvas/40">
          <td colSpan={colSpan} className="px-5 py-4">
            <div className="rounded-xl border border-line bg-surface p-4">
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <Icon name="history" size={15} className="text-ink-3" />
                <h4 className="font-display text-label-lg text-ink">{row.name} — history</h4>
                {changeLabel && <span className="text-body-sm text-ink-2">{changeLabel}</span>}
                {loading && <span className="text-body-sm text-ink-3">loading…</span>}
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
