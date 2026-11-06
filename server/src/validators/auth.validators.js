const { z } = require('zod');

const acceptInviteSchema = z.object({
  token: z.string().min(10),
  password: z.string().min(8),
});

const signupSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  fullName: z.string().optional(),
  // Receptionist is reserved for staff an administrator creates. A clinician
  // may self-register but gets no clinical access until verified.
  role: z.enum(['patient', 'clinician']).default('patient'),
  phone: z.string().optional(),
});

module.exports = { acceptInviteSchema, signupSchema };
