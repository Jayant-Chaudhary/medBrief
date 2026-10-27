const { z } = require('zod');

const dateField = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional();
const textField = z.string().trim().max(5000).nullable().optional();
const numericField = z.number().finite().nullable().optional();
const intField = z.number().int().min(0).nullable().optional();

const episodeSchema = z.object({
  status: z.enum(['ongoing', 'completed', 'other']).optional(),
  first_anc_date: dateField,
  last_menstrual_period: dateField,
  due_date: dateField,
  date_of_quickening: dateField,
  gravida: intField,
  para: intField,
  chest_history: textField,
  cvs_history: textField,
  alcohol_history: textField,
  smoking_history: textField,
  vomiting_history: textField,
  discharge_history: textField,
  bleeding_history: textField,
});

const recordSchemas = {
  antenatal_visits: z.object({
    visit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    appointment_id: z.string().uuid().nullable().optional(),
    weight_kg: numericField,
    bp_systolic: numericField,
    bp_diastolic: numericField,
    gestational_weeks: intField,
    gestational_days: intField,
    fundal_height_cm: numericField,
    present_position: textField,
    relation_presentation_to_brim: textField,
    fetal_heart_rate: textField,
    urine_albumin: textField,
    urine_sugar: textField,
    tsh: numericField,
    hemoglobin_percent: numericField,
    next_visit_date: dateField,
    signature: textField,
    advice: textField,
  }),
  pregnancy_investigations: z.object({
    investigation_key: z.string().trim().max(100).nullable().optional(),
    investigation_name: z.string().trim().min(1).max(200),
    performed_on: dateField,
    result_text: textField,
    result_value: numericField,
    result_unit: z.string().trim().max(80).nullable().optional(),
    lab_report_id: z.string().uuid().nullable().optional(),
  }),
  pregnancy_ultrasounds: z.object({
    performed_on: dateField,
    report_text: textField,
  }),
  pregnancy_vaccinations: z.object({
    vaccine_name: z.string().trim().min(1).max(200),
    dose_label: z.string().trim().max(100).nullable().optional(),
    administered_on: dateField,
    notes: textField,
  }),
};

const deliverySchema = z.object({
  delivery_type: textField,
  indication: textField,
  delivered_at: z.string().datetime().nullable().optional(),
  baby_sex: z.string().trim().max(40).nullable().optional(),
  baby_weight_kg: numericField,
  apgar_score: z.string().trim().max(80).nullable().optional(),
  postnatal_advice: textField,
  next_visit_date: dateField,
});

module.exports = { episodeSchema, recordSchemas, deliverySchema };
