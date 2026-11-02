/**
 * Unit Tests for LocalProvider STT & ProviderFactory (Phase 10).
 *
 * Verifies:
 * 1. LocalProvider capabilities.
 * 2. Transcribing Buffer and file path inputs.
 * 3. Mapping of segment timestamps, confidence, and language.
 * 4. Fallback when segments array is empty but full text is provided.
 * 5. Error handling on network failure and non-200 HTTP status.
 * 6. ProviderFactory resolution for 'local' provider.
 */

const fs = require('fs');
const path = require('path');
const LocalProvider = require('../../services/consultAudio/stt/localProvider');
const { getProvider } = require('../../services/consultAudio/stt/providerFactory');

describe('LocalProvider STT (Phase 10)', () => {
  const originalFetch = global.fetch;
  let tempFilePath = null;

  beforeAll(() => {
    tempFilePath = path.join(__dirname, 'temp-test-audio.wav');
    fs.writeFileSync(tempFilePath, Buffer.from('RIFFtestwavchunkdata'));
  });

  afterAll(() => {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      fs.unlinkSync(tempFilePath);
    }
    global.fetch = originalFetch;
  });

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('Capabilities', () => {
    test('reports correct capabilities and provider name', () => {
      const provider = new LocalProvider('http://localhost:8001');
      expect(provider.name).toBe('local');
      expect(provider.getCapabilities()).toEqual({
        name: 'local',
        supportsDiarization: false,
        supportsStreaming: false,
      });
    });

    test('strips trailing slashes from serviceUrl', () => {
      const provider = new LocalProvider('http://localhost:8001///');
      expect(provider.serviceUrl).toBe('http://localhost:8001');
    });
  });

  describe('transcribe()', () => {
    test('transcribes Buffer input and maps segments correctly', async () => {
      const mockApiResponse = {
        text: 'Patient reports mild nausea.',
        language: 'en',
        language_probability: 0.98,
        duration_sec: 4.5,
        segments: [
          {
            start_ms: 100,
            end_ms: 2200,
            text: 'Patient reports',
            confidence: 0.92,
          },
          {
            start_ms: 2300,
            end_ms: 4400,
            text: 'mild nausea.',
            confidence: 0.95,
          },
        ],
      };

      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => mockApiResponse,
      });

      const provider = new LocalProvider('http://localhost:8001');
      const audioBuffer = Buffer.from('RIFFfakeaudiobuffer');
      const segments = await provider.transcribe(audioBuffer, {
        languageCode: 'en',
        vadFilter: true,
      });

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, req] = global.fetch.mock.calls[0];
      expect(url).toBe('http://localhost:8001/transcribe');
      expect(req.method).toBe('POST');
      expect(req.body).toBeInstanceOf(FormData);

      expect(segments).toHaveLength(2);
      expect(segments[0]).toEqual({
        start_ms: 100,
        end_ms: 2200,
        text: 'Patient reports',
        confidence: 0.92,
        language: 'en',
      });
      expect(segments[1]).toEqual({
        start_ms: 2300,
        end_ms: 4400,
        text: 'mild nausea.',
        confidence: 0.95,
        language: 'en',
      });
    });

    test('transcribes file path input and loads buffer from disk', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          text: 'Hello doctor',
          language: 'hi',
          segments: [
            { start_ms: 0, end_ms: 1500, text: 'Hello doctor' },
          ],
        }),
      });

      const provider = new LocalProvider('http://localhost:8001');
      const segments = await provider.transcribe(tempFilePath, { languageCode: 'hi' });

      expect(segments).toHaveLength(1);
      expect(segments[0].text).toBe('Hello doctor');
      expect(segments[0].confidence).toBe(0.95); // default fallback confidence
      expect(segments[0].language).toBe('hi');
    });

    test('falls back to single whole-chunk segment if segments array is empty', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          text: 'Whole chunk recognized text without segmented timestamps.',
          language: 'en',
          duration_sec: 12.0,
          segments: [],
        }),
      });

      const provider = new LocalProvider('http://localhost:8001');
      const segments = await provider.transcribe(Buffer.from('audio'));

      expect(segments).toHaveLength(1);
      expect(segments[0]).toEqual({
        start_ms: 0,
        end_ms: 12000,
        text: 'Whole chunk recognized text without segmented timestamps.',
        confidence: 0.95,
        language: 'en',
      });
    });

    test('returns empty array when neither segments nor text are returned (silence)', async () => {
      global.fetch.mockResolvedValue({
        ok: true,
        json: async () => ({
          text: '',
          language: 'en',
          duration_sec: 15.0,
          segments: [],
        }),
      });

      const provider = new LocalProvider('http://localhost:8001');
      const segments = await provider.transcribe(Buffer.from('audio'));

      expect(segments).toEqual([]);
    });

    test('throws ERR_FILE_NOT_FOUND when file does not exist', async () => {
      const provider = new LocalProvider('http://localhost:8001');
      await expect(provider.transcribe('/non/existent/path/audio.wav'))
        .rejects.toThrow('Audio file not found');
    });

    test('throws for invalid input types (non-buffer, non-string)', async () => {
      const provider = new LocalProvider('http://localhost:8001');
      await expect(provider.transcribe(12345))
        .rejects.toThrow('Invalid wavInput provided to LocalProvider');
    });

    test('throws ERR_LOCAL_STT_UNAVAILABLE on fetch network error', async () => {
      global.fetch.mockRejectedValue(new Error('ECONNREFUSED'));

      const provider = new LocalProvider('http://localhost:8001');
      await expect(provider.transcribe(Buffer.from('audio')))
        .rejects.toMatchObject({
          code: 'ERR_LOCAL_STT_UNAVAILABLE',
        });
    });

    test('throws ERR_LOCAL_STT_FAILED on HTTP error response (500)', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 500,
        text: async () => 'Internal Server Error in CTranslate2',
      });

      const provider = new LocalProvider('http://localhost:8001');
      await expect(provider.transcribe(Buffer.from('audio')))
        .rejects.toMatchObject({
          code: 'ERR_LOCAL_STT_FAILED',
        });
    });
  });

  describe('ProviderFactory integration', () => {
    test('instantiates LocalProvider when requested', () => {
      const provider = getProvider('local');
      expect(provider).toBeInstanceOf(LocalProvider);
      expect(provider.name).toBe('local');
    });
  });
});
