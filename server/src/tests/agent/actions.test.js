const { validateAgentActions, isGrounded } = require('../../services/assistant/agent/actions');

const PATIENTS = [
  { id: 'p-asha', fullName: 'Asha Example', email: 'asha@example.test', nextVisit: { appointmentId: 'a-next' }, lastVisit: { appointmentId: 'a-last' } },
  { id: 'p-bina1', fullName: 'Bina Sample', email: 'bina1@example.test' },
  { id: 'p-bina2', fullName: 'Bina Other', email: 'bina2@example.test' },
];

const el = (ref, kind, name, extra = {}) => ({ ref, kind, name, ...extra });
const PAGE = {
  title: 'Dashboard',
  elements: [
    el('r1', 'button', 'Consultation notes', { effect: 'free' }),
    el('r2', 'textarea', 'Consultancy notes', { effect: 'save' }),
    el('r3', 'button', 'Save notes', { effect: 'save' }),
    el('r4', 'button', 'Delete consultation', { effect: 'never' }),
    el('r5', 'select', 'Item type', { options: ['medicine', 'injection', 'vaccination'], effect: 'free' }),
    el('r6', 'search', 'Search patient', { effect: 'free' }),
  ],
};

describe('agent actions: validateAgentActions', () => {
  it('allows safe click action on free button', () => {
    const { pageActions, refused } = validateAgentActions(
      [{ op: 'click', ref: 'r1' }],
      PAGE,
      'open consultation notes',
      PATIENTS,
    );
    expect(refused).toHaveLength(0);
    expect(pageActions).toHaveLength(1);
    expect(pageActions[0]).toMatchObject({ ref: 'r1', op: 'click', risk: 'free' });
  });

  it('refuses dangerous action with risk never', () => {
    const { pageActions, refused } = validateAgentActions(
      [{ op: 'click', ref: 'r4' }],
      PAGE,
      'delete consultation',
      PATIENTS,
    );
    expect(pageActions).toHaveLength(0);
    expect(refused).toHaveLength(1);
    expect(refused[0].name).toBe('Delete consultation');
  });

  it('validates text grounding: accepts text from message', () => {
    const { pageActions, refused } = validateAgentActions(
      [{ op: 'append', ref: 'r2', text: 'mild headache for 2 days' }],
      PAGE,
      'open notes and write mild headache for 2 days',
      PATIENTS,
    );
    expect(refused).toHaveLength(0);
    expect(pageActions).toHaveLength(1);
    expect(pageActions[0]).toMatchObject({ ref: 'r2', op: 'append', value: 'mild headache for 2 days', risk: 'confirm' });
  });

  it('refuses ungrounded text: rejects text not in message', () => {
    const { pageActions, refused } = validateAgentActions(
      [{ op: 'append', ref: 'r2', text: 'invented clinical diagnosis' }],
      PAGE,
      'open notes and write mild headache',
      PATIENTS,
    );
    expect(pageActions).toHaveLength(0);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toContain('values typed must come directly');
  });

  it('enforces single confirm rule and cuts subsequent confirm actions', () => {
    const { pageActions, cut } = validateAgentActions(
      [
        { op: 'click', ref: 'r3' }, // save button -> confirm
        { op: 'append', ref: 'r2', text: 'headache' }, // textarea save -> confirm (different group)
      ],
      PAGE,
      'save notes and write headache',
      PATIENTS,
    );
    expect(pageActions).toHaveLength(1);
    expect(pageActions[0].ref).toBe('r3');
    expect(cut).toBe(true);
  });

  it('handles go(pageId) navigation', () => {
    const { navigationSteps, refused } = validateAgentActions(
      [{ op: 'go', page: 'schedule' }],
      PAGE,
      'go to schedule',
      PATIENTS,
    );
    expect(refused).toHaveLength(0);
    expect(navigationSteps).toHaveLength(1);
    expect(navigationSteps[0]).toMatchObject({ path: '/clinician/schedule' });
  });

  it('resolves unique patient in open_record', () => {
    const { navigationSteps, refused } = validateAgentActions(
      [{ op: 'open_record', kind: 'last_visit', patient: 'Asha' }],
      PAGE,
      'open asha last visit',
      PATIENTS,
    );
    expect(refused).toHaveLength(0);
    expect(navigationSteps).toHaveLength(1);
    expect(navigationSteps[0].path).toBe('/clinician?appointment=a-last');
  });

  it('returns disambiguation when multiple patients match', () => {
    const { disambiguation } = validateAgentActions(
      [{ op: 'open_record', kind: 'maternity', patient: 'Bina' }],
      PAGE,
      'open bina maternity card',
      PATIENTS,
    );
    expect(disambiguation).not.toBeNull();
    expect(disambiguation.type).toBe('choose');
    expect(disambiguation.options).toHaveLength(2);
  });

  it('validates key action: allows Enter on search field', () => {
    const { pageActions, refused } = validateAgentActions(
      [{ op: 'key', ref: 'r6', key: 'Enter' }],
      PAGE,
      'search patient',
      PATIENTS,
    );
    expect(refused).toHaveLength(0);
    expect(pageActions).toHaveLength(1);
    expect(pageActions[0]).toMatchObject({ op: 'key', key: 'Enter' });
  });

  it('extracts leading ref token when descriptor is appended to ref', () => {
    const { pageActions, refused } = validateAgentActions(
      [{ op: 'click', ref: 'r1 button "Consultation notes"' }],
      PAGE,
      'open consultation notes',
      PATIENTS,
    );
    expect(refused).toHaveLength(0);
    expect(pageActions).toHaveLength(1);
    expect(pageActions[0]).toMatchObject({ ref: 'r1', op: 'click' });
  });

  it('rejects click on textarea without text value', () => {
    const { pageActions, refused } = validateAgentActions(
      [{ op: 'click', ref: 'r2' }],
      PAGE,
      'click notes',
      PATIENTS,
    );
    expect(pageActions).toHaveLength(0);
    expect(refused).toHaveLength(1);
    expect(refused[0].reason).toContain('that does not work on this kind of field');
  });

  it('normalizes click with text on textarea to append', () => {
    const { pageActions, refused } = validateAgentActions(
      [{ op: 'click', ref: 'r2', text: 'mild headache' }],
      PAGE,
      'write mild headache in notes',
      PATIENTS,
    );
    expect(refused).toHaveLength(0);
    expect(pageActions).toHaveLength(1);
    expect(pageActions[0]).toMatchObject({ ref: 'r2', op: 'append', value: 'mild headache' });
  });
});

