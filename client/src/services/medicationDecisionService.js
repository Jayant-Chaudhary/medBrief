import { request } from './apiClient.js';

const root = '/api/decision-support';

export const fetchMedicationTemplates = () => request(`${root}/templates`);
export const saveMedicationTemplate = template => request(`${root}/templates`, { method: 'PUT', body: { template } });
export const fetchMedicationContext = appointmentId => request(`${root}/appointments/${encodeURIComponent(appointmentId)}/context`);
export const savePatientAllergies = (appointmentId, state) => request(`${root}/appointments/${encodeURIComponent(appointmentId)}/allergies`, { method: 'PUT', body: state });
export const fetchPrescriptionDraft = appointmentId => request(`${root}/appointments/${encodeURIComponent(appointmentId)}/draft`);
export const savePrescriptionDraft = (appointmentId, draft) => request(`${root}/appointments/${encodeURIComponent(appointmentId)}/draft`, { method: 'PUT', body: { draft } });
export const searchMedicationCatalog = query => request(`${root}/medications/search?q=${encodeURIComponent(query)}`);
export const fetchPrescriptionFactors = appointmentId => request(`${root}/appointments/${encodeURIComponent(appointmentId)}/factors`);
export const savePrescriptionFactors = (appointmentId, state) => request(`${root}/appointments/${encodeURIComponent(appointmentId)}/factors`, { method: 'PUT', body: state });
export const fetchMedicationFactorCatalog = () => request(`${root}/factor-catalog`);
export const submitMedicationFeedback = feedback => request(`${root}/feedback`, { method: 'POST', body: feedback });
export const evaluateMedicationSuggestions = (appointmentId, input) => request(`${root}/appointments/${encodeURIComponent(appointmentId)}/evaluate`, { method: 'POST', body: input });
export const saveDisplayedMedicationCandidates = (appointmentId, eventId, displayed) => request(`${root}/appointments/${encodeURIComponent(appointmentId)}/evaluations/${encodeURIComponent(eventId)}/displayed`, { method: 'PUT', body: { displayed } });
export const fetchMedicationFeedbackAnalytics = () => request(`${root}/analytics`);

