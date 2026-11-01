const { spawnSync } = require('node:child_process');
const path = require('node:path');
const { convertTo16kHzMonoWav } = require('../../utils/audioConverter');

describe('Real in-memory audio conversion', () => {
  test('resamples synthetic stereo PCM to 16 kHz mono WAV', async () => {
    const frameCount = 32000;
    const bytes = Buffer.alloc(44 + frameCount * 4);
    bytes.write('RIFF', 0);
    bytes.writeUInt32LE(bytes.length - 8, 4);
    bytes.write('WAVEfmt ', 8);
    bytes.writeUInt32LE(16, 16);
    bytes.writeUInt16LE(1, 20);
    bytes.writeUInt16LE(2, 22);
    bytes.writeUInt32LE(32000, 24);
    bytes.writeUInt32LE(128000, 28);
    bytes.writeUInt16LE(4, 32);
    bytes.writeUInt16LE(16, 34);
    bytes.write('data', 36);
    bytes.writeUInt32LE(frameCount * 4, 40);
    for (let index = 0; index < frameCount; index += 1) {
      const sample = Math.round(6000 * Math.sin(2 * Math.PI * 440 * index / 32000));
      bytes.writeInt16LE(sample, 44 + index * 4);
      bytes.writeInt16LE(sample, 46 + index * 4);
    }
    const wav = await convertTo16kHzMonoWav(bytes);
    expect(wav.subarray(0, 4).toString()).toBe('RIFF');
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16000);
    const payloadStart = wav.indexOf(Buffer.from('data'), 12) + 8;
    expect(wav.length - payloadStart).toBe(32000);
  });

  test('rejects malformed large input without an unhandled stdin EPIPE or process crash', () => {
    // Isolate the process: an unhandled pipe error would otherwise kill Jest.
    const converter = path.resolve(__dirname, '../../utils/audioConverter.js');
    const script = `require(${JSON.stringify(converter)}).convertTo16kHzMonoWav(
      Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(1999996)])
    ).then(()=>{process.exitCode=2;},err=>console.log(err.code));`;
    const result = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', timeout: 10000 });
    expect(result.error).toBeUndefined();
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe('ERR_AUDIO_CONVERSION');
    expect(result.stderr).not.toContain('Unhandled');
    expect(result.stderr).not.toContain('EPIPE');
  });

  test('invalid input returns a controlled code without including its contents', async () => {
    await expect(convertTo16kHzMonoWav(Buffer.alloc(0))).rejects.toMatchObject({ code: 'ERR_AUDIO_INPUT_INVALID' });
  });
});
