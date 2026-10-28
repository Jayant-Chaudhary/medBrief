const request = require('supertest');
const app = require('../app');
const supabaseAdmin = require('../config/supabaseAdminClient');
const { ok, mockTables, profileRow } = require('./helpers/supabaseMock');
const { standardizeMetrics } = require('../services/standardization/standardizeLabReport.service');
const { maybeFlagReportForTriage, getTriageQueue } = require('../services/triage.service');

jest.mock('../services/storage.service', () => ({
  LAB_REPORTS_BUCKET: 'lab-reports',
  uploadFile: jest.fn(),
  createSignedUrl: jest.fn().mockResolvedValue(null),
  removeFile: jest.fn(),
}));

jest.mock('../config/supabaseAdminClient', () => ({
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn(),
}));

jest.mock('../services/standardization/standardizeLabReport.service', () => ({
  standardizeMetrics: jest.fn(),
}));

jest.mock('../services/triage.service', () => ({
  maybeFlagReportForTriage: jest.fn(),
  getTriageQueue: jest.fn(),
}));

describe('Lab Reports API', () => {
  const mockPatient = {
    id: 'patient-123',
    email: 'patient@example.com',
  };
  const mockClinician = {
    id: 'clinician-456',
    email: 'dr@example.com',
  };

  const mockPatientProfile = {
    role: 'patient',
    full_name: 'Patient Test',
  };
  
  const mockClinicianProfile = {
    role: 'clinician',
    full_name: 'Dr. Test',
    clinician_details: { is_verified: true },
  };

  const mockToken = 'valid-token';

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const setupAuthMock = (user, profile) => {
    supabaseAdmin.auth.getUser.mockResolvedValue({
      data: { user },
      error: null,
    });

    supabaseAdmin.from.mockImplementation((table) => {
      if (table === 'profiles') {
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: profile, error: null }),
        };
      }
      return {
        insert: jest.fn().mockReturnThis(),
        select: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        update: jest.fn().mockReturnThis(),
        single: jest.fn().mockReturnThis(),
      };
    });
  };

  describe('POST /lab-reports', () => {
    const validPayload = {
      storagePath: 'labs/report.pdf',
      ocrStatus: 'success',
      metrics: [{ key: 'hb', value: '12', unit: 'g/dL' }]
    };

    it('should ingest a report and metrics', async () => {
      setupAuthMock(mockPatient, mockPatientProfile);
      
      const mockLabReport = { id: 'report-1' };
      const mockStandardized = [{ standardKey: 'hemoglobin', parsedValue: '12' }];
      const mockInsertedMetrics = [{ id: 'metric-1', lab_report_id: 'report-1' }];

      standardizeMetrics.mockResolvedValue(mockStandardized);
      maybeFlagReportForTriage.mockResolvedValue();

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'profiles') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: mockPatientProfile, error: null }),
          };
        }
        if (table === 'lab_reports') {
          return {
            insert: jest.fn().mockReturnThis(),
            select: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: mockLabReport, error: null }),
          };
        }
        if (table === 'lab_report_metrics') {
          return {
            insert: jest.fn().mockReturnThis(),
            select: jest.fn().mockResolvedValue({ data: mockInsertedMetrics, error: null }),
          };
        }
      });

      const response = await request(app)
        .post('/api/lab-reports')
        .set('Authorization', `Bearer ${mockToken}`)
        .send(validPayload);

      expect(response.status).toBe(201);
      expect(response.body.labReport).toEqual(mockLabReport);
      expect(response.body.metrics).toEqual(mockInsertedMetrics);
      expect(standardizeMetrics).toHaveBeenCalledWith(validPayload.metrics);
      expect(maybeFlagReportForTriage).toHaveBeenCalledWith({
        labReport: mockLabReport,
        metrics: mockInsertedMetrics,
      });
    });

    it('should return 400 for invalid payload', async () => {
      setupAuthMock(mockPatient, mockPatientProfile);

      const response = await request(app)
        .post('/api/lab-reports')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({ ocrStatus: 'success' }); // Missing required storagePath

      expect(response.status).toBe(400);
    });
  });

  describe('GET /lab-reports', () => {
    it('should list reports for the authenticated patient', async () => {
      setupAuthMock(mockPatient, mockPatientProfile);
      const mockReports = [{ id: 'report-1' }];

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: mockPatientProfile, error: null }) };
        if (table === 'lab_reports') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({ data: mockReports, error: null }),
          };
        }
      });

      const response = await request(app)
        .get('/api/lab-reports')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({ id: 'report-1' });
    });

    it('should list only the reports shared with the clinician\'s appointment', async () => {
      setupAuthMock(mockClinician, mockClinicianProfile);
      const chains = mockTables(supabaseAdmin, {
        profiles: profileRow('clinician'),
        appointments: ok({ id: 'appt-1', patient_id: 'patient-123', clinician_id: mockClinician.id }),
        appointment_lab_reports: ok([{ lab_report_id: 'report-1' }]),
        lab_reports: ok([{ id: 'report-1' }]),
      });

      const response = await request(app)
        .get('/api/lab-reports?appointmentId=appt-1')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toHaveLength(1);
      expect(response.body[0]).toMatchObject({ id: 'report-1' });
      expect(chains.lab_reports[0].eq).toHaveBeenCalledWith('patient_id', 'patient-123');
      expect(chains.lab_reports[0].in).toHaveBeenCalledWith('id', ['report-1']);
    });

    it('should require an appointment when a clinician lists reports', async () => {
      setupAuthMock(mockClinician, mockClinicianProfile);
      mockTables(supabaseAdmin, { profiles: profileRow('clinician') });

      const response = await request(app)
        .get('/api/lab-reports?patientId=patient-123')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(400);
    });

    it("should return 403 for another clinician's appointment", async () => {
      setupAuthMock(mockClinician, mockClinicianProfile);
      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician'),
        appointments: ok({ id: 'appt-1', patient_id: 'patient-123', clinician_id: 'another-dr' }),
      });

      const response = await request(app)
        .get('/api/lab-reports?appointmentId=appt-1')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('GET /lab-reports/trend/:standardKey', () => {
    it('should return metric trend', async () => {
      setupAuthMock(mockPatient, mockPatientProfile);
      const mockTrend = [{ parsed_value: '12' }];

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'profiles') return { select: jest.fn().mockReturnThis(), eq: jest.fn().mockReturnThis(), single: jest.fn().mockResolvedValue({ data: mockPatientProfile, error: null }) };
        if (table === 'lab_report_metrics') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({ data: mockTrend, error: null }),
          };
        }
      });

      const response = await request(app)
        .get('/api/lab-reports/trend/hemoglobin')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockTrend);
    });
  });

  describe('GET /lab-reports/triage/queue', () => {
    it('should list triage queue if clinician', async () => {
      setupAuthMock(mockClinician, mockClinicianProfile);
      const mockQueue = [{ id: 'triage-1' }];
      getTriageQueue.mockResolvedValue(mockQueue);

      const response = await request(app)
        .get('/api/lab-reports/triage/queue')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockQueue);
      expect(getTriageQueue).toHaveBeenCalledWith(mockClinician.id);
    });

    it('should return 403 if patient tries to access triage queue', async () => {
      setupAuthMock(mockPatient, mockPatientProfile);

      const response = await request(app)
        .get('/api/lab-reports/triage/queue')
        .set('Authorization', `Bearer ${mockToken}`);

      expect(response.status).toBe(403);
    });
  });

  describe('PATCH /lab-reports/metrics/:metricId/review', () => {
    const shareTables = {
      appointments: ok([{ id: 'appt-1' }]),
      appointment_lab_reports: ok([{ lab_report_id: 'report-1' }]),
    };

    it('should review a metric from a report shared with the clinician', async () => {
      setupAuthMock(mockClinician, mockClinicianProfile);
      const mockUpdated = { id: 'metric-1' };
      const chains = mockTables(supabaseAdmin, {
        profiles: profileRow('clinician'),
        ...shareTables,
        // The ownership lookup, then the update.
        lab_report_metrics: [
          ok({ id: 'metric-1', lab_report_id: 'report-1', lab_reports: { patient_id: 'patient-123' } }),
          ok(mockUpdated),
        ],
      });

      const response = await request(app)
        .patch('/api/lab-reports/metrics/metric-1/review')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({ standardKey: 'hemoglobin', reviewedValue: 12.5 });

      expect(response.status).toBe(200);
      expect(response.body).toEqual(mockUpdated);
      expect(chains.lab_report_metrics[1].update).toHaveBeenCalledWith({
        standard_key: 'hemoglobin',
        reviewed_value: 12.5,
        reviewed_by: mockClinician.id,
        needs_review: false,
      });
    });

    it('should return 403 for a report not shared with the clinician', async () => {
      setupAuthMock(mockClinician, mockClinicianProfile);
      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician'),
        ...shareTables,
        lab_report_metrics: ok({ id: 'metric-1', lab_report_id: 'report-other', lab_reports: { patient_id: 'patient-123' } }),
      });

      const response = await request(app)
        .patch('/api/lab-reports/metrics/metric-1/review')
        .set('Authorization', `Bearer ${mockToken}`)
        .send({ reviewedValue: 12.5 });

      expect(response.status).toBe(403);
    });
  });
});

describe('POST /lab-reports/share-all', () => {
  const APPOINTMENT_ID = '11111111-1111-4111-8111-111111111111';
  const patient = { id: 'patient-123', email: 'patient@example.com' };
  const post = (body) => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: patient }, error: null });
    return request(app).post('/api/lab-reports/share-all').set('Authorization', 'Bearer t').send(body);
  };

  beforeEach(() => jest.clearAllMocks());

  it("shares every report in the patient's library with their appointment", async () => {
    const chains = mockTables(supabaseAdmin, {
      profiles: profileRow('patient'),
      appointments: ok({ id: APPOINTMENT_ID, patient_id: patient.id, clinician_id: 'dr-1' }),
      lab_reports: ok([{ id: 'r1' }, { id: 'r2' }, { id: 'r3' }]),
      appointment_lab_reports: ok(null),
    });

    const response = await post({ appointmentId: APPOINTMENT_ID });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ appointmentId: APPOINTMENT_ID, shared: 3 });
    expect(chains.lab_reports[0].eq).toHaveBeenCalledWith('patient_id', patient.id);
    expect(chains.appointment_lab_reports[0].upsert.mock.calls[0][0]).toHaveLength(3);
  });

  it('does nothing when the patient has no reports yet', async () => {
    const chains = mockTables(supabaseAdmin, {
      profiles: profileRow('patient'),
      appointments: ok({ id: APPOINTMENT_ID, patient_id: patient.id, clinician_id: 'dr-1' }),
      lab_reports: ok([]),
    });

    const response = await post({ appointmentId: APPOINTMENT_ID });

    expect(response.status).toBe(200);
    expect(response.body.shared).toBe(0);
    expect(chains.appointment_lab_reports).toBeUndefined();
  });

  it("refuses another patient's appointment", async () => {
    mockTables(supabaseAdmin, {
      profiles: profileRow('patient'),
      appointments: ok({ id: APPOINTMENT_ID, patient_id: 'someone-else', clinician_id: 'dr-1' }),
    });

    const response = await post({ appointmentId: APPOINTMENT_ID });

    expect(response.status).toBe(403);
  });

  it('is patient-only', async () => {
    mockTables(supabaseAdmin, { profiles: profileRow('clinician') });

    const response = await post({ appointmentId: APPOINTMENT_ID });

    expect(response.status).toBe(403);
  });
});

describe('GET /lab-reports/history', () => {
  const clinician = { id: 'dr-1', email: 'dr@example.com' };
  const get = (query) => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: clinician }, error: null });
    return request(app).get(`/api/lab-reports/history${query}`).set('Authorization', 'Bearer t');
  };

  beforeEach(() => jest.clearAllMocks());

  it('returns the reports shared with any of this clinician\'s visits, newest first', async () => {
    const chains = mockTables(supabaseAdmin, {
      profiles: profileRow('clinician'),
      // clinicianHasPatient, then reportIdsSharedWithClinician.
      appointments: [ok([{ id: 'appt-1' }]), ok([{ id: 'appt-1' }, { id: 'appt-2' }])],
      appointment_lab_reports: ok([{ lab_report_id: 'r-old' }, { lab_report_id: 'r-new' }]),
      lab_reports: ok([
        { id: 'r-old', report_date: '2026-01-10', storage_path: 'p/1', lab_report_metrics: [] },
        { id: 'r-new', report_date: '2026-09-25', storage_path: 'p/2', lab_report_metrics: [] },
      ]),
    });

    const response = await get('?patientId=patient-9');

    expect(response.status).toBe(200);
    expect(response.body.map((r) => r.id)).toEqual(['r-new', 'r-old']);
    expect(chains.lab_reports[0].in).toHaveBeenCalledWith('id', ['r-old', 'r-new']);
  });

  it('returns an empty list when nothing has been shared', async () => {
    const chains = mockTables(supabaseAdmin, {
      profiles: profileRow('clinician'),
      appointments: [ok([{ id: 'appt-1' }]), ok([{ id: 'appt-1' }])],
      appointment_lab_reports: ok([]),
    });

    const response = await get('?patientId=patient-9');

    expect(response.status).toBe(200);
    expect(response.body).toEqual([]);
    expect(chains.lab_reports).toBeUndefined();
  });

  it("refuses a patient this clinician doesn't treat", async () => {
    mockTables(supabaseAdmin, { profiles: profileRow('clinician'), appointments: ok([]) });
    expect((await get('?patientId=someone-else')).status).toBe(403);
  });

  it('requires patientId', async () => {
    mockTables(supabaseAdmin, { profiles: profileRow('clinician') });
    expect((await get('')).status).toBe(400);
  });
});

describe('value source locations', () => {
  const patient = { id: 'patient-123', email: 'patient@example.com' };
  const post = (body) => {
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user: patient }, error: null });
    return request(app).post('/api/lab-reports').set('Authorization', 'Bearer t').send(body);
  };
  const tables = () =>
    mockTables(supabaseAdmin, {
      profiles: profileRow('patient'),
      lab_reports: ok({ id: 'report-1', patient_id: patient.id }),
      lab_report_metrics: ok([]),
    });

  beforeEach(() => {
    jest.clearAllMocks();
    // Two standardised rows back, in the same order as the input metrics.
    standardizeMetrics.mockResolvedValue([
      { raw_key: 'TSH', standard_key: 'tsh', needs_review: false },
      { raw_key: 'Hb', standard_key: 'hemoglobin', needs_review: false },
    ]);
    maybeFlagReportForTriage.mockResolvedValue();
  });

  it('stores where each value was printed, matched to its row by position', async () => {
    const chains = tables();
    const tshSource = { page: 6, row: [0.058, 0.394, 0.931, 0.405], value: [0.495, 0.394, 0.533, 0.404] };

    const response = await post({
      storagePath: 'labs/report.pdf',
      metrics: [
        { key: 'TSH', value: '0.997', source: tshSource },
        { key: 'Hb', value: '12.2' }, // no location recorded
      ],
    });

    expect(response.status).toBe(201);
    const inserted = chains.lab_report_metrics[0].insert.mock.calls[0][0];
    expect(inserted[0]).toMatchObject({ raw_key: 'TSH', source_page: 6, source_box: { row: tshSource.row, value: tshSource.value } });
    expect(inserted[1]).toMatchObject({ raw_key: 'Hb', source_page: null, source_box: null });
  });

  it('keeps the row box when the value box is missing', async () => {
    const chains = tables();
    await post({
      storagePath: 'labs/report.pdf',
      metrics: [{ key: 'TSH', value: '0.997', source: { page: 1, row: [0.1, 0.2, 0.9, 0.25], value: null } }, { key: 'Hb', value: '12' }],
    });
    const [tsh] = chains.lab_report_metrics[0].insert.mock.calls[0][0];
    expect(tsh.source_box).toEqual({ row: [0.1, 0.2, 0.9, 0.25], value: null });
  });

  it.each([
    ['outside the page', { page: 1, row: [0.1, 0.2, 1.4, 0.25] }],
    ['with no area', { page: 1, row: [0.5, 0.2, 0.5, 0.25] }],
    ['on page 0', { page: 0, row: [0.1, 0.2, 0.9, 0.25] }],
  ])('rejects a location %s', async (_label, source) => {
    tables();
    const response = await post({ storagePath: 'labs/report.pdf', metrics: [{ key: 'TSH', value: '1', source }] });
    expect(response.status).toBe(400);
  });
});
