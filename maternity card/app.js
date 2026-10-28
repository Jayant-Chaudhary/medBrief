'use strict';

/* Maternity card: the doctor enters details in the left panel and the structured
   card on the right updates as they type. Everything is kept in this browser only. */

const STORAGE_KEY = 'maternity-card-v1';
// Drafts from the earlier inline-edit version of this page are imported once.
const LEGACY_KEY = 'health-on.maternity-card.inline.v1';
const LIST_KINDS = ['visits', 'labs', 'scans', 'vaccines'];
const URINE = ['Negative', 'Trace', '1+', '2+', '3+', '4+', 'Not tested'];

// ---------- Field definitions (span is out of a 12-column grid) ----------
const f = (key, label, type = 'text', extra = {}) => ({ key, label, type, span: 6, ...extra });

const FIELDS = {
  patient: [
    f('name', 'Patient name', 'text', { span: 12 }),
    f('id', 'Hospital ID'),
    f('phone', 'Phone', 'tel'),
    f('age', 'Age (years)', 'number', { span: 4 }),
    f('attendance', 'First attendance', 'date', { span: 8 }),
    f('gravida', 'Gravida', 'number', { span: 3 }),
    f('para', 'Para', 'number', { span: 3 }),
    f('living', 'Living', 'number', { span: 3 }),
    f('abortions', 'Abortions', 'number', { span: 3 }),
    f('lmp', 'LMP', 'date'),
    f('edd', 'EDD', 'date', { hint: 'Auto: LMP + 280 days' }),
    f('history', 'Relevant history / allergies', 'textarea', { span: 12 }),
  ],
  investigations: [
    f('blood', 'Blood group', 'select', { options: ['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'] }),
    f('resultsDate', 'Investigation date', 'date'),
    f('hb', 'Hb (g/dL)', 'number', { step: '0.1' }),
    f('tsh', 'TSH (mIU/L)', 'number', { step: '0.01' }),
    f('chest', 'Chest'),
    f('cvs', 'CVS'),
    f('results', 'Other results', 'textarea', { span: 12, placeholder: 'Test, date and result' }),
  ],
  visits: [
    f('date', 'Visit date', 'date', { required: true }),
    f('weeks', 'GA weeks', 'number', { span: 3, max: 45 }),
    f('days', '+ days', 'number', { span: 3, max: 6 }),
    f('weight', 'Weight (kg)', 'number', { step: '0.1' }),
    f('fundal', 'Fundal height (cm)', 'number', { step: '0.1' }),
    f('systolic', 'BP systolic', 'number', { placeholder: 'mmHg' }),
    f('diastolic', 'BP diastolic', 'number', { placeholder: 'mmHg' }),
    f('presentation', 'Presentation', 'select', { options: ['Cephalic', 'Breech', 'Transverse', 'Oblique', 'Not assessed', 'Other'] }),
    f('brim', 'Relation to brim', 'text', { placeholder: 'e.g. 3/5 palpable' }),
    f('fhr', 'FHR (bpm)', 'number', { span: 4 }),
    f('albumin', 'Urine albumin', 'select', { span: 4, options: URINE }),
    f('sugar', 'Urine sugar', 'select', { span: 4, options: URINE }),
    f('hb', 'Hb (g/dL)', 'number', { step: '0.1' }),
    f('tsh', 'TSH (mIU/L)', 'number', { step: '0.01' }),
    f('next', 'Next visit', 'date'),
    f('clinician', 'Clinician'),
    f('advice', 'Advice / notes', 'textarea', { span: 12 }),
  ],
  labs: [
    f('date', 'Test date', 'date', { required: true }),
    f('test', 'Investigation', 'text', { required: true, list: 'testOptions', placeholder: 'e.g. Hb, TSH, OGTT' }),
    f('result', 'Result', 'text', { required: true }),
    f('unit', 'Unit'),
    f('notes', 'Notes / reference range', 'textarea', { span: 12 }),
  ],
  scans: [
    f('date', 'Scan date', 'date', { required: true }),
    f('weeks', 'GA weeks', 'number', { span: 3, max: 45 }),
    f('days', '+ days', 'number', { span: 3, max: 6 }),
    f('report', 'Report / findings', 'textarea', { span: 12, required: true }),
  ],
  vaccines: [
    f('name', 'Vaccine / injection', 'text', { span: 12, required: true, list: 'vaccineOptions', placeholder: 'e.g. Td, Tdap, Anti-D' }),
    f('dose', 'Dose / details'),
    f('date', 'Date given', 'date', { required: true }),
    f('next', 'Next dose', 'date'),
    f('notes', 'Notes'),
  ],
  delivery: [
    f('type', 'Type of delivery', 'select', { options: ['Vaginal', 'Assisted vaginal', 'Caesarean', 'Other'] }),
    f('when', 'Date & time', 'datetime-local'),
    f('indication', 'Indication', 'text', { span: 12 }),
    f('sex', 'Sex of baby', 'select', { options: ['Female', 'Male', 'Indeterminate'] }),
    f('weight', 'Birth weight (kg)', 'number', { step: '0.001' }),
    f('apgar1', 'APGAR · 1 min', 'number', { span: 4, max: 10 }),
    f('apgar5', 'APGAR · 5 min', 'number', { span: 4, max: 10 }),
    f('next', 'Next postnatal', 'date', { span: 4 }),
    f('advice', 'Postnatal advice', 'textarea', { span: 12 }),
  ],
};

const SECTIONS = [
  { id: 'patient', label: 'Patient', title: '1. Patient details', hint: 'Fill in what you have — the card updates live as you type.' },
  { id: 'investigations', label: 'Baseline', title: '2. Baseline investigations', hint: 'First attendance baseline tests & vitals.' },
  { id: 'visits', label: 'Visits', title: '3. Antenatal visits', noun: 'visit', hint: 'Add a dated entry at each visit throughout pregnancy.' },
  { id: 'labs', label: 'Labs', title: '4. Investigations / Labs', noun: 'test result', hint: 'Blood tests, serology & lab investigations.' },
  { id: 'scans', label: 'Ultrasound', title: '5. Ultrasound examination', noun: 'scan', hint: 'Ultrasound reports, gestational dating & growth scans.' },
  { id: 'vaccines', label: 'Vaccines', title: '6. Vaccinations & injections', noun: 'vaccination', hint: 'Immunization schedule & pregnancy prophylaxis.' },
  { id: 'delivery', label: 'Delivery', title: '7. Delivery & postnatal', hint: 'Delivery outcome, baby details & postnatal advice.' },
];
const tabById = Object.fromEntries(SECTIONS.map(sec => [sec.id, sec]));

// ---------- State ----------
const fresh = () => ({
  version: 1, patient: {}, investigations: {}, delivery: {},
  visits: [], labs: [], scans: [], vaccines: [], pending: {}, updatedAt: '',
});
let state = fresh();
let saveBlocked = false; // a stored card could not be read, or another tab changed it
let saveTimer, toastTimer, renderFrame;

// ---------- Small helpers ----------
const $ = id => document.getElementById(id);
function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}
const isRecord = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const uid = () => crypto.randomUUID?.() ?? Date.now().toString(36) + Math.random().toString(36).slice(2);
const hasValues = obj => Object.entries(obj || {}).some(([k, v]) => k !== 'id' && String(v ?? '').trim() !== '');
const withUnit = (value, unit) => (value ? `${value} ${unit}` : '');

function parseDate(value) {
  const [y, m, d] = String(value || '').slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
}
function fmtDate(value) {
  if (!value) return '';
  const [date, time] = value.split('T');
  const [y, m, d] = date.split('-');
  return d ? `${d}/${m}/${y}${time ? ' · ' + time.slice(0, 5) : ''}` : value;
}
function addDays(value, days) {
  const date = parseDate(value);
  if (!date) return '';
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}
function gestation(lmp, on) {
  const from = parseDate(lmp), to = parseDate(on);
  if (!from || !to) return null;
  const days = Math.round((to - from) / 86400000);
  return days < 0 || days > 310 ? null : { weeks: Math.floor(days / 7), days: days % 7 };
}
const gaText = r => (r.weeks ? `${r.weeks}w ${r.days || 0}d` : '');

// Values highlighted on the card for the clinician's attention.
const bpHigh = r => Number(r.systolic) >= 140 || Number(r.diastolic) >= 90;
const hbLow = v => v !== '' && v != null && Number(v) < 11;
const fhrAbnormal = v => v && (Number(v) < 110 || Number(v) > 160);
const urinePositive = v => ['1+', '2+', '3+', '4+'].includes(v);

// ---------- Storage ----------
const cleanValues = obj => Object.fromEntries(
  Object.entries(obj).filter(([, v]) => typeof v === 'string' || typeof v === 'number').map(([k, v]) => [k, String(v)]),
);
function normalize(raw) {
  const next = fresh();
  for (const key of ['patient', 'investigations', 'delivery']) if (isRecord(raw[key])) next[key] = cleanValues(raw[key]);
  for (const kind of LIST_KINDS) {
    if (!Array.isArray(raw[kind])) continue;
    next[kind] = raw[kind].filter(isRecord).map(row => ({ ...cleanValues(row), id: typeof row.id === 'string' && row.id ? row.id : uid() }));
  }
  if (isRecord(raw.pending)) {
    for (const kind of LIST_KINDS) {
      const draft = raw.pending[kind];
      if (isRecord(draft) && isRecord(draft.values)) {
        next.pending[kind] = { editId: typeof draft.editId === 'string' ? draft.editId : null, values: cleanValues(draft.values) };
      }
    }
  }
  if (typeof raw.updatedAt === 'string') next.updatedAt = raw.updatedAt;
  return next;
}
function load() {
  let raw = null, fromLegacy = false;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) { raw = localStorage.getItem(LEGACY_KEY); fromLegacy = Boolean(raw); }
  } catch {
    setStatus('Browser storage unavailable · print before closing');
    return;
  }
  if (!raw) { setStatus('New card · saved in this browser'); return; }
  try {
    const parsed = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1) throw new Error('Unrecognised card');
    state = normalize(parsed);
    setStatus(fromLegacy ? 'Earlier draft imported' : 'Card restored from this browser');
  } catch {
    saveBlocked = true;
    showWarning('The card saved in this browser could not be read, so it has not been overwritten. Use “New card” to replace it.');
    setStatus('Saving paused');
  }
}
function save() {
  clearTimeout(saveTimer);
  if (saveBlocked) return false;
  try {
    state.updatedAt = new Date().toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setStatus('Saved · ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }));
    return true;
  } catch {
    setStatus('Not saved · print before closing');
    return false;
  }
}
function scheduleSave() {
  if (saveBlocked) return;
  clearTimeout(saveTimer);
  setStatus('Saving…');
  saveTimer = setTimeout(save, 300);
}
function setStatus(text) { $('saveStatus').textContent = text; }
function showWarning(text) { $('warning').textContent = text; $('warning').hidden = !text; }
function toast(text) {
  $('toast').textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 3000);
}

// Every edit saves and redraws the card (batched to one redraw per frame).
function changed() {
  scheduleSave();
  cancelAnimationFrame(renderFrame);
  renderFrame = requestAnimationFrame(() => renderCard());
}

// ---------- Entry panel ----------
function buildField(def, value, prefix) {
  const wrap = el('label', `field span-${def.span}`);
  const caption = el('span', 'field-label', def.label);
  if (def.required) caption.append(el('span', 'req', ' *'));
  wrap.append(caption);

  let input;
  if (def.type === 'textarea') {
    input = el('textarea');
    input.rows = 3;
  } else if (def.type === 'select') {
    input = el('select');
    input.add(new Option('Select…', ''));
    def.options.forEach(option => input.add(new Option(option, option)));
  } else {
    input = el('input');
    input.type = def.type;
  }
  input.id = `${prefix}-${def.key}`;
  input.name = def.key;
  if (def.type === 'number') {
    input.min = '0';
    input.step = def.step || '1';
    input.inputMode = def.step ? 'decimal' : 'numeric';
    if (def.max !== undefined) input.max = def.max;
  }
  if (def.required) input.required = true;
  if (def.placeholder) input.placeholder = def.placeholder;
  if (def.list) input.setAttribute('list', def.list);
  input.value = value ?? '';
  wrap.append(input);
  if (def.hint) wrap.append(el('span', 'field-hint', def.hint));
  return wrap;
}
function fieldGrid(kind, values) {
  const grid = el('div', 'field-grid');
  FIELDS[kind].forEach(def => grid.append(buildField(def, values[def.key], kind)));
  return grid;
}
const formValues = form => Object.fromEntries(new FormData(form).entries());

// ---------- Quick-jump navigation (one tab, no tab-switching) ----------
function renderQuickNav() {
  const host = $('quickNav');
  if (!host) return;
  host.replaceChildren();
  for (const sec of SECTIONS) {
    const pill = el('button', 'quick-pill', sec.label);
    pill.type = 'button';
    pill.dataset.tone = sec.id;
    pill.dataset.target = `section-${sec.id}`;
    if (LIST_KINDS.includes(sec.id)) {
      const count = state[sec.id]?.length || 0;
      pill.append(el('span', 'count', String(count)));
    }
    pill.onclick = () => jumpToSection(`section-${sec.id}`, { focusFirst: true });
    host.append(pill);
  }
}

function jumpToSection(sectionId, { focusFirst = false } = {}) {
  const target = $(sectionId);
  if (!target) return;
  target.scrollIntoView({ behavior: 'smooth', block: 'start' });
  target.classList.add('highlight-pulse');
  setTimeout(() => target.classList.remove('highlight-pulse'), 1200);
  if (focusFirst) {
    const input = target.querySelector('input:not([type=hidden]), select, textarea');
    input?.focus({ preventScroll: true });
  }
}

function setupScrollSpy() {
  const panel = $('panel');
  if (!panel) return;
  const onScroll = () => {
    const sections = panel.querySelectorAll('.entry-section');
    const scrollPos = panel.scrollTop + 60;
    let currentId = '';
    sections.forEach(sec => {
      if (sec.offsetTop <= scrollPos) currentId = sec.id;
    });
    const pills = document.querySelectorAll('.quick-pill');
    pills.forEach(p => p.classList.toggle('is-active', p.dataset.target === currentId));
  };
  panel.addEventListener('scroll', onScroll, { passive: true });
}

// ---------- Unified Single-Tab Panel (all 7 sections visible) ----------
function buildStaticSection(kind) {
  const sec = tabById[kind];
  const section = el('section', 'entry-section');
  section.id = `section-${kind}`;
  section.dataset.tone = kind;

  const head = el('div', 'entry-section-head');
  head.append(el('h3', 'entry-section-title', sec.title));

  const body = el('div', 'entry-section-body');
  if (sec.hint) body.append(el('p', 'entry-section-hint', sec.hint));

  const form = el('form', 'entry-form');
  form.append(fieldGrid(kind, state[kind] || {}));
  form.append(el('div', 'live-note', 'Shown live on the card'));

  form.addEventListener('submit', event => event.preventDefault());
  form.addEventListener('input', event => {
    const input = event.target;
    if (!input.name) return;
    const previous = state[kind][input.name];
    state[kind][input.name] = input.value;
    if (kind === 'patient' && input.name === 'lmp') syncEdd(form, previous);
    changed();
  });

  body.append(form);
  section.append(head, body);
  return section;
}

function syncEdd(form, previousLmp) {
  // Keep EDD in step with LMP unless the doctor entered it by hand (e.g. dated by scan).
  const edd = state.patient.edd || '';
  if (edd && edd !== addDays(previousLmp, 280)) return;
  state.patient.edd = addDays(state.patient.lmp, 280);
  form.elements.edd.value = state.patient.edd;
}

function buildListSection(kind) {
  const sec = tabById[kind];
  const section = el('section', 'entry-section');
  section.id = `section-${kind}`;
  section.dataset.tone = kind;

  const head = el('div', 'entry-section-head');
  const title = el('h3', 'entry-section-title', sec.title);
  const count = state[kind]?.length || 0;
  title.append(el('span', 'entry-section-count', String(count)));

  const addBtn = el('button', 'entry-section-action', `+ Add ${sec.noun}`);
  addBtn.type = 'button';
  addBtn.onclick = () => newEntry(kind);
  head.append(title, addBtn);

  const body = el('div', 'entry-section-body');
  if (sec.hint) body.append(el('p', 'entry-section-hint', sec.hint));

  // If there are recorded items, show them in a compact saved list
  const rows = state[kind] || [];
  if (rows.length > 0) {
    const listWrap = el('div', 'saved-list');
    listWrap.append(el('div', 'saved-list-heading', `Recorded ${sec.noun}s (${rows.length})`));

    const currentEditId = state.pending[kind]?.editId;
    for (const row of rows) {
      const isEditing = currentEditId === row.id;
      const rowItem = el('div', 'saved-row' + (isEditing ? ' is-editing' : ''));

      let summaryText = '';
      if (kind === 'visits') {
        const ga = gaText(row);
        const bp = (row.systolic || row.diastolic) ? `${row.systolic || '–'}/${row.diastolic || '–'} mmHg` : '';
        summaryText = `${fmtDate(row.date)} ${ga ? '· ' + ga : ''} ${row.weight ? '· ' + row.weight + ' kg' : ''} ${bp ? '· BP ' + bp : ''}`;
      } else if (kind === 'labs') {
        summaryText = `${row.test || 'Test'}: ${[row.result, row.unit].filter(Boolean).join(' ')} (${fmtDate(row.date)})`;
      } else if (kind === 'scans') {
        const ga = gaText(row);
        summaryText = `${fmtDate(row.date)} ${ga ? '· ' + ga : ''} · ${row.report || ''}`;
      } else if (kind === 'vaccines') {
        summaryText = `${row.name || 'Vaccine'} (${fmtDate(row.date)}) ${row.dose ? '· ' + row.dose : ''}`;
      }

      const textSpan = el('span', 'saved-row-text', summaryText.trim() || fmtDate(row.date));
      const actions = el('div', 'saved-row-actions');

      if (isEditing) {
        actions.append(el('span', 'tag', 'Editing'));
      } else {
        const editBtn = el('button', 'saved-row-btn', 'Edit');
        editBtn.type = 'button';
        editBtn.onclick = () => editRow(kind, row.id);
        actions.append(editBtn);
      }

      const delBtn = el('button', 'saved-row-btn danger', '×');
      delBtn.type = 'button';
      delBtn.title = `Delete ${sec.noun}`;
      delBtn.onclick = () => {
        if (!confirm(`Delete this ${sec.noun} from ${fmtDate(row.date)}?`)) return;
        state[kind] = state[kind].filter(item => item.id !== row.id);
        if (state.pending[kind]?.editId === row.id) delete state.pending[kind];
        changed();
        updateListSection(kind);
        renderQuickNav();
        toast(`${capitalize(sec.noun)} deleted`);
      };
      actions.append(delBtn);

      rowItem.append(textSpan, actions);
      listWrap.append(rowItem);
    }
    body.append(listWrap);
  }

  // Active form for new or editing entry
  let draft = state.pending[kind];
  if (draft?.editId && !state[kind].some(r => r.id === draft.editId)) {
    draft = state.pending[kind] = { editId: null, values: draft.values };
  }
  const editId = draft?.editId || null;

  const form = el('form', 'entry-form');
  const subHead = el('div');
  subHead.append(
    el('h4', 'panel-title', editId ? `Edit ${sec.noun}` : `+ Add new ${sec.noun}`),
    el('p', 'panel-hint', editId ? 'Editing the highlighted row on the card.' : `Fill details below and click Add ${sec.noun}.`),
  );
  form.append(subHead, fieldGrid(kind, draft?.values || {}));

  const actions = el('div', 'form-actions');
  if (editId) {
    const remove = el('button', 'btn btn-danger', 'Delete');
    remove.type = 'button';
    remove.onclick = () => {
      if (!confirm(`Delete this ${sec.noun} from the card?`)) return;
      state[kind] = state[kind].filter(row => row.id !== editId);
      delete state.pending[kind];
      changed();
      updateListSection(kind);
      renderQuickNav();
      toast(`${capitalize(sec.noun)} deleted`);
    };
    actions.append(remove);
  }
  const reset = el('button', 'btn btn-quiet', editId ? 'Cancel' : 'Clear');
  reset.type = 'button';
  reset.onclick = () => {
    if (!confirmDiscard(kind)) return;
    delete state.pending[kind];
    changed();
    updateListSection(kind);
  };
  const submit = el('button', 'btn btn-primary', editId ? 'Save changes' : `+ Add ${sec.noun}`);
  actions.append(el('span', 'spacer'), reset, submit);
  form.append(actions);

  form.addEventListener('input', event => {
    if (event.target.name === 'date') fillGestation(form);
    state.pending[kind] = { editId, values: formValues(form) };
    changed();
  });

  form.addEventListener('submit', event => {
    event.preventDefault();
    const values = formValues(form);
    const next = form.elements.next;
    if (next && values.next && values.date && values.next < values.date) {
      next.setCustomValidity('Must be on or after the entry date.');
      next.reportValidity();
      next.setCustomValidity('');
      return;
    }
    const row = { ...values, id: editId || uid() };
    if (editId) state[kind] = state[kind].map(item => (item.id === editId ? row : item));
    else state[kind].push(row);
    delete state.pending[kind];
    changed();
    updateListSection(kind);
    renderQuickNav();
    toast(editId ? 'Changes saved' : `${capitalize(sec.noun)} added to card`);
  });

  body.append(form);
  section.append(head, body);
  return section;
}

function updateListSection(kind) {
  const current = $(`section-${kind}`);
  if (!current) return;
  const replacement = buildListSection(kind);
  current.replaceWith(replacement);
}

function renderAllSections() {
  const panel = $('panel');
  panel.replaceChildren(
    buildStaticSection('patient'),
    buildStaticSection('investigations'),
    buildListSection('visits'),
    buildListSection('labs'),
    buildListSection('scans'),
    buildListSection('vaccines'),
    buildStaticSection('delivery'),
  );
  renderQuickNav();
}

const capitalize = text => text.charAt(0).toUpperCase() + text.slice(1);

function fillGestation(form) {
  // Work out gestational age from LMP, unless the doctor has typed their own.
  const { weeks, days, date } = form.elements;
  if (!weeks) return;
  if (weeks.value && `${weeks.value}+${days.value}` !== form.dataset.autoGa) return;
  const ga = gestation(state.patient.lmp, date.value);
  if (!ga) return;
  weeks.value = ga.weeks;
  days.value = ga.days;
  form.dataset.autoGa = `${ga.weeks}+${ga.days}`;
}

function draftChanged(kind) {
  const draft = state.pending[kind];
  if (!draft || !hasValues(draft.values)) return false;
  if (!draft.editId) return true;
  const row = state[kind].find(item => item.id === draft.editId);
  return !row || FIELDS[kind].some(def => (draft.values[def.key] || '') !== (row[def.key] || ''));
}
const confirmDiscard = kind => !draftChanged(kind) || confirm(`Discard the unsaved ${tabById[kind].noun}?`);

function editRow(kind, id) {
  if (state.pending[kind]?.editId !== id) {
    if (!confirmDiscard(kind)) return;
    const row = state[kind].find(item => item.id === id);
    if (!row) return;
    state.pending[kind] = { editId: id, values: { ...row } };
    changed();
    updateListSection(kind);
  }
  jumpToSection(`section-${kind}`, { focusFirst: true });
}

function newEntry(kind) {
  if (state.pending[kind]?.editId) {
    if (!confirmDiscard(kind)) return;
    delete state.pending[kind];
    changed();
    updateListSection(kind);
  }
  jumpToSection(`section-${kind}`, { focusFirst: true });
}

// ---------- Card: landscape clinical sheet ----------
const BLANK = '________________';
// A value shown in red on the card; plain text when the check passes.
const flagged = (text, abnormal) => (text && abnormal ? { text, flag: true } : text);

const VISIT_HEADINGS = ['Date', 'Weight (kg)', 'B.P. (mmHg)', 'Weeks', 'Fundal height (cm)', 'Presentation', 'Relation to brim', 'FHR (bpm)', 'Urine albumin', 'Urine sugar', 'TSH', 'Hb', 'Next visit', 'Clinician', 'Advice'];
const VISIT_WIDTHS = [7, 5, 6, 4, 5, 7, 6, 4, 5, 5, 4, 4, 7, 7, 24];
const visitCells = r => [
  fmtDate(r.date), r.weight,
  flagged(r.systolic || r.diastolic ? `${r.systolic || '—'}/${r.diastolic || '—'}` : '', bpHigh(r)),
  r.weeks ? `${r.weeks}+${r.days || 0}` : '', r.fundal, r.presentation, r.brim,
  flagged(r.fhr, fhrAbnormal(r.fhr)), flagged(r.albumin, urinePositive(r.albumin)), flagged(r.sugar, urinePositive(r.sugar)),
  r.tsh, flagged(r.hb, hbLow(r.hb)), fmtDate(r.next), r.clinician, r.advice,
];

// Saved rows, with the entry being typed shown in place so the doctor sees the result live.
function cardRows(kind, forPrint) {
  const draft = forPrint ? null : state.pending[kind];
  const rows = state[kind].map(row => (draft?.editId === row.id ? { ...row, ...draft.values, id: row.id, status: 'editing' } : row));
  rows.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
  if (draft && !draft.editId && hasValues(draft.values)) rows.push({ ...draft.values, status: 'draft' });
  return rows;
}

function paperTable(kind, headings, widths, toCells, minRows, forPrint) {
  const noun = tabById[kind].noun;
  const table = el('table');
  const group = el('colgroup');
  widths.forEach(width => { const col = el('col'); col.style.width = width + '%'; group.append(col); });
  table.append(group);
  const head = table.createTHead().insertRow();
  headings.forEach(heading => { const th = el('th', '', heading); th.scope = 'col'; head.append(th); });

  const body = table.createTBody();
  const rows = cardRows(kind, forPrint);
  for (const row of rows) {
    const tr = body.insertRow();
    for (const value of toCells(row)) {
      const td = tr.insertCell();
      if (value?.flag) td.append(el('span', 'flag', value.text));
      else td.textContent = value || '';
    }
    if (row.status === 'draft') {
      tr.className = 'is-draft';
      tr.title = `Not added yet — click “+ Add ${noun}” to keep it`;
      tr.onclick = () => jumpToSection(`section-${kind}`, { focusFirst: true });
      continue;
    }
    tr.className = 'row' + (row.status === 'editing' ? ' is-editing' : '');
    tr.tabIndex = 0;
    tr.title = `Edit this ${noun}`;
    tr.onclick = () => editRow(kind, row.id);
    tr.onkeydown = event => {
      if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); editRow(kind, row.id); }
    };
  }
  // Ruled blank rows, as on the paper card.
  for (let i = rows.length; i < minRows; i++) {
    const tr = body.insertRow();
    tr.className = 'blank';
    headings.forEach(() => tr.insertCell());
    if (!forPrint) tr.onclick = () => newEntry(kind);
  }
  return table;
}

// Clicking a part of the card jumps to the matching entry section.
function linkTo(node, kind) {
  node.classList.add('jump');
  node.title = `Edit ${tabById[kind].title.replace(/^\d+\.\s*/, '').toLowerCase()}`;
  node.onclick = () => jumpToSection(`section-${kind}`, { focusFirst: true });
  return node;
}

function renderCard(forPrint = false) {
  const p = state.patient, inv = state.investigations, d = state.delivery;
  const paper = $('card');
  paper.replaceChildren();

  const title = el('div', 'paper-title');
  title.append(el('h2', '', 'MATERNITY RECORD'), el('span', '', 'CONFIDENTIAL · ANTENATAL & POSTNATAL CARD'));
  paper.append(title);

  const info = linkTo(el('div', 'paper-patient'), 'patient');
  [
    ['Patient', p.name], ['Hospital ID', p.id], ['Age', p.age], ['Phone', p.phone],
    ['First attendance', fmtDate(p.attendance)], ['LMP', fmtDate(p.lmp)], ['EDD', fmtDate(p.edd)],
    ['Obstetric history', `G ${p.gravida || '—'}  P ${p.para || '—'}  L ${p.living || '—'}  A ${p.abortions || '—'}`],
  ].forEach(([label, value]) => {
    const line = el('div');
    line.append(el('b', '', label), value ? value : el('span', 'blank-line', BLANK));
    info.append(line);
  });
  paper.append(info);

  const top = el('div', 'paper-top');
  const box = (label, kind) => {
    const section = el('section', 'paper-box');
    section.append(linkTo(el('h3', '', label), kind));
    top.append(section);
    return section;
  };

  const lines = el('div', 'paper-lines');
  const baseline = [
    ...FIELDS.investigations.filter(def => def.key !== 'results').map(def => [def.label, def.type === 'date' ? fmtDate(inv[def.key]) : inv[def.key], def.key === 'hb' && hbLow(inv.hb)]),
    ['History / allergies', p.history],
    ['Other results', inv.results],
  ];
  for (const [label, value, abnormal] of baseline) {
    const line = el('div');
    line.append(label + ': ');
    if (!value) line.append(el('span', 'blank-line', '__________'));
    else line.append(abnormal ? el('span', 'flag', value) : value);
    lines.append(line);
  }
  box('FIRST ATTENDANCE / BASELINE', 'investigations').append(linkTo(lines, 'investigations'));

  box('INVESTIGATIONS', 'labs').append(paperTable('labs', ['Investigation', 'Date', 'Result / unit'], [32, 26, 42],
    r => [r.test, fmtDate(r.date), [r.result, r.unit, r.notes].filter(Boolean).join(' · ')], 8, forPrint));
  box('ULTRASOUND EXAMINATION', 'scans').append(paperTable('scans', ['Date', 'Report'], [25, 75],
    r => [fmtDate(r.date), (r.weeks ? `${r.weeks}w ${r.days || 0}d · ` : '') + (r.report || '')], 8, forPrint));
  box('VACCINATIONS / INJECTIONS', 'vaccines').append(paperTable('vaccines', ['Name / dose', 'Date', 'Next dose'], [44, 28, 28],
    r => [[r.name, r.dose, r.notes].filter(Boolean).join(' · '), fmtDate(r.date), fmtDate(r.next)], 8, forPrint));
  paper.append(top);

  const visits = paperTable('visits', VISIT_HEADINGS, VISIT_WIDTHS, visitCells, 10, forPrint);
  visits.className = 'visits-table';
  paper.append(visits);

  const deliveryRecord = linkTo(el('div', 'paper-delivery'), 'delivery');
  deliveryRecord.append(el('div', 'paper-delivery-title', 'DELIVERY & POSTNATAL RECORD'));
  const items = el('div');
  FIELDS.delivery.forEach((def, index) => {
    const raw = d[def.key];
    const value = def.type === 'date' || def.type === 'datetime-local' ? fmtDate(raw) : raw;
    if (index) items.append('   |   ');
    items.append(def.label + ': ', value ? value : el('span', 'blank-line', '________'));
  });
  deliveryRecord.append(items);
  paper.append(deliveryRecord);

  paper.append(el('div', 'paper-foot', 'Same patient record throughout pregnancy · Each row is a separate dated entry.'));
}

// ---------- Top-bar actions ----------
$('newCard').onclick = () => {
  if (!confirm('Start a blank card? This replaces the card saved in this browser. Print the current card first if you need it.')) return;
  const previous = state, wasBlocked = saveBlocked;
  state = fresh();
  saveBlocked = false;
  if (!save()) { state = previous; saveBlocked = wasBlocked; return; }
  showWarning('');
  renderAllSections();
  renderCard();
  jumpToSection('section-patient', { focusFirst: true });
  toast('New card started');
};
$('printCard').onclick = () => {
  const unfinished = LIST_KINDS.filter(draftChanged).map(kind => tabById[kind].noun);
  if (unfinished.length && !confirm(`Unsaved ${unfinished.join(', ')} will not be printed. Print anyway?`)) return;
  save();
  window.print();
};
// Ctrl+P prints too: drop drafts and add writing rows for the paper copy.
window.addEventListener('beforeprint', () => renderCard(true));
window.addEventListener('afterprint', () => renderCard());
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  clearTimeout(saveTimer);
  saveBlocked = true;
  setStatus('Saving paused');
  showWarning('This card was changed in another tab. Saving here is paused so neither copy is overwritten — reload to open the latest version.');
});

load();
renderAllSections();
renderCard();
setupScrollSpy();
