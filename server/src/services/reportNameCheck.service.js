const env = require('../config/env');

/** Titles printed around a name on lab reports; they say nothing about who it is. */
const TITLES = new Set(['mr', 'mrs', 'ms', 'miss', 'mx', 'dr', 'smt', 'shri', 'sri', 'kumari', 'km']);

function nameTokens(name) {
  if (typeof name !== 'string') return [];
  const words = name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '') // Latin accents only; other scripts need their marks.
    .toLowerCase()
    .split(/[^\p{L}]+/u)
    .filter((word) => word && !TITLES.has(word));
  return [...new Set(words)];
}

function withinOneEdit(a, b) {
  if (Math.abs(a.length - b.length) > 1) return false;
  let i = 0;
  let j = 0;
  let edits = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length >= b.length) i += 1;
    if (b.length >= a.length) j += 1;
  }
  return edits + (a.length - i) + (b.length - j) <= 1;
}

function tokensMatch(a, b) {
  if (a === b) return true;
  if (a.length === 1 || b.length === 1) return a[0] === b[0]; // "P. Sharma"
  // OCR misreads a letter now and then, but short names differ by one letter
  // for real (Riya, Priya), so only long words get the benefit of the doubt.
  const minLength = env.ocr.nameTypoMinLength;
  return a.length >= minLength && b.length >= minLength && withinOneEdit(a, b);
}

/**
 * Whether the name printed on a report points at a different person.
 *
 * Deliberately forgiving, because a warning on someone's own report teaches
 * them to dismiss it: order, titles, initials, and a missing middle or family
 * name are not differences. A name that could not be read is not one either.
 */
function reportNameDiffers(nameOnReport, nameOnAccount) {
  const reported = nameTokens(nameOnReport);
  const account = nameTokens(nameOnAccount);
  if (reported.length === 0 || account.length === 0) return false;

  // OCR routinely eats the spaces in a name ("PRIYASHARMA").
  if (reported.join('') === account.join('')) return false;

  const [shorter, longer] = reported.length <= account.length ? [reported, account] : [account, reported];
  return !shorter.every((token) => longer.some((other) => tokensMatch(token, other)));
}

module.exports = { reportNameDiffers };
