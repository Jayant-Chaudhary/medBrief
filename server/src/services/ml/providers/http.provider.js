const axios = require('axios');
const { validateModelResponse } = require('../contracts');

const TASK_ENDPOINTS = Object.freeze({
  maternal_risk: '/v1/maternal-risk/predict',
  patient_similarity: '/v1/patient-similarity/rank',
  medication_template_recommendation: '/v1/medication-template-recommendations/rank',
});

function createHttpProvider({ task, baseUrl, apiKey, timeoutMs }) {
  const endpoint = TASK_ENDPOINTS[task];
  if (!endpoint) throw new Error(`Unsupported ML task: ${task}`);

  const client = axios.create({
    baseURL: baseUrl.replace(/\/$/, ''),
    timeout: timeoutMs,
    headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : {},
  });

  return {
    name: 'http',
    task,
    configured: true,
    async predict(input) {
      // The caller supplies a minimized, structured feature payload. Keep
      // patient names, contact details, and uploaded files out of model calls.
      const { data } = await client.post(endpoint, { task, input });
      const response = validateModelResponse(task, data);

      return {
        available: true,
        task,
        provider: 'http',
        modelVersion: response.modelVersion,
        results: response.results,
      };
    },
  };
}

module.exports = { createHttpProvider };
