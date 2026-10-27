const { z } = require('zod');

const factorSchema = z.string().trim().min(1).max(240);
const episodeRef = z.string().min(1).max(120);

const resultSchemas = Object.freeze({
  maternal_risk: z.object({
    episodeRef,
    score: z.number().min(0).max(1),
    riskLevel: z.enum(['low', 'moderate', 'high']),
    horizonDays: z.number().int().positive().optional(),
    explanation: z.string().trim().min(1).max(2000),
    contributingFactors: z.array(factorSchema).max(30).default([]),
  }),
  patient_similarity: z.object({
    groupKey: z.string().trim().min(1).max(120),
    members: z.array(z.object({ episodeRef, similarityScore: z.number().min(0).max(1) })).max(500),
    matchReasons: z.array(factorSchema).max(30).default([]),
  }),
  medication_template_recommendation: z.object({
    episodeRef,
    templateId: z.string().uuid(),
    score: z.number().min(0).max(1),
    matchReasons: z.array(factorSchema).max(30).default([]),
  }),
});

function validateModelResponse(task, payload) {
  const resultSchema = resultSchemas[task];
  if (!resultSchema) throw new Error(`No response contract registered for ML task: ${task}`);

  const envelope = z.object({
    modelVersion: z.string().trim().min(1).max(120),
    results: z.array(resultSchema).max(1000),
  }).safeParse(payload);

  if (!envelope.success) {
    const error = new Error('ML provider response did not match the task contract');
    error.code = 'ML_INVALID_RESPONSE';
    error.details = envelope.error.flatten();
    throw error;
  }
  return envelope.data;
}

module.exports = { resultSchemas, validateModelResponse };
