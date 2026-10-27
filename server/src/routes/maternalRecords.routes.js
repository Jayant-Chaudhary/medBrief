const express = require('express');
const authGuard = require('../middleware/authGuard');
const roleGuard = require('../middleware/roleGuard');
const validateBody = require('../middleware/validateBody');
const { episodeSchema, recordSchemas, deliverySchema } = require('../validators/maternalRecords.validators');
const controller = require('../controllers/maternalRecords.controller');

const router = express.Router();
router.use(authGuard, roleGuard('clinician'));

function validateRecord(req, res, next) {
  const schema = recordSchemas[req.params.collection];
  if (!schema) return res.status(400).json({ error: 'Unsupported record collection' });
  const inputSchema = req.method === 'PATCH' ? schema.partial() : schema;
  return validateBody(inputSchema)(req, res, next);
}

router.get('/patients/:patientId', controller.getPatientRecord);
router.post('/patients/:patientId/episodes', validateBody(episodeSchema), controller.createEpisode);
router.patch('/episodes/:episodeId', validateBody(episodeSchema.partial()), controller.updateEpisode);
router.post('/episodes/:episodeId/records/:collection', validateRecord, controller.createRecord);
router.patch('/records/:collection/:recordId', validateRecord, controller.updateRecord);
router.delete('/records/:collection/:recordId', controller.deleteRecord);
router.put('/episodes/:episodeId/delivery', validateBody(deliverySchema), controller.saveDelivery);

module.exports = router;
