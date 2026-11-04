/**
 * Client Service for Patient Similarity API.
 *
 * Provides functions to:
 * 1. Fetch configured parameter weights (structured and symptoms).
 * 2. Evaluate direct patient similarity (with optional custom weights, cohort source, and gestational window).
 * 3. Fetch synthetic cohort catalog for preview/testing.
 */

import { request } from './apiClient.js';

export function isPatientSimilarityEnabled() {
  return import.meta.env.VITE_PATIENT_SIMILARITY_ENABLED !== 'false';
}

export function isSimilaritySyntheticDataAllowed() {
  return import.meta.env.VITE_PATIENT_SIMILARITY_USE_SYNTHETIC_DATA !== 'false';
}

export async function fetchSimilarityWeights() {
  return request('/api/patient-similarity/weights');
}

export async function fetchSyntheticCohortCatalog(options = {}) {
  const query = options.includeGenerated ? '?includeGenerated=true' : '';
  return request(`/api/patient-similarity/synthetic-cohort${query}`);
}

export async function evaluatePatientSimilarity({ queryPatient, options = {}, referenceCohort = null }) {
  const body = {
    queryPatient,
    options,
  };
  if (Array.isArray(referenceCohort) && referenceCohort.length > 0) {
    body.referenceCohort = referenceCohort;
  }

  return request('/api/patient-similarity/evaluate-direct', {
    method: 'POST',
    body,
  });
}
