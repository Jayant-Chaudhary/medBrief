const express = require('express');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');
const { modelStatus } = require('../controllers/maternalRecords.controller');

const router = express.Router();
router.use(authGuard, roleGuard('clinician'));
router.get('/status', modelStatus);

module.exports = router;
