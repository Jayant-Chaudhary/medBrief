const { assertAppointmentAccess } = require('../services/access.service');
const {
  recordCheckin,
  recordAdHocConcern,
  recordQuickPulse,
  getCheckinStatus,
  getPatientCheckinHistory,
} = require('../services/checkin.service');
const { generatePreVisitSummary, getPreVisitSummary } = require('../services/checkinAi.service');

/**
 * Submit structured check-in responses (patient only).
 */
async function submitCheckin(req, res, next) {
  try {
    const { appointmentId, sessionType, gestationalWeek, answers } = req.validated;

    if (appointmentId) {
      const access = await assertAppointmentAccess(appointmentId, req.user);
      if (!access.ok) return res.status(access.status).json({ error: access.error });
    }

    const result = await recordCheckin({
      patientId: req.user.id,
      appointmentId,
      sessionType,
      gestationalWeek,
      answers,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Submit an ad-hoc spontaneous patient concern/symptom (patient only).
 */
async function submitAdHoc(req, res, next) {
  try {
    const { category, description, severity, gestationalWeek } = req.validated;

    const result = await recordAdHocConcern({
      patientId: req.user.id,
      category,
      description,
      severity,
      gestationalWeek,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Submit a 30-second quick pulse check-in (patient only).
 */
async function submitQuickPulse(req, res, next) {
  try {
    const { comfortRating, discomforts, notes, gestationalWeek } = req.validated;

    const result = await recordQuickPulse({
      patientId: req.user.id,
      comfortRating,
      discomforts,
      notes,
      gestationalWeek,
    });

    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Get cadence and due status for check-ins (patient or clinician).
 */
async function getStatus(req, res, next) {
  try {
    const patientId = req.query.patientId || req.user.id;

    if (patientId !== req.user.id && req.user.role !== 'clinician') {
      return res.status(403).json({ error: 'Not authorized to view other patient status' });
    }

    const status = await getCheckinStatus({ patientId });
    res.json(status);
  } catch (err) {
    next(err);
  }
}

/**
 * Get patient check-in history.
 */
async function getHistory(req, res, next) {
  try {
    const patientId = req.query.patientId || req.user.id;

    if (patientId !== req.user.id && req.user.role !== 'clinician') {
      return res.status(403).json({ error: 'Not authorized to view other patient history' });
    }

    const lookbackDays = req.query.lookbackDays ? Number(req.query.lookbackDays) : undefined;
    const history = await getPatientCheckinHistory({ patientId, lookbackDays });

    res.json(history);
  } catch (err) {
    next(err);
  }
}

/**
 * Retrieve the AI pre-visit summary for an appointment.
 */
async function getSummary(req, res, next) {
  try {
    const { appointmentId } = req.params;

    const access = await assertAppointmentAccess(appointmentId, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const summary = await getPreVisitSummary(appointmentId);
    res.json(summary || null);
  } catch (err) {
    next(err);
  }
}

/**
 * Generate/regenerate the AI pre-visit summary for an appointment (clinician only).
 */
async function generateSummary(req, res, next) {
  try {
    const { appointmentId } = req.params;

    const access = await assertAppointmentAccess(appointmentId, req.user);
    if (!access.ok) return res.status(access.status).json({ error: access.error });

    const summary = await generatePreVisitSummary(appointmentId);
    res.status(200).json(summary);
  } catch (err) {
    next(err);
  }
}

module.exports = {
  submitCheckin,
  submitAdHoc,
  submitQuickPulse,
  getStatus,
  getHistory,
  getSummary,
  generateSummary,
};
