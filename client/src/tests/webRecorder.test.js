import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WebRecorder } from '../services/consultAudio/webRecorder.js';

class SyntheticMediaRecorder {
  static instances = [];
  static isTypeSupported() { return true; }
  constructor(_stream, options) {
    this.index = SyntheticMediaRecorder.instances.length;
    this.mimeType = options.mimeType;
    this.state = 'inactive';
    this.stopDelay = 0;
    SyntheticMediaRecorder.instances.push(this);
  }
  start() { this.state = 'recording'; }
  emit(value) { this.ondataavailable?.({ data: new Blob([value]) }); }
  stop() {
    this.state = 'inactive';
    setTimeout(() => {
      this.emit(`tail-${this.index}`);
      this.onstop?.();
    }, this.stopDelay);
  }
}

function response(body = {}) {
  return { ok: true, status: 200, json: async () => ({ ok: true, ...body }) };
}

describe('WebRecorder asynchronous chunk handover', () => {
  let recorder;
  let ready;
  let fetchMock;
  let trackStop;

  beforeEach(() => {
    vi.useFakeTimers();
    SyntheticMediaRecorder.instances = [];
    vi.stubGlobal('MediaRecorder', SyntheticMediaRecorder);
    fetchMock = vi.fn().mockResolvedValue(response());
    vi.stubGlobal('fetch', fetchMock);
    ready = vi.fn();
    trackStop = vi.fn();
    recorder = new WebRecorder({
      sessionId: 'synthetic-session', sessionToken: 'synthetic-token',
      apiBaseUrl: 'http://localhost:4000', onChunkReady: ready, onError: vi.fn(),
    });
    recorder.mediaStream = { getTracks: () => [{ stop: trackStop }] };
    recorder.startLevelMeter = vi.fn();
  });

  afterEach(() => {
    recorder.cleanup();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  function voice() {
    recorder.activeSamples.push({ timestampMs: Date.now(), dbfs: -10 });
  }

  it('keeps each header, data and stop tail in its own chunk across handover', async () => {
    await recorder.startRecording();
    const first = SyntheticMediaRecorder.instances[0];
    first.emit('header-0|');
    voice();
    recorder.cutAndHandoverChunk(Date.now());
    const second = SyntheticMediaRecorder.instances[1];
    second.emit('header-1|');
    await vi.advanceTimersByTimeAsync(0);
    expect(await ready.mock.calls[0][0].blob.text()).toBe('header-0|tail-0');
    voice();
    const stopped = recorder.stopRecording();
    await vi.runAllTimersAsync();
    await stopped;
    expect(ready.mock.calls.map(([chunk]) => chunk.seq)).toEqual([0, 1]);
    expect(await ready.mock.calls[1][0].blob.text()).toBe('header-1|tail-1');
  });

  it('waits for the final data event and its upload before sending the final marker', async () => {
    let acknowledge;
    fetchMock.mockImplementation((url) => url.includes('/chunks?')
      ? new Promise((resolve) => { acknowledge = resolve; })
      : Promise.resolve(response()));
    await recorder.startRecording();
    SyntheticMediaRecorder.instances[0].emit('synthetic-header|');
    voice();
    const stopped = recorder.stopRecording();
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/final'))).toBe(false);
    await vi.advanceTimersByTimeAsync(0);
    expect(acknowledge).toBeTypeOf('function');
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/final'))).toBe(false);
    acknowledge(response());
    await vi.runAllTimersAsync();
    await stopped;
    const final = fetchMock.mock.calls.find(([url]) => url.endsWith('/final'));
    expect(JSON.parse(final[1].body).total_chunks).toBe(1);
    expect(trackStop).toHaveBeenCalledTimes(1);
  });

  it('preserves sequence order when the last recorder stops before its predecessor', async () => {
    await recorder.startRecording();
    const first = SyntheticMediaRecorder.instances[0];
    first.stopDelay = 30;
    first.emit('header-0|');
    voice();
    recorder.cutAndHandoverChunk(Date.now());
    SyntheticMediaRecorder.instances[1].emit('header-1|');
    voice();
    const stopped = recorder.stopRecording();
    await vi.runAllTimersAsync();
    await stopped;
    expect(ready.mock.calls.map(([chunk]) => chunk.seq)).toEqual([0, 1]);
    const uploads = fetchMock.mock.calls.filter(([url]) => url.includes('/chunks?'));
    expect(uploads.map(([, options]) => options.headers['x-seq'])).toEqual(['0', '1']);
    expect(JSON.parse(fetchMock.mock.calls.find(([url]) => url.endsWith('/final'))[1].body).total_chunks).toBe(2);
  });

  it('deduplicates simultaneous Stop requests while the recorder is finalizing', async () => {
    await recorder.startRecording();
    SyntheticMediaRecorder.instances[0].emit('synthetic-header|');
    voice();
    const first = recorder.stopRecording();
    const second = recorder.stopRecording();
    await vi.runAllTimersAsync();
    await Promise.all([first, second]);
    expect(ready).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls.filter(([url]) => url.endsWith('/final'))).toHaveLength(1);
    expect(trackStop).toHaveBeenCalledTimes(1);
  });

  it('reports recorder stop failure and does not claim a complete upload', async () => {
    await recorder.startRecording();
    SyntheticMediaRecorder.instances[0].stop = () => { throw new Error('synthetic stop failure'); };
    voice();
    const stopped = recorder.stopRecording();
    const rejection = expect(stopped).rejects.toThrow('Audio chunk could not be finalized');
    await vi.runAllTimersAsync();
    await rejection;
    expect(fetchMock.mock.calls.some(([url]) => url.endsWith('/final'))).toBe(false);
    expect(recorder.onError).toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalledTimes(1);
  });
});
