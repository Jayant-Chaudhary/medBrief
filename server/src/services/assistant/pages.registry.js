/**
 * The pages the assistant may open, per role. This list is the only source of
 * routes: the model picks an id, never a URL.
 *
 * Aliases are plain names for each page in English, Hindi and Hinglish. They
 * let common requests skip the model entirely (see intentRules.js). They name
 * pages, not symptoms or conditions, so a health statement never matches.
 */

const PAGES = {
  patient: [
    { id: 'home', path: '/', label: 'Home', description: 'Overview with upcoming appointments', aliases: ['home', 'home page', 'main page', 'homepage', 'होम'] },
    { id: 'reports', path: '/reports', label: 'Lab reports', description: 'Upload, view and share lab reports', aliases: ['report', 'reports', 'lab report', 'lab reports', 'riport', 'riports', 'रिपोर्ट', 'रिपोर्ट्स'] },
    { id: 'summary', path: '/summary', label: 'Visit summary', description: 'Notes, prescriptions and next steps from past visits', aliases: ['summary', 'visit summary', 'visit summaries', 'prescription', 'prescriptions', 'parchi', 'parcha', 'पर्ची'] },
    { id: 'checkin', path: '/checkin/symptoms', label: 'Pre-visit check-in', description: 'Answer the questions before an appointment', aliases: ['check in', 'checkin', 'pre visit', 'previsit', 'questionnaire', 'चेक इन'] },
    { id: 'profile', path: '/profile', label: 'Profile', description: 'Your personal details', aliases: ['profile', 'my details', 'account', 'प्रोफाइल', 'प्रोफ़ाइल'] },
  ],
  clinician: [
    { id: 'dashboard', path: '/clinician', label: 'Dashboard', description: "Today's patients and open visits", aliases: ['dashboard', 'home', 'home page', 'main page', 'डैशबोर्ड'] },
    { id: 'schedule', path: '/clinician/schedule', label: 'Schedule', description: 'Calendar of appointments', aliases: ['schedule', 'calendar', 'appointments', 'todays schedule', 'agenda', 'शेड्यूल'] },
    { id: 'patients', path: '/clinician/patients', label: 'Patients', description: 'List of your patients', aliases: ['patients', 'patient list', 'my patients', 'मरीज'] },
    {
      id: 'new_appointment',
      path: '/clinician/appointments/new',
      label: 'New visit',
      description: 'Book an appointment and invite a patient',
      aliases: [
        'new visit', 'new visits', 'add visit', 'create visit', 'create a visit',
        'schedule visit', 'schedule a visit', 'book visit', 'book a visit',
        'naya visit', 'nayi visit', 'नई विज़िट', 'new visit tab',
        'new appointment', 'book appointment', 'create appointment', 'add appointment',
      ],
    },
    { id: 'maternity', path: '/clinician/maternity', label: 'Maternity card', description: 'Antenatal and delivery record', aliases: ['maternity', 'maternity card', 'antenatal card', 'antenatal record', 'antenatal', 'anc card', 'mcp card'] },
    { id: 'checklists', path: '/clinician/checklists', label: 'Checklists', description: 'Visit checklist templates', aliases: ['checklist', 'checklists', 'check list', 'check lists'] },
    { id: 'medication_templates', path: '/clinician/templates', label: 'Medication templates', description: 'Saved prescription and medicine templates', aliases: ['medication templates', 'medicine templates', 'prescription templates', 'medication template', 'template library', 'dawai templates'] },
    { id: 'profile', path: '/clinician/profile', label: 'Profile', description: 'Your clinician details', aliases: ['profile', 'my profile', 'account', 'प्रोफाइल'] },
  ],
};

function pagesFor(role) {
  return PAGES[role] || [];
}

function findPage(role, id) {
  const pages = pagesFor(role);
  const direct = pages.find((page) => page.id === id);
  if (direct) return direct;
  const norm = String(id || '').trim().toLowerCase().replace(/[_\s-]+/g, ' ');
  return pages.find((page) => {
    const pageIdNorm = String(page.id || '').trim().toLowerCase().replace(/[_\s-]+/g, ' ');
    if (pageIdNorm === norm) return true;
    const pageLabelNorm = String(page.label || '').trim().toLowerCase().replace(/[_\s-]+/g, ' ');
    if (pageLabelNorm === norm) return true;
    if (Array.isArray(page.aliases)) {
      return page.aliases.some((alias) => String(alias || '').trim().toLowerCase().replace(/[_\s-]+/g, ' ') === norm);
    }
    return false;
  }) || null;
}

/** The page id the user is on, from the browser's path (query string ignored), or null. */
function pageAt(role, currentPath) {
  const path = String(currentPath || '').split(/[?#]/)[0].replace(/(.)\/+$/, '$1');
  return pagesFor(role).find((page) => page.path === path)?.id || null;
}

module.exports = { PAGES, pagesFor, findPage, pageAt };
