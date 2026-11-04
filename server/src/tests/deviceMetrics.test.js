const request = require('supertest');
const app = require('../app');
const supabaseAdmin = require('../config/supabaseAdminClient');
const { ok, mockTables, profileRow } = require('./helpers/supabaseMock');

jest.mock('../config/supabaseAdminClient', () => ({
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn(),
}));

jest.mock('../config/checkin.config', () => {
  const original = jest.requireActual('../config/checkin.config');
  return {
    ...original,
    geminiApiKey: '',
  };
});

describe('Device Metrics & Health Connect Integration API', () => {
  const mockPatient = { id: 'patient-uuid-1', email: 'patient@example.com' };
  const mockClinician = { id: 'clinician-uuid-1', email: 'doctor@example.com' };
  const mockOtherClinician = { id: 'clinician-uuid-2', email: 'otherdoctor@example.com' };
  const mockToken = 'mock-auth-token';

  const appointmentId = '11111111-2222-3333-4444-555555555555';
  const ownAppointment = {
    id: appointmentId,
    patient_id: mockPatient.id,
    clinician_id: mockClinician.id,
    status: 'scheduled',
    scheduled_at: '2026-11-10T10:00:00.000Z',
  };

  const signInAs = (user) =>
    supabaseAdmin.auth.getUser.mockResolvedValue({ data: { user }, error: null });

  const send = (method, path) =>
    request(app)[method](path).set('Authorization', `Bearer ${mockToken}`);

  beforeEach(() => {
    jest.clearAllMocks();
    signInAs(mockPatient);
  });

  describe('POST /api/checkin/device-metrics/sync', () => {
    const validMetrics = [
      {
        metricDate: '2026-11-03',
        steps: 6420,
        distanceMeters: 4500,
        activeMinutes: 45,
        restingHeartRate: 78,
        sleepMinutes: 440,
        source: 'health_connect',
      },
      {
        metricDate: '2026-11-02',
        steps: 5800,
        distanceMeters: 4100,
        activeMinutes: 38,
        restingHeartRate: 76,
        sleepMinutes: 420,
        source: 'health_connect',
      },
    ];

    it('rejects submissions from clinician accounts', async () => {
      signInAs(mockClinician);
      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician', mockClinician.id),
      });

      const res = await send('post', '/api/checkin/device-metrics/sync').send({
        metrics: validMetrics,
      });

      expect(res.status).toBe(403);
    });

    it('rejects invalid payload (e.g. invalid date or negative steps)', async () => {
      mockTables(supabaseAdmin, {
        profiles: profileRow('patient', mockPatient.id),
      });

      const res = await send('post', '/api/checkin/device-metrics/sync').send({
        metrics: [
          {
            metricDate: 'invalid-date',
            steps: -50,
          },
        ],
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('successfully syncs and upserts device metrics for authenticated patient', async () => {
      mockTables(supabaseAdmin, {
        profiles: profileRow('patient', mockPatient.id),
        patient_device_metrics: ok([
          { id: 'metric-uuid-1', metric_date: '2026-11-03', steps: 6420 },
          { id: 'metric-uuid-2', metric_date: '2026-11-02', steps: 5800 },
        ]),
      });

      const res = await send('post', '/api/checkin/device-metrics/sync').send({
        metrics: validMetrics,
      });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.syncedCount).toBe(2);
    });
  });

  describe('GET /api/checkin/device-metrics', () => {
    it('allows patient to fetch their own device metrics', async () => {
      mockTables(supabaseAdmin, {
        profiles: profileRow('patient', mockPatient.id),
        patient_device_metrics: ok([
          { id: 'metric-uuid-1', metric_date: '2026-11-03', steps: 6420, resting_heart_rate: 78 },
        ]),
      });

      const res = await send('get', '/api/checkin/device-metrics');
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body[0].steps).toBe(6420);
    });

    it('allows clinician to fetch metrics of an assigned patient via appointmentId', async () => {
      signInAs(mockClinician);
      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician', mockClinician.id),
        appointments: ok(ownAppointment),
        patient_device_metrics: ok([
          { id: 'metric-uuid-1', metric_date: '2026-11-03', steps: 6420, resting_heart_rate: 78 },
        ]),
      });

      const res = await send('get', `/api/checkin/device-metrics?appointmentId=${appointmentId}`);
      expect(res.status).toBe(200);
      expect(res.body.length).toBe(1);
    });

    it('forbids clinician without appointment access from fetching metrics', async () => {
      signInAs(mockOtherClinician);
      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician', mockOtherClinician.id),
        appointments: ok(ownAppointment),
      });

      const res = await send('get', `/api/checkin/device-metrics?appointmentId=${appointmentId}`);
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/checkin/device-metrics/trajectory', () => {
    it('computes trajectory and flags tachycardia & mobility reduction', async () => {
      // Mock historical records showing a drop in steps and tachycardia
      const sampleRecords = [
        {
          id: 'm1',
          metric_date: '2026-11-03',
          steps: 2100,
          resting_heart_rate: 104,
          sleep_minutes: 300, // 5 hours
          blood_pressure_systolic: 122,
          blood_pressure_diastolic: 80,
          weight_kg: 68.5,
        },
        {
          id: 'm2',
          metric_date: '2026-11-02',
          steps: 2200,
          resting_heart_rate: 102,
          sleep_minutes: 320,
          blood_pressure_systolic: 120,
          blood_pressure_diastolic: 78,
          weight_kg: 68.4,
        },
        // Prior week records (higher baseline steps)
        {
          id: 'm3',
          metric_date: '2026-10-25',
          steps: 6500,
          resting_heart_rate: 75,
          sleep_minutes: 450,
          blood_pressure_systolic: 118,
          blood_pressure_diastolic: 76,
          weight_kg: 68.0,
        },
        {
          id: 'm4',
          metric_date: '2026-10-24',
          steps: 6200,
          resting_heart_rate: 74,
          sleep_minutes: 460,
          blood_pressure_systolic: 116,
          blood_pressure_diastolic: 74,
          weight_kg: 68.0,
        },
      ];

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient', mockPatient.id),
        patient_device_metrics: ok(sampleRecords),
      });

      const res = await send('get', '/api/checkin/device-metrics/trajectory');
      expect(res.status).toBe(200);
      expect(res.body.hasData).toBe(true);
      expect(res.body.tachycardiaAlert).toBe(true);
      expect(res.body.peakRestingHr).toBe(104);
      expect(res.body.mobilityAlert).toBe(true);
      expect(res.body.flags.length).toBeGreaterThan(0);
    });
  });

  describe('Integration with Pre-Visit Clinical Brief Synthesis', () => {
    it('synthesizes AI pre-visit brief enriched with Health Connect device trajectory', async () => {
      signInAs(mockClinician);

      const deviceRecords = [
        {
          id: 'm1',
          metric_date: '2026-11-03',
          steps: 1800,
          resting_heart_rate: 106,
          sleep_minutes: 310,
          blood_pressure_systolic: 124,
          blood_pressure_diastolic: 82,
        },
      ];

      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician', mockClinician.id),
        appointments: [
          ok(ownAppointment),
          ok(ownAppointment),
          ok(null), // no previous completed appointment
        ],
        patient_details: ok({ profile_id: mockPatient.id, due_date: '2027-02-15', gravida: 1, para: 0 }),
        patient_checkin_sessions: ok([]),
        vitals_logs: ok([]),
        patient_device_metrics: ok(deviceRecords),
        visit_ai_summaries: ok({
          id: 'ai-summary-uuid-1',
          appointment_id: appointmentId,
          clinical_risk_level: 'moderate',
          physical_symptom_trajectory: 'Expected physiological progression with no acute distress. Wearable activity (Health Connect): Daily steps averaged 1800, Resting HR averaged 106 bpm (peak: 106 bpm), Sleep averaged 5.2 hrs/night.',
          red_flags: ['Elevated resting heart rate observed: peaked at 106 bpm (interval average: 106 bpm)'],
        }),
      });

      const res = await send('post', `/api/checkin/summary/${appointmentId}/generate`);
      expect(res.status).toBe(200);
      expect(res.body.clinical_risk_level).toBe('moderate');
      expect(res.body.physical_symptom_trajectory).toContain('Health Connect');
      expect(res.body.red_flags.some((f) => f.includes('Elevated resting heart rate'))).toBe(true);
    });
  });
});
