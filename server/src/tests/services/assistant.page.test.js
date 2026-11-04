const assistant = require('../../services/assistant/assistant.service');
const FakeProvider = require('../../services/assistant/llm/fakeProvider');
const { redact, classify, checkPageActions, checkAnswer } = require('../../services/assistant/pageSnapshot');

// Synthetic page and patients only.
const PATIENTS = [{ id: 'p-asha', fullName: 'Asha Example', email: 'asha@example.test', nextVisit: null, lastVisit: null }];
const directory = jest.fn(async () => PATIENTS);
const settings = {
  timeoutMs: 1000, coldStartTimeoutMs: 9000, warmWindowMs: 60000, maxSteps: 4, unavailableMessage: 'unavailable text',
  maxPageElements: 120, maxPageActions: 8, maxRounds: 8, maxAnswerChars: 300, actionsEnabled: true,
};
const el = (ref, kind, name, extra = {}) => ({ ref, kind, name, ...extra });
const PAGE = {
  title: 'Dashboard',
  elements: [
    // Opens a panel: the browser marks buttons with aria-expanded / aria-haspopup as free.
    el('r1', 'button', 'Consultation notes', { effect: 'free' }),
    el('r2', 'textarea', 'Consultancy notes', { effect: 'save' }),
    el('r3', 'button', 'Add medicine', { section: 'Prescription', effect: 'free' }),
    el('r4', 'text', 'Dose', { section: 'Prescription · Medicine 1', effect: 'free' }),
    el('r5', 'button', 'Remove', { section: 'Prescription · Medicine 1' }),
    el('r6', 'button', 'End visit and share summary', { effect: 'send' }),
    el('r7', 'select', 'Item type', { options: ['medicine', 'injection', 'vaccination'], effect: 'free' }),
    el('r8', 'button', 'Record consultation'),
    el('r9', 'button', 'Save template'),
    el('r10', 'link', 'Schedule'),
  ],
};
const reply = (pageActions, extra = {}) => JSON.stringify({ action: 'run', steps: [], options: [], more: false, answer: '', pageActions, next: false, ...extra });
const act = (ref, op, value = '') => ({ ref, op, value });
const step = (message, modelReply, { page = PAGE, role = 'clinician', round = 0, progress = [] } = {}) => {
  const provider = new FakeProvider(modelReply);
  return assistant
    .handleStep({ message, role, userId: 'dr-1', currentPath: '/clinician', currentRecord: { kind: 'visit', id: 'test-visit' }, recordLookup: async () => ({ id: 'test-visit', patient_id: 'p-asha' }), page, round, progress, provider, directory, settings })
    .then((result) => ({ ...result, provider }));
};

beforeEach(() => {
  assistant.resetForTests();
  directory.mockClear();
});

describe('page snapshot: redaction', () => {
  it('removes patient names, emails, long numbers and values with units from labels', () => {
    const seen = redact({
      title: 'Asha Example · visit',
      headings: ['Hb 9.8 g/dl'],
      elements: [el('r1', 'button', 'Open Asha Example (asha@example.test, 98765 43210) BP 140/90 mmHg', { section: 'Example ward' })],
    }, PATIENTS);
    expect(seen.title).toBe('[patient] · visit');
    expect(seen.headings).toEqual(['Hb [value]']);
    expect(seen.elements[0].name).toBe('Open [patient] ([email], [number]) BP 140/[value]');
    expect(seen.elements[0].section).toBe('[patient] ward');
  });
});

describe('page snapshot: risk classes', () => {
  it.each([
    ['Remove', 'click', 'never'],
    ['Delete this entry', 'click', 'never'],
    ['Sign out', 'click', 'never'],
    ['Record consultation', 'click', 'never'],
    ['Confirm Readiness', 'click', 'never'],
    ['Browse files', 'click', 'never'],
    ['Open notes', 'click', 'free'],
    ['Next day', 'click', 'free'],
    ['Save changes', 'click', 'confirm'],
    ['Add question', 'click', 'confirm'],
    ['Something unclear', 'click', 'confirm'],
  ])('"%s" (%s) is %s', (name, op, expected) => {
    expect(classify(el('r1', 'button', name), op)).toBe(expected);
  });

  it('uses the page\'s own marks: autosaving fields need Confirm, local-only buttons do not, links and tabs are free', () => {
    expect(classify(el('r1', 'textarea', 'Notes', { effect: 'save' }), 'append')).toBe('confirm');
    expect(classify(el('r1', 'text', 'Dose'), 'type')).toBe('free');
    expect(classify(el('r1', 'button', 'Add medicine', { effect: 'free' }), 'click')).toBe('free');
    expect(classify(el('r1', 'checkbox', 'BP check', { effect: 'never' }), 'click')).toBe('never');
    expect(classify(el('r1', 'link', 'Schedule'), 'click')).toBe('free');
  });
});

describe('page snapshot: checking actions', () => {
  const check = (actions, message) => checkPageActions(actions, PAGE, message, { maxActions: 8 });

  it('keeps only actions on listed elements that fit them', () => {
    const { actions, refused } = check([act('r99', 'click'), act('r3', 'type', 'x'), act('r3', 'click')], 'add medicine');
    expect(actions.map((a) => a.ref)).toEqual(['r3']);
    expect(refused).toEqual([{ name: 'Add medicine', reason: 'that does not work on this kind of field' }]);
  });

  it('types only words the user wrote', () => {
    const { actions, refused } = check([act('r4', 'type', '500 mg'), act('r4', 'type', '650 mg')], 'add paracetamol 500 mg twice daily');
    expect(actions).toEqual([expect.objectContaining({ ref: 'r4', op: 'type', value: '500 mg', risk: 'free' })]);
    expect(refused).toEqual([{ name: 'Dose', reason: 'I could not find that value in your message' }]);
  });

  it('picks only a listed choice the user named', () => {
    expect(check([act('r7', 'select', 'injection')], 'make it an injection').actions[0].value).toBe('injection');
    expect(check([act('r7', 'select', 'tablet')], 'make it a tablet').refused[0].reason).toBe('that is not one of its choices');
    expect(check([act('r7', 'select', 'vaccination')], 'change the type').refused[0].reason).toBe('I could not find that value in your message');
  });

  it('refuses never-class buttons and allows one save per round', () => {
    const { actions, refused, cut } = check([act('r5', 'click'), act('r2', 'append', 'mild headache'), act('r9', 'click')], 'note mild headache, remove the row, save the template');
    expect(refused).toEqual([{ name: 'Remove', reason: 'that one is yours to press' }]);
    expect(actions.map((a) => [a.ref, a.risk])).toEqual([['r2', 'confirm']]);
    expect(cut).toBe(true);
  });

  it('lets several saving fields of one section share one Confirm, but not fields of another section', () => {
    const page = { elements: [
      el('m1', 'text', 'Name', { section: 'Prescription · Medicine 1', effect: 'save' }),
      el('m2', 'text', 'Dose', { section: 'Prescription · Medicine 1', effect: 'save' }),
      el('n1', 'text', 'Name', { section: 'Prescription · Medicine 2', effect: 'save' }),
    ] };
    const { actions, cut } = checkPageActions(
      [act('m1', 'type', 'paracetamol'), act('m2', 'type', '500 mg'), act('n1', 'type', 'iron')],
      page, 'paracetamol 500 mg and iron', { maxActions: 8 }
    );
    expect(actions.map((a) => [a.ref, a.group])).toEqual([['m1', 'fields:Prescription · Medicine 1'], ['m2', 'fields:Prescription · Medicine 1']]);
    expect(cut).toBe(true);
  });

  it('keeps opening buttons harmless inside a saving region, unless their label commits', () => {
    expect(classify(el('r1', 'button', 'Templates', { effect: 'save' }), 'click')).toBe('free');
    expect(classify(el('r1', 'button', 'Review', { effect: 'save' }), 'click')).toBe('free');
    // "add" in the label: asked, to be safe, even though it only opens an editor.
    expect(classify(el('r1', 'button', 'Edit / add factors', { effect: 'save' }), 'click')).toBe('confirm');
    expect(classify(el('r1', 'button', 'Edit and save', { effect: 'save' }), 'click')).toBe('confirm');
    expect(classify(el('r1', 'button', 'Add medicine', { effect: 'save' }), 'click')).toBe('confirm');
  });
});

describe('page phrase rules', () => {
  const { matchPageCommand } = require('../../services/assistant/pageSnapshot');
  const page = { elements: [
    el('a1', 'button', 'Close panel'),
    el('a2', 'button', 'Templates'),
    el('a3', 'checkbox', 'BP check', { effect: 'save' }),
    el('a4', 'checkbox', 'Iron advice', { effect: 'save' }),
    el('a5', 'textarea', 'Patient instructions / counseling'),
    el('a6', 'button', 'Add medicine'),
    el('a7', 'button', 'Add'),
    el('a8', 'button', 'Add'),
  ] };
  it.each([
    ['close the panel', [{ ref: 'a1', op: 'click', value: '' }]],
    ['show my templates', [{ ref: 'a2', op: 'click', value: '' }]],
    ['add a medicine', [{ ref: 'a6', op: 'click', value: '' }]],
    ['tick BP check and iron advice', [{ ref: 'a3', op: 'check', value: '' }, { ref: 'a4', op: 'check', value: '' }]],
    ['patient instructions: rest and drink fluids', [{ ref: 'a5', op: 'type', value: 'rest and drink fluids' }]],
    ['press add', null],
    ['untick BP check', null],
    ['tick BP check and something else', null],
    ['what is on this page', null],
  ])('"%s"', (message, expected) => {
    expect(matchPageCommand(message, page)).toEqual(expected && { actions: expected });
  });

  describe('consultation notes and medicines', () => {
    const panel = { elements: [
      el('n1', 'textarea', 'Consultancy notes', { effect: 'save' }),
      el('m0', 'button', 'Add medicine', { effect: 'save' }),
      el('m1', 'text', 'Name', { section: 'Prescription · Medicine 1', effect: 'save' }),
      el('m2', 'text', 'Dose', { section: 'Prescription · Medicine 1', effect: 'save' }),
      el('m3', 'text', 'Frequency', { section: 'Prescription · Medicine 1', effect: 'save' }),
      el('m4', 'text', 'Duration', { section: 'Prescription · Medicine 1', effect: 'save' }),
      el('p1', 'text', 'Name', { section: 'Prescription · Medicine 2', effect: 'save' }),
      el('p2', 'text', 'Dose', { section: 'Prescription · Medicine 2', effect: 'save' }),
    ] };
    it.each([
      ['notes: mild headache for 2 days', [{ ref: 'n1', op: 'append', value: 'mild headache for 2 days' }]],
      ['in consultation notes - BP stable', [{ ref: 'n1', op: 'append', value: 'BP stable' }]],
      ['write in notes: advised rest', [{ ref: 'n1', op: 'append', value: 'advised rest' }]],
      ['write "no fever" in the notes', [{ ref: 'n1', op: 'append', value: 'no fever' }]],
      ['notes me likho: pet dard', [{ ref: 'n1', op: 'append', value: 'pet dard' }]],
      ['change "mild headache" to "severe headache" in notes', [{ ref: 'n1', op: 'replace', find: 'mild headache', value: 'severe headache' }]],
      ['in notes, replace 2 days with 3 days', [{ ref: 'n1', op: 'replace', find: '2 days', value: '3 days' }]],
      // The newest row is filled; frequency and duration only when given.
      ['paracetamol 500 mg twice daily for 5 days', [
        { ref: 'p1', op: 'type', value: 'paracetamol' }, { ref: 'p2', op: 'type', value: '500 mg' },
      ]],
      ['add iron tablet 100 mg', [{ ref: 'p1', op: 'type', value: 'iron' }, { ref: 'p2', op: 'type', value: '100 mg' }]],
    ])('"%s"', (message, expected) => {
      expect(matchPageCommand(message, panel)).toEqual({ actions: expected });
    });

    it('fills every part of a full medicine line on a row that has them', () => {
      const oneRow = { elements: panel.elements.filter((e) => !e.ref.startsWith('p')) };
      expect(matchPageCommand('paracetamol 500 mg twice daily for 5 days', oneRow)).toEqual({ actions: [
        { ref: 'm1', op: 'type', value: 'paracetamol' }, { ref: 'm2', op: 'type', value: '500 mg' },
        { ref: 'm3', op: 'type', value: 'twice daily' }, { ref: 'm4', op: 'type', value: '5 days' },
      ] });
    });

    it('adds a row first when there is none, and asks for another round', () => {
      expect(matchPageCommand('paracetamol 500 mg twice daily', { elements: [el('m0', 'button', 'Add medicine', { effect: 'save' })] }))
        .toEqual({ actions: [{ ref: 'm0', op: 'click', value: '' }], next: true });
    });

    it('asks to open the notes panel when the notes box is not on the page', () => {
      expect(matchPageCommand('notes: mild headache', { elements: [el('r1', 'button', 'End visit')] })).toEqual({ openNotes: true });
    });
  });

  it('opens the notes panel first, then adds the note after Confirm, without repeating it in later rounds', async () => {
    const visit = { elements: [el('r1', 'button', 'End visit')] };
    const opened = await step('notes: mild headache', reply([]), { page: visit });
    expect(opened).toMatchObject({ type: 'run', source: 'rules', continue: true, steps: [{ press: { id: 'open_notes', effect: 'ui' } }] });

    const panelPage = { elements: [el('n1', 'textarea', 'Consultancy notes', { effect: 'save' })] };
    const added = await step('notes: mild headache', reply([]), { page: panelPage, round: 1, progress: ['Pressed Open notes'] });
    expect(added.steps[0].page.actions).toEqual([expect.objectContaining({ ref: 'n1', op: 'append', value: 'mild headache', risk: 'confirm' })]);
    expect(added.continue).toBeUndefined();

    const again = await step('notes: mild headache', reply([]), { page: panelPage, round: 2, progress: ['Pressed Open notes', 'Added to "Consultancy notes"'] });
    expect(again.type).toBe('done');
  });

  it('only changes words the user wrote, both the old and the new', () => {
    const notesPage = { elements: [el('n1', 'textarea', 'Consultancy notes', { effect: 'save' })] };
    const ok = checkPageActions([{ ref: 'n1', op: 'replace', find: 'mild', value: 'severe' }], notesPage, 'change mild to severe in notes', { maxActions: 8 });
    expect(ok.actions[0]).toMatchObject({ op: 'replace', find: 'mild', value: 'severe', risk: 'confirm' });
    const invented = checkPageActions([{ ref: 'n1', op: 'replace', find: 'fever', value: 'severe' }], notesPage, 'change mild to severe in notes', { maxActions: 8 });
    expect(invented.refused[0].reason).toBe('I could not find that value in your message');
  });

  it('runs the same checks as model actions, without calling the model', async () => {
    const result = await step('tick BP check', reply([]), { page: { elements: page.elements } });
    expect(result).toMatchObject({ type: 'run', source: 'rules' });
    expect(result.steps[0].page.actions).toEqual([expect.objectContaining({ ref: 'a3', op: 'check', risk: 'confirm' })]);
    expect(result.provider.calls).toHaveLength(0);
  });
});

describe('page snapshot: app-help answers', () => {
  it.each([
    ['Open Schedule from the menu, then pick the day.', 'Open Schedule from the menu, then pick the day.'],
    ['Her Hb is in the normal range.', null],
    ['Take 500 mg twice daily.', null],
    ['x'.repeat(301), null],
  ])('"%s"', (text, expected) => {
    expect(checkAnswer(text, 300)).toBe(expected);
  });
});

describe('handleStep: acting on the open page (doctor)', () => {
  it('sends the redacted page to the model and returns checked actions to run', async () => {
    const result = await step('open notes and write mild headache for 2 days', reply([act('r1', 'click'), act('r2', 'append', 'mild headache for 2 days')]));
    expect(result.type).toBe('run');
    expect(result.steps).toMatchObject([{
      label: 'This page',
      page: {
        actions: [
          { ref: 'r1', op: 'click', name: 'Consultation notes', kind: 'button', risk: 'free', effect: 'free' },
          { ref: 'r2', op: 'append', name: 'Consultancy notes', kind: 'textarea', risk: 'confirm', value: 'mild headache for 2 days', effect: 'save', group: 'fields:' },
        ],
        refused: [],
      },
    }]);
    const system = result.provider.calls[0].messages[0].content;
    expect(system).toContain('r6 button "End visit and share summary" [sends to patient]');
    expect(system).toContain('r8 button "Record consultation" [never]');
    expect(result.provider.calls[0].schema.properties.pageActions.items.properties.ref.enum).toEqual(PAGE.elements.map((e) => e.ref));
  });

  it('asks for another round when the model needs the page to change first', async () => {
    const result = await step('make a note that she has a mild headache', reply([act('r1', 'click')], { next: true }));
    expect(result.continue).toBe(true);
    expect(result.steps[0].page.actions.map((a) => a.ref)).toEqual(['r1']);
  });

  it('holds actions on this page when a step leaves it, and continues on the next page', async () => {
    const result = await step('go to schedule and add medicine', reply([act('r3', 'click')], { steps: [{ do: 'open_page', page: 'schedule', patient: '', which: 'none', when: '' }] }));
    expect(result.type).toBe('navigate');
    expect(result.continue).toBe(true);
  });

  it('stops asking for rounds at the limit, and ends quietly when nothing is left', async () => {
    const last = await step('make a note that she has a mild headache', reply([act('r1', 'click')], { next: true }), { round: 7 });
    expect(last.continue).toBeUndefined();
    const done = await step('make a note that she has a mild headache', reply([]), { round: 2, progress: ['Pressed "Consultation notes"'] });
    expect(done.type).toBe('done');
    expect(done.provider.calls[0].messages[0].content).toContain('Already done for this request: Pressed "Consultation notes"');
  });

  it('later rounds skip the page-opening phrase rules and go to the model', async () => {
    const result = await step('open checklists', reply([]), { round: 1 });
    expect(result.type).toBe('done');
    expect(result.provider.calls).toHaveLength(1);
  });

  it('never reads or acts on the page for patients', async () => {
    const result = await step('something', JSON.stringify({ action: 'unsupported', steps: [], options: [], more: false }), { role: 'patient' });
    const system = result.provider.calls[0].messages[0].content;
    expect(system).not.toContain('Elements you may act on');
    expect(result.provider.calls[0].schema.properties.pageActions).toBeUndefined();
    expect(directory).not.toHaveBeenCalled();
  });

  it('answers questions about using the site, and refuses health answers', async () => {
    const help = await step('where do I add a medicine?', JSON.stringify({ action: 'answer', answer: 'Open the visit, expand Prescription and press Add medicine.', steps: [], options: [], more: false, pageActions: [], next: false }));
    expect(help).toMatchObject({ type: 'answer', text: 'Open the visit, expand Prescription and press Add medicine.' });
    const health = await step('is 9.8 hb low?', JSON.stringify({ action: 'answer', answer: 'That is below the normal range.', steps: [], options: [], more: false, pageActions: [], next: false }));
    expect(health.type).toBe('unsupported');
  });
});

describe('requests in several parts', () => {
  const { matchPageCommand } = require('../../services/assistant/pageSnapshot');

  it('treats "open notes" as done when the notes are showing, and a plain "write" as notes', () => {
    expect(matchPageCommand('open the consultation notes', PAGE)).toEqual({ actions: [], done: true });
    expect(matchPageCommand('write review in 2 weeks', PAGE)).toEqual({ actions: [{ ref: 'r2', op: 'append', value: 'review in 2 weeks' }] });
    expect(matchPageCommand('write rest well in patient instructions', PAGE)).toBeNull();
  });

  it('opens a page once when a search on it follows', async () => {
    const plan = JSON.stringify({ action: 'run', steps: [
      { do: 'open_page', page: 'patients', patient: '', which: 'none', when: '', fields: [], press: 'none' },
      { do: 'find_patient', page: 'none', patient: 'Asha', which: 'none', when: '', fields: [], press: 'none' },
    ], options: [], more: false });
    const result = await step('look for Asha among the patients please', plan, { page: null });
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0]).toMatchObject({ path: '/clinician/patients', state: { assistantQuery: 'Asha' } });
  });
});
