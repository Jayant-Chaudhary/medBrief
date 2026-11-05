const { z } = require('zod');

// [x0, y0, x1, y1] as fractions of the page, with a positive area.
const pageBox = z
  .array(z.number().min(0).max(1))
  .length(4)
  .refine(([x0, y0, x1, y1]) => x1 > x0 && y1 > y0, 'box must have a positive area');

// Where the OCR pipeline found a value on the report (see the
// metric_source_location migration). The value box may be missing.
const metricSourceSchema = z.object({
  page: z.number().int().min(1),
  row: pageBox,
  value: pageBox.nullable().optional(),
});

// Shape of one metric inside the OCR pipeline's JSON payload.
const ocrMetricSchema = z.object({
  key: z.string().min(1), // raw key, e.g. "HGB"
  value: z.union([z.string(), z.number()]),
  unit: z.string().optional(),
  confidence: z.number().min(0).max(1).optional(),
  source: metricSourceSchema.nullable().optional(),
});

// Full payload the server expects at POST /lab-reports.
const ocrPayloadSchema = z.object({
  appointmentId: z.string().uuid().optional(),
  storagePath: z.string().min(1),
  reportDate: z.string().optional(), // ISO date string
  metrics: z.array(ocrMetricSchema).default([]),
  ocrStatus: z.enum(['success', 'partial', 'failed']).default('success'),
});

const shareReportSchema = z.object({
  appointmentId: z.string().uuid(),
});

const reviewMetricSchema = z.object({
  standardKey: z.string().min(1).optional(),
  reviewedValue: z.number().optional(),
});

module.exports = { ocrPayloadSchema, reviewMetricSchema, shareReportSchema, metricSourceSchema };
