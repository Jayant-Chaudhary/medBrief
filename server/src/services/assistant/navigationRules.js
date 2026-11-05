const { matchIntent } = require('./intentRules');
const { pagesFor, findPage } = require('./pages.registry');
const { namedPatients } = require('./patientScope');
const { validateAgentActions, isGrounded } = require('./agent/actions');
const { requirementSources } = require('./execution');

// Follow the first pending instruction. No fields that save, no new values,
// no patient guessed from whichever page happens to be open.
function nextNavigation({ checklist, message, patients, currentPath, currentRecord, clock }) {
  const item = checklist.find(entry => !entry.done);
  if (!item) return null;
  const pageIntent = matchIntent(item.text, pagesFor('clinician'));
  if (pageIntent?.kind === 'open') {
    const page = findPage('clinician', pageIntent.pageIds[0]);
    return { type: 'navigate', op: 'go', pageId: page.id, path: page.path, label: page.label };
  }
  const named = namedPatients(message, patients);
  if (named.length !== 1) return null;
  const patient = named[0];
  const typedName = isGrounded(patient.fullName, message) ? patient.fullName : patient.fullName.split(/\s+/)[0];
  if (/\b(find|search|look\s+up|dhundo)\b/i.test(item.text) && isGrounded(typedName, item.text)) {
    if (currentPath !== '/clinician/patients') return { type: 'navigate', op: 'go', pageId: 'patients', path: '/clinician/patients', state: { assistantQuery: typedName }, label: 'Patients' };
    const checked = validateAgentActions([{ op: 'fill', control: 'query', value: typedName }], {}, message, patients, 'clinician', { onPage: 'patients', clock });
    return checked.formStep ? { type: 'run', steps: [checked.formStep] } : null;
  }
  if (currentPath === '/clinician/appointments/new' && currentRecord?.patientId === patient.id &&
      item.required?.includes('new_appointment:scheduledAt') && !item.completed?.includes('new_appointment:scheduledAt')) {
    // Opening a draft is only the prerequisite. Fill its requested date in a
    // separate verified action, without asking the model to calculate tomorrow.
    // Multiple booking clauses remain with the planner; never choose one here.
    const bookings = requirementSources(message).filter(text => /\b(?:new\s+(?:appointment|visit)|book(?:ing)?(?:\s+(?:an?|the))?\s+(?:appointment|visit))\b/i.test(text));
    if (bookings.length === 1) {
      const checked = validateAgentActions([{ op: 'fill', control: 'scheduledAt', value: bookings[0] }], {}, message, patients, 'clinician', {
        onPage: 'new_appointment', clock, currentRecord,
      });
      if (checked.formStep) return { type: 'run', steps: [checked.formStep] };
    }
  }
  if (/\b(write|fill|append|replace|bp|weight)\b/i.test(item.text)) return null;
  let kind;
  if (/\b(last|previous|past)\s+visit\b/i.test(item.text)) kind = 'last_visit';
  else if (/\b(next|upcoming)\s+visit\b/i.test(item.text)) kind = 'next_visit';
  else if (/\b(new\s+(appointment|visit)|book)\b/i.test(item.text)) kind = 'new_appointment';
  else if (/\b(maternity|antenatal)\b/i.test(item.text)) kind = 'maternity';
  if (!kind) return null;
  // A combined "book ... at ..." item still needs its fields filled once here.
  if (kind === 'new_appointment' && currentPath === '/clinician/appointments/new' && currentRecord?.patientId === patient.id) return null;
  const checked = validateAgentActions([{ op: 'open_record', kind, patient: typedName }], {}, message, patients, 'clinician');
  const navigation = checked.navigationSteps[0];
  return navigation ? { type: 'navigate', ...navigation } : checked.disambiguation || null;
}
module.exports = { nextNavigation };
