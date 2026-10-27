const supabaseAdmin = require('../config/supabaseAdminClient');
const records = require('../services/maternalRecords.service');

function sendResult(res, result, successStatus = 200) {
  if (!result.ok) return res.status(result.status).json({ error: result.error });
  return res.status(successStatus).json(result.data ?? result.record);
}

async function getPatientRecord(req, res, next) {
  try {
    const result = await records.getPatientRecord(req.user.id, req.params.patientId);
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.json(result.record);
  } catch (err) { next(err); }
}

async function createEpisode(req, res, next) {
  try {
    const result = await records.createEpisode({ clinicianId: req.user.id, patientId: req.params.patientId, changes: req.validated });
    sendResult(res, result, 201);
  } catch (err) { next(err); }
}

async function updateEpisode(req, res, next) {
  try {
    const result = await records.updateEpisode({ clinicianId: req.user.id, episodeId: req.params.episodeId, changes: req.validated });
    sendResult(res, result);
  } catch (err) { next(err); }
}

async function createRecord(req, res, next) {
  try {
    const result = await records.createRecord({
      clinicianId: req.user.id,
      episodeId: req.params.episodeId,
      collection: req.params.collection,
      changes: req.validated,
    });
    sendResult(res, result, 201);
  } catch (err) { next(err); }
}

async function updateRecord(req, res, next) {
  try {
    const result = await records.updateRecord({
      clinicianId: req.user.id,
      recordId: req.params.recordId,
      collection: req.params.collection,
      changes: req.validated,
    });
    sendResult(res, result);
  } catch (err) { next(err); }
}

async function deleteRecord(req, res, next) {
  try {
    const result = await records.updateRecord({
      clinicianId: req.user.id,
      recordId: req.params.recordId,
      collection: req.params.collection,
      remove: true,
    });
    if (!result.ok) return res.status(result.status).json({ error: result.error });
    res.status(204).send();
  } catch (err) { next(err); }
}

async function saveDelivery(req, res, next) {
  try {
    const result = await records.saveDelivery({ clinicianId: req.user.id, episodeId: req.params.episodeId, changes: req.validated });
    sendResult(res, result);
  } catch (err) { next(err); }
}

async function modelStatus(req, res, next) {
  try {
    const { getModelStatus } = require('../services/ml');
    res.json({ tasks: getModelStatus() });
  } catch (err) { next(err); }
}

module.exports = { getPatientRecord, createEpisode, updateEpisode, createRecord, updateRecord, deleteRecord, saveDelivery, modelStatus };
