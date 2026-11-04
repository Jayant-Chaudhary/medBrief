const { z } = require('zod');
const config = require('../config/deviceMetrics.config');

const metricItemSchema = z.object({
  metricDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'metricDate must be in YYYY-MM-DD format'),
  steps: z.number().int().min(0).max(100000).optional().nullable(),
  distanceMeters: z.number().min(0).max(200000).optional().nullable(),
  activeMinutes: z.number().int().min(0).max(1440).optional().nullable(),
  restingHeartRate: z.number().min(30).max(250).optional().nullable(),
  sleepMinutes: z.number().int().min(0).max(1440).optional().nullable(),
  weightKg: z.number().min(20).max(300).optional().nullable(),
  bloodPressureSystolic: z.number().int().min(50).max(260).optional().nullable(),
  bloodPressureDiastolic: z.number().int().min(30).max(180).optional().nullable(),
  bloodGlucoseMgDl: z.number().min(20).max(600).optional().nullable(),
  source: z.enum(['health_connect', 'apple_health', 'manual', 'simulator']).optional().default('health_connect'),
});

const syncDeviceMetricsSchema = z.object({
  metrics: z.array(metricItemSchema)
    .min(1, 'At least one metric record is required')
    .max(config.maxSyncBatchSize, `Batch size cannot exceed ${config.maxSyncBatchSize}`),
});

module.exports = {
  metricItemSchema,
  syncDeviceMetricsSchema,
};

