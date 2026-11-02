/** Pages where the assistant button never appears: sign-in, onboarding, and the separate community space. */
const HIDDEN_PREFIXES = ['/login', '/signup', '/invite', '/onboarding', '/verification-pending', '/community-care', '/maternity'];

/**
 * Whether the assistant may show on this route for this user. The server
 * enforces the same roles; this only avoids offering a panel that would fail.
 */
export function assistantVisibleOn(pathname, { role, verified } = {}) {
  if (HIDDEN_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`))) return false;
  if (role === 'patient') return true;
  if (role === 'clinician') return verified === true;
  return false;
}
