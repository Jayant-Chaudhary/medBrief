/**
 * Patient Similarity Controller.
 *
 * Exposes:
 * 1. GET  /api/patient-similarity/weights          — Returns all structured & symptom weights and multipliers.
 * 2. GET  /api/patient-similarity/synthetic-cohort — Returns the synthetic cohort & sample queries.
 * 3. POST /api/patient-similarity/evaluate-direct  — Runs the full similarity pipeline on synthetic/direct payloads.
 * 4. POST /api/patient-similarity/adapt-public     — Adapts UCI Maternal Health / MTS-Dialog records and optionally evaluates.
 * 5. POST /api/patient-similarity/benchmark        — Runs quantitative leave-one-out retrieval & negation benchmark.
 * 6. POST /api/patient-similarity/episodes/:episodeId/evaluate — Runs against a saved Supabase episode.
 */

const {
  getWeightsCatalog,
  getSyntheticCohortCatalog,
  evaluateDirectSimilarity,
  adaptAndEvaluatePublicDataset,
  runCohortBenchmark,
  evaluateEpisodeSimilarity,
} = require('../services/patientSimilarity/patientSimilarity.service');

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function badRequest(res, message, status = 400) {
  return res.status(status).json({ error: message });
}

async function getWeights(req, res, next) {
  try {
    return res.json(getWeightsCatalog());
  } catch (err) {
    return next(err);
  }
}

async function getSyntheticCohort(req, res, next) {
  try {
    return res.json(getSyntheticCohortCatalog(req.query || {}));
  } catch (err) {
    return next(err);
  }
}

async function evaluateDirect(req, res, next) {
  try {
    const body = req.body || {};
    const queryPatient = body.queryPatient || body.patient;

    if (!queryPatient || typeof queryPatient !== 'object' || Array.isArray(queryPatient)) {
      return badRequest(res, 'Request body must include a valid queryPatient object');
    }

    if (body.referenceCohort !== undefined && !Array.isArray(body.referenceCohort)) {
      return badRequest(res, 'referenceCohort must be an array when provided');
    }

    const options = typeof body.options === 'object' && body.options !== null ? body.options : {};
    const result = await evaluateDirectSimilarity({
      queryPatient,
      referenceCohort: body.referenceCohort || null,
      options,
    });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function adaptPublic(req, res, next) {
  try {
    const body = req.body || {};
    const result = await adaptAndEvaluatePublicDataset({
      uciCsv: body.uciCsv || null,
      mtsCsv: body.mtsCsv || null,
      uciRows: body.uciRows || null,
      dialogueRows: body.dialogueRows || null,
      queryPatient: body.queryPatient || null,
      options: body.options || {},
    });
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function runBenchmark(req, res, next) {
  try {
    const options = typeof req.body === 'object' && req.body !== null ? req.body : {};
    const result = await runCohortBenchmark(options);
    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

async function evaluateEpisode(req, res, next) {
  try {
    const { episodeId } = req.params;
    if (!UUID_REGEX.test(episodeId || '')) {
      return badRequest(res, 'Invalid pregnancy episode ID');
    }

    const options = typeof req.body?.options === 'object' && req.body.options !== null ? req.body.options : {};
    const result = await evaluateEpisodeSimilarity({
      episodeId,
      clinicianId: req.user.id,
      options,
    });

    return res.json(result);
  } catch (err) {
    return next(err);
  }
}

module.exports = {
  getWeights,
  getSyntheticCohort,
  evaluateDirect,
  adaptPublic,
  runBenchmark,
  evaluateEpisode,
};
