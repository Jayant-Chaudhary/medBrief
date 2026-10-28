const supabaseAdmin = require('../config/supabaseAdminClient');
const { reportIdsSharedWithClinician } = require('./reportSharing.service');
const log = require('../utils/logger').child({ scope: 'maternity-lab-import' });

/**
 * Copies confirmed values from the patient's lab reports onto the maternity
 * card's investigations.
 *
 * Every rule here is about not putting a wrong value on a pregnancy record:
 *
 * - Only reports the patient shared with this clinician's visits are read,
 *   the same rule as the history grid.
 * - A value still waiting in the triage queue is skipped until the clinician
 *   confirms it; it joins the card on the next import.
 * - The test is dated by the date printed on the report. When none was read,
 *   the upload date stands in and the row says so.
 * - Only tests taken during this pregnancy count: from the LMP (or EDD − 280
 *   days) to six weeks after delivery. Without an LMP or EDD nothing is
 *   imported, because there is no way to tell which reports belong to it.
 * - Each report adds its own new rows. Nothing already on the card is
 *   changed, and a value the clinician removed is never brought back.
 */

// Tests worth carrying onto an antenatal card. A full blood count alone
// prints about twenty values; only these reach the investigations box.
const PREGNANCY_TESTS = new Set([
  'hemoglobin', 'hematocrit', 'platelets', 'wbc',
  'blood_glucose_fasting', 'blood_glucose_pp', 'blood_glucose_random', 'hba1c',
  'tsh', 't3_free', 't4_free', 't4_total',
  'ferritin', 'iron', 'folate', 'vitamin_b12', 'vitamin_d', 'calcium',
  'creatinine', 'urea', 'uric_acid',
  'alt', 'ast', 'bilirubin_total', 'ldh',
  'urine_protein', 'urine_glucose', 'urine_ketones', 'urine_pus_cells',
  'urine_protein_creatinine_ratio', 'urine_acr',
  'beta_hcg', 'progesterone',
]);

const POSTNATAL_DAYS = 42;
const CLINIC_TIME_ZONE = process.env.CLINIC_TIME_ZONE || 'Asia/Kolkata';

function shiftDate(isoDate, days) {
  const date = new Date(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** A timestamp as the calendar date at the clinic (an upload at 2 a.m. IST is that day, not the day before). */
function clinicDate(timestamp) {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleDateString('en-CA', { timeZone: CLINIC_TIME_ZONE });
}

/** The dates this pregnancy covers, or null when neither LMP nor EDD is known. */
function pregnancyWindow(episode, deliveredAt) {
  const start = episode.last_menstrual_period || (episode.due_date ? shiftDate(episode.due_date, -280) : null);
  if (!start) return null;
  const today = clinicDate(Date.now());
  const delivered = deliveredAt ? clinicDate(deliveredAt) : null;
  const end = delivered ? shiftDate(delivered, POSTNATAL_DAYS) : today;
  // A date in the future is an OCR misread, never a real test.
  return { start, end: end < today ? end : today };
}

/** The value a confirmed metric stands for, in the unit it is stored in. */
function confirmedValue(metric) {
  const reviewed = metric.reviewed_by != null;
  if (metric.needs_review && !reviewed) return null;

  const numeric = reviewed && metric.reviewed_value != null ? metric.reviewed_value : metric.parsed_value;
  if (numeric != null) {
    return { text: String(numeric), value: Number(numeric), unit: metric.unit_standard || metric.unit_raw || null };
  }
  // Word results ("Negative", "2+") are readings in their own right.
  const printed = String(metric.raw_value ?? '').trim();
  return printed ? { text: printed, value: null, unit: metric.unit_raw || null } : null;
}

/**
 * @returns {Promise<{status: 'imported'|'needs_dates', added: number}>}
 */
async function importReportValues({ episode, patientId, clinicianId }) {
  const { data: delivery, error: deliveryError } = await supabaseAdmin
    .from('pregnancy_deliveries')
    .select('delivered_at')
    .eq('pregnancy_episode_id', episode.id)
    .maybeSingle();
  if (deliveryError) throw deliveryError;

  const span = pregnancyWindow(episode, delivery?.delivered_at);
  if (!span) return { status: 'needs_dates', added: 0 };

  const sharedIds = await reportIdsSharedWithClinician(clinicianId, patientId);
  if (sharedIds.length === 0) return { status: 'imported', added: 0 };

  const [reportsResult, existingResult] = await Promise.all([
    supabaseAdmin
      .from('lab_reports')
      .select(
        `id, report_date, uploaded_at,
         lab_report_metrics ( standard_key, raw_key, raw_value, parsed_value, reviewed_value, reviewed_by,
           unit_raw, unit_standard, needs_review, metric_dictionary ( display_name ) )`
      )
      .eq('patient_id', patientId)
      .in('id', sharedIds),
    // Hidden rows count too, so a value the clinician removed stays removed.
    supabaseAdmin
      .from('pregnancy_investigations')
      .select('lab_report_id, investigation_key')
      .eq('pregnancy_episode_id', episode.id)
      .not('lab_report_id', 'is', null),
  ]);
  if (reportsResult.error) throw reportsResult.error;
  if (existingResult.error) throw existingResult.error;

  const alreadyOnCard = new Set((existingResult.data || []).map((row) => `${row.lab_report_id}|${row.investigation_key}`));
  const rows = [];

  for (const report of reportsResult.data || []) {
    const printedDate = report.report_date || null;
    const takenOn = printedDate || clinicDate(report.uploaded_at);
    if (!takenOn || takenOn < span.start || takenOn > span.end) continue;

    for (const metric of report.lab_report_metrics || []) {
      const key = metric.standard_key;
      if (!PREGNANCY_TESTS.has(key)) continue;
      // The same test twice in one report (two sections) is one entry.
      const marker = `${report.id}|${key}`;
      if (alreadyOnCard.has(marker)) continue;

      const reading = confirmedValue(metric);
      if (!reading) continue;

      alreadyOnCard.add(marker);
      rows.push({
        pregnancy_episode_id: episode.id,
        lab_report_id: report.id,
        investigation_key: key,
        investigation_name: metric.metric_dictionary?.display_name || metric.raw_key || key,
        performed_on: takenOn,
        result_text: reading.text,
        result_value: reading.value,
        result_unit: reading.unit,
        is_baseline: false,
        notes: printedDate ? 'From lab report' : 'From lab report · no date printed, upload date used',
        created_by: clinicianId,
      });
    }
  }

  if (rows.length > 0) {
    // Check current rows right before insert to prevent duplicate additions
    const { data: latestExisting, error: existingErr } = await supabaseAdmin
      .from('pregnancy_investigations')
      .select('lab_report_id, investigation_key')
      .eq('pregnancy_episode_id', episode.id)
      .not('lab_report_id', 'is', null);

    if (existingErr) throw existingErr;
    const latestSet = new Set((latestExisting || []).map((r) => `${r.lab_report_id}|${r.investigation_key}`));
    const newRows = rows.filter((r) => !latestSet.has(`${r.lab_report_id}|${r.investigation_key}`));

    if (newRows.length > 0) {
      const { error } = await supabaseAdmin.from('pregnancy_investigations').insert(newRows);
      if (error) throw error;
      log.info('imported report values onto maternity card', { episodeId: episode.id, added: newRows.length });
      return { status: 'imported', added: newRows.length };
    }
    return { status: 'imported', added: 0 };
  }

  return { status: 'imported', added: 0 };
}

module.exports = { importReportValues, PREGNANCY_TESTS, pregnancyWindow, confirmedValue };
