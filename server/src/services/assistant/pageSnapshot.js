/**
 * The open page as the browser reads it (Phase 5): labels of its buttons,
 * links, fields and dropdowns, never the values on screen. This module
 * redacts what the model sees, decides how risky each proposed action is,
 * and checks every action against the page and the user's own words.
 *
 * Risk classes for an action:
 *   never   - deletes, removals, sign out, recording and consent, choosing files:
 *             refused, and the user is told to do it themselves.
 *   free    - opening, viewing, tabs, filters, navigation, and typing into fields
 *             that do not save by themselves.
 *   confirm - everything else: anything that saves, adds, sends or ends, and
 *             any button whose label does not say it is harmless.
 */

const { mentions, norm } = require('./resolvers/values');

// Labels that are never pressed. Deletes stay manual by decision; recording and
// consent must be the doctor's own act; browsers do not let code choose files.
const NEVER = /\b(delete|remove|discard|clear|archive|untick|sign ?out|log ?out|reset|new card|start recording|stop recording|pause recording|resume recording|record audio|mic check|mic test|stt test|start consultation|stop consultation|end consultation|confirm ready|microphone|consent|readiness|test phrase|browse files|choose file|replace file|upload|download|export|browse)\b/i;
// Labels that only change what is shown.
const FREE = /^(open|view|show|hide|expand|collapse|close|back|next|previous|prev|today|search|filter|menu|more|less|details|see|go to|jump|scroll|cancel|dismiss|review|preview|edit|templates?|all|upcoming|past|maternity record|antenatal record)\b/i;
const FREE_KINDS = new Set(['link', 'summary', 'tab']);
const TEXT_KINDS = new Set(['text', 'textarea', 'number', 'date', 'datetime', 'email', 'tel', 'search']);
const CLICK_KINDS = new Set(['button', 'link', 'summary', 'tab', 'checkbox', 'radio']);
// replace: change one phrase inside a field to another, in the browser (the field's text is never sent).
const OPS = ['click', 'type', 'append', 'replace', 'select', 'check'];
const WRITES = new Set(['type', 'append', 'replace', 'select']);
// How a done action is described in a later round's "already done" (matches the panel's wording).
const DONE = { click: 'Pressed', type: 'Typed in', append: 'Added to', replace: 'Changed in', select: 'Chose in', check: 'Ticked' };

const EMAIL_ANYWHERE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;
const LONG_NUMBER = /\+?\d[\d\s-]{5,}\d/g;
const VALUE_WITH_UNIT = /\b\d+(?:\.\d+)?\s*(?:mg|g\/dl|mmhg|kg|bpm|%|cm|mm|ml|iu|miu\/l|weeks?|w)\b/gi;

/**
 * Removes anything that could identify a patient or show a clinical value from
 * the labels: the doctor's own patients' names, emails, long numbers, values
 * with units. Pages also mark rows of patient data private, so this is a net.
 */
function redact(snapshot, patients = []) {
  const names = [...new Set(patients.flatMap((p) => {
    const full = String(p.fullName || '').trim();
    return full ? [full, ...full.split(/\s+/).filter((part) => part.length >= 3)] : [];
  }))].sort((a, b) => b.length - a.length);
  const clean = (text) => {
    let out = String(text || '').replace(EMAIL_ANYWHERE, '[email]').replace(LONG_NUMBER, '[number]').replace(VALUE_WITH_UNIT, '[value]');
    for (const name of names) {
      out = out.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi'), '[patient]');
    }
    return out;
  };
  return {
    title: clean(snapshot.title),
    headings: (snapshot.headings || []).map(clean),
    elements: (snapshot.elements || []).map((el) => ({
      ...el,
      name: clean(el.name),
      ...(el.text && { text: clean(el.text) }),
      ...(el.section && { section: clean(el.section) }),
      ...(el.options && { options: el.options.map(clean) }),
    })),
  };
}

// A label that says it commits something is never treated as harmless ("Edit and save").
const COMMITS = /\b(save|submit|send|add|create|confirm|apply|share|end|approve|publish|resolve|keep)\b/i;

/** How risky an action on this element is: 'never' | 'free' | 'confirm'. */
function classify(element, op) {
  if (element.private) return 'never';
  if (element.effect === 'never' || NEVER.test(element.name)) return 'never';
  if (WRITES.has(op)) {
    return element.effect === 'save' || element.effect === 'send' ? 'confirm' : 'free';
  }
  if (element.effect === 'free') return 'free';
  if (element.effect === 'save' || element.effect === 'send') return 'confirm';
  // Opening, showing and filtering stay harmless even inside a region that saves.
  if ((FREE_KINDS.has(element.kind) || FREE.test(element.name)) && !COMMITS.test(element.name)) return 'free';
  return 'confirm';
}

/**
 * Typing into several saving fields of one section shares one Confirm card
 * ("Medicine 1": name, dose, frequency); any other confirmed action is its own.
 */
function confirmGroup(element, op) {
  return WRITES.has(op) || op === 'check' ? `fields:${element.section || ''}` : `click:${element.ref}`;
}

/** One line per element for the prompt: `r3 button "Add medicine" (Prescription · Medicine 2) [saves]`. */
function describeElements(elements) {
  return elements.map((el) => {
    const desc = el.text ? ` - "${el.text}"` : '';
    const where = el.section ? ` (${el.section})` : '';
    const options = el.options?.length ? ` options: ${el.options.join(' | ')}` : '';
    const mark = el.effect === 'save' ? ' [saves]' : el.effect === 'send' ? ' [sends to patient]' : NEVER.test(el.name) || el.effect === 'never' ? ' [never]' : '';
    const off = el.disabled ? ' [disabled until the field before it is filled]' : '';
    return `${el.ref} ${el.kind} "${el.name}"${desc}${where}${options}${mark}${off}`;
  }).join('\n');
}

/**
 * Trims snapshot elements when they exceed the token budget (~1500 tokens / 6000 chars for Gemma).
 * Trimming priority order: preserves open dialogs and sections mentioned in the request, trims Menu first.
 */
function applyTokenBudget(snapshot, message = '', maxBudgetChars = 6000) {
  if (!snapshot?.elements || snapshot.elements.length === 0) return snapshot;
  const currentText = describeElements(snapshot.elements);
  if (currentText.length <= maxBudgetChars) return snapshot;

  const msgNorm = String(message || '').toLowerCase();
  const scored = snapshot.elements.map((el, index) => {
    let score = 0;
    if (el.section?.toLowerCase().includes('dialog') || el.section?.toLowerCase().includes('modal')) score += 100;
    if (el.section && msgNorm.includes(el.section.toLowerCase())) score += 50;
    if (el.name && msgNorm.includes(el.name.toLowerCase())) score += 30;
    if (el.section === 'Menu') score -= 50;
    return { el, index, score };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);

  const kept = [];
  let currentChars = 0;
  for (const item of scored) {
    const line = `${item.el.ref} ${item.el.kind} "${item.el.name}"`;
    if (currentChars + line.length > maxBudgetChars && kept.length > 0) break;
    kept.push(item);
    currentChars += line.length + 30;
  }

  kept.sort((a, b) => a.index - b.index);
  return {
    ...snapshot,
    elements: kept.map((item) => item.el),
  };
}

const REASON = {
  never: 'that one is yours to press',
  noElement: 'it is not on this page any more',
  wrongOp: 'that does not work on this kind of field',
  notInMessage: 'I could not find that value in your message',
  badOption: 'that is not one of its choices',
};

/**
 * Checks the model's actions on the open page.
 * @returns {{ actions: object[], refused: { name: string, reason: string }[], cut: boolean }}
 *   `cut` is true when actions after the first save were dropped (one Confirm per round;
 *   several fields of one section share it).
 */
function checkPageActions(proposed, snapshot, message, { maxActions }) {
  const byRef = new Map((snapshot?.elements || []).map((el) => [el.ref, el]));
  const actions = [];
  const refused = [];
  let group = null;
  let cut = false;

  for (const raw of (Array.isArray(proposed) ? proposed : []).slice(0, maxActions)) {
    const element = byRef.get(raw?.ref);
    if (!element) continue;
    let op = OPS.includes(raw.op) ? raw.op : null;
    if (op === 'type' && element.kind === 'textarea') op = 'append';
    const fits = op && (
      (op === 'click' && CLICK_KINDS.has(element.kind))
      // A search box that only opens a list of results (marked free) can be clicked open.
      || (op === 'click' && TEXT_KINDS.has(element.kind) && element.effect === 'free')
      || ((op === 'type' || op === 'append' || op === 'replace') && TEXT_KINDS.has(element.kind))
      || (op === 'select' && element.kind === 'select')
      || (op === 'check' && (element.kind === 'checkbox' || element.kind === 'radio'))
    );
    if (!fits) {
      refused.push({ name: element.name, reason: REASON.wrongOp });
      continue;
    }

    const risk = classify(element, op);
    if (risk === 'never') {
      refused.push({ name: element.name, reason: REASON.never });
      continue;
    }

    let value;
    let find;
    if (op === 'type' || op === 'append' || op === 'replace') {
      value = String(raw.value ?? '').trim().slice(0, 300);
      find = op === 'replace' ? String(raw.find ?? '').trim().slice(0, 300) : undefined;
      // Typed text (and the phrase being changed) comes from the user's own words, never the model's.
      const fromMessage = (text) => text && norm(message).includes(norm(text));
      if (!fromMessage(value) || (op === 'replace' && !fromMessage(find))) {
        refused.push({ name: element.name, reason: REASON.notInMessage });
        continue;
      }
    } else if (op === 'select') {
      const wanted = norm(raw.value);
      const option = (element.options || []).find((o) => norm(o) === wanted);
      if (!option) {
        refused.push({ name: element.name, reason: REASON.badOption });
        continue;
      }
      if (!mentions(message, [option])) {
        refused.push({ name: element.name, reason: REASON.notInMessage });
        continue;
      }
      value = option;
    }

    let confirmWith;
    if (risk === 'confirm') {
      confirmWith = confirmGroup(element, op);
      if (group && (confirmWith !== group || !group.startsWith('fields:'))) {
        cut = true;
        break;
      }
      group = confirmWith;
    }
    actions.push({
      ref: element.ref, op, name: element.name, kind: element.kind, risk,
      ...(value !== undefined && { value }),
      ...(find !== undefined && { find }),
      ...(element.section && { section: element.section }),
      ...(element.effect && { effect: element.effect }),
      ...(element.sideEffect && { sideEffect: element.sideEffect }),
      ...(confirmWith && { group: confirmWith }),
    });
  }
  return { actions, refused, cut };
}

// Page phrase rules: plain commands that name an element exactly are matched without the model.
const FILLER = new Set(['the', 'a', 'an', 'my', 'this', 'please', 'button', 'on', 'for', 'me']);
const VERBS = /^(press|click|tap|hit|open|show|select|read|view|check|see)\s+/;
const TICK = /^(?:please\s+)?(?:tick|check|mark)\s+(.+)$/i;
const FIELD_VALUE = /^([^:]{3,60}):\s*(.+)$/;
const TYPED_IN_FIELD = /^(?:please\s+)?(?:type|search(?:\s+for)?)\s+["“']?(.+?)["”']?\s+(?:in|into)\s+(?:the\s+)?(.+?)(?:\s+(?:field|box|input|bar))?$/i;
const SELECT_OPTION = /^(?:please\s+)?(?:select|choose|filter\s+by)\s+["“']?(.+?)["”']?\s+(?:in|from|on)\s+(?:the\s+)?(.+?)(?:\s+(?:dropdown|select|filter|menu))?$/i;
const ADD_TO_LIST = /^(?:please\s+)?add\s+["“']?(.+?)["”']?\s+to\s+(?:the\s+)?(consultation\s+checklist|next\s+steps(?:\s+for\s+the\s+patient)?)$/i;

const words = (text) => norm(text).replace(/[^\p{L}\p{N}\s/-]/gu, ' ').split(/\s+/).filter((w) => w && !FILLER.has(w)).join(' ');

/** Edit distance, for typos like "consultaion". */
function distance(a, b) {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) {
    let previous = row[0];
    row[0] = i;
    for (let j = 1; j <= b.length; j += 1) {
      const current = row[j];
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, previous + (a[i - 1] === b[j - 1] ? 0 : 1));
      previous = current;
    }
  }
  return row[b.length];
}

/** The same words, allowing a small typo in longer ones (two letters from 7 letters up, one from 4). */
function sameWords(a, b) {
  const x = a.split(' ');
  const y = b.split(' ');
  return x.length === y.length && x.every((w, i) => {
    const allowed = w.length >= 7 ? 2 : w.length >= 4 ? 1 : 0;
    return w === y[i] || distance(w, y[i]) <= allowed;
  });
}

/** The one element whose label is these words (or none, if zero or several). */
function only(elements, target, kinds) {
  if (!target) return null;
  const exact = elements.filter((el) => kinds.has(el.kind) && words(el.name) === target);
  if (exact.length) return exact.length === 1 ? exact[0] : null;
  const close = elements.filter((el) => kinds.has(el.kind) && sameWords(target, words(el.name)));
  return close.length === 1 ? close[0] : null;
}

// Consultation notes: "notes: …", "write in notes …", "write … in the notes", "change A to B in notes".
const NOTES_WORD = '(?:the\\s+)?(?:consultation\\s+|consultancy\\s+)?notes?';
const NOTE_ADD = [
  new RegExp(`^(?:in\\s+)?${NOTES_WORD}\\s*(?:me\\s+)?(?:likho|write|add)?\\s*[:\\-]\\s*(.+)$`, 'i'),
  // "in the consultation notes write walk at least 100m daily"
  new RegExp(`^(?:in|into|to)\\s+${NOTES_WORD}\\s*,?\\s*(?:write|add|put|type|likho|mention)\\s+(.+)$`, 'i'),
  new RegExp(`^(?:please\\s+)?(?:write|add|put|likho|type)\\s+(?:in|to|into)\\s+${NOTES_WORD}\\s*[:\\-,]?\\s*(.+)$`, 'i'),
  new RegExp(`^(?:please\\s+)?(?:write|add|put|type)\\s+["“']?(.+?)["”']?\\s+(?:in|to|into)\\s+${NOTES_WORD}\\s*$`, 'i'),
];
const NOTE_CHANGE = [
  new RegExp(`^(?:in\\s+${NOTES_WORD},?\\s*)(?:replace|change)\\s+["“']?(.+?)["”']?\\s+(?:with|to|into)\\s+["“']?(.+?)["”']?\\s*$`, 'i'),
  new RegExp(`^(?:replace|change)\\s+["“']?(.+?)["”']?\\s+(?:with|to|into)\\s+["“']?(.+?)["”']?\\s+in\\s+${NOTES_WORD}\\s*$`, 'i'),
];
const NOTES_FIELD = /\bnotes?\b/i;
// The button that opens the notes panel (the Dashboard's "Consultation notes").
const NOTES_BUTTON = 'consultation notes';
// A plain "write …" that names no other box ("write … in patient instructions" is left to the model).
const WRITE = /^(?:please\s+)?write\s+(?:down\s+)?(?!.*\b(?:in|into|under)\s+(?:the\s+)?[\w /]+?\s*(?:instructions?|advice|field|box|checklist|steps?)\s*$)(.+)$/i;
const OPEN_NOTES = /^(?:please\s+)?(?:open|show|view|see|go\s+to)\s+(?:the\s+)?(?:consultation\s+|consultancy\s+)?notes?(?:\s+(?:panel|section|tab))?$/i;

// "add the template with the highest similarity", "use the best matching template" (typos allowed).
const BEST_TEMPLATE = /\btempl\w*/i;
const BEST_WORDS = /\b(best|top|closest|most similar|high\w*|similar\w*|match\w*)\b/i;
// "close the consultation notes", "close this", "band karo", "go back": the open panel's or page's own close/back button.
const CLOSE = /^(?:please\s+)?(?:close|hide|exit|dismiss|shut|band\s+kar(?:o|\s+do)?|go\s+back|back)\b/i;
const CLOSER = /^(close|dismiss|back)\b/i;

// "add folic acid as well": a bundle or saved item by name.
const ADD_BY_NAME = /^(?:please\s+)?(?:add|give|start|put|include)\s+(?:the\s+|a\s+|some\s+)?(.+?)(?:\s+(?:a\s*s\s+well|as\s+well|too|also))?\s*$/i;

// A medicine line as doctors type it: "paracetamol 500 mg twice daily for 5 days".
const DOSE = /(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu|units?|tabs?|tablets?|drops?))\b/i;
const FREQUENCY = /\b((?:once|twice|thrice|one time|two times|three times|four times)\s+(?:a\s+day|daily|per day|a week|weekly)|od|bd|bid|tds|tid|qid|hs|sos|at night|every \d+\s*hours?)\b/i;
const DURATION = /\bfor\s+(\d+\s*(?:days?|weeks?|months?))\b/i;
const MEDICINE_VERBS = /^(?:please\s+)?(?:add|give|start|write|prescribe|put)\s+/i;

/** The last medicine row's fields ("Prescription · Medicine 2" → its Name, Dose, Frequency, Duration). */
function lastMedicineRow(elements) {
  const rows = elements
    .map((el) => ({ el, row: Number(/Medicine (\d+)/.exec(el.section || '')?.[1]) }))
    .filter(({ row }) => row > 0);
  const last = Math.max(0, ...rows.map(({ row }) => row));
  if (!last) return null;
  const field = (name) => rows.find(({ el, row }) => row === last && el.name === name && TEXT_KINDS.has(el.kind))?.el;
  return { name: field('Name'), dose: field('Dose'), frequency: field('Frequency'), duration: field('Duration') };
}

/** "paracetamol 500 mg twice daily for 5 days" → its parts, or null when it is not a medicine line. */
function medicineLine(text) {
  const dose = DOSE.exec(text);
  if (!dose) return null;
  const name = text.slice(0, dose.index).replace(MEDICINE_VERBS, '').replace(/\b(tablet|tab|capsule|cap|syrup|inj(?:ection)?)\.?\s*$/i, '').trim();
  if (!/^[\p{L}][\p{L}\d\s+./-]{1,40}$/u.test(name)) return null;
  return { name, dose: dose[1], frequency: FREQUENCY.exec(text)?.[1], duration: DURATION.exec(text)?.[1] };
}

/**
 * Plain commands the page's own labels answer without the model:
 *   "close the panel", "tick BP check and iron advice", "patient instructions: rest and fluids",
 *   "notes: mild headache", "change 'mild' to 'severe' in notes", "paracetamol 500 mg twice daily for 5 days".
 * @returns {{ actions: object[], next?: boolean } | { openNotes: true } | null}
 *   actions are proposals, checked like the model's; `next` asks for another round (a new row to fill);
 *   `openNotes` means the request is for the notes but the notes panel is closed.
 */
function matchPageCommand(message, snapshot) {
  const elements = snapshot?.elements || [];
  const text = String(message || '').trim();
  const notesBox = elements.filter((el) => el.kind === 'textarea' && NOTES_FIELD.test(el.name));
  const notes = notesBox.length === 1 ? notesBox[0] : null;
  // Notes panel closed: press the page's own "Consultation notes" button, then carry on.
  const openNotes = () => {
    const button = only(elements, NOTES_BUTTON, CLICK_KINDS);
    return button ? { actions: [{ ref: button.ref, op: 'click', value: '' }], next: true } : { openNotes: true };
  };

  for (const pattern of NOTE_CHANGE) {
    const change = pattern.exec(text);
    if (change) return notes ? { actions: [{ ref: notes.ref, op: 'replace', find: change[1].trim(), value: change[2].trim() }] } : openNotes();
  }
  for (const pattern of NOTE_ADD) {
    const add = pattern.exec(text);
    // "add to the notes that she has nausea" → "she has nausea".
    if (add) return notes ? { actions: [{ ref: notes.ref, op: 'append', value: add[1].trim().replace(/^that\s+/i, '') }] } : openNotes();
  }
  // "write review in 2 weeks" with the notes open: the notes are where doctors write.
  const write = WRITE.exec(text);
  if (write && notes) return { actions: [{ ref: notes.ref, op: 'append', value: write[1].trim() }] };
  // "open notes" with the notes already showing is already done.
  if (OPEN_NOTES.test(text)) {
    if (notes) return { actions: [], done: true };
    const button = only(elements, NOTES_BUTTON, CLICK_KINDS);
    return button ? { actions: [{ ref: button.ref, op: 'click', value: '' }] } : { openNotes: true };
  }

  // "record consultation", "open recording", "open audio consult"
  const AUDIO_CONSULT = /^(?:please\s+)?(?:open\s+(?:consultation\s+)?recording|record\s+consultation|open\s+audio\s+consult|audio\s+consult)$/i;
  if (AUDIO_CONSULT.test(text)) {
    const btn = elements.find((el) => CLICK_KINDS.has(el.kind) && /record consultation|open audio consult|open recording/i.test(el.name));
    if (btn) return { actions: [{ ref: btn.ref, op: 'click', value: '' }] };
    return { openAudioConsult: true };
  }

  // Close what is open: an open panel is read first, so its close button comes first; a
  // close/back button whose label matches the request wins ("close panel", "back to dashboard").
  if (CLOSE.test(text)) {
    const closers = elements.filter((el) => CLICK_KINDS.has(el.kind) && CLOSER.test(el.name) && el.section !== 'Menu');
    const named = only(closers, words(text), CLICK_KINDS);
    const target = named || closers[0];
    if (target) return { actions: [{ ref: target.ref, op: 'click', value: '' }] };
  }

  // The best patient match: pick it once the ranked list is open; otherwise open the list first.
  if (BEST_TEMPLATE.test(text) && BEST_WORDS.test(text)) {
    const best = elements.find((el) => /^best matching template:/i.test(el.name));
    if (best) return { actions: [{ ref: best.ref, op: 'click', value: '' }] };
    const search = elements.find((el) => TEXT_KINDS.has(el.kind) && /^search templates/i.test(el.name));
    if (search) return { actions: [{ ref: search.ref, op: 'click', value: '' }], next: true };
  }

  const medicine = medicineLine(text);
  if (medicine) {
    const row = lastMedicineRow(elements);
    if (row?.name && row.dose) {
      const parts = [['name', row.name], ['dose', row.dose], ['frequency', row.frequency], ['duration', row.duration]];
      return { actions: parts.filter(([key, el]) => el && medicine[key]).map(([key, el]) => ({ ref: el.ref, op: 'type', value: medicine[key] })) };
    }
    const addMedicine = only(elements, 'add medicine', CLICK_KINDS);
    if (addMedicine) return { actions: [{ ref: addMedicine.ref, op: 'click', value: '' }], next: true };
  }

  const tick = TICK.exec(text);
  if (tick) {
    const boxes = tick[1].split(/,|\band\b/).map((part) => words(part)).filter(Boolean)
      .map((target) => only(elements, target, new Set(['checkbox'])));
    if (boxes.length && boxes.every(Boolean)) return { actions: boxes.map((el) => ({ ref: el.ref, op: 'check', value: '' })) };
  }

  const field = FIELD_VALUE.exec(text);
  if (field) {
    const label = words(field[1]);
    const hits = elements.filter((el) => TEXT_KINDS.has(el.kind) && (words(el.name) === label || words(el.name).startsWith(`${label} `)));
    if (label && hits.length === 1) return { actions: [{ ref: hits[0].ref, op: 'type', value: field[2].trim() }] };
  }

  const typed = TYPED_IN_FIELD.exec(text);
  if (typed) {
    const label = words(typed[2]);
    const hits = elements.filter((el) => TEXT_KINDS.has(el.kind) && (words(el.name) === label || words(el.name).startsWith(`${label} `)));
    if (label && hits.length === 1) return { actions: [{ ref: hits[0].ref, op: 'type', value: typed[1].trim() }] };
  }

  const sel = SELECT_OPTION.exec(text);
  if (sel) {
    const optWanted = norm(sel[1]);
    const label = words(sel[2]);
    const hits = elements.filter((el) => el.kind === 'select' && (words(el.name) === label || words(el.name).startsWith(`${label} `)));
    if (hits.length === 1) {
      const opt = (hits[0].options || []).find((o) => norm(o) === optWanted);
      if (opt) return { actions: [{ ref: hits[0].ref, op: 'select', value: opt }] };
    }
  }

  const addList = ADD_TO_LIST.exec(text);
  if (addList) {
    const val = addList[1].trim();
    const isChecklist = /checklist/i.test(addList[2]);
    const inputEl = elements.find((el) => TEXT_KINDS.has(el.kind) && (isChecklist ? /add an item for this consultation/i.test(el.name) : /write an action for this patient/i.test(el.name)));
    const btnEl = elements.find((el) => CLICK_KINDS.has(el.kind) && /^add$/i.test(el.name) && (isChecklist ? /checklist/i.test(el.section || '') : /next steps/i.test(el.section || '')));
    if (inputEl && btnEl) {
      return { actions: [{ ref: inputEl.ref, op: 'type', value: val }, { ref: btnEl.ref, op: 'click', value: '' }] };
    }
  }

  const whole = words(text);
  const target = only(elements, whole, CLICK_KINDS) || only(elements, whole.replace(VERBS, ''), CLICK_KINDS);
  if (target) return { actions: [{ ref: target.ref, op: 'click', value: '' }] };

  // "add folic acid": the one bundle or saved item whose label contains those words.
  const addName = ADD_BY_NAME.exec(text);
  if (addName) {
    const name = words(addName[1]);
    const wanted = name.split(' ');
    const hits = elements.filter((el) => CLICK_KINDS.has(el.kind) && !/^(add|remove)\b/i.test(el.name)
      && wanted.every((w) => words(el.name).split(' ').some((x) => sameWords(w, x))));
    if (name && hits.length === 1) return { actions: [{ ref: hits[0].ref, op: 'click', value: '' }] };
  }
  return null;
}

// Parts of a longer request, split where a new instruction starts ("… and add …", "…, then open …",
// "… and lastly add …", "… then his notes"). Filler words between parts are dropped.
const doneLine = (op, name) => `${DONE[op]} "${name}"`;

// App-help replies may explain the website, never health. Anything that sounds like
// advice, a diagnosis or a dose is replaced by the fixed refusal.
const HEALTH_WORDS = /\b(diagnos\w*|disease|infection|treat\w*|medicine for|you should take|dose|dosage|mg\b|tablet|normal range|abnormal|risk of|symptom\w* (?:of|mean)|pregnan\w* is|safe to|unsafe|consult a doctor|emergency|bleeding)\b/i;

/** A model-written app-help reply, or null when it must not be shown. */
function checkAnswer(text, maxChars) {
  const answer = String(text || '').replace(/\s+/g, ' ').trim();
  if (!answer || answer.length > maxChars || HEALTH_WORDS.test(answer)) return null;
  return answer;
}

module.exports = {
  redact, applyTokenBudget, classify, confirmGroup, describeElements, checkPageActions, checkAnswer, matchPageCommand, doneLine, NOTES_BUTTON, NEVER,
};
