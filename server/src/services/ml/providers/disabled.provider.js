/** Explicit no-model provider: never invents a score or recommendation. */
function createDisabledProvider(task) {
  return {
    name: 'unconfigured',
    task,
    configured: false,
    async predict() {
      return {
        available: false,
        task,
        provider: 'unconfigured',
        reason: 'model_not_configured',
        results: [],
      };
    },
  };
}

module.exports = { createDisabledProvider };
