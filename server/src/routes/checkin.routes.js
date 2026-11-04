const express = require('express');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');
const validateBody = require('../middleware/validateBody');
const {
  submitCheckinSchema,
  adHocConcernSchema,
  quickPulseSchema,
} = require('../validators/checkin.validators');
const { syncDeviceMetricsSchema } = require('../validators/deviceMetrics.validators');
const {
  submitCheckin,
  submitAdHoc,
  submitQuickPulse,
  getStatus,
  getHistory,
  getSummary,
  generateSummary,
  syncMetrics,
  getMetrics,
  getMetricsTrajectory,
} = require('../controllers/checkin.controller');

const router = express.Router();

router.use(authGuard);

router.post('/sessions', roleGuard('patient'), validateBody(submitCheckinSchema), submitCheckin);
router.post('/ad-hoc', roleGuard('patient'), validateBody(adHocConcernSchema), submitAdHoc);
router.post('/quick-pulse', roleGuard('patient'), validateBody(quickPulseSchema), submitQuickPulse);
router.get('/status', getStatus);
router.get('/history', getHistory);
router.get('/summary/:appointmentId', getSummary);
router.post('/summary/:appointmentId/generate', roleGuard('clinician'), generateSummary);
router.post('/device-metrics/sync', roleGuard('patient'), validateBody(syncDeviceMetricsSchema), syncMetrics);
router.get('/device-metrics', getMetrics);
router.get('/device-metrics/trajectory', getMetricsTrajectory);

module.exports = router;
