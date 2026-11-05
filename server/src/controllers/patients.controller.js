const { listClinicianPatients } = require('../services/patientDirectory.service');

/** The signed-in clinician's patients; see patientDirectory.service for the shape. */
async function listPatients(req, res, next) {
  try {
    res.json(await listClinicianPatients(req.user.id));
  } catch (err) {
    next(err);
  }
}

module.exports = { listPatients };
