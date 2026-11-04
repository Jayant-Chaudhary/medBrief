/**
 * Form controls and buttons the assistant may use, per page (Phase 3).
 *
 * Only what is listed here can be filled or pressed; the page supplies the
 * matching setters and handlers through the client bridge. Buttons that delete,
 * discard or sign out are never listed, so they cannot be pressed at all.
 *
 * Control kinds: text, email, textarea, number, date, datetime, select, checkbox.
 * - `aliases`: words that name the field. Clinical controls only take a value
 *   when one of them appears in the typed message.
 * - `clinical`: a health value. Filled only from the doctor's own words.
 * - `future`: dates must be in the future (booking).
 * Button effects: `ui` (changes only the form on screen), `save` or `send`
 * (pressed only after the user confirms).
 */

// Maternity card helpers. Clinical controls take a value only when the field is named.
const clinicalNumber = (id, label, aliases, extra = {}) => ({ id, label, kind: 'number', clinical: true, aliases, ...extra });
const clinicalText = (id, label, aliases, kind = 'text') => ({ id, label, kind, clinical: true, aliases });
const option = (value, synonyms = []) => ({ value, label: value, synonyms });
const URINE = [
  option('Negative', ['nil', 'negative', 'neg', 'absent']),
  option('Trace', ['trace']),
  option('1+', ['+1', 'one plus']),
  option('2+', ['+2', 'two plus']),
  option('3+', ['+3', 'three plus']),
  option('4+', ['+4', 'four plus']),
  option('Not tested', ['not tested', 'not done']),
];
const bloodGroup = (group, sign, word) => option(`${group}${sign}`, [`${group} ${word}`, `${group} ${word.slice(0, 3)}`, `${group}${sign === '+' ? '+ve' : '-ve'}`, ...(sign === '−' ? [`${group}-`] : [])]);

const CONTROLS = {
  new_appointment: {
    roles: ['clinician'],
    // Small enough to offer the model on every doctor request.
    alwaysOffer: true,
    controls: [
      { id: 'scheduledAt', label: 'Date and time', kind: 'datetime', future: true },
      { id: 'patientFullName', label: 'New patient name', kind: 'text' },
      { id: 'patientEmail', label: 'New patient email', kind: 'email' },
      { id: 'newQuestion', label: 'New pre-visit question', kind: 'text' },
      {
        id: 'newQuestionType',
        label: 'How the patient answers',
        kind: 'select',
        options: [
          { value: 'yes_no', label: 'Yes / No', synonyms: ['yes or no', 'yes/no', 'yes no', 'haan ya na', 'haan ya nahi'] },
          { value: 'text', label: 'Written answer', synonyms: ['written', 'in words', 'text answer', 'free text', 'likh'] },
        ],
      },
      { id: 'saveQuestionToLibrary', label: 'Also save the question to my library', kind: 'checkbox', aliases: ['library'] },
    ],
    buttons: [
      { id: 'add_question', label: 'Add question', effect: 'ui' },
      { id: 'create_visit', label: 'Create visit and invite', effect: 'send', sideEffect: 'Creates the visit and emails the patient an invite.' },
    ],
  },

  // Maternity card. The patient comes from the open_maternity_card route; name, hospital id,
  // phone and age are not offered. Patient, Baseline and Delivery save as soon as they change
  // on a patient's record, so the website asks for Confirm before filling them there.
  maternity: {
    roles: ['clinician'],
    // Offered on the card itself, or when the request talks about it.
    hints: /maternity|antenatal|\banc\b|\bcard\b|\blmp\b|\bedd\b|\bhb\b|\bbp\b|\bfhr\b|fundal|apgar|\bscan\b|\busg\b|ultrasound|vaccin|\btd\b|delivery|delivered|gravida|\bg\d/i,
    // "BP 110/70": both numbers are taken from the user's words in this order,
    // so the model cannot swap systolic and diastolic.
    pairs: [{ ids: ['visit.systolic', 'visit.diastolic'], pattern: /(?:\bbp\b|blood pressure)\D{0,12}?(\d{2,3})\s*\/\s*(\d{2,3})/i }],
    controls: [
      { id: 'patient.attendance', label: 'First attendance', kind: 'date', aliases: ['first attendance', 'first visit', 'booking'] },
      clinicalNumber('patient.gravida', 'Gravida', ['gravida'], { formula: 'g' }),
      clinicalNumber('patient.para', 'Para', ['para'], { formula: 'p' }),
      clinicalNumber('patient.living', 'Living', ['living', 'live children'], { formula: 'l' }),
      clinicalNumber('patient.abortions', 'Abortions', ['abortion', 'abortions', 'miscarriage', 'miscarriages'], { formula: 'a' }),
      { id: 'patient.lmp', label: 'LMP', kind: 'date', clinical: true, aliases: ['lmp', 'last period', 'last menstrual'] },
      { id: 'patient.edd', label: 'EDD', kind: 'date', clinical: true, aliases: ['edd', 'due date', 'expected delivery'] },
      clinicalText('patient.history', 'Relevant history / allergies', ['history', 'allergy', 'allergies', 'allergic'], 'textarea'),

      {
        id: 'baseline.blood', label: 'Blood group', kind: 'select', clinical: true, optionsNameField: true, aliases: ['blood group', 'blood'],
        options: [['A', '+', 'positive'], ['A', '−', 'negative'], ['B', '+', 'positive'], ['B', '−', 'negative'],
          ['AB', '+', 'positive'], ['AB', '−', 'negative'], ['O', '+', 'positive'], ['O', '−', 'negative']].map(([g, s, w]) => bloodGroup(g, s, w)),
      },
      { id: 'baseline.resultsDate', label: 'Baseline date tested', kind: 'date', aliases: ['tested', 'date tested'] },
      clinicalNumber('baseline.hb', 'Baseline Hb (g/dL)', ['hb', 'haemoglobin', 'hemoglobin']),
      clinicalNumber('baseline.tsh', 'Baseline TSH (mIU/L)', ['tsh', 'thyroid']),
      clinicalText('baseline.chest', 'Chest', ['chest']),
      clinicalText('baseline.cvs', 'CVS', ['cvs', 'cardiovascular', 'heart sounds']),
      clinicalText('baseline.results', 'Other baseline results', ['results', 'other', 'hiv', 'vdrl', 'hbsag'], 'textarea'),

      { id: 'visit.date', label: 'Visit date', kind: 'date' },
      clinicalNumber('visit.weeks', 'Visit GA weeks', ['weeks', 'week', 'wks', 'ga', 'gestation']),
      clinicalNumber('visit.days', 'Visit GA days', ['days', 'day']),
      clinicalNumber('visit.weight', 'Weight (kg)', ['weight', 'wt', 'kg']),
      clinicalNumber('visit.fundal', 'Fundal height (cm)', ['fundal', 'fundal height', 'sfh']),
      clinicalNumber('visit.systolic', 'BP systolic', ['bp', 'blood pressure', 'systolic']),
      clinicalNumber('visit.diastolic', 'BP diastolic', ['bp', 'blood pressure', 'diastolic']),
      {
        id: 'visit.presentation', label: 'Presentation', kind: 'select', clinical: true, optionsNameField: true, aliases: ['presentation', 'presenting'],
        options: [option('Cephalic', ['ceph', 'vertex', 'head down']), option('Breech'), option('Transverse'), option('Oblique'), option('Not assessed'), option('Other')],
      },
      clinicalText('visit.brim', 'Relation to brim', ['brim', 'palpable']),
      clinicalNumber('visit.fhr', 'FHR (bpm)', ['fhr', 'fhs', 'fetal heart', 'heart rate']),
      { id: 'visit.albumin', label: 'Urine albumin', kind: 'select', clinical: true, aliases: ['albumin', 'protein'], options: URINE },
      { id: 'visit.sugar', label: 'Urine sugar', kind: 'select', clinical: true, aliases: ['sugar', 'glucose'], options: URINE },
      clinicalNumber('visit.hb', 'Visit Hb (g/dL)', ['hb', 'haemoglobin', 'hemoglobin']),
      clinicalNumber('visit.tsh', 'Visit TSH (mIU/L)', ['tsh', 'thyroid']),
      { id: 'visit.next', label: 'Next visit', kind: 'date', aliases: ['next visit', 'follow up', 'review', 'next'] },
      { id: 'visit.clinician', label: 'Clinician', kind: 'text' },
      clinicalText('visit.advice', 'Visit advice / notes', ['advice', 'advised', 'notes', 'note'], 'textarea'),

      { id: 'lab.date', label: 'Lab date tested', kind: 'date' },
      { id: 'lab.test', label: 'Investigation', kind: 'text' },
      { id: 'lab.result', label: 'Result', kind: 'text' },
      { id: 'lab.unit', label: 'Unit', kind: 'text' },
      { id: 'lab.notes', label: 'Lab notes', kind: 'textarea' },

      { id: 'scan.date', label: 'Scan date', kind: 'date' },
      clinicalNumber('scan.weeks', 'Scan GA weeks', ['weeks', 'week', 'wks', 'ga']),
      clinicalNumber('scan.days', 'Scan GA days', ['days', 'day']),
      { id: 'scan.report', label: 'Scan report', kind: 'textarea' },

      { id: 'vaccine.name', label: 'Vaccine / injection', kind: 'text' },
      { id: 'vaccine.dose', label: 'Dose', kind: 'text' },
      { id: 'vaccine.date', label: 'Date given', kind: 'date' },
      { id: 'vaccine.next', label: 'Next dose', kind: 'date', aliases: ['next dose', 'due', 'next'] },
      { id: 'vaccine.notes', label: 'Vaccine notes', kind: 'text' },

      {
        id: 'delivery.type', label: 'Delivery type', kind: 'select', clinical: true, optionsNameField: true, aliases: ['delivery type', 'mode of delivery'],
        options: [
          option('Vaginal', ['vaginal', 'normal delivery', 'nvd', 'svd']),
          option('Assisted vaginal', ['assisted', 'forceps', 'vacuum', 'ventouse']),
          option('Caesarean', ['cesarean', 'c-section', 'c section', 'lscs', 'cs']),
          option('Other'),
        ],
      },
      { id: 'delivery.when', label: 'Delivery date & time', kind: 'datetime', past: true },
      clinicalText('delivery.indication', 'Indication', ['indication', 'because', 'due to']),
      {
        id: 'delivery.sex', label: 'Baby sex', kind: 'select', clinical: true, optionsNameField: true, aliases: ['sex', 'baby'],
        options: [option('Female', ['girl', 'baby girl']), option('Male', ['boy', 'baby boy']), option('Indeterminate', ['ambiguous'])],
      },
      clinicalNumber('delivery.weight', 'Birth weight', ['birth weight', 'baby weight', 'weighing', 'weight', 'kg', 'grams']),
      clinicalNumber('delivery.apgar1', 'APGAR 1 min', ['apgar']),
      clinicalNumber('delivery.apgar5', 'APGAR 5 min', ['apgar']),
      { id: 'delivery.next', label: 'Next postnatal visit', kind: 'date', aliases: ['postnatal', 'next visit', 'follow up', 'next'] },
      clinicalText('delivery.advice', 'Postnatal advice', ['advice', 'advised'], 'textarea'),
    ],
    buttons: [
      { id: 'save_visit', label: 'Add visit', effect: 'save', sideEffect: 'Adds this visit to the maternity card.' },
      { id: 'save_lab', label: 'Add result', effect: 'save', sideEffect: 'Adds this result to the maternity card.' },
      { id: 'save_scan', label: 'Add scan', effect: 'save', sideEffect: 'Adds this scan to the maternity card.' },
      { id: 'save_vaccine', label: 'Add vaccination', effect: 'save', sideEffect: 'Adds this vaccination to the maternity card.' },
      // Not offered to the model: the website asks for this Confirm itself before filling
      // fields that save straight to a patient's record, and logs the outcome under this id.
      { id: 'save_details', label: 'Save to record', effect: 'save', internal: true },
    ],
  },

  schedule: {
    roles: ['clinician'],
    hints: /\b(?:schedule|calendar|agenda)\b/i,
    controls: [
      { id: 'date', label: 'Schedule date', kind: 'date', aliases: ['date', 'day', 'din', 'aaj', 'kal', 'parso', 'today', 'tomorrow'] },
      {
        id: 'statusFilter',
        label: 'Status filter',
        kind: 'select',
        options: [
          option('all', ['all', 'sabhi', 'all visits']),
          option('checked_in', ['checked in', 'waiting', 'aaye hue']),
          option('active', ['scheduled', 'booked', 'active']),
          option('completed', ['completed', 'done', 'dekhe hue']),
          option('cancelled', ['cancelled']),
        ],
      },
    ],
    buttons: [
      { id: 'jump_today', label: 'Go to today', effect: 'ui' },
      { id: 'next_day', label: 'Next day', effect: 'ui' },
      { id: 'prev_day', label: 'Previous day', effect: 'ui' },
      { id: 'new_appointment', label: 'Schedule visit', effect: 'ui' },
    ],
  },

  patients: {
    roles: ['clinician'],
    hints: /\b(?:directory|patient directory|filter tab)\b/i,
    controls: [
      { id: 'query', label: 'Search patient name or email', kind: 'text', aliases: ['name', 'patient', 'naam', 'search', 'find'] },
      {
        id: 'filterTab',
        label: 'Filter tab',
        kind: 'select',
        options: [
          option('all', ['all', 'sabhi', 'all patients']),
          option('upcoming', ['upcoming', 'next', 'aane wale']),
          option('past', ['past', 'previous', 'purane']),
        ],
      },
    ],
    buttons: [
      { id: 'clear_search', label: 'Clear search', effect: 'ui' },
      { id: 'new_patient', label: 'Add new patient', effect: 'ui' },
    ],
  },

  dashboard: {
    roles: ['clinician'],
    hints: /\b(?:dashboard|observations|audio consult)\b/i,
    // The notes box is a page field (read by the page reader), so it can be added to,
    // replaced or edited, always after Confirm.
    controls: [],
    buttons: [
      { id: 'open_notes', label: 'Open notes', effect: 'ui' },
      { id: 'close_notes', label: 'Close notes', effect: 'ui' },
      { id: 'save_notes', label: 'Save notes', effect: 'save', sideEffect: 'Saves consultation notes for this visit.' },
      // Opening the recording window starts a consultation session on the server; recording itself stays the doctor's.
      { id: 'open_audio_consult', label: 'Open audio consult', effect: 'send', sideEffect: 'This will open the consultation recording window. Recording stays manual.', aliases: ['record consultation', 'open recording', 'open audio consult', 'audio consult', 'recording'] },
      // Only returns to the list of today's visits; it does not end the visit.
      { id: 'close_visit', label: 'Back to today\'s visits', effect: 'ui' },
    ],
  },

  checklists: {
    roles: ['clinician'],
    hints: /(?:checklist|question|template|item|sawal)/i,
    controls: [
      { id: 'questionText', label: 'New question label', kind: 'text', aliases: ['question', 'sawal', 'new question'] },
      {
        id: 'questionType',
        label: 'Question response type',
        kind: 'select',
        options: [
          option('yes_no', ['yes or no', 'yes/no', 'yes no', 'haan ya na']),
          option('text', ['written', 'in words', 'text answer']),
        ],
      },
      { id: 'consultationItem', label: 'Consultation checklist item', kind: 'text', aliases: ['consultation item', 'consult item'] },
      { id: 'actionItem', label: 'Action checklist item', kind: 'text', aliases: ['action item', 'action'] },
    ],
    buttons: [
      { id: 'add_question', label: 'Add question', effect: 'save', sideEffect: 'Adds question template to library.' },
      { id: 'add_consultation_item', label: 'Add consultation item', effect: 'save', sideEffect: 'Adds item to consultation template.' },
      { id: 'add_action_item', label: 'Add action item', effect: 'save', sideEffect: 'Adds item to action template.' },
    ],
  },

  checkin: {
    roles: ['patient'],
    hints: /(?:checkin|symptom|check in|questionnaire|symptoms)/i,
    controls: [
      { id: 'symptomsNotes', label: 'Symptoms notes', kind: 'textarea', aliases: ['symptoms', 'notes', 'takleef', 'problem'] },
    ],
    buttons: [
      { id: 'next_step', label: 'Save check-in step', effect: 'save', sideEffect: 'Saves your check-in answers.' },
    ],
  },

  reports: {
    roles: ['patient'],
    hints: /(?:report|reports|upload|share)/i,
    controls: [],
    buttons: [
      { id: 'trigger_upload', label: 'Upload report', effect: 'ui' },
      { id: 'share_all', label: 'Share reports with upcoming appointment', effect: 'send', sideEffect: 'Shares reports with doctor for your next visit.' },
    ],
  },
};

const formFor = (role, pageId) => {
  const form = CONTROLS[pageId];
  return form && form.roles.includes(role) ? form : null;
};

const findControl = (role, pageId, id) => formFor(role, pageId)?.controls.find((c) => c.id === id) || null;
const findButton = (role, pageId, id) => formFor(role, pageId)?.buttons.find((b) => b.id === id) || null;
/** Buttons the model may press (internal ones are only logged by the website). */
const pressableButtons = (pageId) => CONTROLS[pageId].buttons.filter((b) => !b.internal);

/**
 * Pages whose controls go into this request's prompt and schema: the open page,
 * small forms, and forms the message talks about (keeps the prompt short).
 */
function offeredForms(role, onPage, message = '') {
  return Object.keys(CONTROLS).filter((id) => formFor(role, id)
    && (id === onPage || CONTROLS[id].alwaysOffer || CONTROLS[id].hints?.test(message)));
}

module.exports = { CONTROLS, formFor, findControl, findButton, pressableButtons, offeredForms };
