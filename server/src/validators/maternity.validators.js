const { z } = require('zod');
const validateBody = require('../middleware/validateBody');

// The card sends every value as text; an empty box ('') means "clear this field".
const text = (max = 2000) => z.string().trim().max(max).optional();
const requiredText = (max = 2000) => z.string().trim().min(1, 'Required').max(max);

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const date = z.union([z.literal(''), z.string().regex(DATE, 'Use YYYY-MM-DD')]).optional();
const requiredDate = z.string().regex(DATE, 'Use YYYY-MM-DD');
const dateTime = z
  .union([z.literal(''), z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/, 'Use YYYY-MM-DDTHH:MM')])
  .optional();

const number = z
  .union([z.literal(''), z.coerce.string().regex(/^\d+(\.\d+)?$/, 'Must be a number')])
  .optional();
const wholeNumber = (max) =>
  z
    .union([
      z.literal(''),
      z.coerce
        .string()
        .regex(/^\d+$/, 'Must be a whole number')
        .refine((v) => max === undefined || Number(v) <= max, `Must be ${max} or less`),
    ])
    .optional();

// The card offers "A−" (a true minus sign); the database stores "A-".
const bloodGroup = z.preprocess(
  (v) => (typeof v === 'string' ? v.replace('−', '-') : v),
  z.union([z.literal(''), z.enum(['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-'])]).optional()
);

/** A follow-up date ("next visit", "next dose") cannot come before the entry itself. */
function nextNotBefore(row, ctx) {
  if (row.next && row.date && row.next < row.date) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['next'], message: 'Must be on or after the entry date' });
  }
}

// Patient details + first-attendance baseline (one per pregnancy).
const episodeSchema = z.object({
  attendance: date,
  lmp: date,
  edd: date,
  gravida: wholeNumber(),
  para: wholeNumber(),
  living: wholeNumber(),
  abortions: wholeNumber(),
  history: text(5000),
  blood: bloodGroup,
  chest: text(),
  cvs: text(),
  resultsDate: date,
  hb: number,
  tsh: number,
  results: text(5000),
});

const deliverySchema = z.object({
  type: text(100),
  when: dateTime,
  indication: text(),
  sex: text(50),
  weight: number,
  apgar1: wholeNumber(10),
  apgar5: wholeNumber(10),
  next: date,
  advice: text(5000),
});

// Repeating rows on the card: one schema per section.
const sectionSchemas = {
  visits: z
    .object({
      date: requiredDate,
      weight: number,
      systolic: number,
      diastolic: number,
      weeks: wholeNumber(60),
      days: wholeNumber(6),
      fundal: number,
      presentation: text(100),
      brim: text(100),
      fhr: text(50),
      albumin: text(50),
      sugar: text(50),
      hb: number,
      tsh: number,
      next: date,
      clinician: text(200),
      advice: text(5000),
    })
    .superRefine(nextNotBefore),
  labs: z.object({
    date: requiredDate,
    test: requiredText(200),
    result: requiredText(200),
    unit: text(50),
    notes: text(),
  }),
  scans: z.object({
    date: requiredDate,
    weeks: wholeNumber(60),
    days: wholeNumber(6),
    report: requiredText(5000),
  }),
  vaccines: z
    .object({
      name: requiredText(200),
      dose: text(200),
      date: requiredDate,
      next: date,
      notes: text(),
    })
    .superRefine(nextNotBefore),
};

/** Validates a section row against that section's schema; unknown sections are 404. */
function validateSection(req, res, next) {
  const schema = sectionSchemas[req.params.section];
  if (!schema) return res.status(404).json({ error: 'Unknown card section' });
  return validateBody(schema)(req, res, next);
}

module.exports = { episodeSchema, deliverySchema, sectionSchemas, validateSection };
