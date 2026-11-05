const supabaseAdmin = require('../config/supabaseAdminClient');
const config = require('../config/checkin.config');
const logger = require('../utils/logger');

/**
 * Checks if a string contains any configured emergency keywords.
 */
function containsEmergencyKeyword(text) {
  if (!text || typeof text !== 'string') return false;
  const lower = text.toLowerCase();
  return config.emergencyKeywords.some((kw) => lower.includes(kw));
}

/**
 * Records a new check-in session and its associated answers.
 * If any answer is flagged as a red flag, the session status is elevated to 'flagged_urgent'.
 */
async function recordCheckin({ patientId, appointmentId, sessionType, gestationalWeek, answers }) {
  const hasRedFlag = answers.some((a) => a.isRedFlag === true);
  const status = hasRedFlag ? 'flagged_urgent' : 'completed';

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('patient_checkin_sessions')
    .insert({
      patient_id: patientId,
      appointment_id: appointmentId || null,
      session_type: sessionType,
      gestational_week: gestationalWeek || null,
      status,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (sessionError) {
    logger.error('Failed to create check-in session', {
      scope: 'checkin',
      err: sessionError.message,
    });
    throw sessionError;
  }

  const answerRows = answers.map((ans) => ({
    session_id: session.id,
    category: ans.category,
    question_key: ans.questionKey,
    question_text: ans.questionText,
    answer_type: ans.answerType,
    bool_value: ans.boolValue !== undefined ? ans.boolValue : null,
    scale_value: ans.scaleValue !== undefined ? ans.scaleValue : null,
    text_value: ans.textValue ? ans.textValue.trim() : null,
    is_red_flag: Boolean(ans.isRedFlag),
  }));

  const { data: insertedAnswers, error: answersError } = await supabaseAdmin
    .from('patient_checkin_answers')
    .insert(answerRows)
    .select();

  if (answersError) {
    logger.error('Failed to insert check-in answers', {
      scope: 'checkin',
      err: answersError.message,
    });
    throw answersError;
  }

  logger.info('Recorded check-in session', {
    scope: 'checkin',
    sessionId: session.id,
    answerCount: answerRows.length,
    status,
  });

  return {
    session,
    answers: insertedAnswers || [],
    hasRedFlag,
  };
}

/**
 * Records an ad-hoc spontaneous patient concern/symptom (can be submitted 24/7).
 */
async function recordAdHocConcern({ patientId, category = 'concern', description, severity = 'mild', gestationalWeek }) {
  const isEmergencySeverity = severity === 'severe';
  const hasEmergencyKeyword = containsEmergencyKeyword(description);
  const isRedFlag = isEmergencySeverity || hasEmergencyKeyword;
  const status = isRedFlag ? 'flagged_urgent' : 'completed';

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('patient_checkin_sessions')
    .insert({
      patient_id: patientId,
      session_type: 'ad_hoc_concern',
      gestational_week: gestationalWeek || null,
      status,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (sessionError) {
    logger.error('Failed to create ad-hoc concern session', {
      scope: 'checkin',
      err: sessionError.message,
    });
    throw sessionError;
  }

  const { data: answer, error: answerError } = await supabaseAdmin
    .from('patient_checkin_answers')
    .insert({
      session_id: session.id,
      category,
      question_key: 'ad_hoc_symptom',
      question_text: `Patient logged concern (${severity})`,
      answer_type: 'text',
      text_value: description.trim(),
      is_red_flag: isRedFlag,
    })
    .select()
    .single();

  if (answerError) {
    logger.error('Failed to insert ad-hoc concern answer', {
      scope: 'checkin',
      err: answerError.message,
    });
    throw answerError;
  }

  logger.info('Recorded ad-hoc concern', {
    scope: 'checkin',
    sessionId: session.id,
    isRedFlag,
  });

  return {
    session,
    answers: [answer],
    hasRedFlag: isRedFlag,
  };
}

/**
 * Records a 30-second quick pulse check-in (cadence every 2-4 days).
 */
async function recordQuickPulse({ patientId, comfortRating, discomforts = [], notes, gestationalWeek }) {
  const hasDiscomforts = Array.isArray(discomforts) && discomforts.length > 0;
  const notesEmergency = containsEmergencyKeyword(notes);
  const discomfortsEmergency = discomforts.some((d) => containsEmergencyKeyword(d));
  const isRedFlag = notesEmergency || discomfortsEmergency || comfortRating === 1;
  const status = isRedFlag ? 'flagged_urgent' : 'completed';

  const { data: session, error: sessionError } = await supabaseAdmin
    .from('patient_checkin_sessions')
    .insert({
      patient_id: patientId,
      session_type: 'quick_pulse',
      gestational_week: gestationalWeek || null,
      status,
      completed_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (sessionError) {
    logger.error('Failed to create quick pulse session', {
      scope: 'checkin',
      err: sessionError.message,
    });
    throw sessionError;
  }

  const answerRows = [
    {
      session_id: session.id,
      category: 'physical',
      question_key: 'comfort_rating',
      question_text: 'Overall comfort rating today',
      answer_type: 'scale',
      scale_value: comfortRating,
      is_red_flag: comfortRating === 1,
    },
  ];

  if (hasDiscomforts) {
    answerRows.push({
      session_id: session.id,
      category: 'physical',
      question_key: 'reported_discomforts',
      question_text: 'Reported symptoms / discomforts',
      answer_type: 'text',
      text_value: discomforts.join(', '),
      is_red_flag: discomfortsEmergency,
    });
  }

  if (notes && notes.trim().length > 0) {
    answerRows.push({
      session_id: session.id,
      category: 'physical',
      question_key: 'quick_notes',
      question_text: 'Patient quick note',
      answer_type: 'text',
      text_value: notes.trim(),
      is_red_flag: notesEmergency,
    });
  }

  const { data: answers, error: answersError } = await supabaseAdmin
    .from('patient_checkin_answers')
    .insert(answerRows)
    .select();

  if (answersError) {
    logger.error('Failed to insert quick pulse answers', {
      scope: 'checkin',
      err: answersError.message,
    });
    throw answersError;
  }

  return {
    session,
    answers: answers || [],
    hasRedFlag: isRedFlag,
  };
}

/**
 * Calculates check-in status and cadence for a patient.
 */
async function getCheckinStatus({ patientId }) {
  const { data: sessions, error } = await supabaseAdmin
    .from('patient_checkin_sessions')
    .select('id, session_type, created_at, status')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) {
    logger.error('Failed to fetch check-in status', {
      scope: 'checkin',
      err: error.message,
    });
    throw error;
  }

  if (!sessions || sessions.length === 0) {
    return {
      lastCheckinDate: null,
      daysSinceLastCheckin: null,
      nextDueType: 'routine_weekly',
      isWeeklyDue: true,
      isQuickPulseDue: true,
      nextDueInDays: 0,
      totalCompleted: 0,
    };
  }

  const now = Date.now();
  const latestSession = sessions[0];
  const lastCheckinTime = new Date(latestSession.created_at).getTime();
  const daysSinceLastCheckin = Math.floor((now - lastCheckinTime) / (1000 * 60 * 60 * 24));

  const latestWeekly = sessions.find((s) => s.session_type === 'routine_weekly');
  const daysSinceWeekly = latestWeekly
    ? Math.floor((now - new Date(latestWeekly.created_at).getTime()) / (1000 * 60 * 60 * 24))
    : 999;

  const isWeeklyDue = daysSinceWeekly >= config.weeklyCheckinIntervalDays;
  const isQuickPulseDue = daysSinceLastCheckin >= config.quickPulseIntervalDays;

  let nextDueType = 'none';
  let nextDueInDays = 0;

  if (isWeeklyDue) {
    nextDueType = 'routine_weekly';
    nextDueInDays = 0;
  } else if (isQuickPulseDue) {
    nextDueType = 'quick_pulse';
    nextDueInDays = 0;
  } else {
    nextDueType = 'none';
    nextDueInDays = Math.max(1, config.quickPulseIntervalDays - daysSinceLastCheckin);
  }

  return {
    lastCheckinDate: latestSession.created_at,
    lastSessionType: latestSession.session_type,
    daysSinceLastCheckin,
    nextDueType,
    isWeeklyDue,
    isQuickPulseDue,
    nextDueInDays,
    totalCompleted: sessions.length,
  };
}

/**
 * Retrieves check-in history for a patient.
 */
async function getPatientCheckinHistory({ patientId, lookbackDays, limit = 20 }) {
  let query = supabaseAdmin
    .from('patient_checkin_sessions')
    .select('*, patient_checkin_answers(*)')
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
    .limit(limit);

  if (lookbackDays) {
    const cutoff = new Date(Date.now() - lookbackDays * 24 * 60 * 60 * 1000).toISOString();
    query = query.gte('created_at', cutoff);
  }

  const { data, error } = await query;

  if (error) {
    logger.error('Failed to fetch patient checkin history', {
      scope: 'checkin',
      err: error.message,
    });
    throw error;
  }

  return data || [];
}

module.exports = {
  recordCheckin,
  recordAdHocConcern,
  recordQuickPulse,
  getCheckinStatus,
  getPatientCheckinHistory,
};
