const express = require('express');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');
const controller = require('../controllers/patientSimilarity.controller');

const router = express.Router();

/**
 * In non-production (development / test), synthetic demo endpoints can be called
 * directly via curl / Postman without a JWT token if no Authorization header is sent.
 * In production, strict clinician authentication is always required.
 */
function demoOrClinicianAuth(req, res, next) {
  const isNonProd = process.env.NODE_ENV !== 'production';
  const hasAuthHeader = Boolean(req.headers.authorization);

  if (isNonProd && !hasAuthHeader) {
    return next();
  }
  return authGuard(req, res, (err) => {
    if (err) return next(err);
    return roleGuard('clinician')(req, res, next);
  });
}

// Parameter weights inspection, synthetic cohort catalog, direct evaluation & benchmark endpoints
router.get('/weights', demoOrClinicianAuth, controller.getWeights);
router.get('/synthetic-cohort', demoOrClinicianAuth, controller.getSyntheticCohort);
router.post('/evaluate-direct', demoOrClinicianAuth, controller.evaluateDirect);
router.post('/adapt-public', demoOrClinicianAuth, controller.adaptPublic);
router.post('/benchmark', demoOrClinicianAuth, controller.runBenchmark);

// Database-backed episode evaluation (always requires authenticated clinician)
router.post('/episodes/:episodeId/evaluate', authGuard, roleGuard('clinician'), controller.evaluateEpisode);

module.exports = router;
