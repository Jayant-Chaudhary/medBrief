// Local-only observation. Never serialize DOM text or field values to the API.
export function capturePage(doc = document) {
  const root = doc.body?.cloneNode(true);
  root?.querySelectorAll('[data-assistant-panel]').forEach(el => el.remove());
  root?.querySelectorAll('[data-assistant-flash]').forEach(el => el.removeAttribute('data-assistant-flash'));
  return `${doc.defaultView?.location?.href || ''}|${root?.innerHTML || ''}`;
}
export async function observeAction(run, settle, capture = capturePage) {
  const before = capture();
  const result = await run();
  if (result && result.result !== 'ok') return result;
  await settle();
  return result?.verified || capture() !== before ? { result: 'ok' } : { result: 'no_change' };
}
