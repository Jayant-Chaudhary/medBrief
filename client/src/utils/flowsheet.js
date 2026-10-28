/**
 * The clinician's history grid ("flowsheet"): one row per test, one column per
 * report date, so every earlier reading sits beside the latest one.
 *
 * Pure functions over the lab-report rows the API returns, kept free of React
 * and fetch so they can be checked against real data in isolation.
 */

import { fileKindOf } from './sourceCrop.js';

/** Mirrors OCR_CONFIDENCE_REVIEW_THRESHOLD on the server, for wording only. */
export const REVIEW_CONFIDENCE = 0.85;

/** Smaller moves than this are noise between labs, not a change worth an arrow. */
export const SIGNIFICANT_CHANGE = 0.1;

/** Panels in the order a clinician reads a report; anything else goes last. */
const GROUP_ORDER = [
  ['blood', 'Blood count'],
  ['liver', 'Liver function'],
  ['protein', 'Proteins'],
  ['kidney', 'Kidney function'],
  ['electrolyte', 'Electrolytes'],
  ['lipid', 'Lipid profile'],
  ['metabolic', 'Diabetes and metabolic'],
  ['pancreas', 'Pancreas'],
  ['thyroid', 'Thyroid'],
  ['hormone', 'Hormones'],
  ['nutrient', 'Vitamins and minerals'],
  ['urine', 'Urine'],
  ['cardiac', 'Cardiac'],
  ['inflammation', 'Inflammation'],
  ['coagulation', 'Coagulation'],
  ['vitals', 'Vitals'],
];
const OTHER_GROUP = ['other', 'Other tests'];

/** Grouping key for a metric: its dictionary key, or its printed name. */
export function metricKey(metric) {
  return metric.standard_key ?? `raw:${(metric.raw_key ?? '').trim().toLowerCase()}`;
}

/**
 * Why a value was sent to review, most specific cause first — the same
 * checks the server's standardizer applies when it sets needs_review.
 */
export function reviewReason(metric) {
  const raw = String(metric.raw_value ?? '').trim();

  if (/^[<>≤≥]/.test(raw)) {
    return `Printed as a limit (${raw}), not an exact value.`;
  }
  // Ranges and word results ("2-4", "Negative") are fine on their own, so a
  // flag on one of them can only be about how confidently it was read.
  if (typeof metric.confidence_score === 'number' && metric.confidence_score < REVIEW_CONFIDENCE) {
    return `OCR confidence is below ${Math.round(REVIEW_CONFIDENCE * 100)}%.`;
  }
  if (metric.parsed_value == null) {
    return raw ? `Could not read a number from "${raw}".` : 'No value was found next to this test.';
  }
  if (metric.standard_key && metric.unit_raw && metric.unit_standard) {
    return `Unit "${metric.unit_raw}" could not be converted to ${metric.unit_standard}.`;
  }
  if (!metric.standard_key) return 'Test name did not match the metric dictionary.';
  return 'Value could not be read confidently.';
}

function dayKey(date) {
  const d = new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function numeric(metric) {
  const value = metric.reviewed_value ?? metric.parsed_value;
  return value == null || Number.isNaN(Number(value)) ? null : Number(value);
}

/** Latest reading against the one before it; flat under SIGNIFICANT_CHANGE. */
function changeOf(cells) {
  const readings = cells.filter((cell) => cell?.number != null && !cell.needsReview);
  if (readings.length < 2) return { direction: 'flat', pct: null, since: null };

  const [latest, previous] = readings;
  if (previous.number === 0) return { direction: 'flat', pct: null, since: previous.date };

  const pct = (latest.number - previous.number) / Math.abs(previous.number);
  const direction = Math.abs(pct) < SIGNIFICANT_CHANGE ? 'flat' : pct > 0 ? 'up' : 'down';
  return { direction, pct, since: previous.date };
}

/**
 * @param {object[]} reports             lab_reports rows with lab_report_metrics
 * @param {string}   [currentAppointmentId] marks the columns from this visit
 * @returns {{ columns, groups, rowCount, changedCount, reviewCount }}
 *   columns: newest first, one per calendar day (same-day reports merge)
 *   groups:  [{ id, label, rows }] in GROUP_ORDER
 *   row:     { key, name, unit, standardKey, cells[], change, needsReview, series }
 *   cell:    null | { value, number, needsReview, reason, confidence, metricId,
 *                     reportId, scanUrl, date }
 */
export function buildFlowsheet(reports = [], currentAppointmentId = null) {
  // Columns: one per report day, newest first.
  const columnsByDay = new Map();
  for (const report of reports) {
    const date = report.report_date ?? report.uploaded_at;
    if (!date) continue;
    const key = dayKey(date);
    const column = columnsByDay.get(key) ?? { key, date, reportIds: [], isCurrentVisit: false };
    column.reportIds.push(report.id);
    if (
      currentAppointmentId &&
      (report.appointment_id === currentAppointmentId ||
        (report.shared_appointment_ids ?? []).includes(currentAppointmentId))
    ) {
      column.isCurrentVisit = true;
    }
    columnsByDay.set(key, column);
  }
  const columns = [...columnsByDay.values()].sort((a, b) => new Date(b.date) - new Date(a.date));
  const columnIndex = new Map(columns.map((column, index) => [column.key, index]));

  // Rows: one per test, a cell per column.
  const rows = new Map();
  for (const report of reports) {
    const date = report.report_date ?? report.uploaded_at;
    if (!date) continue;
    const col = columnIndex.get(dayKey(date));

    for (const metric of report.lab_report_metrics ?? []) {
      const key = metricKey(metric);
      const row = rows.get(key) ?? {
        key,
        name: metric.metric_dictionary?.display_name ?? metric.raw_key,
        unit: metric.unit_standard ?? metric.unit_raw ?? '',
        standardKey: metric.standard_key ?? null,
        category: metric.metric_dictionary?.category ?? null,
        cells: columns.map(() => null),
      };

      const needsReview = Boolean(metric.needs_review);
      const cell = {
        value: metric.reviewed_value ?? metric.parsed_value ?? metric.raw_value ?? null,
        number: numeric(metric),
        needsReview,
        reason: needsReview ? reviewReason(metric) : null,
        confidence: metric.confidence_score ?? null,
        metricId: metric.id,
        reportId: report.id,
        scanUrl: report.signed_url ?? null,
        // Where the value is printed, for the source preview (null on reports
        // stored before locations were recorded).
        sourcePage: metric.source_page ?? null,
        sourceBox: metric.source_box ?? null,
        fileKind: fileKindOf(report.storage_path),
        printed: [metric.raw_value, metric.unit_raw].filter(Boolean).join(' '),
        date,
      };

      // Two reports on one day with the same test: prefer the one that
      // does not need review, so a clean reading is what the grid shows.
      const existing = row.cells[col];
      if (!existing || (existing.needsReview && !needsReview)) row.cells[col] = cell;
      rows.set(key, row);
    }
  }

  // Finish rows and bucket them into panels.
  const buckets = new Map();
  let changedCount = 0;
  let reviewCount = 0;
  for (const row of rows.values()) {
    row.change = changeOf(row.cells);
    row.needsReview = row.cells.some((cell) => cell?.needsReview);
    // Oldest -> newest numeric readings, for the sparkline.
    row.series = row.cells
      .filter((cell) => cell?.number != null && !cell.needsReview)
      .map((cell) => ({ date: cell.date, value: cell.number }))
      .reverse();
    if (row.change.direction !== 'flat') changedCount += 1;
    if (row.needsReview) reviewCount += 1;

    const [groupId] = GROUP_ORDER.find(([id]) => id === row.category) ?? OTHER_GROUP;
    if (!buckets.has(groupId)) buckets.set(groupId, []);
    buckets.get(groupId).push(row);
  }

  const groups = [...GROUP_ORDER, OTHER_GROUP]
    .filter(([id]) => buckets.has(id))
    .map(([id, label]) => ({ id, label, rows: buckets.get(id) }));

  return { columns, groups, rowCount: rows.size, changedCount, reviewCount };
}
