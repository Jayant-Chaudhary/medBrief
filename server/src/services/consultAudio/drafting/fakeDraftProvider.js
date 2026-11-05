/**
 * Fake Draft Provider for Deterministic Unit & CI Testing (Phase 8).
 *
 * Provides deterministic schema-compliant clinical drafts using actual segment_ids
 * and verified tracers from input data with zero network I/O.
 * Supports configurable failure simulation for test coverage.
 */

const DraftProviderInterface = require('./draftProvider.interface');
const {
  DoctorNotesSchema,
  PatientSummarySchema,
  ClinicalFlagsSchema,
} = require('./draftSchemas');

class FakeDraftProvider extends DraftProviderInterface {
  constructor(options = {}) {
    super();
    this.name = 'fake';
    this.modelVersion = options.model || 'fake-draft-model:v1';
    this.simulateInvalidCitation = options.simulateInvalidCitation || false;
    this.simulateUnverifiedNumber = options.simulateUnverifiedNumber || false;
    this.simulateTimeout = options.simulateTimeout || false;
    this.simulateSchemaError = options.simulateSchemaError || false;
    this.simulatedLatencyMs = options.simulatedLatencyMs || 10;
  }

  async _simulateDelay() {
    if (this.simulateTimeout) {
      throw new Error('Fake draft provider simulated timeout');
    }
    if (this.simulatedLatencyMs > 0) {
      await new Promise((r) => setTimeout(r, this.simulatedLatencyMs));
    }
  }

  async generateDoctorNotes({ transcript = [], structuredContext = {}, tracerCatalog = [] }) {
    await this._simulateDelay();

    if (this.simulateSchemaError) {
      return { data: { invalid_key: true }, latencyMs: 5 };
    }

    const validIds = transcript.map((s) => s.id || s.segment_id).filter(Boolean);
    const cite1 = this.simulateInvalidCitation
      ? 'seg-hallucinated-9999'
      : validIds[0] || 'seg-doc-0001';
    const cite2 = validIds[1] || validIds[0] || 'seg-pat-0002';

    // Find a verified tracer if present
    const hbTracer = tracerCatalog.find((t) => t.metric.includes('hemoglobin') || t.metric.includes('hb'));
    const bpTracer = tracerCatalog.find((t) => t.metric.includes('bp'));

    const vitalsObserved = bpTracer
      ? `Blood pressure verified at ${bpTracer.value} ${bpTracer.unit}`
      : 'Vitals reviewed during consultation.';

    const planText = this.simulateUnverifiedNumber
      ? 'Unverified platelet count 85000 stated without disclaimer.'
      : (hbTracer
        ? `Continue iron supplement for verified hemoglobin of ${hbTracer.value} ${hbTracer.unit}.`
        : 'Continue daily nutritional supplements after dinner.');

    const draft = {
      chief_complaint: 'Routine antenatal checkup; discussion of fatigue and diet.',
      vitals_observed: vitalsObserved,
      assessment: 'Antenatal evaluation showing stable progression with managed nutritional needs.',
      plan_and_recommendations: [
        {
          recommendation: planText,
          cited_segment_ids: [cite1],
        },
        {
          recommendation: 'Maintain left lateral resting posture and adequate hydration.',
          cited_segment_ids: [cite2],
        },
      ],
    };

    return { data: DoctorNotesSchema.parse(draft), latencyMs: 10 };
  }

  async generatePatientSummary({ transcript = [], structuredContext = {}, tracerCatalog = [] }) {
    await this._simulateDelay();

    const summary = {
      summary_text: 'Your consultation went well today. Your vital parameters and checkup progress were discussed thoroughly.',
      action_checklist: [
        'Take iron supplement once daily after dinner',
        'Drink at least 2 to 3 liters of water daily',
        'Monitor and note daily fetal movements',
      ],
      warning_signs: [
        'Severe persistent headache or vision disturbances',
        'Sudden swelling of hands or face',
        'Any fluid leakage or bleeding',
      ],
    };

    return { data: PatientSummarySchema.parse(summary), latencyMs: 10 };
  }

  async generateClinicalFlags({ transcript = [], structuredContext = {}, tracerCatalog = [] }) {
    await this._simulateDelay();

    const validIds = transcript.map((s) => s.id || s.segment_id).filter(Boolean);
    const cite1 = this.simulateInvalidCitation
      ? 'seg-hallucinated-8888'
      : validIds[0] || 'seg-doc-0001';

    const flags = {
      flags: [
        {
          flag_name: 'nutritional_supplementation_review',
          severity: 'low',
          description: 'Patient requested guidance on iron tablet schedule and absorption.',
          cited_segment_ids: [cite1],
        },
      ],
    };

    return { data: ClinicalFlagsSchema.parse(flags), latencyMs: 10 };
  }
}

module.exports = FakeDraftProvider;
