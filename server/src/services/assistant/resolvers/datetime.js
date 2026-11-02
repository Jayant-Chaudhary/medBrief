/**
 * Checks a date and time the model proposes for a form. Times are wall-clock
 * values ("2026-12-01T10:00") in the user's own time zone, the same format the
 * form's datetime-local field uses, so nothing is shifted between zones.
 *
 * Only future times within a configured window are accepted. The result also
 * carries the date in words, so the user can see exactly what was filled.
 */

const WALL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const DAY_MS = 24 * 60 * 60 * 1000;

/** The given time zone if the runtime knows it, otherwise the fallback. */
function safeTimeZone(timeZone, fallback) {
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(0);
    return timeZone;
  } catch {
    return fallback;
  }
}

/** "YYYY-MM-DDTHH:mm" for an instant, as a clock in `timeZone` shows it. */
function wallClock(date, timeZone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
    }).formatToParts(date).map((part) => [part.type, part.value])
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

/** "Tue 1 Dec 2026, 10:00" for a wall-clock value. */
function inWords(wall) {
  const [, y, mo, d, h, mi] = WALL.exec(wall).map(Number);
  const weekday = WEEKDAYS[new Date(Date.UTC(y, mo - 1, d)).getUTCDay()];
  return `${weekday} ${d} ${MONTHS[mo - 1]} ${y}, ${String(h).padStart(2, '0')}:${String(mi).padStart(2, '0')}`;
}

/** True for a real calendar time in "YYYY-MM-DDTHH:mm" form. */
function isWallClock(value) {
  const match = WALL.exec(value);
  if (!match) return false;
  const [, y, mo, d, h, mi] = match.map(Number);
  const asDate = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return asDate.getUTCFullYear() === y && asDate.getUTCMonth() === mo - 1 && asDate.getUTCDate() === d && h <= 23 && mi <= 59;
}

/**
 * @returns {{ status: 'empty' } | { status: 'invalid' } | { status: 'ok', value: string, words: string }}
 */
function checkWhen(text, { now, timeZone, maxDays }) {
  const value = String(text || '').trim();
  if (!value) return { status: 'empty' };
  if (!isWallClock(value)) return { status: 'invalid' };

  // Same-format strings compare in time order.
  if (value <= wallClock(now, timeZone) || value > wallClock(new Date(now.getTime() + maxDays * DAY_MS), timeZone)) {
    return { status: 'invalid' };
  }
  return { status: 'ok', value, words: inWords(value) };
}

/** The current moment in words, for the model: "Tue 3 Nov 2026, 14:10 (Asia/Kolkata)". */
function nowInWords(now, timeZone) {
  return `${inWords(wallClock(now, timeZone))} (${timeZone})`;
}

module.exports = { checkWhen, isWallClock, wallClock, inWords, nowInWords, safeTimeZone };
