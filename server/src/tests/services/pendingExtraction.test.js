const env = require('../../config/env');
const { holdExtraction, takeExtraction } = require('../../services/pendingExtraction.service');

describe('pending extractions', () => {
  const scan = { ocrStatus: 'success', metrics: [] };
  let fileCount = 0;

  const owner = (overrides = {}) => {
    fileCount += 1;
    return { userId: 'user-1', patientId: 'patient-1', buffer: Buffer.from(`synthetic-${fileCount}`), ...overrides };
  };

  afterEach(() => jest.useRealTimers());

  it('hands a held scan back once', () => {
    const who = owner();
    holdExtraction(who, scan);

    expect(takeExtraction(who)).toBe(scan);
    expect(takeExtraction(who)).toBeNull();
  });

  it('finds nothing for a file that was never held', () => {
    expect(takeExtraction(owner())).toBeNull();
  });

  it.each([
    ['another user', { userId: 'user-2' }],
    ['another patient', { patientId: 'patient-2' }],
    ['another file', { buffer: Buffer.from('some-other-file') }],
  ])('does not hand a scan to %s', (_label, change) => {
    const who = owner();
    holdExtraction(who, scan);

    expect(takeExtraction({ ...who, ...change })).toBeNull();
    expect(takeExtraction(who)).toBe(scan);
  });

  it('forgets a scan when its time runs out', () => {
    jest.useFakeTimers();
    const who = owner();
    holdExtraction(who, scan);

    jest.advanceTimersByTime(env.ocr.pendingExtractionTtlMs + 1);

    expect(takeExtraction(who)).toBeNull();
  });

  it('keeps a scan until just before its time runs out', () => {
    jest.useFakeTimers();
    const who = owner();
    holdExtraction(who, scan);

    jest.advanceTimersByTime(env.ocr.pendingExtractionTtlMs - 1);

    expect(takeExtraction(who)).toBe(scan);
  });

  it('holding the same file again restarts its time', () => {
    jest.useFakeTimers();
    const who = owner();
    holdExtraction(who, scan);
    jest.advanceTimersByTime(env.ocr.pendingExtractionTtlMs - 1);

    holdExtraction(who, scan);
    jest.advanceTimersByTime(env.ocr.pendingExtractionTtlMs - 1);

    expect(takeExtraction(who)).toBe(scan);
  });

  it('drops the oldest scan when too many are waiting', () => {
    const oldest = owner();
    holdExtraction(oldest, scan);
    const rest = Array.from({ length: env.ocr.pendingExtractionMax - 1 }, () => owner());
    rest.forEach((who) => holdExtraction(who, scan));

    // Enough to push out anything left over from the tests above as well as `oldest`.
    const extra = Array.from({ length: env.ocr.pendingExtractionMax }, () => owner());
    extra.forEach((who) => holdExtraction(who, scan));

    expect(takeExtraction(oldest)).toBeNull();
    expect(takeExtraction(extra[extra.length - 1])).toBe(scan);
  });
});
