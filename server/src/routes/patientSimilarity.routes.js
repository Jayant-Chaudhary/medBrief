const express = require('express');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');
const controller = require('../controllers/patientSimilarity.controller');
const config = require('../config/patientSimilarity.config');
const { isDevOrTest } = require('../config/runtimeEnv');

const router = express.Router();

/**
 * Gate middleware that verifies whether the similarity model is enabled via configuration.
 */
function similarityEnabledGuard(req, res, next) {
  if (config.isPatientSimilarityEnabled && !config.isPatientSimilarityEnabled()) {
    return res.status(503).json({
      error: 'Patient similarity model is currently disabled by environment configuration',
      enabled: false,
    });
  }
  next();
}

/**
 * In non-production (development / test), synthetic demo endpoints can be called
 * directly via curl / Postman without a JWT token if no Authorization header is sent.
 * In production, strict clinician authentication is always required.
 */
function demoOrClinicianAuth(req, res, next) {
  // Explicit development/test only; an unset NODE_ENV requires login.
  const isNonProd = isDevOrTest();
  const hasAuthHeader = Boolean(req.headers.authorization);

  if (isNonProd && !hasAuthHeader) {
    return next();
  }
  return authGuard(req, res, (err) => {
    if (err) return next(err);
    return roleGuard('clinician')(req, res, next);
  });
}

router.use(similarityEnabledGuard);

// Parameter weights inspection, synthetic cohort catalog, direct evaluation & benchmark endpoints
router.get('/weights', demoOrClinicianAuth, controller.getWeights);
router.get('/synthetic-cohort', demoOrClinicianAuth, (req, res, next) => {
  if (config.isSimilaritySyntheticDataAllowed && !config.isSimilaritySyntheticDataAllowed()) {
    return res.status(403).json({
      error: 'Synthetic cohort catalog is disabled by environment configuration',
      useSyntheticData: false,
    });
  }
  return controller.getSyntheticCohort(req, res, next);
});
router.post('/evaluate-direct', demoOrClinicianAuth, controller.evaluateDirect);
router.post('/adapt-public', demoOrClinicianAuth, controller.adaptPublic);
router.post('/benchmark', demoOrClinicianAuth, controller.runBenchmark);

// Database-backed episode evaluation (always requires authenticated clinician)
router.post('/episodes/:episodeId/evaluate', authGuard, roleGuard('clinician'), controller.evaluateEpisode);

module.exports = router;
