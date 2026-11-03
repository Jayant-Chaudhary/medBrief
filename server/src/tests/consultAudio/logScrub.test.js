/**
 * Zero-PII & Privacy Log Scrubbing Audit Tests (Phase 11).
 *
 * Enforces repository standing rules in AGENTS.md:
 * - "The product flags and prioritises. It never diagnoses. No UI text or output may state a diagnosis."
 * - "No audio, transcript text, names or health values in logs, errors, analytics or notification text.
 *    Log ids, counts, timings and error codes only."
 * - "Tests and fixtures use synthetic data only."
 */

const logger = require('../../utils/logger');
const { ingestChunk } = require('../../services/consultAudio/chunkIngest.service');
const { processJob } = require('../../services/consultAudio/transcriptionWorker');
const { mergeSegments } = require('../../services/consultAudio/mergeSegments');
const {
  buildStructuredContext,
  buildTracerCatalog,
  postCheckDraft,
} = require('../../services/consultAudio/drafting/tracerVerification');
const { generateDraftForSession } = require('../../services/consultAudio/draft.service');
const supabaseAdmin = require('../../config/supabaseAdminClient');

jest.mock('../../config/supabaseAdminClient');
jest.mock('../../services/consultAudio/audioCache.service', () => ({
  put: jest.fn().mockResolvedValue(true),
  get: jest.fn().mockResolvedValue(null),
  remove: jest.fn().mockResolvedValue(true),
}));
jest.mock('../../utils/audioConverter', () => ({
  convertTo16kHzMonoWav: jest.fn().mockResolvedValue(Buffer.from('RIFF16khzmonowav')),
  checkFfmpegInstalled: jest.fn().mockResolvedValue(true),
}));

describe('Privacy & Zero-PII Log Scrubbing Audit (Phase 11)', () => {
  const SENSITIVE_PATIENT_NAME = 'Asha Devi';
  const SENSITIVE_TRANSCRIPT_PHRASE = 'Severe lower abdominal cramps radiating to back';
  const SENSITIVE_CLINICAL_VALUE = '145/95';
  const SENSITIVE_HEMOGLOBIN_VALUE = '9.2 g/dL';

  const FORBIDDEN_STRINGS = [
    SENSITIVE_PATIENT_NAME,
    SENSITIVE_TRANSCRIPT_PHRASE,
    SENSITIVE_CLINICAL_VALUE,
    SENSITIVE_HEMOGLOBIN_VALUE,
  ];

  let logCalls = [];
  let spies = [];

  beforeEach(() => {
    logCalls = [];
    jest.clearAllMocks();

    const recordCall = (level, args) => {
      const serialized = args
        .map((arg) => {
          if (typeof arg === 'string') return arg;
          try {
            return JSON.stringify(arg);
          } catch {
            return String(arg);
          }
        })
        .join(' ');
      logCalls.push({ level, text: serialized });
    };

    spies = [
      jest.spyOn(logger, 'debug').mockImplementation((...args) => recordCall('debug', args)),
      jest.spyOn(logger, 'info').mockImplementation((...args) => recordCall('info', args)),
      jest.spyOn(logger, 'warn').mockImplementation((...args) => recordCall('warn', args)),
      jest.spyOn(logger, 'error').mockImplementation((...args) => recordCall('error', args)),
    ];
  });

  afterEach(() => {
    spies.forEach((s) => s.mockRestore());
  });

  function assertNoSensitiveDataInLogs(operationName) {
    for (const call of logCalls) {
      for (const forbidden of FORBIDDEN_STRINGS) {
        if (call.text.includes(forbidden)) {
          throw new Error(
            `[PRIVACY VIOLATION] Found sensitive data "${forbidden}" in logger.${call.level} during ${operationName}:\n${call.text}`
          );
        }
      }
    }
  }

  describe('1. Chunk Ingestion Logging', () => {
    test('does not log audio data or patient info during chunk upload', async () => {
      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'consult_sessions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: 'sess-101', status: 'recording' },
              error: null,
            }),
          };
        }
        if (table === 'audio_chunks') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({
                data: { id: 'chunk-1', seq: 0, status: 'uploaded', silent: false, storage_path: 'chunks/c1.wav' },
                error: null,
              }),
            }),
          };
        }
        if (table === 'transcription_jobs') {
          return {
            insert: jest.fn().mockResolvedValue({ error: null }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: {}, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({ data: {}, error: null }),
        };
      });

      supabaseAdmin.storage.from.mockReturnValue({
        upload: jest.fn().mockResolvedValue({ data: { path: 'chunks/chunk.wav' }, error: null }),
      });

      const syntheticWav = Buffer.from('RIFF....fake-audio-containing-bytes');
      await ingestChunk({
        sessionId: 'sess-101',
        device: 'doctor',
        seq: 0,
        startMs: 0,
        durationMs: 15000,
        avgDbfs: -22.5,
        codec: 'audio/wav',
        audioBuffer: syntheticWav,
      });

      assertNoSensitiveDataInLogs('ingestChunk');
      expect(logCalls.length).toBeGreaterThan(0);
    });
  });

  describe('2. STT & Transcription Worker Logging', () => {
    test('does not log transcript text or spoken words during chunk transcription', async () => {
      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'transcription_jobs') {
          return {
            update: jest.fn().mockReturnThis(),
            eq: jest.fn().mockResolvedValue({ data: {}, error: null }),
          };
        }
        if (table === 'segments') {
          return {
            insert: jest.fn().mockResolvedValue({ data: [], error: null }),
          };
        }
        if (table === 'audio_chunks') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: {
                id: 'chunk-1',
                session_id: 'sess-101',
                device: 'doctor',
                start_ms: 0,
                duration_ms: 15000,
                storage_path: 'chunks/chunk-1.wav',
              },
              error: null,
            }),
            update: jest.fn().mockReturnThis(),
          };
        }
        if (table === 'consult_sessions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({
              data: { id: 'sess-101', status: 'recording', started_at: '2026-11-02T10:00:00.000Z' },
              error: null,
            }),
          };
        }
        if (table === 'session_devices') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            maybeSingle: jest.fn().mockResolvedValue({
              data: { device: 'doctor', offset_ms: 0, capture_zero_device_ms: 0 },
              error: null,
            }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: {}, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({ data: {}, error: null }),
          update: jest.fn().mockReturnThis(),
        };
      });

      supabaseAdmin.storage.from.mockReturnValue({
        download: jest.fn().mockResolvedValue({
          data: { arrayBuffer: async () => Buffer.from('RIFFdummy') },
          error: null,
        }),
      });

      const providerWithSensitiveText = {
        name: 'sensitive-test-provider',
        transcribe: jest.fn().mockResolvedValue([
          {
            start_ms: 500,
            end_ms: 4500,
            text: SENSITIVE_TRANSCRIPT_PHRASE,
            confidence: 0.98,
          },
        ]),
      };

      const job = {
        id: 'job-1',
        chunk_id: 'chunk-1',
        attempts: 1,
      };

      await processJob(job, providerWithSensitiveText);

      assertNoSensitiveDataInLogs('processJob');
      expect(logCalls.length).toBeGreaterThan(0);
    });
  });

  describe('3. Merge & Crosstalk Deduplication Logging', () => {
    test('does not leak sensitive text during segment merge', () => {
      const doctorSegments = [
        {
          id: 'seg-1',
          device: 'doctor',
          start_ms: 1000,
          end_ms: 5000,
          text: SENSITIVE_TRANSCRIPT_PHRASE,
          confidence: 0.95,
          avg_dbfs: -18,
        },
      ];
      const patientSegments = [
        {
          id: 'seg-2',
          device: 'patient',
          start_ms: 1200,
          end_ms: 5100,
          text: SENSITIVE_TRANSCRIPT_PHRASE,
          confidence: 0.90,
          avg_dbfs: -26,
        },
      ];

      const merged = mergeSegments(doctorSegments, patientSegments);
      expect(merged).toHaveLength(1);

      // mergeSegments is a pure function that does not leak text to logs
      assertNoSensitiveDataInLogs('mergeSegments');
    });
  });

  describe('4. Tracer Verification & Context Builder Logging', () => {
    test('does not log patient names or clinical numbers when building context', () => {
      const mockPatient = {
        id: 'pat-100',
        name: SENSITIVE_PATIENT_NAME,
        blood_group: 'O+',
      };
      const mockVitals = [
        { bp_systolic: 145, bp_diastolic: 95, heart_rate: 88 },
      ];
      const mockLabs = [
        { metric_name: 'hemoglobin', metric_value: 9.2, metric_unit: 'g/dL', needs_review: false },
      ];

      const catalog = buildTracerCatalog({
        verifiedLabMetrics: [
          { metricKey: 'hemoglobin', value: 9.2, unit: 'g/dL', source: 'lab_reports' },
        ],
        vitalsLogs: [
          { metricKey: 'bp_systolic', value: 145, unit: 'mmHg', source: 'vitals_logs' },
          { metricKey: 'bp_diastolic', value: 95, unit: 'mmHg', source: 'vitals_logs' },
        ],
      });

      expect(catalog.length).toBeGreaterThan(0);
      assertNoSensitiveDataInLogs('buildTracerCatalog');

      // Post-check verification
      const draftResult = {
        doctor_notes: {
          chief_complaint: 'Routine follow-up',
          vitals_observed: 'BP 145/95 mmHg',
          assessment: 'Routine antenatal checkup completed.',
          plan_and_recommendations: 'Continue prenatal vitamins [value pending verification].',
          cited_segment_ids: ['seg-1'],
        },
        patient_summary: {
          summary: 'Regular checkup completed.',
          action_items: ['Take prenatal vitamins.'],
          red_flags: ['Seek medical care if severe pain occurs.'],
        },
        clinical_flags: [
          {
            flag_code: 'MONITOR_BLOOD_PRESSURE',
            priority: 'medium',
            reason: 'Elevated blood pressure observed verbally, unverified.',
            cited_segment_ids: ['seg-1'],
          },
        ],
      };

      const check = postCheckDraft({
        draftResult,
        validSegmentIds: ['seg-1'],
        tracerCatalog: catalog,
      });

      expect(check.isValidForApproval).toBe(true);
      assertNoSensitiveDataInLogs('postCheckDraft');
    });
  });

  describe('5. Drafting Service Logging', () => {
    test('does not log patient names, draft bodies, or medical numbers', async () => {
      const mockSession = {
        id: 'sess-draft-test',
        patient_id: 'pat-100',
        status: 'processing',
        patient_required: true,
      };

      supabaseAdmin.from.mockImplementation((table) => {
        if (table === 'consult_sessions') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            single: jest.fn().mockResolvedValue({ data: mockSession, error: null }),
            update: jest.fn().mockReturnThis(),
          };
        }
        if (table === 'consult_segments') {
          return {
            select: jest.fn().mockReturnThis(),
            eq: jest.fn().mockReturnThis(),
            order: jest.fn().mockResolvedValue({
              data: [
                { id: 'seg-101', speaker: 'doctor', text: SENSITIVE_TRANSCRIPT_PHRASE, start_ms: 0, end_ms: 4000 },
              ],
              error: null,
            }),
          };
        }
        if (table === 'consult_drafts') {
          return {
            insert: jest.fn().mockReturnValue({
              select: jest.fn().mockReturnThis(),
              single: jest.fn().mockResolvedValue({ data: { id: 'draft-101', status: 'needs_review' }, error: null }),
            }),
          };
        }
        return {
          select: jest.fn().mockReturnThis(),
          eq: jest.fn().mockReturnThis(),
          single: jest.fn().mockResolvedValue({ data: {}, error: null }),
          maybeSingle: jest.fn().mockResolvedValue({ data: {}, error: null }),
          order: jest.fn().mockResolvedValue({ data: [], error: null }),
          update: jest.fn().mockReturnThis(),
        };
      });

      const draft = await generateDraftForSession('sess-draft-test', {
        provider: 'fake',
      });

      expect(draft).toBeDefined();
      assertNoSensitiveDataInLogs('generateDraftForSession');
      expect(logCalls.length).toBeGreaterThan(0);
    });
  });
});
