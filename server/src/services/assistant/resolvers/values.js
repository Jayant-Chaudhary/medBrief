/**
 * Checks a value the model proposes for a form control before the website
 * fills it (Phase 3).
 *
 * Grounding: the model may only copy values, never make them up. Free text,
 * emails and numbers must appear in the typed message; a dropdown choice must
 * be named in it; dates must match words in it. Clinical controls also need
 * the field itself to be named ("hb 10.5", not just "10.5"), so a value cannot
 * drift into a field the user never mentioned. No clinical ranges are applied:
 * those are for clinicians to configure, not for this code to invent.
 */

const { checkWhen, inWords, isWallClock, wallClock } = require('./datetime');

const MAX_TEXT = 500;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_MS = 24 * 60 * 60 * 1000;

// A filled time must come from the user's words; small models invent "00:00" for "tomorrow".
const TIME_WORDS = /\d|\b(am|pm|noon|midnight|o\s?clock|baje|bajkar|dopahar)\b|बजे/i;
const mentionsTime = (message) => TIME_WORDS.test(String(message || ''));

const REASONS = {
  notInMessage: 'I could not find that value in your message',
  notNamed: 'you did not name this field',
  badOption: 'that is not one of its choices',
  badNumber: 'that is not a number',
  badEmail: 'that is not an email address',
  badDate: 'that is not a valid date',
  notFuture: 'it must be in the future',
  notPast: 'it cannot be in the future',
  noTime: 'tell me the day and the time together, for example "today at 4 pm"',
  wrongDay: 'I was not sure which day you meant',
};

/** Lower case, quotes dropped, spaces collapsed: for comparing what was typed. */
function norm(text) {
  return String(text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[“”"‘’'`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * True when one of the phrases appears in the message as a whole word: "hb" does
 * not match "hbsag", but does match "hb10.5" (doctors often skip the space).
 */
function mentions(message, phrases) {
  const haystack = norm(message);
  return phrases.some((phrase) => {
    const needle = norm(phrase);
    return needle && new RegExp(`(^|[^\\p{L}])${escapeRegExp(needle)}($|[^\\p{L}])`, 'u').test(haystack);
  });
}

const numbersIn = (message) => (String(message).match(/\d+(?:\.\d+)?/g) || []).map(Number);

// Obstetric formula as doctors write it: "G2 P1 L1 A0", "g2p1l1a0".
const FORMULA = /(?:^|[^a-z])g\s*(\d+)\s*p\s*(\d+)(?:\s*l\s*(\d+))?(?:\s*a\s*(\d+))?/;
const FORMULA_GROUP = { g: 1, p: 2, l: 3, a: 4 };

/** The number the formula gives for this control's letter, or null. */
function formulaValue(control, message) {
  if (!control.formula) return null;
  const match = FORMULA.exec(norm(message));
  const value = match?.[FORMULA_GROUP[control.formula]];
  return value == null ? null : Number(value);
}

function dateMentioned(message, value, clock) {
  const today = wallClock(clock.now, clock.timeZone).slice(0, 10);
  const yesterday = wallClock(new Date(clock.now.getTime() - DAY_MS), clock.timeZone).slice(0, 10);
  if (value === today && mentions(message, ['today', 'todays', 'aaj', 'आज'])) return true;
  if (value === yesterday && mentions(message, ['yesterday', 'kal raat'])) return true;
  const [, , month, day] = ISO_DATE.exec(value).map(Number);
  const numbers = numbersIn(message);
  // "mar", "march" and "12/3" all name March.
  const monthNamed = new RegExp(`(^|[^a-z])${MONTHS[month - 1]}`).test(norm(message));
  return numbers.includes(day) && (monthNamed || numbers.includes(month));
}

const WEEKDAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

/**
 * True when the date part of a filled time is the day the message names:
 * today/aaj, tomorrow/kal, day after tomorrow/parso, a weekday, a written
 * date, or (no day named) today or tomorrow. Stops the model writing today's
 * date for "kal shaam 5 baje" while today's 5 pm is still in the future.
 */
function dayMatches(datePart, message, clock, { future = true } = {}) {
  const dayAt = (offset) => wallClock(new Date(clock.now.getTime() + offset * DAY_MS), clock.timeZone).slice(0, 10);
  const text = norm(message);
  if (/day after tomorrow|\bparso\b|परसों/.test(text)) return datePart === dayAt(2);
  if (/\byesterday\b/.test(text)) return datePart === dayAt(-1);
  // "kal" is also yesterday; for a booking only tomorrow makes sense.
  if (/\b(tomorrow|tmrw|kal)\b|कल/.test(text)) return datePart === dayAt(1) || (!future && datePart === dayAt(-1));
  if (/\b(today|todays|tonight|aaj)\b|आज/.test(text)) return datePart === dayAt(0);
  const weekday = WEEKDAY_NAMES.findIndex((name) => new RegExp(`\\b${name}\\b`).test(text));
  if (weekday >= 0) return new Date(`${datePart}T00:00:00Z`).getUTCDay() === weekday;
  if (/\bnext week\b/.test(text)) return datePart > dayAt(0) && datePart <= dayAt(14);
  if (MONTHS.some((m) => new RegExp(`(^|[^a-z])${m}`).test(text)) || /\d{1,2}[/-]\d{1,2}/.test(text)) return dateMentioned(message, datePart, clock);
  return datePart === dayAt(0) || datePart === dayAt(1);
}

/** The day a relative word names ("kal" → tomorrow for a booking), or null when there is none. */
function relativeDay(message, clock, { future = true } = {}) {
  const dayAt = (offset) => wallClock(new Date(clock.now.getTime() + offset * DAY_MS), clock.timeZone).slice(0, 10);
  const text = norm(message);
  if (/day after tomorrow|\bparso\b|परसों/.test(text)) return dayAt(2);
  if (/\byesterday\b/.test(text)) return future ? null : dayAt(-1);
  if (/\b(tomorrow|tmrw|kal)\b|कल/.test(text)) return future ? dayAt(1) : null;
  if (/\b(today|todays|tonight|aaj)\b|आज/.test(text)) return dayAt(0);
  return null;
}

/**
 * Keeps the model's time but takes the day from the user's own words when the
 * model got the day wrong. Returns null when the day cannot be settled.
 */
function settleDay(value, message, clock, options) {
  if (!isWallClock(value) || dayMatches(value.slice(0, 10), message, clock, options)) return value;
  const day = relativeDay(message, clock, options);
  return day ? `${day}${value.slice(10)}` : null;
}

function validIsoDate(value) {
  const match = ISO_DATE.exec(value);
  if (!match) return false;
  const [, y, m, d] = match.map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

const fail = (reason) => ({ ok: false, reason: REASONS[reason] });

/**
 * @param {object} control - from controls.registry
 * @param {unknown} raw - the model's value (a string)
 * @param {string} message - what the user typed
 * @param {{ now: Date, timeZone: string, maxDays: number }} clock
 * @returns {{ ok: true, value: string|boolean, display: string } | { ok: false, reason: string|null }}
 *   reason null means "nothing to fill" and is not shown to the user.
 */
function checkValue(control, raw, message, clock) {
  const text = String(raw ?? '').trim().slice(0, MAX_TEXT);
  if (!text) return { ok: false, reason: null };
  // Clinical controls need the field named in the message, so a value cannot drift into it.
  const named = !control.clinical || mentions(message, control.aliases?.length ? control.aliases : [control.label]);

  switch (control.kind) {
    case 'text':
    case 'textarea':
      if (!named) return fail('notNamed');
      return norm(message).includes(norm(text)) ? { ok: true, value: text, display: text } : fail('notInMessage');

    case 'email':
      if (!EMAIL.test(text)) return fail('badEmail');
      return norm(message).includes(norm(text)) ? { ok: true, value: text, display: text } : fail('notInMessage');

    case 'number': {
      if (!/^\d+(\.\d+)?$/.test(text)) return fail('badNumber');
      const value = Number(text);
      // "G2 P1 L1 A0" names each field by its letter and gives its value.
      if (formulaValue(control, message) === value) return { ok: true, value: String(value), display: String(value) };
      if (!named) return fail('notNamed');
      return numbersIn(message).includes(value) ? { ok: true, value: String(value), display: String(value) } : fail('notInMessage');
    }

    case 'select': {
      const wanted = norm(text);
      const option = control.options.find((o) => [o.value, o.label, ...(o.synonyms || [])].some((name) => norm(name) === wanted));
      if (!option) return fail('badOption');
      // "Yes / No" is also matched as "yes/no".
      if (!mentions(message, [option.label, option.label.replace(/\s*\/\s*/g, '/'), ...(option.synonyms || [])])) {
        // A non-clinical choice the user never mentioned is usually the model guessing the default:
        // leave the field as it is, without a note.
        return control.clinical ? fail('notInMessage') : { ok: false, reason: null };
      }
      // A choice like "breech" or "O negative" names its own field; "negative" alone does not.
      if (!named && !control.optionsNameField) return fail('notNamed');
      return { ok: true, value: option.value, display: option.label };
    }

    case 'checkbox': {
      const on = /^(true|yes|on|1)$/i.test(text);
      if (!on && !/^(false|no|off|0)$/i.test(text)) return { ok: false, reason: null };
      if (mentions(message, control.aliases?.length ? control.aliases : [control.label])) {
        return { ok: true, value: on, display: on ? 'yes' : 'no' };
      }
      return control.clinical ? fail('notNamed') : { ok: false, reason: null };
    }

    case 'date': {
      if (!named) return fail('notNamed');
      if (!validIsoDate(text)) return fail('badDate');
      if (control.future && text <= wallClock(clock.now, clock.timeZone).slice(0, 10)) return fail('notFuture');
      return dateMentioned(message, text, clock) ? { ok: true, value: text, display: text } : fail('notInMessage');
    }

    case 'datetime': {
      if (!named) return fail('notNamed');
      if (!mentionsTime(message)) return fail('noTime');
      const settled = settleDay(text, message, clock, { future: control.future });
      if (!settled) return fail(control.future && checkWhen(text, clock).status === 'invalid' ? 'notFuture' : 'wrongDay');
      if (control.future) {
        const when = checkWhen(settled, clock);
        return when.status === 'ok' ? { ok: true, value: when.value, display: when.words } : fail('notFuture');
      }
      if (!isWallClock(settled)) return fail('badDate');
      // A delivery has already happened.
      if (control.past && settled > wallClock(clock.now, clock.timeZone)) return fail('notPast');
      return { ok: true, value: settled, display: inWords(settled) };
    }

    default:
      return { ok: false, reason: null };
  }
}

module.exports = { checkValue, dayMatches, settleDay, mentions, mentionsTime, norm, REASONS };
