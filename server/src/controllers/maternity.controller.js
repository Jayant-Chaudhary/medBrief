const supabaseAdmin = require('../config/supabaseAdminClient');
const { clinicianHasPatient } = require('../services/access.service');
const { importReportValues } = require('../services/maternityLabImport.service');

/**
 * The maternity card, stored per pregnancy ("episode").
 *
 * The API speaks the card's own field names. Which column each one lives in
 * is listed once below, so the card and the schema can be read side by side.
 */
const PATIENT_FIELDS = {
  attendance: 'first_anc_date',
  lmp: 'last_menstrual_period',
  edd: 'due_date',
  gravida: 'gravida',
  para: 'para',
  living: 'living',
  abortions: 'abortions',
  history: 'history_notes',
};
const BASELINE_FIELDS = { blood: 'blood_group', chest: 'chest_history', cvs: 'cvs_history' };
const EPISODE_FIELDS = { ...PATIENT_FIELDS, ...BASELINE_FIELDS };

// The first-attendance Hb, TSH and free-text results are investigation rows.
const BASELINE_TESTS = [
  { field: 'hb', key: 'hemoglobin', name: 'Hb', unit: 'g/dL', numeric: true },
  { field: 'tsh', key: 'tsh', name: 'TSH', unit: 'mIU/L', numeric: true },
  { field: 'results', key: 'other_results', name: 'Other results' },
];

const DELIVERY_FIELDS = {
  type: 'delivery_type',
  when: 'delivered_at',
  indication: 'indication',
  sex: 'baby_sex',
  weight: 'baby_weight_kg',
  apgar1: 'apgar_1min',
  apgar5: 'apgar_5min',
  next: 'next_visit_date',
  advice: 'postnatal_advice',
};

const NUMERIC_RESULT = /^\d+(\.\d+)?$/;

const SECTIONS = {
  visits: {
    table: 'antenatal_visits',
    order: 'visit_date',
    fields: {
      date: 'visit_date',
      weight: 'weight_kg',
      systolic: 'bp_systolic',
      diastolic: 'bp_diastolic',
      weeks: 'gestational_weeks',
      days: 'gestational_days',
      fundal: 'fundal_height_cm',
      presentation: 'present_position',
      brim: 'relation_presentation_to_brim',
      fhr: 'fetal_heart_rate',
      albumin: 'urine_albumin',
      sugar: 'urine_sugar',
      hb: 'hemoglobin_g_dl',
      tsh: 'tsh',
      next: 'next_visit_date',
      clinician: 'signature',
      advice: 'advice',
    },
  },
  labs: {
    table: 'pregnancy_investigations',
    order: 'performed_on',
    // Baseline rows share this table; the labs list never touches them.
    match: { is_baseline: false },
    // Values imported from an uploaded report are hidden, not deleted.
    hideable: true,
    describe: (row) => ({ fromReport: Boolean(row.lab_report_id) }),
    fields: { date: 'performed_on', test: 'investigation_name', result: 'result_text', unit: 'result_unit', notes: 'notes' },
    // A numeric result is also stored as a number, so it can be charted.
    derive: (values) =>
      values.result === undefined
        ? {}
        : { result_value: NUMERIC_RESULT.test(values.result) ? Number(values.result) : null },
  },
  scans: {
    table: 'pregnancy_ultrasounds',
    order: 'performed_on',
    fields: { date: 'performed_on', weeks: 'gestational_weeks', days: 'gestational_days', report: 'report_text' },
  },
  vaccines: {
    table: 'pregnancy_vaccinations',
    order: 'administered_on',
    fields: { name: 'vaccine_name', dose: 'dose_label', date: 'administered_on', next: 'next_dose_date', notes: 'notes' },
  },
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Card values -> columns. Only fields the request sent are written; '' clears one. */
function toColumns(fields, values) {
  const row = {};
  for (const [field, column] of Object.entries(fields)) {
    if (values[field] !== undefined) row[column] = values[field] === '' ? null : values[field];
  }
  return row;
}

/** Columns -> card values, as the strings the card's inputs hold. */
function toCard(fields, row) {
  const card = {};
  for (const [field, column] of Object.entries(fields)) {
    const value = row?.[column];
    card[field] = value == null ? '' : String(value);
  }
  return card;
}

/** One section row as the card holds it: its fields, plus any section extras. */
function rowToCard(section, row) {
  return { id: row.id, ...toCard(section.fields, row), ...(section.describe ? section.describe(row) : {}) };
}

let hasDismissedAt = process.env.NODE_ENV === 'test';
if (process.env.NODE_ENV !== 'test') {
  supabaseAdmin
    .from('pregnancy_investigations')
    .select('dismissed_at')
    .limit(1)
    .then(({ error }) => {
      hasDismissedAt = !error;
    })
    .catch(() => {
      hasDismissedAt = false;
    });
}

/** A section's visible rows: hidden imported values are left out. */
function visibleRows(section, query) {
  let scoped = query;
  if (section.match) scoped = scoped.match(section.match);
  if (section.hideable && hasDismissedAt) scoped = scoped.is('dismissed_at', null);
  return scoped;
}

function ageFrom(dateOfBirth) {
  const born = dateOfBirth ? new Date(dateOfBirth) : null;
  if (!born || Number.isNaN(born.getTime())) return '';
  const now = new Date();
  let age = now.getFullYear() - born.getFullYear();
  const beforeBirthday =
    now.getMonth() < born.getMonth() || (now.getMonth() === born.getMonth() && now.getDate() < born.getDate());
  if (beforeBirthday) age -= 1;
  return String(age);
}

/**
 * Every route runs on the service-role key, which bypasses row level
 * security, so the clinician must be shown to treat this patient first.
 */
async function patientAccess(req) {
  const { patientId } = req.params;
  if (!UUID.test(patientId)) return { ok: false, status: 400, error: 'Invalid patient id' };
  if (!(await clinicianHasPatient(req.user.id, patientId))) {
    return { ok: false, status: 403, error: 'Not authorized for this patient' };
  }
  return { ok: true, patientId };
}

/** The clinician's ongoing pregnancy card for this patient, or null. */
async function findEpisode(patientId, clinicianId) {
  const { data, error } = await supabaseAdmin
    .from('pregnancy_episodes')
    .select('*')
    .eq('patient_id', patientId)
    .eq('clinician_id', clinicianId)
    .eq('status', 'ongoing')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

/** The ongoing card, started on the first save rather than on first view. */
async function ensureEpisode(patientId, clinicianId) {
  const existing = await findEpisode(patientId, clinicianId);
  if (existing) return existing;

  const { data, error } = await supabaseAdmin
    .from('pregnancy_episodes')
    .insert({ patient_id: patientId, clinician_id: clinicianId })
    .select()
    .single();
  if (error) throw error;
  return data;
}

function deliveryToCard(row) {
  const card = toCard(DELIVERY_FIELDS, row);
  // The card's datetime input takes "YYYY-MM-DDTHH:MM".
  card.when = card.when.slice(0, 16);
  return card;
}

/** GET /api/maternity/:patientId — the whole card, empty if none was started. */
async function getCard(req, res, next) {
  try {
    const access = await patientAccess(req);
    if (!access.ok) return res.status(access.status).json({ error: access.error });
    const { patientId } = access;

    const [profileResult, detailsResult, episode] = await Promise.all([
      supabaseAdmin.from('profiles').select('full_name, phone').eq('id', patientId).maybeSingle(),
      supabaseAdmin.from('patient_details').select('date_of_birth').eq('profile_id', patientId).maybeSingle(),
      findEpisode(patientId, req.user.id),
    ]);
    if (profileResult.error) throw profileResult.error;
    if (detailsResult.error) throw detailsResult.error;

    const stored = toCard(EPISODE_FIELDS, episode);
    const card = {
      episodeId: episode?.id ?? null,
      // Name, phone and age come from the patient's account, not the card.
      patient: {
        name: profileResult.data?.full_name ?? '',
        id: patientId,
        phone: profileResult.data?.phone ?? '',
        age: ageFrom(detailsResult.data?.date_of_birth),
        ...toCard(PATIENT_FIELDS, episode),
      },
      investigations: {
        blood: stored.blood.replace('-', '−'),
        chest: stored.chest,
        cvs: stored.cvs,
        hb: '',
        tsh: '',
        results: '',
        resultsDate: '',
      },
      delivery: deliveryToCard(null),
      visits: [],
      labs: [],
      scans: [],
      vaccines: [],
      // Lab values only join a card once one has been started.
      labImport: { status: 'no_card', added: 0 },
    };

    if (!episode) return res.json(card);

    // New confirmed values from shared reports become new rows before the card is read.
    card.labImport = await importReportValues({ episode, patientId, clinicianId: req.user.id });

    const [baselineResult, deliveryResult, ...lists] = await Promise.all([
      supabaseAdmin
        .from('pregnancy_investigations')
        .select('investigation_key, result_text, performed_on')
        .eq('pregnancy_episode_id', episode.id)
        .eq('is_baseline', true),
      supabaseAdmin.from('pregnancy_deliveries').select('*').eq('pregnancy_episode_id', episode.id).maybeSingle(),
      ...Object.values(SECTIONS).map((section) =>
        visibleRows(
          section,
          supabaseAdmin.from(section.table).select('*').eq('pregnancy_episode_id', episode.id)
        ).order(section.order, { ascending: true })
      ),
    ]);

    if (baselineResult.error) throw baselineResult.error;
    for (const row of baselineResult.data || []) {
      const test = BASELINE_TESTS.find((t) => t.key === row.investigation_key);
      if (test) card.investigations[test.field] = row.result_text ?? '';
      if (row.performed_on) card.investigations.resultsDate = row.performed_on;
    }

    if (deliveryResult.error) throw deliveryResult.error;
    card.delivery = deliveryToCard(deliveryResult.data);

    Object.entries(SECTIONS).forEach(([name, section], i) => {
      if (lists[i].error) throw lists[i].error;
      card[name] = (lists[i].data || []).map((row) => rowToCard(section, row));
    });

    res.json(card);
  } catch (err) {
    next(err);
  }
}

/**
 * POST /api/maternity/:patientId/import-reports — pull in values from reports
 * shared since the card was opened, and return the investigations list.
 */
async function importReports(req, res, next) {
  try {
    const access = await patientAccess(req);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const episode = await findEpisode(access.patientId, req.user.id);
    if (!episode) {
      return res.json({ labImport: { status: 'no_card', added: 0 }, labs: [] });
    }

    const labImport = await importReportValues({ episode, patientId: access.patientId, clinicianId: req.user.id });
    const section = SECTIONS.labs;
    const { data, error } = await visibleRows(
      section,
      supabaseAdmin.from(section.table).select('*').eq('pregnancy_episode_id', episode.id)
    ).order(section.order, { ascending: true });
    if (error) throw error;

    res.json({ labImport, labs: (data || []).map((row) => rowToCard(section, row)) });
  } catch (err) {
    next(err);
  }
}

/** Baseline Hb / TSH / other results: one investigation row each, '' removes it. */
async function saveBaseline(episodeId, values, userId) {
  const { data: existing, error } = await supabaseAdmin
    .from('pregnancy_investigations')
    .select('id, investigation_key')
    .eq('pregnancy_episode_id', episodeId)
    .eq('is_baseline', true);
  if (error) throw error;
  const idByKey = new Map((existing || []).map((row) => [row.investigation_key, row.id]));

  for (const test of BASELINE_TESTS) {
    const value = values[test.field];
    if (value === undefined) continue;
    const id = idByKey.get(test.key);

    if (value === '') {
      if (id) {
        const { error: deleteError } = await supabaseAdmin.from('pregnancy_investigations').delete().eq('id', id);
        if (deleteError) throw deleteError;
      }
      continue;
    }

    const row = {
      investigation_name: test.name,
      result_text: value,
      result_value: test.numeric ? Number(value) : null,
      result_unit: test.unit ?? null,
      performed_on: values.resultsDate || null,
    };
    const { error: writeError } = id
      ? await supabaseAdmin.from('pregnancy_investigations').update(row).eq('id', id)
      : await supabaseAdmin.from('pregnancy_investigations').insert({
          ...row,
          pregnancy_episode_id: episodeId,
          investigation_key: test.key,
          is_baseline: true,
          created_by: userId,
        });
    if (writeError) throw writeError;
  }
}

/** PUT /api/maternity/:patientId — patient details and baseline. */
async function saveEpisode(req, res, next) {
  try {
    const access = await patientAccess(req);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const episode = await ensureEpisode(access.patientId, req.user.id);
    const changes = toColumns(EPISODE_FIELDS, req.validated);
    if (Object.keys(changes).length > 0) {
      const { error } = await supabaseAdmin.from('pregnancy_episodes').update(changes).eq('id', episode.id);
      if (error) throw error;
    }
    await saveBaseline(episode.id, req.validated, req.user.id);

    res.json({ episodeId: episode.id });
  } catch (err) {
    next(err);
  }
}

/** PUT /api/maternity/:patientId/delivery — one delivery record per pregnancy. */
async function saveDelivery(req, res, next) {
  try {
    const access = await patientAccess(req);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const episode = await ensureEpisode(access.patientId, req.user.id);
    const { data, error } = await supabaseAdmin
      .from('pregnancy_deliveries')
      .upsert(
        { ...toColumns(DELIVERY_FIELDS, req.validated), pregnancy_episode_id: episode.id, updated_by: req.user.id },
        { onConflict: 'pregnancy_episode_id' }
      )
      .select()
      .single();
    if (error) throw error;

    res.json(deliveryToCard(data));
  } catch (err) {
    next(err);
  }
}

/** POST /api/maternity/:patientId/:section — add a visit, test, scan or vaccine. */
async function addRow(req, res, next) {
  try {
    const section = SECTIONS[req.params.section];
    const access = await patientAccess(req);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const episode = await ensureEpisode(access.patientId, req.user.id);
    const { data, error } = await supabaseAdmin
      .from(section.table)
      .insert({
        ...toColumns(section.fields, req.validated),
        ...(section.derive ? section.derive(req.validated) : {}),
        ...(section.match || {}),
        pregnancy_episode_id: episode.id,
        created_by: req.user.id,
      })
      .select()
      .single();
    if (error) throw error;

    res.status(201).json(rowToCard(section, data));
  } catch (err) {
    next(err);
  }
}

/**
 * The section and episode a row request is about. A row is only reachable
 * through the clinician's own ongoing card, so another card's row id is a 404.
 */
async function rowScope(req) {
  const section = SECTIONS[req.params.section];
  if (!section) return { ok: false, status: 404, error: 'Unknown card section' };

  const access = await patientAccess(req);
  if (!access.ok) return access;

  const episode = await findEpisode(access.patientId, req.user.id);
  if (!episode) return { ok: false, status: 404, error: 'No maternity card for this patient yet' };

  return { ok: true, section, episode };
}

function scopedRow(query, scope, rowId) {
  return visibleRows(scope.section, query.eq('id', rowId).eq('pregnancy_episode_id', scope.episode.id));
}

/** PATCH /api/maternity/:patientId/:section/:rowId */
async function updateRow(req, res, next) {
  try {
    const scope = await rowScope(req);
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
    if (!UUID.test(req.params.rowId)) return res.status(404).json({ error: 'Entry not found' });

    const { section } = scope;
    const changes = {
      ...toColumns(section.fields, req.validated),
      ...(section.derive ? section.derive(req.validated) : {}),
    };
    const { data, error } = await scopedRow(supabaseAdmin.from(section.table).update(changes), scope, req.params.rowId)
      .select()
      .maybeSingle();
    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Entry not found' });

    res.json(rowToCard(section, data));
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /api/maternity/:patientId/:section/:rowId
 *
 * A value imported from a report is hidden instead, so the next import does
 * not bring it back. Anything typed in by hand is deleted.
 */
async function deleteRow(req, res, next) {
  try {
    const scope = await rowScope(req);
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
    if (!UUID.test(req.params.rowId)) return res.status(404).json({ error: 'Entry not found' });

    if (scope.section.hideable && hasDismissedAt) {
      const { data: hidden, error: hideError } = await scopedRow(
        supabaseAdmin.from(scope.section.table).update({ dismissed_at: new Date().toISOString() }),
        scope,
        req.params.rowId
      )
        .not('lab_report_id', 'is', null)
        .select('id');
      if (hideError) throw hideError;
      if (hidden && hidden.length > 0) return res.status(204).send();
    }

    const { data, error } = await scopedRow(supabaseAdmin.from(scope.section.table).delete(), scope, req.params.rowId)
      .select('id');
    if (error) throw error;
    if (!data || data.length === 0) return res.status(404).json({ error: 'Entry not found' });

    res.status(204).send();
  } catch (err) {
    next(err);
  }
}

module.exports = { getCard, importReports, saveEpisode, saveDelivery, addRow, updateRow, deleteRow };
