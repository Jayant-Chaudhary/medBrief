/**
 * What the assistant may do, per role. Each action turns a validated step into
 * something the website does: open a route, fill a form's declared controls,
 * press one of its declared buttons. Routes are built here from ids the server
 * resolved, never from model output, and carry no names or contact details.
 * Buttons that save or send are only ever pressed after the user confirms.
 */

const { findPage } = require('./pages.registry');
const { checkWhen } = require('./resolvers/datetime');
const { checkValue, settleDay, mentionsTime } = require('./resolvers/values');
const { formFor, findControl, findButton } = require('./controls.registry');

const ACTIONS = {
  open_page: {
    roles: ['patient', 'clinician'],
    description: 'Open one page. Set "page".',
  },
  // pageWithoutPatient: what to open when the user named no patient ("open the antenatal record").
  find_patient: {
    roles: ['clinician'],
    description: 'Search the Patients list for a name. Set "patient" to the name the user typed.',
    needsPatient: true,
    pageWithoutPatient: 'patients',
  },
  open_patient_visit: {
    roles: ['clinician'],
    description: 'Open a patient\'s next or last visit on the dashboard. Set "patient" and "which" (next or last).',
    needsPatient: true,
    resolvesPatient: true,
    pageWithoutPatient: 'patients',
  },
  open_maternity_card: {
    roles: ['clinician'],
    description: 'Open a patient\'s maternity card. Set "patient".',
    needsPatient: true,
    resolvesPatient: true,
    pageWithoutPatient: 'maternity',
  },
  open_new_appointment: {
    roles: ['clinician'],
    description:
      'Open New appointment with one of the doctor\'s existing patients chosen and, if the user gave a date AND a time, fill them in. ' +
      'Set "patient", and "when" (or "" if no exact time was given).',
    needsPatient: true,
    resolvesPatient: true,
    pageWithoutPatient: 'new_appointment',
  },
  fill_form: {
    roles: ['clinician'],
    description:
      'Fill fields on a form page and/or press one of its buttons. Set "page", "fields" (only fields the user gave a value for, ' +
      'values copied exactly from the message) and "press" (a button id, or "none").',
  },
};

const BAD_TIME = 'I could not use that date and time (it must be in the future), so please choose it yourself.';
const WRONG_DAY = 'I was not sure which day you meant, so please choose the date and time yourself.';
const ASK_TIME = 'Tell me the day and the time together, for example "today at 4 pm", and I will fill them in.';
const MAX_FIELDS = 12;

function actionsFor(role) {
  return Object.keys(ACTIONS).filter((id) => ACTIONS[id].roles.includes(role));
}

const needsPatient = (id) => Boolean(ACTIONS[id]?.needsPatient);
const resolvesPatient = (id) => Boolean(ACTIONS[id]?.resolvesPatient);

/** A patient action with no name becomes "open the plain page" (no record is opened). */
function withoutMissingPatient(step) {
  const page = ACTIONS[step.do]?.pageWithoutPatient;
  if (!page || String(step.patient || '').trim()) return step;
  return { ...step, do: 'open_page', page, patient: '', when: '' };
}

// A day with no time ("add today's date") can't be filled, but deserves a reply saying why.
const DAY_WORDS = /\b(today'?s?|tonight|tomorrow'?s?|day after|next week|date|aaj|kal|parso|(mon|tues|wednes|thurs|fri|satur|sun)day)\b|आज|कल|परसों/i;
const mentionsDay = (message) => DAY_WORDS.test(String(message || ''));

// Words that mean the user expected a button to be pressed. Where the button is
// not one the assistant may press, the reply says the last step is theirs.
const SUBMIT_WORDS = /\b(start it|start the visit|submit|save|confirm|send|invite|press|click|book it|create it|schedule it)\b|bhej|save kar|submit kar/i;
const asksToSubmit = (message) => SUBMIT_WORDS.test(String(message || ''));

const isSaving = (button) => button?.effect === 'save' || button?.effect === 'send';

/**
 * Fills and presses on one declared form; values the message does not back up are skipped and reported.
 * After a patient's record was opened in the same plan, the fill names that patient, and the website
 * waits until exactly that patient's record has loaded before filling anything.
 */
function buildFill(step, role, clock, ctx, patient) {
  const form = formFor(role, step.page);
  const page = findPage(role, step.page);
  if (!form || !page) return { ok: false, message: null };

  const fields = {};
  const filled = [];
  const skipped = [];
  for (const proposed of (Array.isArray(step.fields) ? step.fields : []).slice(0, MAX_FIELDS)) {
    const control = findControl(role, step.page, proposed?.control);
    if (!control || control.id in fields) continue;
    const checked = clock ? checkValue(control, proposed.value, ctx.message, clock) : { ok: false, reason: null };
    if (checked.ok) {
      fields[control.id] = checked.value;
      filled.push({ id: control.id, label: control.label, value: checked.display });
    } else if (checked.reason) {
      skipped.push({ label: control.label, reason: checked.reason });
    }
  }

  // Paired fields (blood pressure) come straight from the user's "110/70", in that order.
  for (const pair of form.pairs || []) {
    const match = pair.pattern.exec(ctx.message || '');
    const proposed = (Array.isArray(step.fields) ? step.fields : []).some((f) => pair.ids.includes(f?.control));
    if (!match || !proposed) continue;
    pair.ids.forEach((id, index) => {
      const control = findControl(role, step.page, id);
      const value = String(Number(match[index + 1]));
      fields[id] = value;
      const entry = { id, label: control.label, value };
      const at = filled.findIndex((f) => f.id === id);
      if (at >= 0) filled[at] = entry;
      else filled.push(entry);
      const skippedAt = skipped.findIndex((s) => s.label === control.label);
      if (skippedAt >= 0) skipped.splice(skippedAt, 1);
    });
  }

  const here = ctx.pathname === page.path;
  // Whose page the fill and press are for: the patient opened in this plan, or (after opening
  // the plain page) no patient. On the page already open there is none: it uses what is shown.
  const context = patient ? { patientId: patient.id } : !here ? { patientId: null } : null;

  let button = step.press && step.press !== 'none' ? findButton(role, step.page, step.press) : null;
  if (button?.internal) button = null;
  // A save or send is only proposed when the user asked for one ("send the invite"), never because
  // the model read "book" as "submit". Even then it waits for Confirm in the browser.
  if (isSaving(button) && !asksToSubmit(ctx.message)) button = null;
  // With pressing switched off, saving buttons are left to the user.
  const press = button && (!isSaving(button) || ctx.actionsEnabled)
    ? {
        page: step.page, id: button.id, label: button.label, effect: button.effect,
        ...(button.sideEffect && { sideEffect: button.sideEffect }),
        ...(context && { context }),
      }
    : null;
  const more = Boolean(button && !press);
  if (!filled.length && !skipped.length && !press && !more) return { ok: false, message: step.dayOnly ? ASK_TIME : null };

  return {
    ok: true,
    more,
    step: {
      ...(!here && { path: page.path }),
      label: page.id === 'new_appointment' ? 'New appointment' : page.label,
      ...(filled.length && { fill: { page: step.page, fields, filled, ...(context && { context }) } }),
      ...(skipped.length && { skipped }),
      ...(press && { press }),
    },
  };
}

/**
 * @param {object} step - validated model step
 * @param {object|null} patient - resolved patient from the clinician's own list, when the action needs one
 * @param {{ now: Date, timeZone: string, maxDays: number }} [clock] - for checking dates to fill
 * @param {{ message?: string, pathname?: string, actionsEnabled?: boolean }} [ctx] - for form actions:
 *   what was typed (values must come from it), the page open before this step, whether saving buttons may be pressed
 * @returns {{ ok: true, more?: boolean, step: object } | { ok: false, message: string|null }}
 */
function buildStep(step, patient, role, clock, ctx = {}) {
  const ok = (path, label, state, extra) => ({ ok: true, step: { path, label, ...(state && { state }), ...extra } });
  const name = patient?.fullName || 'this patient';

  switch (step.do) {
    case 'open_page': {
      const page = findPage(role, step.page);
      return page ? ok(page.path, page.label) : { ok: false, message: null };
    }
    case 'find_patient':
      // Passed as navigation state, so the name never appears in the URL.
      return ok('/clinician/patients', 'Patients', { assistantQuery: String(step.patient || '').trim().slice(0, 80) });
    case 'open_patient_visit': {
      const wantLast = step.which === 'last';
      const visit = wantLast ? patient.lastVisit : patient.nextVisit || (step.which === 'next' ? null : patient.lastVisit);
      if (!visit) return { ok: false, message: `${name} has no ${wantLast ? 'past' : 'upcoming'} visit with you.` };
      return ok(`/clinician?appointment=${encodeURIComponent(visit.appointmentId)}`, `${wantLast || !patient.nextVisit ? 'Last' : 'Next'} visit · ${name}`);
    }
    case 'open_maternity_card':
      return ok(`/clinician/maternity?patientId=${encodeURIComponent(patient.id)}`, `Maternity card · ${name}`);
    case 'open_new_appointment': {
      const path = `/clinician/appointments/new?patient=${encodeURIComponent(patient.id)}`;
      // The day comes from the user's words ("kal" → tomorrow) if the model got it wrong.
      const settled = clock && step.when ? settleDay(step.when, ctx.message, clock) : step.when;
      if (clock && step.when && !settled) {
        const past = checkWhen(step.when, clock).status === 'invalid';
        return ok(path, `New appointment · ${name}`, null, { notice: past ? BAD_TIME : WRONG_DAY });
      }
      const when = clock ? checkWhen(settled, clock) : { status: 'empty' };
      if (when.status === 'ok') {
        // Filled into the form only; pressing Create visit and invite is a separate, confirmed step.
        return ok(path, `New appointment · ${name} · ${when.words}`, null, {
          fill: { page: 'new_appointment', fields: { scheduledAt: when.value }, words: when.words, context: { patientId: patient.id } },
        });
      }
      if (when.status === 'invalid') return ok(path, `New appointment · ${name}`, null, { notice: BAD_TIME });
      return ok(path, `New appointment · ${name}`, null, step.dayOnly ? { notice: ASK_TIME } : {});
    }
    case 'fill_form':
      return buildFill(step, role, clock, ctx, patient);
    default:
      return { ok: false, message: null };
  }
}

module.exports = {
  ACTIONS, actionsFor, needsPatient, resolvesPatient, withoutMissingPatient, mentionsTime, mentionsDay, asksToSubmit, isSaving,
  buildStep, BAD_TIME, ASK_TIME, WRONG_DAY,
};
