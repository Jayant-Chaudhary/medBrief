const { modelRegistry } = require('./registry');
const { TASKS } = require('./tasks');

function getModelStatus() {
  return modelRegistry.status();
}

function assessMaternalRisk(featurePayload) {
  return modelRegistry.run(TASKS.maternalRisk, featurePayload);
}

function findSimilarPregnancies(featurePayload) {
  return modelRegistry.run(TASKS.patientSimilarity, featurePayload);
}

function recommendMedicationTemplates(featurePayload) {
  return modelRegistry.run(TASKS.medicationTemplateRecommendation, featurePayload);
}

module.exports = {
  getModelStatus,
  assessMaternalRisk,
  findSimilarPregnancies,
  recommendMedicationTemplates,
};
