const { ProviderError } = require('./provider.interface');

/** POST a JSON body and return the parsed JSON reply, mapping failures to ProviderError codes. */
async function postJson(url, body, { headers = {}, timeoutMs }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    throw new ProviderError(err.name === 'AbortError' ? 'TIMEOUT' : 'NETWORK');
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) throw new ProviderError(`HTTP_${response.status}`);
  try {
    return await response.json();
  } catch {
    throw new ProviderError('BAD_RESPONSE');
  }
}

module.exports = { postJson };
