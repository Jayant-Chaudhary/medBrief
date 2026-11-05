/**
 * Matches plain navigation requests ("open my reports", "mere reports dikhao")
 * without calling the model.
 *
 * Strict on purpose: every word must be either part of a page alias or a
 * filler word like "open", "my" or "dikhao". Anything else ("is my report
 * normal?", "I have pain") is left for the model, so a health statement can
 * never be routed by a keyword it happens to contain.
 */

const FILLER = new Set([
  // English
  'a', 'an', 'the', 'my', 'me', 'i', 'to', 'go', 'open', 'show', 'see', 'view', 'take', 'want', 'need', 'please',
  'pls', 'plz', 'can', 'you', 'let', 'lets', 'check', 'page', 'tab', 'screen', 'section', 'up', 'bring', 'get',
  'display', 'navigate', 'goto', 'would', 'like', 'could', 'now', 'for', 'of', 'on', 'and', 'or', 'aur', 'ya',
  // Conversational glue around a page name ("close it and open the dashboard", "click the menu button then ...")
  'close', 'it', 'this', 'that', 'then', 'next', 'after', 'also', 'just', 'back', 'click', 'tap', 'press', 'menu',
  'button', 'link', 'phir', 'fir', 'band',
  // Hinglish
  'mere', 'mera', 'meri', 'mujhe', 'dikhao', 'dikha', 'dikhado', 'dikhaiye', 'kholo', 'khol', 'kholiye', 'do', 'de',
  'dena', 'par', 'pe', 'ko', 'jao', 'jana', 'chalo', 'le', 'lo', 'wala', 'wali', 'wale', 'zara', 'kar', 'karo',
  'dekhna', 'dekhni', 'dekhao', 'hai', 'hain', 'ka', 'ki', 'ke', 'aap',
  // Hindi
  'मेरे', 'मेरी', 'मेरा', 'मुझे', 'दिखाओ', 'दिखा', 'दिखाइए', 'खोलो', 'खोलिए', 'दो', 'को', 'पर', 'पे', 'पेज', 'का', 'की', 'के',
]);

function normalize(text) {
  return String(text)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{M}\p{N}]+/gu, ' ')
    .trim();
}

function tokens(text) {
  const normalized = normalize(text);
  return normalized ? normalized.split(' ') : [];
}

/**
 * @returns {{ kind: 'open', pageIds: [string] } | { kind: 'clarify', pageIds: string[] } | null}
 */
function matchIntent(message, pages) {
  const words = tokens(message);
  if (!words.length) return null;

  // Longest aliases first, so "lab reports" wins over "reports".
  const aliases = pages
    .flatMap((page) => page.aliases.map((alias) => ({ id: page.id, words: tokens(alias) })))
    .filter((alias) => alias.words.length)
    .sort((a, b) => b.words.length - a.words.length);

  const matched = new Set();
  let i = 0;
  while (i < words.length) {
    const alias = aliases.find((candidate) => candidate.words.every((word, k) => words[i + k] === word));
    if (alias) {
      matched.add(alias.id);
      i += alias.words.length;
    } else if (FILLER.has(words[i])) {
      i += 1;
    } else {
      return null;
    }
  }

  if (matched.size === 0) return null;
  const pageIds = [...matched];
  return pageIds.length === 1 ? { kind: 'open', pageIds } : { kind: 'clarify', pageIds: pageIds.slice(0, 3) };
}

module.exports = { matchIntent, normalize };
