/**
 * Audio Conversion Utility for Consultation Audio Pipeline.
 *
 * Uses ffmpeg-static to convert incoming chunks (WebM, Opus, WAV, AAC)
 * into 16 kHz mono PCM 16-bit WAV for Speech-to-Text providers.
 *
 * Streams through stdin/stdout to avoid writing chunk audio to disk.
 */

const { spawn, execFile } = require('child_process');
const ffmpegPath = require('ffmpeg-static');
const logger = require('./logger');

function conversionError(code) {
  return Object.assign(new Error(code), { code });
}

/**
 * Checks if ffmpeg is available and executable.
 * @returns {Promise<boolean>}
 */
async function checkFfmpegInstalled() {
  return new Promise((resolve) => {
    if (!ffmpegPath) {
      logger.error('ffmpeg binary not found in ffmpeg-static package', {
        scope: 'audio-converter',
      });
      return resolve(false);
    }

    execFile(ffmpegPath, ['-version'], (err, stdout) => {
      if (err) {
        logger.error('ffmpeg binary failed health check', {
          scope: 'audio-converter',
          errorCode: 'ERR_FFMPEG_UNAVAILABLE',
        });
        return resolve(false);
      }
      logger.info('ffmpeg binary verified', {
        scope: 'audio-converter',
        version: stdout.split('\n')[0],
      });
      resolve(true);
    });
  });
}

/**
 * Converts an in-memory audio buffer to 16 kHz mono WAV.
 *
 * @param {Buffer} inputBuffer - Raw audio bytes of chunk.
 * @param {string} [inputFormatHint] - Optional format hint (e.g. 'webm', 'wav', 'ogg').
 * @returns {Promise<Buffer>} 16 kHz mono WAV buffer.
 */
function convertTo16kHzMonoWav(inputBuffer, inputFormatHint = null) {
  return new Promise((resolve, reject) => {
    if (!inputBuffer || !Buffer.isBuffer(inputBuffer) || inputBuffer.length === 0) {
      return reject(conversionError('ERR_AUDIO_INPUT_INVALID'));
    }

    if (!ffmpegPath) {
      return reject(conversionError('ERR_FFMPEG_UNAVAILABLE'));
    }

    const args = [
      '-y',
      '-hide_banner',
      '-loglevel', 'error',
    ];

    if (inputFormatHint) {
      args.push('-f', inputFormatHint);
    }

    args.push(
      '-i', 'pipe:0',
      '-ar', '16000',
      '-ac', '1',
      '-c:a', 'pcm_s16le',
      '-f', 'wav',
      'pipe:1'
    );

    let proc;
    try {
      proc = spawn(ffmpegPath, args);
    } catch (_err) {
      return reject(conversionError('ERR_FFMPEG_START'));
    }
    const stdoutChunks = [];
    let settled = false;
    const fail = (code) => {
      if (settled) return;
      settled = true;
      stdoutChunks.length = 0;
      proc.kill();
      reject(conversionError(code));
    };

    proc.stdout.on('data', (chunk) => {
      if (!settled) stdoutChunks.push(chunk);
    });
    // Drain diagnostics without retaining or exposing content from the input.
    proc.stderr.resume();

    proc.on('error', () => fail('ERR_FFMPEG_START'));
    // ffmpeg can reject a malformed chunk before stdin finishes writing. EPIPE
    // is asynchronous: try/catch around write() cannot prevent a Node crash.
    proc.stdin.on('error', () => fail('ERR_AUDIO_CONVERSION'));

    proc.on('close', (code) => {
      if (settled) return;
      if (code !== 0) {
        return fail('ERR_AUDIO_CONVERSION');
      }
      const outputBuffer = Buffer.concat(stdoutChunks);
      stdoutChunks.length = 0;
      if (outputBuffer.length === 0) {
        return fail('ERR_AUDIO_OUTPUT_EMPTY');
      }
      settled = true;
      resolve(outputBuffer);
    });

    // Feed input to ffmpeg stdin
    try {
      proc.stdin.end(inputBuffer);
    } catch (_err) {
      fail('ERR_AUDIO_CONVERSION');
    }
  });
}

module.exports = {
  checkFfmpegInstalled,
  convertTo16kHzMonoWav,
};
