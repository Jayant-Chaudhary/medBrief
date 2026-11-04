const { z } = require('zod');

const nullableText = z.string().trim().max(200).nullish();

/** Fields any signed-in user may change about themselves. */
const baseProfileSchema = {
  fullName: z.string().trim().min(1).max(200).optional(),
  phone: nullableText,
};

const patientProfileSchema = z.object({
  ...baseProfileSchema,
  dateOfBirth: z.string().date().nullish(),
  dueDate: z.string().date().nullish(),
  bloodType: z.string().trim().max(10).nullish(),
  address: z.string().trim().max(500).nullish(),
  emergencyContactName: nullableText,
  emergencyContactPhone: nullableText,
});

const clinicianProfileSchema = z.object({
  ...baseProfileSchema,
  specialty: nullableText,
  licenseNumber: nullableText,
  stateMedicalCouncil: nullableText,
});

/**
 * Verification status is granted by an administrator, never self-declared, so
 * `is_verified` is deliberately absent from the clinician schema above.
 */
module.exports = { patientProfileSchema, clinicianProfileSchema };
