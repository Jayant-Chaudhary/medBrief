import { describe, it, expect, vi } from 'vitest';
import { runPlan } from '../components/assistant/planRunner';

// A fake page: controls held in a plain object, a submit that records calls. Synthetic data only.
function fakePage({ available = true, submitOk = true } = {}) {
  const values = {};
  const page = {
    values,
    submitted: 0,
    added: 0,
    actions: {
      fill: vi.fn((fields) => Object.assign(values, fields)),
      hasButton: vi.fn(() => available),
      summary: vi.fn(() => [{ label: 'Date and time', value: values.scheduledAt || '—' }]),
      press: vi.fn(async (id) => {
        if (id === 'add_question') page.added += 1;
        if (id === 'create_visit') page.submitted += 1;
        return id === 'create_visit' ? submitOk : true;
      }),
    },
  };
  return page;
}

function io(page, { confirm = async () => true, waitFor } = {}) {
  return {
    navigate: vi.fn(),
    waitFor: waitFor || vi.fn(async () => page.actions),
    pause: async () => {},
    settle: async () => {},
    highlight: vi.fn(),
    confirm: vi.fn(confirm),
    report: vi.fn(),
    progress: vi.fn(),
    stopped: () => false,
  };
}

const FORM = '/clinician/appointments/new';
const fillStep = { path: FORM, label: 'New appointment', fill: { page: 'new_appointment', fields: { scheduledAt: '2026-11-04T16:00' } } };
const send = { page: 'new_appointment', id: 'create_visit', label: 'Create visit and invite', effect: 'send', sideEffect: 'Emails an invite.' };
const ui = { page: 'new_appointment', id: 'add_question', label: 'Add question', effect: 'ui' };

describe('runPlan', () => {
  it('opens the page, fills and outlines the fields, and presses nothing it was not asked to', async () => {
    const page = fakePage();
    const deps = io(page);
    expect(await runPlan([fillStep], deps)).toBe('done');
    expect(deps.navigate).toHaveBeenCalledWith(FORM, undefined);
    expect(page.values).toEqual({ scheduledAt: '2026-11-04T16:00' });
    expect(deps.highlight).toHaveBeenCalledWith(['scheduledAt']);
    expect(page.actions.press).not.toHaveBeenCalled();
  });

  it('fills the open page in place when the step has no path', async () => {
    const page = fakePage();
    const deps = io(page);
    await runPlan([{ label: 'New appointment', fill: fillStep.fill }], deps);
    expect(deps.navigate).not.toHaveBeenCalled();
    expect(page.values.scheduledAt).toBe('2026-11-04T16:00');
  });

  it('presses a button that only changes the screen without asking', async () => {
    const page = fakePage();
    const deps = io(page);
    await runPlan([{ label: 'New appointment', press: ui }], deps);
    expect(page.added).toBe(1);
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(deps.report).not.toHaveBeenCalled();
  });

  it('shows what will be sent and presses only after Confirm, reporting the outcome', async () => {
    const page = fakePage();
    const deps = io(page);
    expect(await runPlan([{ ...fillStep, press: send }], deps)).toBe('done');
    expect(deps.confirm).toHaveBeenCalledWith({
      label: 'Create visit and invite', rows: [{ label: 'Date and time', value: '2026-11-04T16:00' }], sideEffect: 'Emails an invite.', changed: false,
    });
    expect(page.submitted).toBe(1);
    expect(deps.report.mock.calls).toEqual([['new_appointment', 'create_visit', 'confirmed'], ['new_appointment', 'create_visit', 'done']]);
  });

  it('presses nothing when the user cancels', async () => {
    const page = fakePage();
    const deps = io(page, { confirm: async () => false });
    expect(await runPlan([{ ...fillStep, press: send }], deps)).toBe('cancelled');
    expect(page.submitted).toBe(0);
    expect(deps.report.mock.calls).toEqual([['new_appointment', 'create_visit', 'cancelled']]);
    expect(page.values.scheduledAt).toBe('2026-11-04T16:00');
  });

  it('asks again if the form changed after the user confirmed', async () => {
    const page = fakePage();
    let asked = 0;
    const deps = io(page, {
      confirm: async () => {
        asked += 1;
        // The user edits the date while the card is open.
        if (asked === 1) page.values.scheduledAt = '2026-11-05T09:00';
        return true;
      },
    });
    await runPlan([{ ...fillStep, press: send }], deps);
    expect(deps.confirm).toHaveBeenCalledTimes(2);
    expect(deps.confirm.mock.calls[1][0]).toMatchObject({ changed: true, rows: [{ label: 'Date and time', value: '2026-11-05T09:00' }] });
    expect(page.submitted).toBe(1);
  });

  it('does not ask to confirm a button the page says is not ready', async () => {
    const page = fakePage({ available: false });
    const deps = io(page);
    expect(await runPlan([{ ...fillStep, press: send }], deps)).toBe('failed');
    expect(deps.confirm).not.toHaveBeenCalled();
    expect(page.submitted).toBe(0);
    expect(deps.progress).toHaveBeenLastCalledWith(0, { fill: 'filled', press: 'unavailable' });
  });

  it('reports a submit the page could not complete', async () => {
    const page = fakePage({ submitOk: false });
    const deps = io(page);
    expect(await runPlan([{ ...fillStep, press: send }], deps)).toBe('failed');
    expect(deps.report).toHaveBeenLastCalledWith('new_appointment', 'create_visit', 'failed', 'SUBMIT_FAILED');
  });

  it('stops when the page never becomes ready, and does not press', async () => {
    const page = fakePage();
    const deps = io(page, { waitFor: vi.fn(async () => { throw new Error('not ready'); }) });
    expect(await runPlan([{ ...fillStep, press: send }, { path: '/clinician/schedule', label: 'Schedule' }], deps)).toBe('failed');
    expect(page.actions.press).not.toHaveBeenCalled();
    expect(deps.navigate).toHaveBeenCalledTimes(1);
  });

  it('waits for the page of the record the fill is meant for', async () => {
    const page = fakePage();
    const deps = io(page);
    const context = { patientId: 'p-asha' };
    await runPlan([{ ...fillStep, fill: { ...fillStep.fill, context } }], deps);
    expect(deps.waitFor).toHaveBeenCalledWith('new_appointment', context);
  });

  describe('fields that save as soon as they are filled', () => {
    const cardFill = {
      label: 'Maternity card',
      fill: { page: 'maternity', fields: { 'baseline.hb': '10.5', 'visit.weight': '62' }, filled: [
        { id: 'baseline.hb', label: 'Baseline Hb (g/dL)', value: '10.5' }, { id: 'visit.weight', label: 'Weight (kg)', value: '62' },
      ] },
    };
    const savingPage = () => {
      const page = fakePage();
      page.actions.confirmFill = vi.fn(() => ({ ids: ['baseline.hb'], sideEffect: 'Saved to the record at once.' }));
      return page;
    };

    it('asks first, showing only those fields, then fills and logs it', async () => {
      const page = savingPage();
      const deps = io(page);
      expect(await runPlan([cardFill], deps)).toBe('done');
      expect(deps.confirm).toHaveBeenCalledWith({
        label: 'Save to record', rows: [{ label: 'Baseline Hb (g/dL)', value: '10.5' }], sideEffect: 'Saved to the record at once.', changed: false,
      });
      expect(page.values).toEqual({ 'baseline.hb': '10.5', 'visit.weight': '62' });
      expect(deps.report.mock.calls).toEqual([['maternity', 'save_details', 'confirmed'], ['maternity', 'save_details', 'done']]);
    });

    it('fills nothing when the user cancels', async () => {
      const page = savingPage();
      const deps = io(page, { confirm: async () => false });
      expect(await runPlan([cardFill], deps)).toBe('cancelled');
      expect(page.actions.fill).not.toHaveBeenCalled();
      expect(deps.report.mock.calls).toEqual([['maternity', 'save_details', 'cancelled']]);
    });

    it('stops if the page refuses the fill (record not ready)', async () => {
      const page = savingPage();
      page.actions.fill = vi.fn(() => { throw new Error('Record not ready'); });
      const deps = io(page);
      expect(await runPlan([{ ...cardFill, press: { ...send, page: 'maternity', id: 'save_visit' } }], deps)).toBe('failed');
      expect(page.actions.press).not.toHaveBeenCalled();
      expect(deps.report).toHaveBeenLastCalledWith('maternity', 'save_details', 'failed', 'FILL_FAILED');
    });
  });

  it('stops between steps when the user presses Stop', async () => {
    const page = fakePage();
    let stop = false;
    const deps = { ...io(page), pause: async () => { stop = true; }, stopped: () => stop };
    expect(await runPlan([{ path: '/clinician/schedule', label: 'Schedule' }, fillStep], deps)).toBe('stopped');
    expect(page.actions.fill).not.toHaveBeenCalled();
  });
});
