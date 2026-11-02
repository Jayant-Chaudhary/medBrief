/**
 * Carries out a plan from the server, one step at a time: open the page, fill
 * the page's declared controls, press at most one of its declared buttons.
 *
 * A button that saves or sends is pressed only after `confirm` resolves true,
 * and the page's summary is read again just before pressing: if anything
 * changed since the user confirmed, they are asked again. Any failure stops the
 * plan and leaves the form as it is. Plain JavaScript, so it can be tested
 * without React or a browser.
 *
 * @param {Array<object>} plan - steps: { path?, state?, fill?: { page, fields }, press?: { page, id, label, effect, sideEffect? } }
 * @param {object} io
 * @param {(path: string, state?: object) => void} io.navigate
 * @param {(page: string, context?: { patientId: string }) => Promise<object>} io.waitFor - the page's registered actions, for that record when given
 * @param {(ms: number) => Promise<void>} io.pause
 * @param {() => Promise<void>} io.settle - lets the page re-render after a fill
 * @param {(ids: string[]) => void} io.highlight
 * @param {(card: { label: string, rows: Array<{label: string, value: string}>, sideEffect?: string, changed: boolean }) => Promise<boolean>} io.confirm
 * @param {(page: string, button: string, outcome: string, errorCode?: string) => void} io.report
 * @param {(index: number, result: object) => void} io.progress
 * @param {() => boolean} io.stopped
 * @returns {Promise<'done'|'stopped'|'cancelled'|'failed'>}
 */
export async function runPlan(plan, io, { stepDelayMs = 500 } = {}) {
  for (let i = 0; i < plan.length; i += 1) {
    if (io.stopped()) return 'stopped';
    const { path, state, fill, press } = plan[i];
    const result = {};
    // No path: the page is already open, and what the user chose on it stays.
    if (path) io.navigate(path, state);

    let actions = null;
    if (fill || press) {
      try {
        // With a context, only that record's page will do (never the one open before).
        const { page, context } = fill || press;
        actions = await io.waitFor(page, context);
      } catch {
        result[fill ? 'fill' : 'press'] = 'failed';
        io.progress(i, result);
        return 'failed';
      }
    }

    if (fill) {
      const outcome = await fillFields(actions, fill, io, i, result);
      if (outcome !== 'done') return outcome;
    }

    if (press) {
      const outcome = await pressButton(actions, press, io, i, result);
      if (outcome !== 'done') return outcome;
    }

    io.progress(i, result);
    if (i < plan.length - 1) await io.pause(stepDelayMs);
  }
  return 'done';
}

// Logged when the user confirms fields that save as soon as they are filled.
const SAVE_DETAILS = 'save_details';

/**
 * Fills the page's controls. Where the page says these fields save the moment
 * they change (a patient's record), the user confirms them first.
 */
async function fillFields(actions, fill, io, index, result) {
  const gate = actions.confirmFill?.(fill.fields);
  if (gate?.ids?.length) {
    const rows = (fill.filled || []).filter((f) => gate.ids.includes(f.id)).map(({ label, value }) => ({ label, value }));
    result.fill = 'confirming';
    io.progress(index, { ...result });
    const yes = await io.confirm({ label: 'Save to record', rows, sideEffect: gate.sideEffect, changed: false });
    if (!yes || io.stopped()) {
      io.report(fill.page, SAVE_DETAILS, 'cancelled');
      result.fill = 'cancelled';
      io.progress(index, result);
      return 'cancelled';
    }
    io.report(fill.page, SAVE_DETAILS, 'confirmed');
  }

  try {
    actions.fill(fill.fields);
  } catch {
    if (gate?.ids?.length) io.report(fill.page, SAVE_DETAILS, 'failed', 'FILL_FAILED');
    result.fill = 'failed';
    io.progress(index, result);
    return 'failed';
  }
  if (gate?.ids?.length) io.report(fill.page, SAVE_DETAILS, 'done');
  // Let the page render what was filled (a new-patient fill shows new fields) before outlining it.
  await io.settle();
  io.highlight(Object.keys(fill.fields));
  result.fill = 'filled';
  io.progress(index, { ...result });
  return 'done';
}

async function pressButton(actions, press, io, index, result) {
  const fail = (state = 'failed') => {
    result.press = state;
    io.progress(index, result);
    return 'failed';
  };
  await io.settle();
  // The page decides whether the button can be pressed now (for example, no patient chosen yet).
  if (!actions.hasButton(press.id)) return fail('unavailable');

  if (press.effect === 'ui') {
    try {
      await actions.press(press.id);
    } catch {
      return fail();
    }
    result.press = 'done';
    return 'done';
  }

  // Saves or sends: the user confirms exactly what the page will submit.
  let changed = false;
  for (;;) {
    const rows = actions.summary(press.id);
    result.press = 'confirming';
    io.progress(index, { ...result });
    const yes = await io.confirm({ label: press.label, rows, sideEffect: press.sideEffect, changed });
    if (!yes || io.stopped()) {
      io.report(press.page, press.id, 'cancelled');
      result.press = 'cancelled';
      io.progress(index, result);
      return 'cancelled';
    }
    await io.settle();
    if (JSON.stringify(actions.summary(press.id)) === JSON.stringify(rows)) break;
    changed = true;
  }

  io.report(press.page, press.id, 'confirmed');
  let ok;
  try {
    ok = await actions.press(press.id);
  } catch {
    ok = false;
  }
  if (ok === false) {
    io.report(press.page, press.id, 'failed', 'SUBMIT_FAILED');
    return fail();
  }
  io.report(press.page, press.id, 'done');
  result.press = 'done';
  return 'done';
}
