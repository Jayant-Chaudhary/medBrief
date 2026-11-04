const supabaseAdmin = require('../config/supabaseAdminClient');
const logger = require('../utils/logger');
const config = require('../config/deviceMetrics.config');

/**
 * Upsert daily wearable/physical metrics from Health Connect or other verified sources.
 * Safe to retry (idempotent on patient_id + metric_date + source).
 */
async function syncDeviceMetrics(patientId, metricsList) {
  if (!metricsList || metricsList.length === 0) {
    return { syncedCount: 0, success: true };
  }

  const rows = metricsList.map((m) => ({
    patient_id: patientId,
    metric_date: m.metricDate,
    steps: m.steps !== undefined ? m.steps : null,
    distance_meters: m.distanceMeters !== undefined ? m.distanceMeters : null,
    active_minutes: m.activeMinutes !== undefined ? m.activeMinutes : null,
    resting_heart_rate: m.restingHeartRate !== undefined ? m.restingHeartRate : null,
    sleep_minutes: m.sleepMinutes !== undefined ? m.sleepMinutes : null,
    weight_kg: m.weightKg !== undefined ? m.weightKg : null,
    blood_pressure_systolic: m.bloodPressureSystolic !== undefined ? m.bloodPressureSystolic : null,
    blood_pressure_diastolic: m.bloodPressureDiastolic !== undefined ? m.bloodPressureDiastolic : null,
    blood_glucose_mg_dl: m.bloodGlucoseMgDl !== undefined ? m.bloodGlucoseMgDl : null,
    source: m.source || 'health_connect',
    synced_at: new Date().toISOString(),
  }));

  const { data, error } = await supabaseAdmin
    .from('patient_device_metrics')
    .upsert(rows, { onConflict: 'patient_id,metric_date,source' })
    .select();

  if (error) {
    logger.error('Failed to sync device metrics', {
      scope: 'device_metrics',
      patientId,
      recordCount: rows.length,
      errorCode: error.code || 'UPSERT_FAILED',
    });
    throw error;
  }

  // Safe audit log: IDs, count and timings only; zero health values in logs
  logger.info('Device metrics synced successfully', {
    scope: 'device_metrics',
    patientId,
    syncedCount: data ? data.length : rows.length,
  });

  return {
    syncedCount: data ? data.length : rows.length,
    success: true,
  };
}

/**
 * Retrieve patient daily metrics for a date range.
 */
async function getPatientDeviceMetrics(patientId, { startDate, endDate, limit = 30 } = {}) {
  let query = supabaseAdmin
    .from('patient_device_metrics')
    .select('*')
    .eq('patient_id', patientId)
    .order('metric_date', { ascending: false });

  if (startDate) {
    query = query.gte('metric_date', startDate);
  }
  if (endDate) {
    query = query.lte('metric_date', endDate);
  }
  if (limit) {
    query = query.limit(limit);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

/**
 * Computes longitudinal physical trajectory and baseline comparisons
 * across an appointment interval or recent lookback.
 */
async function computeMetricsTrajectory(patientId, intervalStart, intervalEnd) {
  const targetEnd = intervalEnd ? new Date(intervalEnd) : new Date();
  const targetStart = intervalStart
    ? new Date(intervalStart)
    : new Date(targetEnd.getTime() - config.defaultLookbackDays * 24 * 60 * 60 * 1000);

  const startIsoDate = targetStart.toISOString().split('T')[0];
  const endIsoDate = targetEnd.toISOString().split('T')[0];

  const records = await getPatientDeviceMetrics(patientId, {
    startDate: startIsoDate,
    endDate: endIsoDate,
    limit: 60,
  });

  if (!records || records.length === 0) {
    return {
      hasData: false,
      daysTracked: 0,
      summary: 'No wearable device data synced for this interval.',
      flags: [],
      dailyMetrics: [],
    };
  }

  // Split into recent 7 days vs prior days for trend calculation
  const sevenDaysAgo = new Date(targetEnd.getTime() - 7 * 24 * 60 * 60 * 1000);
  const recentRecords = [];
  const priorRecords = [];

  for (const r of records) {
    const recordDate = new Date(r.metric_date);
    if (recordDate >= sevenDaysAgo) {
      recentRecords.push(r);
    } else {
      priorRecords.push(r);
    }
  }

  // 1. Steps & Mobility
  const recentStepsArr = recentRecords.filter((r) => r.steps !== null).map((r) => r.steps);
  const priorStepsArr = priorRecords.filter((r) => r.steps !== null).map((r) => r.steps);

  const avgRecentSteps = recentStepsArr.length > 0
    ? Math.round(recentStepsArr.reduce((a, b) => a + b, 0) / recentStepsArr.length)
    : null;
  const avgPriorSteps = priorStepsArr.length > 0
    ? Math.round(priorStepsArr.reduce((a, b) => a + b, 0) / priorStepsArr.length)
    : null;

  let stepsTrendPercent = null;
  let mobilityAlert = false;
  if (avgRecentSteps !== null && avgPriorSteps !== null && avgPriorSteps > 0) {
    stepsTrendPercent = Math.round(((avgRecentSteps - avgPriorSteps) / avgPriorSteps) * 100);
    if (stepsTrendPercent <= -config.thresholds.alertMobilityDropPercent && avgPriorSteps >= 1500) {
      mobilityAlert = true;
    }
  }

  // 2. Resting Heart Rate (RHR)
  const rhrArr = records.filter((r) => r.resting_heart_rate !== null).map((r) => Number(r.resting_heart_rate));
  const avgRestingHr = rhrArr.length > 0
    ? Math.round((rhrArr.reduce((a, b) => a + b, 0) / rhrArr.length) * 10) / 10
    : null;
  const peakRestingHr = rhrArr.length > 0 ? Math.max(...rhrArr) : null;
  const tachycardiaAlert = peakRestingHr !== null && peakRestingHr >= config.thresholds.alertRestingHrBpm;

  // 3. Sleep
  const sleepArr = records.filter((r) => r.sleep_minutes !== null).map((r) => r.sleep_minutes);
  const avgSleepMinutes = sleepArr.length > 0
    ? Math.round(sleepArr.reduce((a, b) => a + b, 0) / sleepArr.length)
    : null;
  const avgSleepHours = avgSleepMinutes !== null ? Math.round((avgSleepMinutes / 60) * 10) / 10 : null;
  const sleepDeficitAlert = avgSleepHours !== null && avgSleepHours < config.thresholds.alertSleepDeficitHours;

  // 4. Blood Pressure from device
  const bpRecords = records.filter((r) => r.blood_pressure_systolic !== null && r.blood_pressure_diastolic !== null);
  const latestBp = bpRecords.length > 0
    ? {
        systolic: bpRecords[0].blood_pressure_systolic,
        diastolic: bpRecords[0].blood_pressure_diastolic,
        metricDate: bpRecords[0].metric_date,
      }
    : null;
  const bpAlert = latestBp !== null && (
    latestBp.systolic >= config.thresholds.alertBpSystolic ||
    latestBp.diastolic >= config.thresholds.alertBpDiastolic
  );

  // 5. Weight
  const weightRecords = records.filter((r) => r.weight_kg !== null);
  const latestWeight = weightRecords.length > 0 ? Number(weightRecords[0].weight_kg) : null;
  let weightGainAlert = false;
  let weightDeltaKg = null;
  if (weightRecords.length >= 2) {
    const oldestWeight = Number(weightRecords[weightRecords.length - 1].weight_kg);
    weightDeltaKg = Math.round((latestWeight - oldestWeight) * 10) / 10;
    if (weightDeltaKg >= config.thresholds.alertRapidWeightGainKgPerWeek) {
      weightGainAlert = true;
    }
  }

  // Construct clinical flags (prioritises, never diagnoses)
  const flags = [];
  if (mobilityAlert) {
    flags.push(`Marked physical mobility drop: daily steps reduced by ${Math.abs(stepsTrendPercent)}% over the last 7 days`);
  }
  if (tachycardiaAlert) {
    flags.push(`Elevated resting heart rate observed: peaked at ${peakRestingHr} bpm (interval average: ${avgRestingHr} bpm)`);
  }
  if (sleepDeficitAlert) {
    flags.push(`Significant sleep deficit: averaging ${avgSleepHours} hours/night over tracked interval`);
  }
  if (bpAlert) {
    flags.push(`Wearable/home blood pressure alert: recorded at ${latestBp.systolic}/${latestBp.diastolic} mmHg`);
  }
  if (weightGainAlert) {
    flags.push(`Rapid weight increase: +${weightDeltaKg} kg logged over interval`);
  }

  return {
    hasData: true,
    daysTracked: records.length,
    avgRecentSteps,
    avgPriorSteps,
    stepsTrendPercent,
    avgRestingHr,
    peakRestingHr,
    avgSleepHours,
    latestBp,
    latestWeight,
    weightDeltaKg,
    flags,
    mobilityAlert,
    tachycardiaAlert,
    sleepDeficitAlert,
    bpAlert,
    weightGainAlert,
    dailyMetrics: records.slice(0, 14),
  };
}

module.exports = {
  syncDeviceMetrics,
  getPatientDeviceMetrics,
  computeMetricsTrajectory,
};

