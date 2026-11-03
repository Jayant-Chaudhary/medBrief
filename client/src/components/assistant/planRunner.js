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
 * @param {(action: object) => void} [io.pageAction] - runs one action on an element read from the page (throws if it changed)
 * @param {string} [io.pageId] - names the open page in the action log
 * @returns {Promise<'done'|'stopped'|'cancelled'|'failed'>}
 */
export async function runPlan(plan, io, { stepDelayMs = 500 } = {}) {
  for (let i = 0; i < plan.length; i += 1) {
    if (io.stopped()) return 'stopped';
    const { path, state, fill, press, page } = plan[i];
    const result = {};
    // No path: the page is already open, and what the user chose on it stays.
    if (path) io.navigate(path, state);

    if (page) {
      const outcome = await runPageActions(page.actions, io, i, result);
      if (outcome !== 'done') return outcome;
    }

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
// Logged for a confirmed action on an element read from the page.
const PAGE_ACTION = 'page_action';

const VERB = { click: 'Press', type: 'Type in', append: 'Add to', replace: 'Change in', select: 'Choose in', check: 'Tick' };
const SIDE_EFFECT = {
  send: 'The patient will be able to see this.',
  save: 'This is saved as soon as it is done.',
};

/**
 * Actions on elements read from the page, in order. Harmless ones run at once;
 * the rest wait for the user's Confirm. Any failure or Cancel stops the plan.
 */
// How each kind of change reads on a Confirm card, so "adds" and "replaces" are never confused.
const ROW_VALUE = {
  check: () => 'tick',
  append: (a) => `adds: ${a.value}`,
  type: (a) => `replaces the text with: ${a.value}`,
  replace: (a) => `changes “${a.find}” to “${a.value}”`,
};

/** The Confirm card for one action, or for several fields of one section filled together. */
function cardFor(group) {
  const [first] = group;
  if (group.length === 1 && !first.group?.startsWith('fields:')) {
    return {
      label: `${VERB[first.op]} "${first.name}"`,
      rows: [
        ...(first.section ? [{ label: 'Where', value: first.section }] : []),
        ...(first.op === 'replace' ? [{ label: 'Change', value: first.find }, { label: 'To', value: first.value }] : []),
        ...(first.op === 'type' ? [{ label: 'Replaces the text with', value: first.value }] : []),
        ...(first.op !== 'replace' && first.op !== 'type' && first.value !== undefined ? [{ label: 'Value', value: first.value }] : []),
      ],
      sideEffect: SIDE_EFFECT[first.effect] || 'This presses the button on the page for you.',
      changed: false,
    };
  }
  return {
    label: `Fill ${first.section || 'these fields'}`,
    rows: group.map((a) => ({ label: a.name, value: ROW_VALUE[a.op]?.(a) ?? a.value })),
    sideEffect: SIDE_EFFECT[first.effect] || 'This is saved as soon as it is done.',
    changed: false,
  };
}

async function runPageActions(actions, io, index, result) {
  result.page = [];
  const show = () => io.progress(index, { ...result, page: [...result.page] });
  for (let j = 0; j < actions.length;) {
    if (io.stopped()) return 'stopped';
    // Consecutive fields of one section that save are confirmed together.
    const group = [actions[j]];
    if (actions[j].risk === 'confirm' && actions[j].group?.startsWith('fields:')) {
      while (actions[j + group.length]?.group === actions[j].group) group.push(actions[j + group.length]);
    }
    const confirming = actions[j].risk === 'confirm';
    if (confirming) {
      group.forEach((_, k) => { result.page[j + k] = 'confirming'; });
      show();
      const yes = await io.confirm(cardFor(group));
      if (!yes || io.stopped()) {
        io.report(io.pageId, PAGE_ACTION, 'cancelled');
        group.forEach((_, k) => { result.page[j + k] = 'cancelled'; });
        show();
        return 'cancelled';
      }
      io.report(io.pageId, PAGE_ACTION, 'confirmed');
    }
    for (let k = 0; k < group.length; k += 1) {
      try {
        io.pageAction(group[k]);
      } catch (err) {
        if (confirming) io.report(io.pageId, PAGE_ACTION, 'failed', err?.code || 'PAGE_ACTION_FAILED');
        result.page[j + k] = 'failed';
        show();
        return 'failed';
      }
      result.page[j + k] = 'done';
      show();
      // Let the page react (a panel opening, a new row, a button enabling) before the next action.
      await io.settle();
    }
    if (confirming) io.report(io.pageId, PAGE_ACTION, 'done');
    j += group.length;
  }
  return 'done';
}

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
