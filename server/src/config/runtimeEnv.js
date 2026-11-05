/**
 * Which environment we are in, for security decisions.
 *
 * Only an explicit NODE_ENV of 'development' or 'test' counts as
 * non-production. An unset NODE_ENV is treated as production, so a deploy
 * that forgets to set it fails closed instead of enabling demo shortcuts.
 */

function isDevOrTest() {
  return ['development', 'test'].includes(process.env.NODE_ENV);
}

/**
 * A secret from the environment. Outside development and test a missing
 * value stops startup; the fallback exists only for local work.
 */
function requireSecret(names, devFallback) {
  for (const name of [].concat(names)) {
    if (process.env[name]) return process.env[name];
  }
  if (isDevOrTest()) return devFallback;
  throw new Error(`Missing required secret: set ${[].concat(names).join(' or ')}`);
}

module.exports = { isDevOrTest, requireSecret };
