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

describe('Check-In & AI Summarization API', () => {
  const mockPatient = { id: 'patient-uuid-1', email: 'patient@example.com' };
  const mockClinician = { id: 'clinician-uuid-1', email: 'doctor@example.com' };
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

  describe('POST /api/checkin/sessions', () => {
    const validPayload = {
      appointmentId,
      sessionType: 'routine_weekly',
      gestationalWeek: 28,
      answers: [
        {
          category: 'physical',
          questionKey: 'fetal_movement',
          questionText: 'Are you feeling the baby move regularly?',
          answerType: 'boolean',
          boolValue: true,
          isRedFlag: false,
        },
        {
          category: 'mental',
          questionKey: 'mood_state',
          questionText: 'How has your mood been over the past week?',
          answerType: 'scale',
          scaleValue: 2,
          isRedFlag: false,
        },
        {
          category: 'medical',
          questionKey: 'prenatal_vitamins',
          questionText: 'Have you taken your daily vitamins?',
          answerType: 'boolean',
          boolValue: true,
          isRedFlag: false,
        },
      ],
    };

    it('rejects submissions from clinician accounts', async () => {
      signInAs(mockClinician);
      mockTables(supabaseAdmin, { profiles: profileRow('clinician') });

      const res = await send('post', '/api/checkin/sessions').send(validPayload);
      expect(res.status).toBe(403);
    });

    it('rejects submissions with missing or invalid fields', async () => {
      mockTables(supabaseAdmin, { profiles: profileRow('patient') });

      const res = await send('post', '/api/checkin/sessions').send({
        sessionType: 'invalid_type',
        answers: [],
      });

      expect(res.status).toBe(400);
      expect(res.body.error).toBeDefined();
    });

    it('successfully records a standard check-in with status completed', async () => {
      const mockSession = {
        id: 'session-uuid-1',
        patient_id: mockPatient.id,
        appointment_id: appointmentId,
        session_type: 'routine_weekly',
        gestational_week: 28,
        status: 'completed',
        completed_at: new Date().toISOString(),
      };
      const mockInsertedAnswers = [
        { id: 'ans-1', session_id: 'session-uuid-1', category: 'physical' },
      ];

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        appointments: ok(ownAppointment),
        patient_checkin_sessions: ok(mockSession),
        patient_checkin_answers: ok(mockInsertedAnswers),
      });

      const res = await send('post', '/api/checkin/sessions').send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.session.status).toBe('completed');
      expect(res.body.hasRedFlag).toBe(false);
    });

    it('escalates status to flagged_urgent when a red flag answer is present', async () => {
      const urgentPayload = {
        ...validPayload,
        answers: [
          ...validPayload.answers,
          {
            category: 'physical',
            questionKey: 'severe_headache_visual',
            questionText: 'Have you had a severe headache with visual blurriness?',
            answerType: 'boolean',
            boolValue: true,
            isRedFlag: true,
          },
        ],
      };

      const mockUrgentSession = {
        id: 'session-uuid-2',
        patient_id: mockPatient.id,
        status: 'flagged_urgent',
      };

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        appointments: ok(ownAppointment),
        patient_checkin_sessions: ok(mockUrgentSession),
        patient_checkin_answers: ok([]),
      });

      const res = await send('post', '/api/checkin/sessions').send(urgentPayload);

      expect(res.status).toBe(201);
      expect(res.body.hasRedFlag).toBe(true);
      expect(res.body.session.status).toBe('flagged_urgent');
    });
  });

  describe('POST /api/checkin/ad-hoc (24/7 symptom / concern log)', () => {
    it('records mild ad-hoc patient symptom without red flag', async () => {
      const mockSession = {
        id: 'session-adhoc-1',
        patient_id: mockPatient.id,
        session_type: 'ad_hoc_concern',
        status: 'completed',
      };
      const mockAnswer = {
        id: 'ans-adhoc-1',
        session_id: 'session-adhoc-1',
        text_value: 'Felt slight stomach discomfort after lunch',
        is_red_flag: false,
      };

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        patient_checkin_sessions: ok(mockSession),
        patient_checkin_answers: ok(mockAnswer),
      });

      const res = await send('post', '/api/checkin/ad-hoc').send({
        description: 'Felt slight stomach discomfort after lunch',
        severity: 'mild',
      });

      expect(res.status).toBe(201);
      expect(res.body.hasRedFlag).toBe(false);
      expect(res.body.session.session_type).toBe('ad_hoc_concern');
    });

    it('escalates to flagged_urgent when emergency keyword or severe is reported', async () => {
      const mockSession = {
        id: 'session-adhoc-urgent',
        patient_id: mockPatient.id,
        session_type: 'ad_hoc_concern',
        status: 'flagged_urgent',
      };
      const mockAnswer = {
        id: 'ans-adhoc-urgent',
        session_id: 'session-adhoc-urgent',
        text_value: 'Experienced heavy bleeding and severe headache',
        is_red_flag: true,
      };

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        patient_checkin_sessions: ok(mockSession),
        patient_checkin_answers: ok(mockAnswer),
      });

      const res = await send('post', '/api/checkin/ad-hoc').send({
        description: 'Experienced heavy bleeding and severe headache',
        severity: 'severe',
      });

      expect(res.status).toBe(201);
      expect(res.body.hasRedFlag).toBe(true);
    });
  });

  describe('POST /api/checkin/quick-pulse (2-4 day check)', () => {
    it('records 30-second comfort pulse', async () => {
      const mockSession = {
        id: 'session-pulse-1',
        patient_id: mockPatient.id,
        session_type: 'quick_pulse',
        status: 'completed',
      };
      const mockAnswers = [
        { id: 'ans-pulse-1', question_key: 'comfort_rating', scale_value: 4 },
      ];

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        patient_checkin_sessions: ok(mockSession),
        patient_checkin_answers: ok(mockAnswers),
      });

      const res = await send('post', '/api/checkin/quick-pulse').send({
        comfortRating: 4,
        discomforts: ['Mild backache'],
        notes: 'Resting helps a lot',
      });

      expect(res.status).toBe(201);
      expect(res.body.hasRedFlag).toBe(false);
    });
  });

  describe('GET /api/checkin/status', () => {
    it('returns check-in cadence status and upcoming due type', async () => {
      const recentSession = {
        id: 'sess-recent',
        session_type: 'quick_pulse',
        created_at: new Date(Date.now() - 1 * 24 * 60 * 60 * 1000).toISOString(),
        status: 'completed',
      };

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        patient_checkin_sessions: ok([recentSession]),
      });

      const res = await send('get', '/api/checkin/status');

      expect(res.status).toBe(200);
      expect(res.body.daysSinceLastCheckin).toBe(1);
      expect(res.body.totalCompleted).toBe(1);
    });
  });

  describe('GET /api/checkin/history', () => {
    it('returns check-in sessions for the current patient', async () => {
      const mockHistory = [
        {
          id: 'session-1',
          patient_id: mockPatient.id,
          session_type: 'routine_weekly',
          patient_checkin_answers: [],
        },
      ];

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        patient_checkin_sessions: ok(mockHistory),
      });

      const res = await send('get', '/api/checkin/history');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body)).toBe(true);
      expect(res.body).toHaveLength(1);
    });

    it('forbids a patient from requesting another patient history', async () => {
      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
      });

      const res = await send('get', '/api/checkin/history?patientId=other-patient-uuid');
      expect(res.status).toBe(403);
    });
  });

  describe('GET /api/checkin/summary/:appointmentId', () => {
    it('returns 403 if the user is not a participant in the appointment', async () => {
      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        appointments: ok({
          id: appointmentId,
          patient_id: 'stranger-id',
          clinician_id: 'other-doctor',
        }),
      });

      const res = await send('get', `/api/checkin/summary/${appointmentId}`);
      expect(res.status).toBe(403);
    });

    it('returns the AI summary if it exists', async () => {
      const mockSummary = {
        id: 'summary-uuid-1',
        appointment_id: appointmentId,
        clinical_risk_level: 'low',
        red_flags: [],
        mental_health_assessment: 'Stable mood.',
        physical_symptom_trajectory: 'Normal progression.',
      };

      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
        appointments: ok(ownAppointment),
        visit_ai_summaries: ok(mockSummary),
      });

      const res = await send('get', `/api/checkin/summary/${appointmentId}`);
      expect(res.status).toBe(200);
      expect(res.body.clinical_risk_level).toBe('low');
    });
  });

  describe('POST /api/checkin/summary/:appointmentId/generate', () => {
    it('forbids patients from triggering AI summary generation', async () => {
      mockTables(supabaseAdmin, {
        profiles: profileRow('patient'),
      });

      const res = await send('post', `/api/checkin/summary/${appointmentId}/generate`);
      expect(res.status).toBe(403);
    });

    it('allows clinician to generate pre-visit summary with interval scoping and fallback', async () => {
      signInAs(mockClinician);

      const mockSavedSummary = {
        id: 'summary-uuid-generated',
        appointment_id: appointmentId,
        patient_id: mockPatient.id,
        clinician_id: mockClinician.id,
        clinical_risk_level: 'urgent',
        red_flags: ['Severe headache: Reported Yes'],
        mental_health_assessment: 'Elevated concern on mood_anhedonia (rated 4/5)',
        physical_symptom_trajectory: 'Severe headache: Reported Yes',
        medication_compliance: 'Routine prenatal vitamins and medications reported as adherent.',
        interval_description: '14 days since last visit (2026-10-27)',
        doctor_talking_points: 'Prioritize immediate evaluation of flagged obstetric concerns and repeat vitals.',
      };

      mockTables(supabaseAdmin, {
        profiles: profileRow('clinician'),
        appointments: [ok(ownAppointment), ok(ownAppointment), ok(null)],
        patient_details: ok({
          profile_id: mockPatient.id,
          due_date: '2026-12-15',
          gravida: 1,
          para: 0,
        }),
        patient_checkin_sessions: ok([
          {
            id: 'session-recent',
            patient_id: mockPatient.id,
            patient_checkin_answers: [
              {
                is_red_flag: true,
                category: 'physical',
                question_key: 'headache',
                question_text: 'Severe headache',
                bool_value: true,
              },
              {
                is_red_flag: false,
                category: 'mental',
                question_key: 'mood_anhedonia',
                question_text: 'Mood rating',
                scale_value: 4,
              },
            ],
          },
        ]),
        vitals_logs: ok([]),
        patient_device_metrics: ok([]),
        visit_ai_summaries: ok(mockSavedSummary),
      });

      const res = await send('post', `/api/checkin/summary/${appointmentId}/generate`);

      expect(res.status).toBe(200);
      expect(res.body.clinical_risk_level).toBe('urgent');
      expect(res.body.red_flags).toContain('Severe headache: Reported Yes');
      expect(res.body.doctor_talking_points).toMatch(/Prioritize immediate evaluation/);
    });
  });
});
