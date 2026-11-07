const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const supervisor = require('../communitySupervisor');

describe('Community Supervisor (In-Process Hosting)', () => {
  let tmpRulesFile;

  beforeAll(() => {
    // Create a temporary valid rules file
    tmpRulesFile = path.join(os.tmpdir(), `test-rules-${Date.now()}.json`);
    fs.writeFileSync(tmpRulesFile, JSON.stringify([
      { code: 'test_code', phrase: 'concerning symptoms', tier: 'soon' },
    ]));
  });

  afterAll(() => {
    try {
      if (fs.existsSync(tmpRulesFile)) fs.unlinkSync(tmpRulesFile);
    } catch (_) {}
  });

  afterEach(() => {
    supervisor.stop();
  });

  test('isConfigured returns false when essential database URLs or keys are missing', () => {
    expect(supervisor.isConfigured({})).toBe(false);

    expect(supervisor.isConfigured({
      identityDatabaseUrl: 'postgres://localhost/test',
      // missing workerDatabaseUrl, keys, rulesFile
    })).toBe(false);

    expect(supervisor.isConfigured({
      identityDatabaseUrl: 'postgres://localhost/test',
      workerDatabaseUrl: 'postgres://localhost/test',
      identityServiceKey: 'a'.repeat(32),
      safetyServiceKey: 'b'.repeat(32),
      rulesFile: '/non/existent/path/rules.json',
    })).toBe(false);
  });

  test('start returns false when autoStartServices is disabled', () => {
    const started = supervisor.start({
      autoStartServices: false,
      forceStart: true,
    });
    expect(started).toBe(false);
    expect(supervisor.getStatus().running).toBe(false);
  });

  test('start returns false in test environment unless forceStart is explicitly set', () => {
    const started = supervisor.start({
      autoStartServices: true,
      forceStart: false,
    });
    expect(started).toBe(false);
    expect(supervisor.getStatus().running).toBe(false);
  });

  test('start returns false cleanly without throwing when unconfigured', () => {
    const started = supervisor.start({
      autoStartServices: true,
      forceStart: true,
      identityDatabaseUrl: '',
      workerDatabaseUrl: '',
    });
    expect(started).toBe(false);
    expect(supervisor.getStatus().running).toBe(false);
  });

  test('stop is safe to call when supervisor is not running', () => {
    expect(() => supervisor.stop()).not.toThrow();
    expect(supervisor.getStatus().running).toBe(false);
  });

  test('start and stop lifecycle when properly configured', async () => {
    const originalUrl = process.env.SUPABASE_URL;
    const originalAnon = process.env.SUPABASE_ANON_KEY;
    process.env.SUPABASE_URL = 'https://example.supabase.co';
    process.env.SUPABASE_ANON_KEY = 'test-anon-key';

    const testOpts = {
      autoStartServices: true,
      forceStart: true,
      identityPort: 49101,
      safetyPort: 49102,
      identityHost: '127.0.0.1',
      safetyHost: '127.0.0.1',
      identityDatabaseUrl: 'postgresql://medbrief_identity_login:testpass@localhost:5432/postgres',
      workerDatabaseUrl: 'postgresql://medbrief_safety_login:testpass@localhost:5432/postgres',
      identityServiceKey: 'x'.repeat(32),
      safetyServiceKey: 'y'.repeat(32),
      rulesFile: tmpRulesFile,
      llmBypass: true,
      sweeperPollMs: 60000,
    };

    expect(supervisor.isConfigured(testOpts)).toBe(true);

    const started = supervisor.start(testOpts);
    expect(started).toBe(true);

    const status = supervisor.getStatus();
    expect(status.running).toBe(true);
    expect(status.identityActive).toBe(true);
    expect(status.safetyActive).toBe(true);
    expect(status.sweeperActive).toBe(true);

    // Stop cleanly
    supervisor.stop();
    const stoppedStatus = supervisor.getStatus();
    expect(stoppedStatus.running).toBe(false);
    expect(stoppedStatus.identityActive).toBe(false);
    expect(stoppedStatus.safetyActive).toBe(false);
    expect(stoppedStatus.sweeperActive).toBe(false);

    process.env.SUPABASE_URL = originalUrl;
    process.env.SUPABASE_ANON_KEY = originalAnon;
  });
});
