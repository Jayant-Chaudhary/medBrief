const express = require('express');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');
const validateBody = require('../middleware/validateBody');
const { episodeSchema, deliverySchema, validateSection } = require('../validators/maternity.validators');
const {
  getCard,
  importReports,
  saveEpisode,
  saveDelivery,
  addRow,
  updateRow,
  deleteRow,
} = require('../controllers/maternity.controller');

const router = express.Router();

// The maternity card is the clinician's record.
router.use(authGuard, roleGuard('clinician'));

router.get('/:patientId', getCard);
router.put('/:patientId', validateBody(episodeSchema), saveEpisode);
router.put('/:patientId/delivery', validateBody(deliverySchema), saveDelivery);
// Registered before /:section so "import-reports" is never read as a section.
router.post('/:patientId/import-reports', importReports);

// :section is visits | labs | scans | vaccines
router.post('/:patientId/:section', validateSection, addRow);
router.patch('/:patientId/:section/:rowId', validateSection, updateRow);
router.delete('/:patientId/:section/:rowId', deleteRow);

module.exports = router;
