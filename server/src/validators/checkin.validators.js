const { z } = require('zod');

const answerItemSchema = z.object({
  category: z.enum(['physical', 'mental', 'medical', 'concern']),
  questionKey: z.string().min(1, 'questionKey is required'),
  questionText: z.string().min(1, 'questionText is required'),
  answerType: z.enum(['boolean', 'scale', 'text']),
  boolValue: z.boolean().optional().nullable(),
  scaleValue: z.number().int().min(1).max(5).optional().nullable(),
  textValue: z.string().optional().nullable(),
  isRedFlag: z.boolean().optional().default(false),
});

const submitCheckinSchema = z.object({
  appointmentId: z.string().uuid('Invalid appointment ID format').optional().nullable(),
  sessionType: z.enum(['routine_weekly', 'quick_pulse', 'ad_hoc_concern', 'pre_visit']),
  gestationalWeek: z.number().int().min(1).max(45).optional().nullable(),
  answers: z.array(answerItemSchema).min(1, 'At least one answer is required'),
});

const adHocConcernSchema = z.object({
  category: z.enum(['physical', 'mental', 'medical', 'concern']).optional().default('concern'),
  description: z.string().min(2, 'Description must be at least 2 characters'),
  severity: z.enum(['mild', 'moderate', 'severe']).optional().default('mild'),
  gestationalWeek: z.number().int().min(1).max(45).optional().nullable(),
});

const quickPulseSchema = z.object({
  comfortRating: z.number().int().min(1).max(5),
  discomforts: z.array(z.string()).optional().default([]),
  notes: z.string().optional().nullable(),
  gestationalWeek: z.number().int().min(1).max(45).optional().nullable(),
});

const appointmentParamSchema = z.object({
  appointmentId: z.string().uuid('Invalid appointment ID format'),
});

module.exports = {
  answerItemSchema,
  submitCheckinSchema,
  adHocConcernSchema,
  quickPulseSchema,
  appointmentParamSchema,
};
