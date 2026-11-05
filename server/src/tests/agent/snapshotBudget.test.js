const { redact, applyTokenBudget, describeElements } = require('../../services/assistant/pageSnapshot');

describe('Slice B: Page Text, Redaction, and Token Budget', () => {
  const PATIENTS = [
    { id: 'p1', fullName: 'Asha Example', email: 'asha@example.test' },
  ];

  it('redacts clinical values, emails, phones, and patient names from element text', () => {
    const raw = {
      title: 'Consultation',
      elements: [
        {
          ref: 'r1',
          kind: 'button',
          name: 'Template 1',
          text: 'Patient Asha Example reported Hb 9.8 g/dl and email asha@example.test',
        },
      ],
    };

    const seen = redact(raw, PATIENTS);
    expect(seen.elements[0].text).toBe('Patient [patient] reported Hb [value] and email [email]');
  });

  it('formats element text in describeElements', () => {
    const elements = [
      {
        ref: 'r1',
        kind: 'button',
        name: 'Template 1',
        text: 'Similarity score 98%',
      },
    ];

    const desc = describeElements(elements);
    expect(desc).toContain('r1 button "Template 1" - "Similarity score 98%"');
  });

  it('trims Menu section first when token budget is exceeded', () => {
    const elements = [
      { ref: 'r1', kind: 'link', name: 'Dashboard', section: 'Menu' },
      { ref: 'r2', kind: 'link', name: 'Patients', section: 'Menu' },
      { ref: 'r3', kind: 'link', name: 'Schedule', section: 'Menu' },
      { ref: 'r4', kind: 'button', name: 'Consultation notes', section: 'Dialog: Active Visit' },
      { ref: 'r5', kind: 'textarea', name: 'Notes', section: 'Dialog: Active Visit' },
      { ref: 'r6', kind: 'button', name: 'Add medicine', section: 'Prescription' },
      { ref: 'r7', kind: 'text', name: 'Dose', section: 'Prescription' },
    ];

    const snapshot = { title: 'Clinic', elements };
    // Set a very small budget to force trimming
    const trimmed = applyTokenBudget(snapshot, 'write notes in consultation', 180);

    // Dialog elements should be kept
    const names = trimmed.elements.map((e) => e.name);
    expect(names).toContain('Consultation notes');
    expect(names).toContain('Notes');
    // Menu elements should be trimmed first
    expect(trimmed.elements.some((e) => e.section === 'Menu')).toBe(false);
  });
});
