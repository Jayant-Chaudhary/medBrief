import { request } from './apiClient.js';

export const maternalRecordService = {
  getPatientRecord(patientId) {
    return request(`/api/maternal-records/patients/${patientId}`);
  },
  createEpisode(patientId, changes) {
    return request(`/api/maternal-records/patients/${patientId}/episodes`, { method: 'POST', body: changes });
  },
  updateEpisode(episodeId, changes) {
    return request(`/api/maternal-records/episodes/${episodeId}`, { method: 'PATCH', body: changes });
  },
  createRecord(episodeId, collection, changes) {
    return request(`/api/maternal-records/episodes/${episodeId}/records/${collection}`, { method: 'POST', body: changes });
  },
  updateRecord(collection, recordId, changes) {
    return request(`/api/maternal-records/records/${collection}/${recordId}`, { method: 'PATCH', body: changes });
  },
  deleteRecord(collection, recordId) {
    return request(`/api/maternal-records/records/${collection}/${recordId}`, { method: 'DELETE' });
  },
  saveDelivery(episodeId, changes) {
    return request(`/api/maternal-records/episodes/${episodeId}/delivery`, { method: 'PUT', body: changes });
  },
};
