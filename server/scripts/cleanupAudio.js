#!/usr/bin/env node
/**
 * Audio Retention Cleanup Script.
 *
 * Removes audio chunks from Supabase Storage and clears Redis cache
 * for consultations whose clinical notes draft was approved past the
 * configured retention period (default 24h).
 *
 * Defaults to a safe dry-run mode. Pass --apply to perform actual deletion.
 *
 * Usage:
 *   node scripts/cleanupAudio.js                  # Dry-run (lists eligible sessions without deleting)
 *   node scripts/cleanupAudio.js --apply          # Permanently deletes eligible audio chunks
 *   node scripts/cleanupAudio.js --apply --batch-size 20 --retention-hours 12
 */

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });
const { cleanupExpiredAudio } = require('../src/services/consultAudio/audioCleanup.service');
const logger = require('../src/utils/logger');

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes('--apply');

  let batchSize = 50;
  let retentionHours = undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--batch-size' && args[i + 1]) {
      batchSize = parseInt(args[i + 1], 10);
    }
    if (args[i] === '--retention-hours' && args[i + 1]) {
      retentionHours = parseFloat(args[i + 1]);
    }
  }

  console.log(`[Audio Cleanup] Starting audio retention cleanup (${apply ? 'APPLY / DELETION MODE' : 'DRY-RUN MODE'})...`);

  try {
    const summary = await cleanupExpiredAudio({
      apply,
      batchSize,
      retentionHours,
    });

    console.log('[Audio Cleanup] Completed successfully.');
    console.log(`  Dry Run:               ${summary.dryRun}`);
    console.log(`  Eligible Sessions:     ${summary.eligibleSessionsCount}`);
    console.log(`  Deleted Sessions:      ${summary.deletedSessionsCount}`);
    console.log(`  Deleted Audio Objects: ${summary.deletedObjectsCount}`);
    console.log(`  Duration:              ${summary.durationMs}ms`);

    if (summary.errors.length > 0) {
      console.warn(`  Errors encountered:    ${summary.errors.length}`);
      for (const err of summary.errors) {
        console.warn(`    - Session ${err.sessionId}: ${err.errorCode}`);
      }
    }

    process.exit(0);
  } catch (err) {
    logger.error('Audio retention cleanup failed', {
      scope: 'consult-audio-cleanup-cli',
      errorCode: err.code || 'ERR_CLEANUP_FAILED',
      message: err.message,
    });
    console.error(`[Audio Cleanup] Failed: ${err.message}`);
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}
