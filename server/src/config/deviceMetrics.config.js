/**
 * Configuration for patient wearable device metrics (Android Health Connect / Apple Health).
 * All tunable parameters, thresholds, and limits live here, not hardcoded in business logic.
 */

module.exports = {
  defaultLookbackDays: Number(process.env.DEVICE_METRICS_LOOKBACK_DAYS || 28),
  trajectoryWindowDays: Number(process.env.DEVICE_METRICS_TRAJECTORY_DAYS || 7),
  maxSyncBatchSize: Number(process.env.DEVICE_METRICS_MAX_SYNC_BATCH || 60),

  // Configured placeholder thresholds for clinical flagging (prioritises, never diagnoses)
  thresholds: {
    alertRestingHrBpm: Number(process.env.ALERT_RESTING_HR_BPM || 100),
    alertBpSystolic: Number(process.env.ALERT_BP_SYSTOLIC || 140),
    alertBpDiastolic: Number(process.env.ALERT_BP_DIASTOLIC || 90),
    alertMobilityDropPercent: Number(process.env.ALERT_MOBILITY_DROP_PERCENT || 40),
    alertSleepDeficitHours: Number(process.env.ALERT_SLEEP_DEFICIT_HOURS || 5.5),
    alertRapidWeightGainKgPerWeek: Number(process.env.ALERT_RAPID_WEIGHT_GAIN_KG || 1.5),
  },
};

