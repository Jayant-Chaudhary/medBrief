/**
 * Finds the patient a typed name refers to, only among the signed-in
 * clinician's own patients. Never guesses: several matches go back to the user.
 *
 * Name matching reuses the report name check, which already handles titles,
 * word order, initials, missing middle names and small OCR-style misspellings.
 */

const { reportNameDiffers } = require('../../reportNameCheck.service');

const MAX_CHOICES = 5;

function normalize(name) {
  return String(name || '').normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * @returns {{ status: 'one', patient: object } | { status: 'many', matches: object[] } | { status: 'none' }}
 */
function resolvePatient(typedName, patients) {
  if (!/\p{L}{2,}/u.test(typedName || '')) return { status: 'none' };

  const matches = patients.filter((p) => p.fullName && !reportNameDiffers(typedName, p.fullName));
  if (!matches.length) return { status: 'none' };

  // An exact full-name match settles it even when a looser match also fits.
  const exact = matches.filter((p) => normalize(p.fullName) === normalize(typedName));
  if (exact.length === 1) return { status: 'one', patient: exact[0] };
  if (matches.length === 1) return { status: 'one', patient: matches[0] };
  return { status: 'many', matches: matches.slice(0, MAX_CHOICES) };
}

function maskEmail(email) {
  const [user, domain] = String(email || '').split('@');
  return user && domain ? `${user[0]}***@${domain}` : null;
}

/** Enough to tell two patients with the same name apart, without showing full contact details. */
function describePatient(patient) {
  const parts = [maskEmail(patient.email)];
  const digits = String(patient.phone || '').replace(/\D/g, '');
  if (digits.length >= 4) parts.push(`phone …${digits.slice(-4)}`);
  const visit = patient.nextVisit || patient.lastVisit;
  if (visit?.scheduledAt) {
    const when = new Date(visit.scheduledAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
    parts.push(`${patient.nextVisit ? 'next visit' : 'last visit'} ${when}`);
  }
  return parts.filter(Boolean).join(' · ');
}

module.exports = { resolvePatient, describePatient };
