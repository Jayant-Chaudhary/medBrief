const axios = require('axios');
const supabaseAdmin = require('../config/supabaseAdminClient');
const config = require('../config/checkin.config');
const logger = require('../utils/logger');
const { computeMetricsTrajectory } = require('./deviceMetrics.service');

/**
 * Builds a deterministic clinical brief fallback when Gemini API key
 * is absent or when running in an offline test harness.
 */
function buildDeterministicSummary({ patientDetails, recentSessions, recentVitals, intervalDescription, deviceTrajectory }) {
  const redFlags = [];
  const topQuestions = [];
  const adHocConcerns = [];
  let hasUrgent = false;
  let hasModerate = false;

  const physicalNotes = [];
  const mentalNotes = [];
  const medicalNotes = [];

  for (const session of recentSessions) {
    const answers = session.patient_checkin_answers || [];
    const isAdHoc = session.session_type === 'ad_hoc_concern';

    for (const ans of answers) {
      if (ans.is_red_flag) {
        hasUrgent = true;
        const flagText = ans.text_value
          ? `${ans.question_text}: ${ans.text_value}`
          : `${ans.question_text}: Flagged`;
        redFlags.push(flagText);
      }

      if (isAdHoc && ans.text_value) {
        adHocConcerns.push(ans.text_value);
      }

      // Extract patient questions first so they do not leak into physical sensations
      if (ans.question_key === 'patient_agenda' || ans.question_key.includes('question') || ans.category === 'agenda') {
        if (ans.text_value && ans.text_value.trim().length > 0) {
          topQuestions.push(ans.text_value.trim());
        }
        continue;
      }

      if (ans.category === 'physical' || ans.category === 'concern') {
        const label = ans.question_text || ans.question_key.replace(/_/g, ' ');
        if (ans.bool_value || ans.text_value) {
          physicalNotes.push(`${label}: ${ans.text_value || 'Present'}`);
        } else if (ans.scale_value) {
          physicalNotes.push(`${label}: rated ${ans.scale_value}/5`);
        }
      } else if (ans.category === 'mental') {
        const label = ans.question_text || ans.question_key.replace(/_/g, ' ');
        if (ans.scale_value && ans.scale_value >= 4) {
          hasModerate = true;
          mentalNotes.push(`Elevated concern on ${label} (rated ${ans.scale_value}/5)`);
        } else if (ans.text_value) {
          mentalNotes.push(ans.text_value);
        }
      } else if (ans.category === 'medical') {
        if (ans.bool_value === false) {
          hasModerate = true;
          medicalNotes.push(`Missed adherence: ${ans.question_text || ans.question_key}`);
        }
      }
    }
  }

  // Check vitals for elevated thresholds
  for (const vital of recentVitals) {
    if (vital.metric_key === 'blood_pressure_systolic' && vital.value >= 140) {
      hasUrgent = true;
      redFlags.push(`Systolic blood pressure recorded at ${vital.value} ${vital.unit || 'mmHg'}`);
    }
  }

  // Factor in wearable / Health Connect trajectory and flags
  if (deviceTrajectory && deviceTrajectory.hasData) {
    if (deviceTrajectory.flags && deviceTrajectory.flags.length > 0) {
      for (const flag of deviceTrajectory.flags) {
        redFlags.push(flag);
      }
      if (deviceTrajectory.bpAlert || (deviceTrajectory.peakRestingHr && deviceTrajectory.peakRestingHr >= 115)) {
        hasUrgent = true;
      } else {
        hasModerate = true;
      }
    }
  }

  let clinicalRiskLevel = 'low';
  if (hasUrgent) {
    clinicalRiskLevel = 'urgent';
  } else if (hasModerate || adHocConcerns.length > 0) {
    clinicalRiskLevel = 'moderate';
  }

  let trajectory = physicalNotes.length > 0
    ? physicalNotes.join('. ')
    : 'Expected physiological progression with no acute distress.';
  if (adHocConcerns.length > 0) {
    trajectory += ` Recent patient-logged concerns: ${adHocConcerns.join('; ')}.`;
  }
  if (deviceTrajectory && deviceTrajectory.hasData) {
    const parts = [];
    if (deviceTrajectory.avgRecentSteps !== null) {
      const trendStr = deviceTrajectory.stepsTrendPercent !== null
        ? ` (${deviceTrajectory.stepsTrendPercent >= 0 ? '+' : ''}${deviceTrajectory.stepsTrendPercent}% trend)`
        : '';
      parts.push(`Daily steps averaged ${deviceTrajectory.avgRecentSteps}${trendStr}`);
    }
    if (deviceTrajectory.avgRestingHr !== null) {
      parts.push(`Resting HR averaged ${deviceTrajectory.avgRestingHr} bpm (peak: ${deviceTrajectory.peakRestingHr} bpm)`);
    }
    if (deviceTrajectory.avgSleepHours !== null) {
      parts.push(`Sleep averaged ${deviceTrajectory.avgSleepHours} hrs/night`);
    }
    if (parts.length > 0) {
      trajectory += ` Wearable activity (Health Connect): ${parts.join(', ')}.`;
    }
  }

  const doctorTalkingPoints = hasUrgent
    ? 'Prioritize immediate evaluation of flagged obstetric concerns, wearable alerts, and repeat vitals.'
    : (deviceTrajectory && deviceTrajectory.flags && deviceTrajectory.flags.length > 0)
    ? `Review wearable alerts (${deviceTrajectory.flags[0]}) alongside patient-reported symptoms.`
    : adHocConcerns.length > 0
    ? `Address recent spontaneous concerns (${adHocConcerns.join(', ')}) and review routine progress.`
    : 'Review routine gestational progress and address patient inquiries.';

  return {
    clinical_risk_level: clinicalRiskLevel,
    red_flags: redFlags,
    mental_health_assessment:
      mentalNotes.length > 0
        ? mentalNotes.join('. ')
        : 'Stable mood and sleep patterns reported over recent interval.',
    physical_symptom_trajectory: trajectory,
    medication_compliance:
      medicalNotes.length > 0
        ? medicalNotes.join('. ')
        : 'Routine prenatal vitamins and medications reported as adherent.',
    patient_top_questions: topQuestions,
    doctor_talking_points: doctorTalkingPoints,
  };
}

/**
 * Invokes Gemini 2.5 Flash to synthesize interval check-in data into a clinical brief.
 */
async function callGeminiSynthesizer({ patientDetails, recentSessions, recentVitals, intervalDescription, deviceTrajectory }) {
  if (!config.geminiApiKey) {
    return buildDeterministicSummary({ patientDetails, recentSessions, recentVitals, intervalDescription, deviceTrajectory });
  }

  const prompt = `
You are a specialized clinical summary assistant preparing a 30-second pre-visit brief for an obstetrician/gynecologist.

CRITICAL SAFETY RULES:
- You FLAG and PRIORITISE; you NEVER diagnose any condition.
- Do not invent clinical values or thresholds.
- Do not output definitive diagnostic statements. Frame findings as "Reported signs consistent with watch for...", "Patient noted...", or "Prioritize evaluation of...".

INTERVAL CONTEXT:
${intervalDescription}

PATIENT CONTEXT:
- Due date: ${patientDetails?.due_date || 'Unknown'}
- Gravida: ${patientDetails?.gravida ?? 'N/A'}, Para: ${patientDetails?.para ?? 'N/A'}
- Recent vitals: ${JSON.stringify(recentVitals)}

INTERVAL CHECK-IN SESSIONS & AD-HOC CONCERNS:
${JSON.stringify(recentSessions, null, 2)}

WEARABLE DEVICE METRICS (Health Connect / Verified Devices):
${deviceTrajectory && deviceTrajectory.hasData ? JSON.stringify({
  daysTracked: deviceTrajectory.daysTracked,
  avgRecentSteps: deviceTrajectory.avgRecentSteps,
  stepsTrendPercent: deviceTrajectory.stepsTrendPercent,
  avgRestingHr: deviceTrajectory.avgRestingHr,
  peakRestingHr: deviceTrajectory.peakRestingHr,
  avgSleepHours: deviceTrajectory.avgSleepHours,
  latestBp: deviceTrajectory.latestBp,
  flags: deviceTrajectory.flags,
}, null, 2) : 'No wearable device data synced for this interval.'}

Provide your response in strictly valid JSON format matching this exact schema:
{
  "clinical_risk_level": "low" | "moderate" | "high" | "urgent",
  "red_flags": ["string"],
  "mental_health_assessment": "concise synthesis of emotional, sleep, and mood signals",
  "physical_symptom_trajectory": "concise timeline of physical symptoms, quick pulses, and ad-hoc patient reports",
  "medication_compliance": "concise report on vitamin/medication adherence",
  "patient_top_questions": ["string"],
  "doctor_talking_points": "1-3 bullet points suggesting clinical focus for this visit"
}
`;

  try {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${config.geminiModel}:generateContent?key=${config.geminiApiKey}`;
    const response = await axios.post(
      url,
      {
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: {
          responseMimeType: 'application/json',
          maxOutputTokens: config.maxOutputTokens,
        },
      },
      { timeout: config.requestTimeoutMs }
    );

    const candidate = response.data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidate) {
      throw new Error('Empty response from Gemini API');
    }

    return JSON.parse(candidate);
  } catch (err) {
    logger.warn('Gemini API call failed or timed out, falling back to deterministic synthesizer', {
      scope: 'checkin_ai',
      err: err.message,
    });
    return buildDeterministicSummary({ patientDetails, recentSessions, recentVitals, intervalDescription, deviceTrajectory });
  }
}

/**
 * Generates and stores an AI pre-visit clinical summary for a given appointment,
 * scoped from the last completed visit up to this appointment.
 */
async function generatePreVisitSummary(appointmentId) {
  const startTime = Date.now();

  // 1. Fetch appointment
  const { data: appointment, error: apptError } = await supabaseAdmin
    .from('appointments')
    .select('id, patient_id, clinician_id, scheduled_at, status')
    .eq('id', appointmentId)
    .single();

  if (apptError || !appointment) {
    throw new Error('Appointment not found');
  }

  // 2. Fetch patient details
  const { data: patientDetails } = await supabaseAdmin
    .from('patient_details')
    .select('*')
    .eq('profile_id', appointment.patient_id)
    .maybeSingle();

  // 3. Compute interval: from last completed appointment up to this appointment
  const targetTime = appointment.scheduled_at || new Date().toISOString();
  const { data: prevAppointment } = await supabaseAdmin
    .from('appointments')
    .select('id, scheduled_at, status')
    .eq('patient_id', appointment.patient_id)
    .eq('status', 'completed')
    .lt('scheduled_at', targetTime)
    .order('scheduled_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  let intervalStart;
  let intervalDescription;
  if (prevAppointment && prevAppointment.scheduled_at) {
    intervalStart = prevAppointment.scheduled_at;
    const days = Math.max(1, Math.round((new Date(targetTime) - new Date(intervalStart)) / (1000 * 60 * 60 * 24)));
    const prevDateStr = new Date(intervalStart).toISOString().split('T')[0];
    intervalDescription = `${days} days since last visit (${prevDateStr})`;
  } else {
    const cutoffMs = config.lookbackDays * 24 * 60 * 60 * 1000;
    intervalStart = new Date(new Date(targetTime).getTime() - cutoffMs).toISOString();
    intervalDescription = `Initial pre-visit summary (${config.lookbackDays} days lookback)`;
  }
  const intervalEnd = targetTime;

  // 4. Fetch check-in sessions & answers in interval
  const { data: recentSessions, error: sessionsError } = await supabaseAdmin
    .from('patient_checkin_sessions')
    .select('*, patient_checkin_answers(*)')
    .eq('patient_id', appointment.patient_id)
    .gte('created_at', intervalStart)
    .order('created_at', { ascending: false });

  if (sessionsError) {
    throw sessionsError;
  }

  // 5. Fetch recent vitals in interval
  const { data: recentVitals } = await supabaseAdmin
    .from('vitals_logs')
    .select('metric_key, value, unit, recorded_at')
    .eq('patient_id', appointment.patient_id)
    .gte('recorded_at', intervalStart)
    .order('recorded_at', { ascending: false });

  // 5.5 Fetch wearable device metrics trajectory in interval
  const deviceTrajectory = await computeMetricsTrajectory(
    appointment.patient_id,
    intervalStart,
    intervalEnd
  );

  // 6. Generate synthesis
  const synthesis = await callGeminiSynthesizer({
    patientDetails,
    recentSessions: recentSessions || [],
    recentVitals: recentVitals || [],
    intervalDescription,
    deviceTrajectory,
  });

  // 7. Persist to visit_ai_summaries
  const summaryPayload = {
    appointment_id: appointmentId,
    patient_id: appointment.patient_id,
    clinician_id: appointment.clinician_id,
    clinical_risk_level: synthesis.clinical_risk_level || 'low',
    red_flags: synthesis.red_flags || [],
    mental_health_assessment: synthesis.mental_health_assessment || '',
    physical_symptom_trajectory: synthesis.physical_symptom_trajectory || '',
    medication_compliance: synthesis.medication_compliance || '',
    patient_top_questions: synthesis.patient_top_questions || [],
    doctor_talking_points: synthesis.doctor_talking_points || '',
    raw_llm_output: synthesis,
    model_version: config.geminiModel,
    interval_start: intervalStart,
    interval_end: intervalEnd,
    interval_description: intervalDescription,
    updated_at: new Date().toISOString(),
  };

  const { data: savedSummary, error: saveError } = await supabaseAdmin
    .from('visit_ai_summaries')
    .upsert(summaryPayload, { onConflict: 'appointment_id' })
    .select()
    .single();

  if (saveError) {
    logger.error('Failed to save visit AI summary', {
      scope: 'checkin_ai',
      appointmentId,
      err: saveError.message,
    });
    throw saveError;
  }

  const durationMs = Date.now() - startTime;
  logger.info('Generated visit AI summary', {
    scope: 'checkin_ai',
    appointmentId,
    riskLevel: savedSummary.clinical_risk_level,
    durationMs,
  });

  return savedSummary;
}

/**
 * Fetches an existing summary for an appointment.
 */
async function getPreVisitSummary(appointmentId) {
  const { data, error } = await supabaseAdmin
    .from('visit_ai_summaries')
    .select('*')
    .eq('appointment_id', appointmentId)
    .maybeSingle();

  if (error) {
    logger.error('Failed to get visit AI summary', {
      scope: 'checkin_ai',
      appointmentId,
      err: error.message,
    });
    throw error;
  }

  return data;
}

module.exports = {
  generatePreVisitSummary,
  getPreVisitSummary,
  buildDeterministicSummary,
};
