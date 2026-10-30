const { spawn } = require('node:child_process');
const fs = require('node:fs');

console.log('=== WORKER DIAGNOSTIC ===');

// 1. Check FCM
console.log('[1/3] Checking FCM credentials file...');
try {
  if (process.env.COMMUNITY_FCM_CREDENTIALS_FILE) {
    const creds = JSON.parse(fs.readFileSync(process.env.COMMUNITY_FCM_CREDENTIALS_FILE, 'utf8'));
    console.log('  -> OK: Loaded FCM credentials for project:', creds.project_id);
  } else {
    console.log('  -> No FCM credentials file defined.');
  }
} catch (err) {
  console.error('  -> ERROR loading FCM file:', err.message);
}

// 2. Check Database URL
console.log('\n[2/3] Checking Database Connection Settings...');
let connection = {};
try {
  const url = new URL(process.env.COMMUNITY_WORKER_DATABASE_URL);
  connection = {
    PGHOST: url.searchParams.get('host') || url.hostname,
    PGPORT: url.port || '5432',
    PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    ...(url.searchParams.has('sslmode') ? { PGSSLMODE: url.searchParams.get('sslmode') } : {}),
  };
  console.log('  -> Host:', connection.PGHOST);
  console.log('  -> Port:', connection.PGPORT);
  console.log('  -> Database:', connection.PGDATABASE);
  console.log('  -> User:', connection.PGUSER);
  console.log('  -> SSL Mode:', connection.PGSSLMODE || '(none)');
} catch (err) {
  console.error('  -> ERROR parsing database URL:', err.message);
  process.exit(1);
}

// 3. Test psql execution
console.log('\n[3/3] Testing psql execution and query...');
const child = spawn('psql', ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
  env: {
    ...process.env,
    ...connection,
    PGCONNECT_TIMEOUT: '5',
    PGAPPNAME: 'medbrief-community',
    PGOPTIONS: '-c statement_timeout=15000'
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stdout = '';
let stderr = '';

child.stdout.on('data', chunk => { stdout += chunk; });
child.stderr.on('data', chunk => { stderr += chunk; });

child.on('error', err => {
  console.error('  -> SPAWN ERROR (psql failed to launch):', err.message);
  if (err.code === 'ENOENT') {
    console.error('  -> REASON: "psql" executable was NOT found in your current terminal PATH.');
  }
});

child.on('close', code => {
  console.log('  -> psql exit code:', code);
  if (stdout.trim()) console.log('  -> Query output:\n' + stdout.trim());
  if (stderr.trim()) console.error('  -> Database stderr:\n' + stderr.trim());
  if (code === 0) {
    console.log('\n=== SUCCESS: Connection and queries completed successfully! ===');
  } else {
    console.log('\n=== FAILED: See errors above ===');
  }
});

// Run worker_tick query
child.stdin.end(`
SELECT current_setting('log_statement')='none' AND current_setting('log_min_error_statement')='panic' AS privacy_logging_ok \\gset
\\if :privacy_logging_ok
SELECT community_private.worker_tick();
\\else
SELECT 'PRIVACY_LOGGING_CHECK_FAILED';
\\endif
`);

