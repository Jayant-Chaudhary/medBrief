const { isGrounded } = require('./agent/actions');

// Prefer full names; a shared first name must not silently select a patient.
function namedPatients(message, patients) {
  const full = patients.filter(p => p.fullName && isGrounded(p.fullName, message));
  return full.length ? full : patients.filter(p => {
    const first = String(p.fullName || '').trim().split(/\s+/)[0];
    return first && isGrounded(first, message);
  });
}

function patientScopeError(reply, currentPath, current, patients, message) {
  const named = namedPatients(message, patients);
  for (const step of reply.steps || []) {
    const pageActions = step.page?.actions || [];
    const formPage = step.fill?.page || step.press?.page;
    const clinicalPage = ['/clinician', '/clinician/maternity'].includes(currentPath);
    const clinicalActions = pageActions.filter(action =>
      action.risk === 'confirm' || ['save', 'send'].includes(action.effect) ||
      /notes|prescription|medicine|patient instructions|follow.up advice|next steps|bp check/i.test(`${action.name || ''} ${action.section || ''}`));
    const patientAction = (clinicalPage && clinicalActions.length > 0) ||
      (formPage === 'dashboard' && step.press?.id !== 'close_visit') || formPage === 'maternity' ||
      (formPage === 'new_appointment' && Boolean(current?.patientId));
    if (!patientAction) continue;
    if (named.length > 1) return 'Please specify the patient’s full name.';
    const context = step.fill?.context || step.press?.context;
    const patientId = context?.patientId || current?.patientId;
    if (named.length && named[0].id !== patientId) return 'Open the named patient’s record before making changes.';
    if (clinicalActions.length && !current?.patientId) return 'Which patient?';
  }
  return null;
}

// Recover a missing prerequisite using only a uniquely named directory patient
// and a destination specified by the request/checklist, never an invented visit.
function patientPrerequisite(checklist, message, patients, currentPath) {
  const named = namedPatients(message, patients);
  if (named.length !== 1) return null;
  const patient = named[0];
  const name = isGrounded(patient.fullName, message) ? patient.fullName : patient.fullName.split(/\s+/)[0];
  const pending = checklist.filter(item => !item.done);
  const first = pending[0]?.text || '';
  if (/\b(find|search|look\s+up|dhundo)\b/i.test(first)) {
    return { type: 'navigate', op: 'go', pageId: 'patients', path: '/clinician/patients', state: { assistantQuery: name }, label: 'Patients' };
  }
  if (/\b(open|show|view|go)\b.*\bpatients\b/i.test(first)) {
    return { type: 'navigate', op: 'go', pageId: 'patients', path: '/clinician/patients', label: 'Patients' };
  }
  const kindFor = text => {
    if (/\b(new\s+(?:appointment|visit)|book)\b/i.test(text)) return 'new_appointment';
    if (/\b(last|previous|past)\s+visit\b/i.test(text)) return 'last_visit';
    if (/\b(next|upcoming)\s+visit\b/i.test(text)) return 'next_visit';
    if (/\b(maternity|antenatal)\b/i.test(text)) return 'maternity';
    return null;
  };
  const pendingIndex = checklist.findIndex(item => !item.done);
  const kind = kindFor(first) ||
    checklist.slice(0, pendingIndex).reverse().map(item => kindFor(item.text)).find(Boolean) ||
    (currentPath === '/clinician/maternity' ? 'maternity' : null);
  if (!kind) return null;
  const checked = require('./agent/actions').validateAgentActions(
    [{ op: 'open_record', kind, patient: name }], {}, message, patients, 'clinician'
  );
  const navigation = checked.navigationSteps[0];
  return navigation ? { type: 'navigate', ...navigation } : null;
}
module.exports = { namedPatients, patientScopeError, patientPrerequisite };
