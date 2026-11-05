const { spawn } = require('node:child_process');

const functions = new Set([
  'identity_private.issue_capability', 'identity_private.reveal_api',
  'community_private.read_api', 'community_private.action_api',
  'community_private.professional_action', 'community_private.submit_screened',
  'community_private.message_screened', 'community_private.worker_tick',
  'community_private.finish_push', 'community_private.read_alerts',
  'community_private.notice_api', 'community_private.manage_tags', 'community_private.own_posts',
  'community_private.choose_username',
  'community_private.username_status',
]);

class CommunityError extends Error {
  constructor(status, code) { super(code); this.status = status; this.code = code; }
}

// Existing PostgreSQL CLI, no shell or new dependency. Inputs travel over stdin,
// never argv. Hex encoding prevents SQL interpolation; credentials stay in env.
// Deliberately limited to bounded function calls, not arbitrary SQL from requests.
function createDatabase(databaseUrl, executable = 'psql') {
  return async (name, values = []) => {
    if (!databaseUrl || !functions.has(name)) throw new CommunityError(503, 'community_unavailable');
    let connection;
    try {
      const url = new URL(databaseUrl);
      if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error();
      connection = {
        PGHOST: url.searchParams.get('host') || url.hostname,
        PGPORT: url.port || '5432',
        PGDATABASE: decodeURIComponent(url.pathname.slice(1)),
        PGUSER: decodeURIComponent(url.username),
        PGPASSWORD: decodeURIComponent(url.password),
        ...(url.searchParams.has('sslmode') ? {PGSSLMODE: url.searchParams.get('sslmode')} : {}),
      };
      if (!connection.PGHOST || !connection.PGDATABASE || !connection.PGUSER) throw new Error();
    } catch { throw new CommunityError(503, 'community_unavailable'); }
    const args = values.map(value => {
      if (value === null) return 'NULL';
      const text = typeof value === 'object' ? JSON.stringify(value) : String(value);
      return `convert_from(decode('${Buffer.from(text).toString('hex')}','hex'),'UTF8')`;
    });
    const types = {
      'identity_private.issue_capability': ['uuid', 'text'],
      'community_private.finish_push': ['uuid', 'boolean'],
    };
    const cast = types[name] || values.map((value, i) => typeof value === 'object' && value !== null ? 'jsonb' : 'text');
    const sql = `\\set VERBOSITY sqlstate\nSELECT current_setting('log_statement')='none' AND current_setting('log_min_error_statement')='panic' AS privacy_logging_ok \\gset\n\\if :privacy_logging_ok\nSELECT ${name}(${args.map((v, i) => `${v}::${cast[i]}`).join(',')});\n\\else\nSELECT 1/0;\n\\endif\n`;
    return new Promise((resolve, reject) => {
      const child = spawn(executable, ['-X', '-q', '-A', '-t', '-v', 'ON_ERROR_STOP=1'], {
        env: { ...process.env, ...connection, PGCONNECT_TIMEOUT: '5', PGAPPNAME: 'medbrief-community', PGOPTIONS: '-c statement_timeout=15000' },
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = ''; let stderr = ''; let stopped = false;
      const timer = setTimeout(() => { stopped = true; child.kill('SIGKILL'); }, 20000);
      child.stdout.on('data', chunk => { stdout += chunk; if (stdout.length > 2_000_000) { stopped = true; child.kill('SIGKILL'); } });
      child.stderr.on('data', chunk => { if (stderr.length < 10000) stderr += chunk; });
      child.on('error', () => { clearTimeout(timer); reject(new CommunityError(503, 'community_unavailable')); });
      child.stdin.on('error', () => {});
      child.on('close', code => {
        clearTimeout(timer);
        if (code !== 0 || stopped) {
          const status = /42501/.test(stderr) ? 403 : /P0002/.test(stderr) ? 404 : /23505/.test(stderr) ? 409 : /22023|22P02|23503/.test(stderr) ? 400 : 503;
          // Never return or log PostgreSQL errors, statements or submitted values.
          return reject(new CommunityError(status, status === 403 ? 'community_access_denied' : 'community_request_failed'));
        }
        const text = stdout.trim();
        try { resolve(text ? JSON.parse(text) : null); } catch { resolve(text); }
      });
      child.stdin.end(sql);
    });
  };
}
module.exports = { createDatabase, CommunityError };
