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
          error: err.message,
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
      return reject(new Error('Invalid or empty audio buffer provided for conversion'));
    }

    if (!ffmpegPath) {
      return reject(new Error('ffmpeg binary is not available'));
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

    const proc = spawn(ffmpegPath, args);
    const stdoutChunks = [];
    const stderrChunks = [];

    proc.stdout.on('data', (chunk) => stdoutChunks.push(chunk));
    proc.stderr.on('data', (chunk) => stderrChunks.push(chunk));

    proc.on('error', (err) => {
      reject(new Error(`FFmpeg process spawn error: ${err.message}`));
    });

    proc.on('close', (code) => {
      if (code !== 0) {
        const errDetails = Buffer.concat(stderrChunks).toString('utf-8').trim();
        return reject(
          new Error(`FFmpeg conversion failed (exit ${code}): ${errDetails || 'unknown'}`)
        );
      }
      const outputBuffer = Buffer.concat(stdoutChunks);
      if (outputBuffer.length === 0) {
        return reject(new Error('FFmpeg conversion produced 0 output bytes'));
      }
      resolve(outputBuffer);
    });

    // Feed input to ffmpeg stdin
    try {
      proc.stdin.write(inputBuffer);
      proc.stdin.end();
    } catch (writeErr) {
      reject(new Error(`Failed to write to ffmpeg stdin: ${writeErr.message}`));
    }
  });
}

module.exports = {
  checkFfmpegInstalled,
  convertTo16kHzMonoWav,
};
