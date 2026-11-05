'use strict';

// This isolated UI intentionally has no backend or patient-account side effects.
const STORAGE_KEY = 'health-on.maternity-card.inline.v1';
const kinds = ['labs', 'scans', 'vaccines', 'visits'];
const $ = id => document.getElementById(id);
const fresh = () => ({version: 1, patient: {}, investigations: {}, delivery: {}, labs: [], scans: [], vaccines: [], visits: []});
let state = fresh();
let saveTimer, toastTimer;
let storageBlocked = false;
let preview = false;

function isRecord(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function validDraft(value) {
  if (!isRecord(value) || value.version !== 1) return false;
  const scalarFields = obj => isRecord(obj) && Object.values(obj).every(v => typeof v === 'string');
  return ['patient', 'investigations', 'delivery'].every(key => scalarFields(value[key])) &&
    kinds.every(key => Array.isArray(value[key]) && value[key].every(row => scalarFields(row) && typeof row.id === 'string') && new Set(value[key].map(row => row.id)).size === value[key].length);
}
function warning(message) {
  $('storageWarning').textContent = message;
  $('storageWarning').hidden = !message;
}
try {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    if (!validDraft(parsed)) throw new Error('Unrecognized draft');
    state = parsed;
  }
  $('saveStatus').textContent = raw ? 'Draft restored from this browser' : 'Ready · local draft';
} catch (error) {
  storageBlocked = true;
  warning('The saved draft could not be opened. It has not been overwritten. Use New card to deliberately replace it, or recover the existing browser data first.');
  $('saveStatus').textContent = 'Draft storage unavailable';
}
function notify(message) {
  $('toast').textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 3500);
}
function save() {
  clearTimeout(saveTimer);
  if (storageBlocked) return false;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    $('saveStatus').textContent = 'Saved locally · ' + new Date().toLocaleTimeString([], {hour: '2-digit', minute: '2-digit'});
    warning('');
    return true;
  } catch (error) {
    $('saveStatus').textContent = 'Not saved · keep this tab open';
    warning('Browser storage is unavailable or full. Your edits remain in this open tab. Print or save a PDF before leaving.');
    return false;
  }
}
function scheduleSave() {
  if (storageBlocked) return;
  clearTimeout(saveTimer);
  $('saveStatus').textContent = 'Saving…';
  saveTimer = setTimeout(save, 300);
}
function node(tag, className, text) {
  const result = document.createElement(tag);
  if (className) result.className = className;
  if (text !== undefined) result.textContent = text;
  return result;
}
function grow(input) {
  if (input.tagName !== 'TEXTAREA' || !input.offsetWidth) return;
  input.style.height = '0px';
  input.style.height = Math.max(34, input.scrollHeight + 2) + 'px';
}
function resizeFields() {
  document.querySelectorAll('textarea').forEach(grow);
}
function printedValue(value, type) {
  if (!value) return '—';
  if (type === 'date' || type === 'datetime-local') {
    const [date, time] = value.split('T');
    const [year, month, day] = date.split('-');
    return `${day}/${month}/${year}${time ? ' · ' + time : ''}`;
  }
  return value;
}
function hasValues(row) {
  return Object.entries(row).some(([key, value]) => key !== 'id' && String(value).trim() !== '');
}
function validateInput(input, row) {
  input.setCustomValidity('');
  if (input.name === 'next' && input.value && row.date && input.value < row.date) {
    input.setCustomValidity('Next date must be on or after this entry date.');
  }
  const missing = input.required && !input.value && hasValues(row);
  const invalid = hasValues(row) && (!input.validity.valid || missing);
  const label = input.closest('.field');
  label.classList.toggle('invalid', invalid);
  input.setAttribute('aria-invalid', String(invalid));
  label.querySelector('.field-error').textContent = invalid ? (input.validationMessage || 'Complete this field.') : '';
  return !invalid;
}
function refreshValidation(container, row) {
  container.querySelectorAll('input,textarea,select').forEach(input => validateInput(input, row));
}
function field(schema, data, prefix, onChange = () => {}) {
  const label = node('label', 'field field-' + schema.key);
  const caption = node('span', 'field-label', schema.label);
  if (schema.required) caption.append(node('span', 'required-mark', ' *'));
  label.append(caption);
  // All free text uses an auto-growing textarea, including names and short notes.
  const text = schema.type === 'text' || schema.type === 'textarea';
  const input = document.createElement(text ? 'textarea' : schema.type === 'select' ? 'select' : 'input');
  input.id = prefix + '-' + schema.key;
  input.name = schema.key;
  input.setAttribute('aria-label', schema.label);
  if (text) { input.rows = 1; input.spellcheck = false; }
  else if (schema.type === 'select') {
    input.add(new Option('—', ''));
    schema.options.forEach(value => input.add(new Option(value, value)));
  } else input.type = schema.type;
  if (schema.type === 'number') {
    input.min = '0';
    input.step = schema.step || '1';
    if (schema.max !== undefined) input.max = schema.max;
    input.inputMode = schema.step ? 'decimal' : 'numeric';
  }
  input.required = Boolean(schema.required);
  input.placeholder = schema.placeholder || 'Enter…';
  input.value = data[schema.key] || '';
  const output = node('span', 'print-value', printedValue(input.value, schema.type));
  output.setAttribute('aria-hidden', 'true');
  const error = node('span', 'field-error');
  error.id = input.id + '-error';
  input.setAttribute('aria-describedby', error.id);
  input.addEventListener('input', () => {
    data[schema.key] = input.value;
    output.textContent = printedValue(input.value, schema.type);
    grow(input);
    validateInput(input, data);
    onChange();
    scheduleSave();
  });
  input.addEventListener('blur', () => validateInput(input, data));
  label.append(input, output, error);
  return label;
}
function renderStatic(id, schema, key) {
  $(id).replaceChildren(...schema.map(item => field(item, state[key], key)));
}
function removeButton(kind, row) {
  const button = node('button', 'remove-row', 'Remove');
  button.type = 'button';
  button.setAttribute('aria-label', `Remove ${labels[kind]} ${row.date || ''}`.trim());
  button.onclick = () => {
    if (hasValues(row) && !confirm(`Remove this ${labels[kind]} from the card?`)) return;
    state[kind] = state[kind].filter(item => item.id !== row.id);
    renderRows(kind);
    save();
    document.querySelector(`[data-add="${kind}"]`).focus();
  };
  return button;
}
const visitGroups = [
  ['date', 'weeks', 'days'], ['weight', 'fundal'], ['systolic', 'diastolic'],
  ['presentation', 'brim'], ['fhr', 'albumin', 'sugar'], ['hb', 'tsh'],
  ['next'], ['clinician'], ['advice'],
];
function renderRows(kind) {
  const host = $(kind + 'Rows');
  host.replaceChildren();
  $(kind + 'Count').textContent = state[kind].length ? `(${state[kind].length})` : '';
  if (!state[kind].length) {
    if (kind === 'visits') {
      const row = node('tr', 'visits-empty');
      const cell = node('td', '', 'No visits yet. Add your first visit to begin the pregnancy record.');
      cell.colSpan = visitGroups.length;
      row.append(cell); host.append(row);
    } else host.append(node('p', 'empty-record', `No ${labels[kind]} recorded yet.`));
  }
  state[kind].forEach((row, index) => {
    const container = node(kind === 'visits' ? 'tr' : 'div', kind === 'visits' ? 'visit-row' : 'record');
    container.dataset.rowId = row.id;
    container.classList.toggle('is-empty', !hasValues(row));
    const changed = () => {
      container.classList.toggle('is-empty', !hasValues(row));
      // Date constraints depend on sibling fields, not only the active control.
      if (row.next) refreshValidation(container, row);
    };
    const buildField = schema => field(schema, row, kind + '-' + row.id, changed);
    if (kind === 'visits') {
      visitGroups.forEach((keys, groupIndex) => {
        const cell = node('td');
        keys.forEach(key => cell.append(buildField(schemas.visits.find(schema => schema.key === key))));
        if (groupIndex === 0) cell.append(removeButton(kind, row));
        container.append(cell);
      });
    } else {
      const tools = node('div', 'record-tools');
      tools.append(node('span', 'record-number', `${labels[kind]} ${index + 1}`), removeButton(kind, row));
      const grid = node('div', 'record-fields');
      schemas[kind].forEach(schema => {
        const element = buildField(schema);
        if (['report', 'notes', 'test', 'name'].includes(schema.key)) element.classList.add('wide');
        grid.append(element);
      });
      container.append(tools, grid);
    }
    host.append(container);
  });
  requestAnimationFrame(resizeFields);
}
function render() {
  renderStatic('patientFields', patient, 'patient');
  renderStatic('baselineFields', investigations, 'investigations');
  renderStatic('deliveryFields', delivery, 'delivery');
  kinds.forEach(renderRows);
  requestAnimationFrame(resizeFields);
}
function setPreview(enabled) {
  preview = enabled;
  document.body.classList.toggle('preview', enabled);
  $('preview').setAttribute('aria-pressed', String(enabled));
  $('preview').textContent = enabled ? 'Edit card' : 'Preview';
  $('editingHint').textContent = enabled ? 'Print preview · All current entries are shown.' : 'Edit directly on the card. Fields and rows grow with your notes.';
  document.querySelectorAll('.print-value').forEach(value => value.setAttribute('aria-hidden', String(!enabled)));
  if (!enabled) requestAnimationFrame(resizeFields);
}
document.querySelectorAll('[data-add]').forEach(button => {
  button.onclick = () => {
    const kind = button.dataset.add;
    // The ID is local record identity, not a database or patient ID.
    const row = {id: crypto.randomUUID()};
    state[kind].push(row);
    renderRows(kind);
    save();
    const container = Array.from($(kind + 'Rows').children).find(item => item.dataset.rowId === row.id);
    container?.querySelector('input,textarea,select')?.focus();
  };
});
$('preview').onclick = () => setPreview(!preview);
$('newCard').onclick = () => {
  if (!confirm('Start a new pregnancy card? This replaces the draft stored in this browser. Print or save a PDF of the current card first if needed.')) return;
  clearTimeout(saveTimer);
  const previous = state;
  const wasBlocked = storageBlocked;
  state = fresh(); storageBlocked = false;
  if (!save()) { state = previous; storageBlocked = wasBlocked; return; }
  setPreview(false); render();
  $('patient-name').focus();
  notify('New card created');
};
function validateCard() {
  const sections = [['patientFields', state.patient], ['baselineFields', state.investigations], ['deliveryFields', state.delivery]];
  sections.forEach(([id, row]) => refreshValidation($(id), row));
  kinds.forEach(kind => state[kind].forEach(row => {
    const element = Array.from($(kind + 'Rows').children).find(item => item.dataset.rowId === row.id);
    if (element) refreshValidation(element, row);
  }));
  return document.querySelector('.field.invalid input,.field.invalid textarea,.field.invalid select');
}
$('print').onclick = () => {
  const invalid = validateCard();
  if (invalid) {
    setPreview(false);
    invalid.focus(); invalid.reportValidity();
    notify('Complete the highlighted fields before printing. Your draft is kept.');
    return;
  }
  save(); window.print();
};
window.addEventListener('beforeprint', () => {
  // Ctrl+P also prints live values. Incomplete records remain visibly marked.
  validateCard();
});
window.addEventListener('afterprint', resizeFields);
window.addEventListener('pagehide', save);
document.addEventListener('visibilitychange', () => { if (document.hidden) save(); });
window.addEventListener('storage', event => {
  if (event.key !== STORAGE_KEY && event.key !== null) return;
  clearTimeout(saveTimer); storageBlocked = true;
  $('saveStatus').textContent = 'Saving paused · draft changed in another tab';
  warning('This draft changed in another tab. Automatic saving is paused to prevent overwriting it. Print your current edits if needed, then reload to open the latest saved draft.');
});
let previousWidth = 0;
new ResizeObserver(entries => {
  const width = entries[0].contentRect.width;
  if (width === previousWidth) return;
  previousWidth = width;
  requestAnimationFrame(resizeFields);
}).observe($('card'));
render();
