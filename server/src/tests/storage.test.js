/**
 * Integration Tests for Decrypted Storage Proxy & Serving Layer
 */

const request = require('supertest');
const app = require('../app');
const crypto = require('crypto');
const supabaseAdmin = require('../config/supabaseAdminClient');
const config = require('../config/storageEncryption.config');
const storageEncryption = require('../services/crypto/storageEncryption.service');
const { signStorageUrl, createSignedUrl, uploadFile, removeFile, LAB_REPORTS_BUCKET, PRESCRIPTIONS_BUCKET } = require('../services/storage.service');

jest.mock('../config/supabaseAdminClient', () => ({
  auth: {
    getUser: jest.fn(),
  },
  from: jest.fn(),
  storage: {
    from: jest.fn(),
  },
}));

describe('Storage Proxy API', () => {
  const mockDownload = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    supabaseAdmin.storage.from = jest.fn().mockReturnValue({
      download: mockDownload,
    });
  });

  describe('GET /api/storage/file', () => {
    test('successfully serves and decrypts an encrypted PDF file with valid signature', async () => {
      const syntheticPdf = Buffer.from('%PDF-1.4 synthetic lab report content');
      const encryptedBlob = storageEncryption.encrypt(syntheticPdf);

      mockDownload.mockResolvedValue({
        data: encryptedBlob,
        error: null,
      });

      const path = 'patient-123/report-abc.pdf';
      const signedUrl = signStorageUrl(LAB_REPORTS_BUCKET, path, 600);

      const urlObj = new URL(signedUrl);
      const relativePath = `${urlObj.pathname}${urlObj.search}`;

      const res = await request(app).get(relativePath);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('application/pdf');
      expect(res.headers['content-disposition']).toBe('inline; filename="report-abc.pdf"');
      expect(res.headers['cache-control']).toBe('private, max-age=300');
      expect(res.body).toEqual(syntheticPdf);
      expect(supabaseAdmin.storage.from).toHaveBeenCalledWith(LAB_REPORTS_BUCKET);
      expect(mockDownload).toHaveBeenCalledWith(path);
    });

    test('successfully serves and decrypts an audio WAV file with valid signature', async () => {
      const syntheticWav = Buffer.from('RIFF....WAVEfmt ....data....');
      const encryptedBlob = storageEncryption.encrypt(syntheticWav);

      mockDownload.mockResolvedValue({
        data: encryptedBlob,
        error: null,
      });

      const path = 'consults/sess-1/doctor/0.wav';
      const signedUrl = signStorageUrl('consult-audio', path, 300);

      const urlObj = new URL(signedUrl);
      const relativePath = `${urlObj.pathname}${urlObj.search}`;

      const res = await request(app).get(relativePath);

      expect(res.status).toBe(200);
      expect(res.headers['content-type']).toBe('audio/wav');
      expect(res.body).toEqual(syntheticWav);
    });

    test('serves unencrypted legacy file when fallback is enabled', async () => {
      const legacyPdf = Buffer.from('%PDF-1.4 unencrypted legacy report');

      mockDownload.mockResolvedValue({
        data: legacyPdf,
        error: null,
      });

      const path = 'patient-123/legacy.pdf';
      const signedUrl = signStorageUrl(LAB_REPORTS_BUCKET, path, 600);
      const urlObj = new URL(signedUrl);

      const res = await request(app).get(`${urlObj.pathname}${urlObj.search}`);

      expect(res.status).toBe(200);
      expect(res.body).toEqual(legacyPdf);
    });

    test('rejects expired signature with 403 ERR_URL_EXPIRED', async () => {
      const expiredUnix = Math.floor(Date.now() / 1000) - 60; // 60 seconds in the past
      const payload = `${LAB_REPORTS_BUCKET}:patient-1/doc.pdf:${expiredUnix}`;
      const sig = crypto.createHmac('sha256', config.proxyHmacSecret).update(payload).digest('hex');

      const res = await request(app)
        .get(`/api/storage/file?bucket=${LAB_REPORTS_BUCKET}&path=patient-1/doc.pdf&expires=${expiredUnix}&sig=${sig}`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ERR_URL_EXPIRED');
    });

    test('rejects invalid or tampered signature with 403 ERR_INVALID_SIGNATURE', async () => {
      const expires = Math.floor(Date.now() / 1000) + 600;
      const res = await request(app)
        .get(`/api/storage/file?bucket=${LAB_REPORTS_BUCKET}&path=patient-1/doc.pdf&expires=${expires}&sig=00112233445566778899aabbccddeeff`);

      expect(res.status).toBe(403);
      expect(res.body.code).toBe('ERR_INVALID_SIGNATURE');
    });

    test('rejects unauthorized or unknown storage bucket with 400 ERR_INVALID_BUCKET', async () => {
      const expires = Math.floor(Date.now() / 1000) + 600;
      const res = await request(app)
        .get(`/api/storage/file?bucket=forbidden-bucket&path=file.pdf&expires=${expires}&sig=abc`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ERR_INVALID_BUCKET');
    });

    test('rejects path traversal attempts with 400 ERR_INVALID_PATH', async () => {
      const expires = Math.floor(Date.now() / 1000) + 600;
      const res = await request(app)
        .get(`/api/storage/file?bucket=${LAB_REPORTS_BUCKET}&path=../../etc/passwd&expires=${expires}&sig=abc`);

      expect(res.status).toBe(400);
      expect(res.body.code).toBe('ERR_INVALID_PATH');
    });

    test('returns 404 ERR_FILE_NOT_FOUND when file does not exist in Supabase storage', async () => {
      mockDownload.mockResolvedValue({
        data: null,
        error: { message: 'Object not found' },
      });

      const path = 'patient-123/missing.pdf';
      const signedUrl = signStorageUrl(LAB_REPORTS_BUCKET, path, 600);
      const urlObj = new URL(signedUrl);

      const res = await request(app).get(`${urlObj.pathname}${urlObj.search}`);

      expect(res.status).toBe(404);
      expect(res.body.code).toBe('ERR_FILE_NOT_FOUND');
    });
  });

  describe('createSignedUrl service function', () => {
    test('returns valid signed URL or null for empty path', async () => {
      expect(await createSignedUrl(PRESCRIPTIONS_BUCKET, null)).toBeNull();
      expect(await createSignedUrl(PRESCRIPTIONS_BUCKET, '')).toBeNull();

      const url = await createSignedUrl(PRESCRIPTIONS_BUCKET, 'owner-1/presc.png');
      expect(url).toContain('/api/storage/file?');
      expect(url).toContain(`bucket=${PRESCRIPTIONS_BUCKET}`);
      expect(url).toContain('path=owner-1%2Fpresc.png');
      expect(url).toContain('sig=');
      expect(url).toContain('expires=');
    });
  });

  describe('uploadFile service function', () => {
    test('encrypts buffer before calling Supabase storage upload', async () => {
      const mockUpload = jest.fn().mockResolvedValue({ data: { path: 'stored/path' }, error: null });
      supabaseAdmin.storage.from = jest.fn().mockReturnValue({ upload: mockUpload });

      const plaintext = Buffer.from('%PDF-1.4 confidential lab report data');
      const storagePath = await uploadFile({
        bucket: LAB_REPORTS_BUCKET,
        ownerId: 'patient-abc',
        buffer: plaintext,
        originalName: 'scan.pdf',
        contentType: 'application/pdf',
      });

      expect(storagePath).toMatch(/^patient-abc\/[a-f0-9-]+\.pdf$/);
      expect(supabaseAdmin.storage.from).toHaveBeenCalledWith(LAB_REPORTS_BUCKET);
      expect(mockUpload).toHaveBeenCalledTimes(1);

      const [calledPath, uploadedBuffer, options] = mockUpload.mock.calls[0];
      expect(calledPath).toBe(storagePath);
      expect(options.contentType).toBe('application/octet-stream');

      // Crucial verification: The buffer stored in Supabase must be encrypted!
      expect(storageEncryption.isEncrypted(uploadedBuffer)).toBe(true);
      expect(uploadedBuffer.toString('utf8')).not.toContain('confidential lab report data');

      // And decrypting it must yield the original plaintext!
      const decrypted = storageEncryption.decrypt(uploadedBuffer);
      expect(decrypted.equals(plaintext)).toBe(true);
    });

    test('throws error if Supabase storage upload fails', async () => {
      const mockUpload = jest.fn().mockResolvedValue({ data: null, error: { message: 'Bucket quota exceeded' } });
      supabaseAdmin.storage.from = jest.fn().mockReturnValue({ upload: mockUpload });

      await expect(
        uploadFile({
          bucket: PRESCRIPTIONS_BUCKET,
          ownerId: 'pat-1',
          buffer: Buffer.from('data'),
          originalName: 'doc.png',
        })
      ).rejects.toThrow('Failed to store file: Bucket quota exceeded');
    });
  });

  describe('removeFile service function', () => {
    test('removes file from Supabase storage', async () => {
      const mockRemove = jest.fn().mockResolvedValue({ data: [], error: null });
      supabaseAdmin.storage.from = jest.fn().mockReturnValue({ remove: mockRemove });

      await removeFile(LAB_REPORTS_BUCKET, 'pat-1/file.pdf');
      expect(supabaseAdmin.storage.from).toHaveBeenCalledWith(LAB_REPORTS_BUCKET);
      expect(mockRemove).toHaveBeenCalledWith(['pat-1/file.pdf']);
    });

    test('handles empty path safely', async () => {
      const mockRemove = jest.fn();
      supabaseAdmin.storage.from = jest.fn().mockReturnValue({ remove: mockRemove });

      await removeFile(LAB_REPORTS_BUCKET, null);
      expect(mockRemove).not.toHaveBeenCalled();
    });
  });
});
