const { assertAppointmentAccess, clinicianHasPatient, resolvePatientScope } = require('../services/access.service');
const {
  recordCheckin,
  recordAdHocConcern,
  recordQuickPulse,
  getCheckinStatus,
  getPatientCheckinHistory,
} = require('../services/checkin.service');
const { generatePreVisitSummary, getPreVisitSummary } = require('../services/checkinAi.service');
const {
  syncDeviceMetrics,
  getPatientDeviceMetrics,
  computeMetricsTrajectory,
} = require('../services/deviceMetrics.service');

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
 * The patient a check-in read is about. A patient naming someone else is
 * refused outright; a clinician must name a patient they treat.
 */
async function checkinReadScope(req) {
  const asked = req.query.patientId;
  if (req.user.role !== 'clinician' && asked && asked !== req.user.id) {
    return { ok: false, status: 403, error: 'Not authorized for this patient' };
  }
  return resolvePatientScope(req);
}

/**
 * Get cadence and due status for check-ins (patient or clinician).
 */
async function getStatus(req, res, next) {
  try {
    // Patients get their own; a clinician must name a patient they treat.
    const scope = await checkinReadScope(req);
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
    const { patientId } = scope;

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
    const scope = await checkinReadScope(req);
    if (!scope.ok) return res.status(scope.status).json({ error: scope.error });
    const { patientId } = scope;

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

/**
 * Sync patient device metrics from Health Connect (patient only).
 */
async function syncMetrics(req, res, next) {
  try {
    const { metrics } = req.validated;
    const result = await syncDeviceMetrics(req.user.id, metrics);
    res.status(201).json(result);
  } catch (err) {
    next(err);
  }
}

/**
 * Retrieve patient device metrics (patient for own, clinician for assigned patient).
 */
async function getMetrics(req, res, next) {
  try {
    let targetPatientId = req.user.id;
    if (req.user.role === 'clinician') {
      const { patientId, appointmentId } = req.query;
      if (appointmentId) {
        const access = await assertAppointmentAccess(appointmentId, req.user);
        if (!access.ok) return res.status(access.status).json({ error: access.error });
        targetPatientId = access.appointment.patient_id;
      } else if (patientId) {
        const allowed = await clinicianHasPatient(req.user.id, patientId);
        if (!allowed) return res.status(403).json({ error: 'Clinician not authorized for this patient' });
        targetPatientId = patientId;
      } else {
        return res.status(400).json({ error: 'patientId or appointmentId required' });
      }
    }

    const { startDate, endDate, limit } = req.query;
    const data = await getPatientDeviceMetrics(targetPatientId, {
      startDate,
      endDate,
      limit: limit ? Number(limit) : 30,
    });
    res.json(data);
  } catch (err) {
    next(err);
  }
}

/**
 * Retrieve longitudinal trajectory & alerts for device metrics.
 */
async function getMetricsTrajectory(req, res, next) {
  try {
    let targetPatientId = req.user.id;
    if (req.user.role === 'clinician') {
      const { patientId, appointmentId } = req.query;
      if (appointmentId) {
        const access = await assertAppointmentAccess(appointmentId, req.user);
        if (!access.ok) return res.status(access.status).json({ error: access.error });
        targetPatientId = access.appointment.patient_id;
      } else if (patientId) {
        const allowed = await clinicianHasPatient(req.user.id, patientId);
        if (!allowed) return res.status(403).json({ error: 'Clinician not authorized for this patient' });
        targetPatientId = patientId;
      } else {
        return res.status(400).json({ error: 'patientId or appointmentId required' });
      }
    }

    const { intervalStart, intervalEnd } = req.query;
    const trajectory = await computeMetricsTrajectory(targetPatientId, intervalStart, intervalEnd);
    res.json(trajectory);
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
  syncMetrics,
  getMetrics,
  getMetricsTrajectory,
};
