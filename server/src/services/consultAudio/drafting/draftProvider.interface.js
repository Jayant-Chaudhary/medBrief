/**
 * Draft Provider Interface for Clinical Notes Generation (Phase 8).
 */

class DraftProviderInterface {
  /**
   * Generates Doctor Notes from transcript and structured context.
   * @param {Object} params
   * @param {Array} params.transcript - Merged transcript segments with segment_id, speaker, text
   * @param {Object} params.structuredContext - Intake, verified labs, vitals, ultrasound
   * @param {Array} params.tracerCatalog - Verified tracer items
   * @returns {Promise<{ data: Object, latencyMs: number }>}
   */
  async generateDoctorNotes(_params) {
    throw new Error('generateDoctorNotes() must be implemented by provider');
  }

  /**
   * Generates Patient-facing summary and action checklist.
   * @param {Object} params
   * @returns {Promise<{ data: Object, latencyMs: number }>}
   */
  async generatePatientSummary(_params) {
    throw new Error('generatePatientSummary() must be implemented by provider');
  }

  /**
   * Generates Operational Clinical Flags.
   * @param {Object} params
   * @returns {Promise<{ data: Object, latencyMs: number }>}
   */
  async generateClinicalFlags(_params) {
    throw new Error('generateClinicalFlags() must be implemented by provider');
  }

  /**
   * Runs the 3 generation tasks and returns full draft payload.
   * Tasks are executed sequentially to avoid concurrent request collisions
   * and 503 high-demand spike errors on external LLM APIs (e.g. Gemini).
   * @param {Object} params
   * @returns {Promise<{ doctorNotes: Object, patientSummary: Object, clinicalFlags: Array, latencyMs: number, provider: string, modelVersion: string }>}
   */
  async generateDraft(params) {
    const start = Date.now();
    const docRes = await this.generateDoctorNotes(params);
    const patRes = await this.generatePatientSummary(params);
    const flagRes = await this.generateClinicalFlags(params);

    const totalLatencyMs = Date.now() - start;

    return {
      doctorNotes: docRes.data,
      patientSummary: patRes.data,
      clinicalFlags: flagRes.data?.flags || (Array.isArray(flagRes.data) ? flagRes.data : []),
      droppedUncitedFlags: flagRes.droppedUncited || 0,
      droppedUncitedRecommendations: docRes.droppedUncited || 0,
      latencyMs: totalLatencyMs,
      provider: this.name,
      modelVersion: this.modelVersion,
    };
  }
}

module.exports = DraftProviderInterface;
