const express = require('express');
const config = require('../config/assistant.config');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');
const validateBody = require('../middleware/validateBody');
const { assistantStepSchema, assistantEventSchema } = require('../validators/assistant.validators');
const { step, warm, event } = require('../controllers/assistant.controller');

const router = express.Router();

// Off unless ASSISTANT_ENABLED=true; nothing below runs, and no model is contacted.
router.use((req, res, next) => (config.enabled ? next() : res.status(404).json({ error: 'Assistant is turned off' })));

// roleGuard also rejects clinicians whose registration is not yet verified.
router.use(authGuard, roleGuard('patient', 'clinician'));

router.post('/step', validateBody(assistantStepSchema), step);
router.post('/warm', warm);
router.post('/event', validateBody(assistantEventSchema), event);

module.exports = router;
