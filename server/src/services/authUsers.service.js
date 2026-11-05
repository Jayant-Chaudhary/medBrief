const { createClient } = require('@supabase/supabase-js');
const supabaseAdmin = require('../config/supabaseAdminClient');
const env = require('../config/env');

const PAGE_SIZE = 1000;

/**
 * The Supabase auth user behind an email address, or null.
 *
 * `listUsers()` is paginated (50 per page by default), so a single call
 * silently misses everyone past the first page — a returning patient would
 * then be treated as new. This walks every page.
 */
async function findAuthUserByEmail(email) {
  const target = email.toLowerCase();

  for (let page = 1; ; page += 1) {
    const { data, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: PAGE_SIZE });
    if (error) throw error;

    const users = data?.users || [];
    const match = users.find((u) => u.email?.toLowerCase() === target);
    if (match) return match;
    if (users.length < PAGE_SIZE) return null;
  }
}

/**
 * Whether this email/password pair signs in. Uses a throwaway anon-key client:
 * signing in on the shared service-role client would make its later queries
 * run as this user. Bad credentials resolve false; other failures throw.
 */
async function verifyPassword(email, password, clientFactory = createClient) {
  const client = clientFactory(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (!error) {
    // Drop the session; we only needed the check.
    await client.auth.signOut({ scope: 'local' }).catch(() => {});
    return Boolean(data?.session);
  }
  if (error.status === 400 || error.code === 'invalid_credentials') return false;
  throw error;
}

module.exports = { findAuthUserByEmail, verifyPassword };
