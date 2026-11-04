const express = require('express');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');
const validateBody = require('../middleware/validateBody');
const {
  submitCheckinSchema,
  adHocConcernSchema,
  quickPulseSchema,
} = require('../validators/checkin.validators');
const {
  submitCheckin,
  submitAdHoc,
  submitQuickPulse,
  getStatus,
  getHistory,
  getSummary,
  generateSummary,
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

module.exports = router;
