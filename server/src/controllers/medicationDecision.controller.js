const db = require('../config/supabaseAdminClient');
const { assertAppointmentAccess } = require('../services/access.service');
const { isDeepStrictEqual } = require('node:util');

const bad = (res, message, status = 400) => res.status(status).json({ error: message });
const includeDemoMedicationData = process.env.NODE_ENV !== 'production' && process.env.ALLOW_DEMO_MEDICATION_DATA === 'true';
function weekAt(dueDate, atDate) {
  if (!dueDate || !atDate) return null;
  const days = Math.floor((new Date(`${dueDate}T00:00:00Z`) - new Date(atDate)) / 86400000) + 280;
  return days < 0 || days > 315 ? null : Math.round((days / 7) * 10) / 10;
}
async function loadContext(appointment, clinicianId) {
  const [episodes, shared, vitals, allergyStatus, allergyRows] = await Promise.all([
    db.from('pregnancy_episodes').select('id,status,due_date,last_menstrual_period,gravida,para,history_notes,chest_history,cvs_history').eq('patient_id', appointment.patient_id).eq('clinician_id', clinicianId).eq('status', 'ongoing').order('created_at', { ascending: false }).limit(1),
    db.from('appointment_lab_reports').select('lab_report_id,lab_reports!inner(id,report_date,uploaded_at,lab_report_metrics(id,raw_key,standard_key,raw_value,parsed_value,unit_raw,unit_standard,confidence_score,needs_review,reviewed_value))').eq('appointment_id', appointment.id),
    db.from('vitals_logs').select('id,metric_key,value,unit,recorded_at,source').eq('appointment_id', appointment.id).order('recorded_at', { ascending: false }),
    db.from('patient_allergy_reviews').select('status,reviewed_at').eq('patient_id', appointment.patient_id).maybeSingle(),
    db.from('patient_allergies').select('substance_key,substance_display,reaction').eq('patient_id', appointment.patient_id),
  ]);
  for (const q of [episodes, shared, vitals, allergyStatus, allergyRows]) if (q.error) throw q.error;
  const episode = episodes.data?.[0] || null;
  const gestationalWeek = weekAt(episode?.due_date, appointment.scheduled_at);
  const labReports = (shared.data || []).map((x) => ({ reportId: x.lab_report_id, reportDate: x.lab_reports.report_date, metrics: x.lab_reports.lab_report_metrics || [] }));
  return { episode: episode && { id: episode.id, gravida: episode.gravida, para: episode.para, history: episode.history_notes, chestHistory: episode.chest_history, cvsHistory: episode.cvs_history }, gestationalWeek, labReports, vitals: vitals.data || [], allergyReview: allergyStatus.data || { status: 'not_assessed' }, allergies: allergyRows.data || [] };
}
async function loadAllergenAssociations(medicationKeys) {
  const keys = [...new Set((medicationKeys || []).filter(Boolean))];
  if (!keys.length) return {};
  let query = db.from('medication_allergen_associations').select('medication_key,allergen_key,allergen_display,association_type,source_name,source_reference').in('medication_key', keys);
  query = includeDemoMedicationData ? query.or('reviewed_at.not.is.null,source_name.like.DEMO ONLY*') : query.not('reviewed_at', 'is', null);
  const { data, error } = await query;
  if (error) throw error;
  return (data || []).reduce((out, row) => {
    (out[row.medication_key] ||= []).push({ substance_key: row.allergen_key, substance_display: row.allergen_display, association_type: row.association_type, source_name: row.source_name, source_reference: row.source_reference, is_demo: row.source_name?.startsWith('DEMO ONLY') || false });
    return out;
  }, {});
}
async function getContext(req, res, next) {
  try { const a = await assertAppointmentAccess(req.params.appointmentId, req.user); if (!a.ok) return bad(res, a.error, a.status); if (!a.appointment.patient_id) return bad(res, 'Appointment has no linked patient', 409); res.json(await loadContext(a.appointment, req.user.id)); } catch (e) { next(e); }
}
async function saveAllergies(req, res, next) {
  try {
    const access = await assertAppointmentAccess(req.params.appointmentId, req.user);
    if (!access.ok) return bad(res, access.error, access.status);
    if (!access.appointment.patient_id) return bad(res, 'Appointment has no linked patient', 409);
    const { status, allergies } = req.body || {};
    if (!['not_assessed', 'none_known', 'allergies_documented'].includes(status) || !Array.isArray(allergies) || allergies.length > 100) return bad(res, 'Invalid allergy review payload');
    if ((status === 'allergies_documented') !== (allergies.length > 0)) return bad(res, 'Allergy status must match the allergy list');
    const keys = new Set();
    for (const allergy of allergies) {
      if (!allergy || typeof allergy.substance_key !== 'string' || !/^[a-z0-9][a-z0-9._-]{0,159}$/i.test(allergy.substance_key) || typeof allergy.substance_display !== 'string' || !allergy.substance_display.trim() || allergy.substance_display.length > 200 || allergy.reaction != null && (typeof allergy.reaction !== 'string' || allergy.reaction.length > 500)) return bad(res, 'Each allergy needs a valid key, display name, and optional reaction');
      if (keys.has(allergy.substance_key)) return bad(res, 'Duplicate allergy entries are not allowed');
      keys.add(allergy.substance_key);
    }
    const { data, error } = await db.rpc('save_patient_allergies', { p_appointment_id: access.appointment.id, p_clinician_id: req.user.id, p_status: status, p_allergies: allergies });
    if (error) throw error;
    res.json(data);
  } catch (e) { next(e); }
}
async function listTemplates(req, res, next) {
  try {
    const { data, error } = await db.from('medication_templates').select('id,title,status,version,indication_display,min_gestational_week,max_gestational_week,template_content,medication_template_items(*)').eq('clinician_id', req.user.id).order('updated_at', { ascending: false });
    if (error) throw error;
    const { data: feedbackRows, error: feedbackError } = await db.from('medication_feedback_events').select('template_id,recommendation_event_id,action,created_at,final_items').eq('clinician_id', req.user.id).in('action', ['accepted', 'edited']).order('created_at', { ascending: false }).limit(500);
    if (feedbackError) throw feedbackError;
    const eventIds = [...new Set((feedbackRows || []).map(row => row.recommendation_event_id))];
    let examplesByTemplate = {};
    if (eventIds.length) {
      const { data: events, error: eventError } = await db.from('medication_recommendation_events').select('id,feature_snapshot').eq('clinician_id', req.user.id).in('id', eventIds);
      if (eventError) throw eventError;
      const snapshots = new Map((events || []).map(row => [row.id, row.feature_snapshot || {}]));
      examplesByTemplate = (feedbackRows || []).reduce((out, row) => {
        const factorSnapshot = snapshots.get(row.recommendation_event_id)?.factorSnapshot;
        if (Array.isArray(row.final_items) && row.final_items.length && factorSnapshot && Object.keys(factorSnapshot).length) (out[row.template_id] ||= []).push({ factorSnapshot, recordedAt: row.created_at, action: row.action });
        return out;
      }, {});
    }
    const keys = (data || []).flatMap(row => (row.medication_template_items || []).map(item => item.ingredient_key));
    const associations = await loadAllergenAssociations(keys);
    res.json((data || []).map((row) => {
      const content = row.template_content || {};
      const items = row.medication_template_items || [];
      const medications = (content.medications || []).map((m) => {
        const saved = items.find((item) => item.id === m.id);
        const ingredientKey = m.ingredientKey || saved?.ingredient_key || '';
        return { ...m, ingredientKey, allergyAssociations: associations[ingredientKey] || [], allergySubstanceKeys: (associations[ingredientKey] || []).map(a => a.substance_key) };
      });
      return { ...content, id: row.id, name: row.title, version: row.version, status: row.status, archived: row.status === 'archived', purpose: content.purpose ?? '', medications, similarityExamples: examplesByTemplate[row.id] || [] };
    }));
  } catch (e) { next(e); }
}
async function saveTemplate(req, res, next) {
  try {
    const template = req.body?.template;
    if (!template || typeof template !== 'object' || typeof template.name !== 'string' || !Array.isArray(template.medications) || template.medications.length > 100) return bad(res, 'Invalid template payload');
    if (JSON.stringify(template).length > 100000) return bad(res, 'Template is too large');
    if ((template.clinicianApproved != null && typeof template.clinicianApproved !== 'boolean') || (template.archived != null && typeof template.archived !== 'boolean')) return bad(res, 'Approval and archive flags must be boolean');
    // The existing database function defaults a manual template to active.
    // Require explicit approval unless it is an archived or captured draft.
    if (template.clinicianApproved !== true && template.archived !== true && !Object.prototype.hasOwnProperty.call(template, 'autoCapture')) return bad(res, 'Explicit clinician approval is required to activate a template');
    const { data, error } = await db.rpc('save_medication_template', { p_clinician_id: req.user.id, p_template: template });
    if (error) throw error;
    res.json(data);
  } catch (e) { next(e); }
}
async function getDraft(req, res, next) {
  try {
    const access = await assertAppointmentAccess(req.params.appointmentId, req.user);
    if (!access.ok) return bad(res, access.error, access.status);
    if (!access.appointment.patient_id) return bad(res, 'Appointment has no linked patient', 409);
    const { data, error } = await db.from('prescription_drafts').select('draft_content,updated_at').eq('appointment_id', access.appointment.id).eq('clinician_id', req.user.id).maybeSingle();
    if (error) throw error;
    res.json({ draft: data?.draft_content || { medications: [], instructions: '', followUp: '' }, updatedAt: data?.updated_at || null });
  } catch (e) { next(e); }
}
async function saveDraft(req, res, next) {
  try {
    const access = await assertAppointmentAccess(req.params.appointmentId, req.user);
    if (!access.ok) return bad(res, access.error, access.status);
    if (!access.appointment.patient_id) return bad(res, 'Appointment has no linked patient', 409);
    const draft = req.body?.draft;
    if (!draft || typeof draft !== 'object' || !Array.isArray(draft.medications) || draft.medications.length > 100 || typeof draft.instructions !== 'string' || typeof draft.followUp !== 'string' || draft.feedbackEventIds != null && (!Array.isArray(draft.feedbackEventIds) || draft.feedbackEventIds.length > 100 || draft.feedbackEventIds.some(id => typeof id !== 'string' || !/^[0-9a-f-]{36}$/i.test(id)))) return bad(res, 'Invalid prescription draft');
    const { data, error } = await db.from('prescription_drafts').upsert({ appointment_id: access.appointment.id, patient_id: access.appointment.patient_id, clinician_id: req.user.id, draft_content: draft, updated_at: new Date().toISOString() }, { onConflict: 'appointment_id' }).select('draft_content,updated_at').single();
    if (error) throw error;
    const linked = new Map();
    for (const id of draft.feedbackEventIds || []) linked.set(id, []);
    for (const item of draft.medications) if (item?.source?.feedbackEventId) {
      const rows = linked.get(item.source.feedbackEventId) || [];
      rows.push(item); linked.set(item.source.feedbackEventId, rows);
    }
    if (linked.size) {
      const feedbackIds = [...linked.keys()];
      const feedbackRows = await db.from('medication_feedback_events').select('id,recommendation_event_id,action,final_items').eq('clinician_id', req.user.id).in('id', feedbackIds);
      if (feedbackRows.error) throw feedbackRows.error;
      const recommendationIds = [...new Set((feedbackRows.data || []).map(row => row.recommendation_event_id))];
      const eventRows = recommendationIds.length ? await db.from('medication_recommendation_events').select('id,appointment_id').eq('clinician_id', req.user.id).eq('appointment_id', access.appointment.id).in('id', recommendationIds) : { data: [], error: null };
      if (eventRows.error) throw eventRows.error;
      const ownedEventIds = new Set((eventRows.data || []).map(row => row.id));
      for (const row of feedbackRows.data || []) {
        if (!ownedEventIds.has(row.recommendation_event_id)) continue;
        const finalItems = (linked.get(row.id) || []).map(({ name, ingredientKey, strength, dose, route, frequency, duration, kind }) => ({ name, ingredientKey, strength, dose, route, frequency, duration, kind }));
        // Postgres jsonb may reorder object keys. Compare values, not key order.
        if (isDeepStrictEqual(JSON.parse(JSON.stringify(finalItems)), row.final_items || [])) continue;
        const updated = await db.from('medication_feedback_events').update({ action: 'edited', final_items: finalItems }).eq('id', row.id).eq('clinician_id', req.user.id);
        if (updated.error) throw updated.error;
      }
    }
    res.json(data);
  } catch (e) { next(e); }
}
async function searchMedications(req, res, next) {
  try {
    const query = String(req.query.q || '').trim().slice(0, 80);
    if (query.length < 2) return res.json([]);
    let catalogQuery = db.from('medication_substances').select('medication_key,display_name,synonyms,source_name').eq('is_active', true).ilike('display_name', `%${query.replace(/[%_]/g, '')}%`).order('display_name').limit(20);
    catalogQuery = includeDemoMedicationData ? catalogQuery.or('reviewed_at.not.is.null,source_name.like.DEMO ONLY*') : catalogQuery.not('reviewed_at', 'is', null);
    const { data, error } = await catalogQuery;
    if (error) throw error;
    res.json((data || []).map(row => ({ ...row, is_demo: row.source_name?.startsWith('DEMO ONLY') || false })));
  } catch (e) { next(e); }
}
async function getFactorState(req, res, next) {
  try {
    const access = await assertAppointmentAccess(req.params.appointmentId, req.user);
    if (!access.ok) return bad(res, access.error, access.status);
    if (!access.appointment.patient_id) return bad(res, 'Appointment has no linked patient', 409);
    const [catalog, values] = await Promise.all([
      db.from('prescription_factor_catalogs').select('definitions').eq('clinician_id', req.user.id).maybeSingle(),
      db.from('prescription_factor_states').select('overrides,updated_at').eq('appointment_id', access.appointment.id).eq('clinician_id', req.user.id).maybeSingle(),
    ]);
    if (catalog.error) throw catalog.error;
    if (values.error) throw values.error;
    res.json({ definitions: catalog.data?.definitions || [], overrides: values.data?.overrides || {}, updatedAt: values.data?.updated_at || null });
  } catch (e) { next(e); }
}
async function getFactorCatalog(req, res, next) {
  try {
    const { data, error } = await db.from('prescription_factor_catalogs').select('definitions,updated_at').eq('clinician_id', req.user.id).maybeSingle();
    if (error) throw error;
    res.json({ definitions: data?.definitions || [], updatedAt: data?.updated_at || null });
  } catch (e) { next(e); }
}
async function saveFactorState(req, res, next) {
  try {
    const access = await assertAppointmentAccess(req.params.appointmentId, req.user);
    if (!access.ok) return bad(res, access.error, access.status);
    if (!access.appointment.patient_id) return bad(res, 'Appointment has no linked patient', 409);
    const { definitions, overrides } = req.body || {};
    if (!Array.isArray(definitions) || definitions.length > 250 || !overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return bad(res, 'Invalid factor state');
    if (JSON.stringify({ definitions, overrides }).length > 200000) return bad(res, 'Factor state is too large');
    const catalog = await db.from('prescription_factor_catalogs').upsert({ clinician_id: req.user.id, definitions, updated_at: new Date().toISOString() }, { onConflict: 'clinician_id' });
    if (catalog.error) throw catalog.error;
    const values = await db.from('prescription_factor_states').upsert({ appointment_id: access.appointment.id, patient_id: access.appointment.patient_id, clinician_id: req.user.id, overrides, updated_at: new Date().toISOString() }, { onConflict: 'appointment_id' }).select('overrides,updated_at').single();
    if (values.error) throw values.error;
    res.json({ definitions, ...values.data });
  } catch (e) { next(e); }
}
async function evaluate(req, res, next) {
  try {
    const a = await assertAppointmentAccess(req.params.appointmentId, req.user); if (!a.ok) return bad(res, a.error, a.status);
    const appointment = a.appointment; if (!appointment.patient_id) return bad(res, 'Appointment has no linked patient', 409);
    const { factorSnapshot } = req.body || {};
    if (factorSnapshot != null && (!factorSnapshot || typeof factorSnapshot !== 'object' || Array.isArray(factorSnapshot) || JSON.stringify(factorSnapshot).length > 50000)) return bad(res, 'Invalid or oversized factor snapshot');
    for (const [id, record] of Object.entries(factorSnapshot || {})) {
      if (!/^[a-zA-Z0-9_.:-]{1,120}$/.test(id) || !record || !['number', 'select'].includes(record.type) || typeof record.unit !== 'string' || (record.value != null && !['number', 'string'].includes(typeof record.value)) || typeof record.confirmed !== 'boolean') return bad(res, 'Each factor snapshot value needs a supported type, unit and confirmed flag');
    }
    const context = await loadContext(appointment, req.user.id);
    const { data: templates, error } = await db.from('medication_templates').select('id,title,indication_key,indication_display,min_gestational_week,max_gestational_week,version,medication_template_items(*)').eq('clinician_id', req.user.id).eq('status', 'active').order('updated_at', { ascending: false }).limit(500); if (error) throw error;
    const associations = await loadAllergenAssociations((templates || []).flatMap(t => (t.medication_template_items || []).map(i => i.ingredient_key)));
    const candidates = (templates || []).filter((t) => context.gestationalWeek == null || ((t.min_gestational_week == null || context.gestationalWeek >= t.min_gestational_week) && (t.max_gestational_week == null || context.gestationalWeek <= t.max_gestational_week))).map((t) => ({ ...t, allergyFlags: (t.medication_template_items || []).map((i) => ({ itemId: i.id, conflicts: (associations[i.ingredient_key] || []).filter(a => context.allergies.some(x => x.substance_key === a.substance_key)) })), rationale: { factorSimilarityEligible: true, gestationalWeek: context.gestationalWeek } }));
    const snapshot = { capturedAt: new Date().toISOString(), matcher: 'factor-similarity-v1', factorSnapshot: factorSnapshot || {}, episode: context.episode, gestationalWeek: context.gestationalWeek, labReports: context.labReports, vitals: context.vitals, allergyReview: context.allergyReview, allergies: context.allergies };
    const { data: event, error: saveError } = await db.from('medication_recommendation_events').insert({ appointment_id: appointment.id, patient_id: appointment.patient_id, clinician_id: req.user.id, gestational_week: context.gestationalWeek, feature_snapshot: snapshot, candidates: candidates.map((c) => ({ id: c.id, version: c.version, rationale: c.rationale, allergyFlags: c.allergyFlags })) }).select('id,created_at').single(); if (saveError) throw saveError;
    res.json({ eventId: event.id, context, candidates });
  } catch (e) { next(e); }
}
async function saveDisplayedCandidates(req, res, next) {
  try {
    const access = await assertAppointmentAccess(req.params.appointmentId, req.user); if (!access.ok) return bad(res, access.error, access.status);
    const { data: event, error } = await db.from('medication_recommendation_events').select('id,candidates').eq('id', req.params.eventId).eq('appointment_id', access.appointment.id).eq('clinician_id', req.user.id).maybeSingle(); if (error) throw error;
    if (!event) return bad(res, 'Recommendation event not found', 404);
    const displayed = req.body?.displayed;
    if (!Array.isArray(displayed) || displayed.length > 3) return bad(res, 'Displayed candidate list is invalid');
    const allowed = new Map((event.candidates || []).map(candidate => [candidate.id, candidate])); const seen = new Set(); const candidates = [];
    for (const row of displayed) {
      if (!row || !allowed.has(row.id) || seen.has(row.id) || !Number.isFinite(row.score) || row.score < 0 || row.score > 100 || !['gower', 'rules'].includes(row.method) || !Number.isInteger(row.compared) || row.compared < 0 || !Number.isInteger(row.featureCount) || row.featureCount < 0) return bad(res, 'Displayed candidate does not match the evaluated visit');
      seen.add(row.id); candidates.push({ ...allowed.get(row.id), displayed: { score: row.score, method: row.method, coverage: Number.isFinite(row.coverage) ? row.coverage : 0, compared: row.compared, featureCount: row.featureCount, rationale: typeof row.rationale === 'string' ? row.rationale.slice(0, 500) : '' } });
    }
    const { data, error: updateError } = await db.from('medication_recommendation_events').update({ candidates, matcher_version: 'factor-gower-coverage-v1' }).eq('id', event.id).eq('clinician_id', req.user.id).select('id,candidates,matcher_version').single(); if (updateError) throw updateError;
    res.json(data);
  } catch (e) { next(e); }
}
async function saveFeedback(req, res, next) {
  try {
    const b = req.body || {}; if (!b.eventId || !b.templateId || !['accepted','edited','rejected','deferred'].includes(b.action) || b.reasonKey != null && (typeof b.reasonKey !== 'string' || b.reasonKey.length > 100) || b.comment != null && (typeof b.comment !== 'string' || b.comment.length > 1000) || b.finalItems != null && (!Array.isArray(b.finalItems) || b.finalItems.length > 100 || JSON.stringify(b.finalItems).length > 50000)) return bad(res, 'Invalid feedback payload');
    const { data: event, error } = await db.from('medication_recommendation_events').select('id,appointment_id,candidates').eq('id', b.eventId).eq('clinician_id', req.user.id).maybeSingle(); if (error) throw error; const candidate = (event?.candidates || []).find((c) => c.id === b.templateId); if (!event || !candidate) return bad(res, 'Recommendation event not found', 404);
    const access = await assertAppointmentAccess(event.appointment_id, req.user); if (!access.ok) return bad(res, access.error, access.status);
    const { data: t, error: te } = await db.from('medication_templates').select('version').eq('id', b.templateId).eq('clinician_id', req.user.id).single(); if (te) throw te;
    const { data, error: fe } = await db.from('medication_feedback_events').insert({ recommendation_event_id: b.eventId, template_id: b.templateId, template_version: candidate.version || t.version, clinician_id: req.user.id, action: b.action, reason_key: b.reasonKey || null, clinician_comment: b.comment || null, final_items: Array.isArray(b.finalItems) ? b.finalItems : [] }).select().single(); if (fe) throw fe; res.status(201).json(data);
  } catch (e) { next(e); }
}
async function analytics(req, res, next) {
  try {
    const { data, error } = await db.from('medication_feedback_events').select('id,action,reason_key,clinician_comment,final_items,template_id,template_version,recommendation_event_id,created_at').eq('clinician_id', req.user.id).order('created_at', { ascending: false }).limit(500); if (error) throw error;
    const summary = { total: data.length, accepted: 0, edited: 0, rejected: 0, deferred: 0, reasons: {} }; for (const r of data) { summary[r.action]++; if (r.reason_key) summary.reasons[r.reason_key] = (summary.reasons[r.reason_key] || 0) + 1; }
    const templateIds = [...new Set(data.map(row => row.template_id))];
    const eventIds = [...new Set(data.map(row => row.recommendation_event_id))];
    const { data: events, error: eventError } = eventIds.length ? await db.from('medication_recommendation_events').select('id,indication_display,feature_snapshot,candidates,created_at').eq('clinician_id', req.user.id).in('id', eventIds) : { data: [], error: null };
    if (eventError) throw eventError;
    const allTemplateIds = [...new Set([...templateIds, ...(events || []).flatMap(event => (event.candidates || []).map(candidate => candidate.id))])];
    const { data: templates, error: templateError } = allTemplateIds.length ? await db.from('medication_templates').select('id,title').eq('clinician_id', req.user.id).in('id', allTemplateIds) : { data: [], error: null };
    if (templateError) throw templateError;
    const templateNames = new Map((templates || []).map(row => [row.id, row.title]));
    const eventMap = new Map((events || []).map(row => [row.id, { ...row, candidates: (row.candidates || []).map(candidate => ({ ...candidate, template_name: templateNames.get(candidate.id) || 'Archived template' })) }]));
    res.json({ summary, events: data.map(row => ({ ...row, template_name: templateNames.get(row.template_id) || 'Archived template', recommendation: eventMap.get(row.recommendation_event_id) || null })), interpretation: 'Clinician suggestion feedback only; not treatment efficacy.' });
  } catch (e) { next(e); }
}
module.exports = { getContext, saveAllergies, listTemplates, saveTemplate, getDraft, saveDraft, searchMedications, getFactorCatalog, getFactorState, saveFactorState, evaluate, saveDisplayedCandidates, saveFeedback, analytics };
