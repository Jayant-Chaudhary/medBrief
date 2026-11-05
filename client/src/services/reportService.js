import { request, upload } from './apiClient';

export const reportService = {
  /** Every report the patient has uploaded. */
  async getReports() {
    return request('/api/lab-reports');
  },

  /** Only the reports the patient shared with one appointment. */
  async getReportsForAppointment(appointmentId) {
    return request(`/api/lab-reports?appointmentId=${appointmentId}`);
  },

  /**
   * Sends the real file. The server stores it, runs the OCR pipeline over it
   * and returns the saved report, so there is nothing to simulate here.
   *
   * Rejects with code REPORT_NAME_MISMATCH, and saves nothing, when the report
   * is printed with another name. Send it again with `confirmNameMismatch`
   * once the user says it is theirs.
   */
  async uploadReport(file, { appointmentId, confirmNameMismatch = false } = {}) {
    const form = new FormData();
    form.append('file', file);
    if (appointmentId) form.append('appointmentId', appointmentId);
    if (confirmNameMismatch) form.append('confirmNameMismatch', 'true');

    return upload('/api/lab-reports/upload', form);
  },

  async shareWithAppointment(reportId, appointmentId) {
    return request(`/api/lab-reports/${reportId}/share`, {
      method: 'POST',
      body: { appointmentId },
    });
  },

  /** Share every report in the library with one appointment (on check-in start). */
  async shareAllWithAppointment(appointmentId) {
    return request('/api/lab-reports/share-all', { method: 'POST', body: { appointmentId } });
  },

  async unshareFromAppointment(reportId, appointmentId) {
    return request(`/api/lab-reports/${reportId}/share/${appointmentId}`, { method: 'DELETE' });
  },

  async removeReport(reportId) {
    return request(`/api/lab-reports/${reportId}`, { method: 'DELETE' });
  },
};
