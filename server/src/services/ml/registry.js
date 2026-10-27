const env = require('../../config/env');
const { TASKS } = require('./tasks');
const { createDisabledProvider } = require('./providers/disabled.provider');
const { createHttpProvider } = require('./providers/http.provider');

/**
 * Task-specific provider registry. Models can be replaced independently
 * without coupling controllers to an ML vendor, runtime, or model format.
 */
function createModelRegistry({ providers = {}, config = env.ml } = {}) {
  const registry = new Map();
  const taskServiceUrls = {
    [TASKS.maternalRisk]: config.maternalRiskUrl || config.serviceUrl,
    [TASKS.patientSimilarity]: config.patientSimilarityUrl || config.serviceUrl,
    [TASKS.medicationTemplateRecommendation]: config.templateRecommendationUrl || config.serviceUrl,
  };

  for (const task of Object.values(TASKS)) {
    const taskUrl = taskServiceUrls[task];
    const provider = providers[task] ?? (taskUrl
      ? createHttpProvider({
          task,
          baseUrl: taskUrl,
          apiKey: config.apiKey,
          timeoutMs: config.timeoutMs,
        })
      : createDisabledProvider(task));
    registry.set(task, provider);
  }

  return {
    status() {
      return [...registry.entries()].map(([task, provider]) => ({
        task,
        provider: provider.name,
        configured: provider.configured === true,
      }));
    },
    async run(task, input) {
      const provider = registry.get(task);
      if (!provider) throw new Error(`No provider registered for ML task: ${task}`);
      return provider.predict(input);
    },
  };
}

const modelRegistry = createModelRegistry();

module.exports = { createModelRegistry, modelRegistry };
