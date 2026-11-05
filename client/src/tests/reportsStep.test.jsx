import { describe, it, expect, vi, beforeEach } from 'vitest';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReportsStep from '../pages/checkin/ReportsStep.jsx';
import { reportService } from '../services/reportService.js';

vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  Link: ({ children, to }) => <a href={to}>{children}</a>,
}));

vi.mock('../context/PatientContext', () => ({
  usePatientContext: () => ({
    activeAppointment: { id: 'appt-123' },
    loading: false,
  }),
}));

vi.mock('../context/ToastContext', () => ({
  useToast: () => ({
    showToast: vi.fn(),
  }),
}));

vi.mock('../services/reportService', () => ({
  reportService: {
    getReports: vi.fn(),
    shareAllWithAppointment: vi.fn(),
    shareWithAppointment: vi.fn(),
    unshareFromAppointment: vi.fn(),
  },
}));

describe('ReportsStep Component (Phase 2 Pre-Visit Report Sharing)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders privacy banner and report options with explicit choices', () => {
    const mockReports = [
      {
        id: 'rep-1',
        report_date: '2026-10-15',
        shared_appointment_ids: ['appt-123'],
        lab_report_metrics: [{ id: 'm1', standard_key: 'hemoglobin', parsed_value: 12.0 }],
      },
      {
        id: 'rep-2',
        report_date: '2026-10-20',
        shared_appointment_ids: [],
        lab_report_metrics: [],
      },
    ];

    const html = renderToStaticMarkup(<ReportsStep initialReports={mockReports} />);

    expect(html).toContain('Share Lab Reports');
    expect(html).toContain('Patient Privacy Choice');
    expect(html).toContain('Choose reports');
    expect(html).toContain('Share all');
    expect(html).toContain('Continue without changing reports');
    expect(html).toContain('Continue to Symptoms');
  });

  it('renders empty library state with continue button when patient has no reports', () => {
    const html = renderToStaticMarkup(<ReportsStep initialReports={[]} />);

    expect(html).toContain('Share Lab Reports');
    expect(html).toContain('No reports in your library');
    expect(html).toContain('Continue to Symptoms');
  });
});
