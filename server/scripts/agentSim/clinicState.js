/**
 * In-memory simulated clinic website state machine for Assistant Phase 6 testing.
 * Accurately models DOM elements and state transitions for MedBrief clinician flows.
 */

class ClinicSimulator {
  constructor({ initialPage = 'visit', initialPatient = 'Asha Example' } = {}) {
    this.patients = [
      { id: 'p-asha', fullName: 'Asha Example', email: 'asha@example.test', nextVisit: 'v-101', lastVisit: 'v-100' },
      { id: 'p-test', fullName: 'Test Person', email: 'test@example.test', nextVisit: null, lastVisit: 'v-200' },
      { id: 'p-bina', fullName: 'Bina Sample', email: 'bina@example.test', nextVisit: 'v-301', lastVisit: null },
    ];
    this.currentPage = initialPage; // 'dashboard' | 'patients' | 'schedule' | 'new_appointment' | 'maternity' | 'visit'
    this.activePatient = this.patients.find((p) => p.fullName === initialPatient) || this.patients[0];
    this.notesOpen = initialPage === 'visit';
    this.notes = '';
    this.medicines = [];
    this.checklist = new Set();
    this.appointment = { scheduledAt: '', patientFullName: '', patientEmail: '' };
    this.maternity = { systolic: '', diastolic: '', weightKg: '' };
    this.templateSearch = '';
    this.templateSelected = null;
    this.visitClosed = false;
  }

  getSnapshot() {
    let elements = [];
    let title = 'MedBrief';
    let headings = [];

    // Common navigation menu
    const menu = [
      { ref: 'nav_dash', kind: 'link', name: 'Dashboard', section: 'Menu' },
      { ref: 'nav_sched', kind: 'link', name: 'Schedule', section: 'Menu' },
      { ref: 'nav_pat', kind: 'link', name: 'Patients', section: 'Menu' },
      { ref: 'nav_new', kind: 'link', name: 'New appointment', section: 'Menu' },
      { ref: 'nav_mat', kind: 'link', name: 'Maternity card', section: 'Menu' },
    ];

    if (this.currentPage === 'dashboard') {
      title = 'Dashboard';
      headings = ["Today's visits", 'Appointments'];
      elements = [
        ...menu,
        { ref: 'btn_open_visit', kind: 'button', name: `Open visit · ${this.activePatient.fullName}`, effect: 'free' },
        { ref: 'btn_new_app', kind: 'button', name: 'Book appointment', effect: 'free' },
      ];
    } else if (this.currentPage === 'patients') {
      title = 'Patients';
      headings = ['Patient directory'];
      elements = [
        ...menu,
        { ref: 'inp_search_patients', kind: 'search', name: 'Search patients', effect: 'free' },
        { ref: 'row_pat_1', kind: 'button', name: '[patient row 1]', section: 'Patients list', patient: 'Asha Example' },
        { ref: 'row_pat_2', kind: 'button', name: '[patient row 2]', section: 'Patients list', patient: 'Test Person' },
        { ref: 'row_pat_3', kind: 'button', name: '[patient row 3]', section: 'Patients list', patient: 'Bina Sample' },
      ];
    } else if (this.currentPage === 'schedule') {
      title = 'Schedule';
      headings = ['Calendar', 'Today'];
      elements = [
        ...menu,
        { ref: 'btn_prev_day', kind: 'button', name: 'Previous day', effect: 'free' },
        { ref: 'btn_next_day', kind: 'button', name: 'Next day', effect: 'free' },
        { ref: 'btn_today', kind: 'button', name: 'Today', effect: 'free' },
      ];
    } else if (this.currentPage === 'new_appointment') {
      title = 'New appointment';
      headings = ['Book appointment & invite'];
      elements = [
        ...menu,
        { ref: 'inp_sched_at', kind: 'datetime', name: 'Date and time', value: this.appointment.scheduledAt, section: 'Booking form' },
        { ref: 'inp_pat_name', kind: 'text', name: 'New patient name', value: this.appointment.patientFullName, section: 'Booking form' },
        { ref: 'inp_pat_email', kind: 'email', name: 'New patient email', value: this.appointment.patientEmail, section: 'Booking form' },
        { ref: 'btn_create_visit', kind: 'button', name: 'Create visit and invite', section: 'Booking form', effect: 'send' },
      ];
    } else if (this.currentPage === 'maternity') {
      title = `Maternity card · ${this.activePatient.fullName}`;
      headings = ['Antenatal records', 'Vitals'];
      elements = [
        ...menu,
        { ref: 'inp_sys', kind: 'number', name: 'Systolic blood pressure', value: this.maternity.systolic, section: 'Vitals' },
        { ref: 'inp_dia', kind: 'number', name: 'Diastolic blood pressure', value: this.maternity.diastolic, section: 'Vitals' },
        { ref: 'inp_wt', kind: 'number', name: 'Weight kg', value: this.maternity.weightKg, section: 'Vitals' },
        { ref: 'btn_save_mat', kind: 'button', name: 'Save vitals', section: 'Vitals', effect: 'save' },
      ];
    } else {
      // Visit page
      title = `Consultation · ${this.activePatient.fullName}`;
      headings = ['Consultation', 'Prescription', 'Checklist'];
      elements = [
        ...menu,
        { ref: 'r_notes_btn', kind: 'button', name: 'Consultation notes', effect: 'free' },
        ...(this.notesOpen
          ? [{ ref: 'r_notes_area', kind: 'textarea', name: 'Consultancy notes', value: this.notes, effect: 'save', section: 'Consultancy Notes' }]
          : []),
        { ref: 'r_add_med', kind: 'button', name: 'Add medicine', effect: 'free', section: 'Prescription' },
        { ref: 'r_tpl_search', kind: 'search', name: 'Search templates', value: this.templateSearch, effect: 'free', section: 'Prescription' },
        ...(this.templateSearch
          ? [{ ref: 'r_tpl_opt', kind: 'button', name: `Best matching template: ${this.templateSearch}`, effect: 'free', section: 'Prescription' }]
          : []),
        { ref: 'r_chk_bp', kind: 'checkbox', name: 'BP check', checked: this.checklist.has('BP check'), effect: 'save', section: 'Action checklist' },
        { ref: 'r_chk_iron', kind: 'checkbox', name: 'Iron advice', checked: this.checklist.has('Iron advice'), effect: 'save', section: 'Action checklist' },
        { ref: 'r_end_visit', kind: 'button', name: 'End visit and share summary', effect: 'send' },
        { ref: 'r_record_mic', kind: 'button', name: 'Record consultation', effect: 'never' },
      ];

      // Add dynamic medicine rows
      this.medicines.forEach((med, idx) => {
        const rowNum = idx + 1;
        const sec = `Prescription · Medicine ${rowNum}`;
        elements.push(
          { ref: `r_med_name_${rowNum}`, kind: 'text', name: 'Name', value: med.name, section: sec, effect: 'free' },
          { ref: `r_med_dose_${rowNum}`, kind: 'text', name: 'Dose', value: med.dose, section: sec, effect: 'free' },
          { ref: `r_med_freq_${rowNum}`, kind: 'text', name: 'Frequency', value: med.frequency, section: sec, effect: 'free' },
          { ref: `r_med_dur_${rowNum}`, kind: 'text', name: 'Duration', value: med.duration, section: sec, effect: 'free' },
          { ref: `r_med_del_${rowNum}`, kind: 'button', name: `Remove item ${rowNum}`, section: sec, effect: 'never' }
        );
      });
    }

    return { title, headings, elements };
  }

  applyAction(action) {
    const { op, ref, find, patient, key } = action;
    const value = action.text !== undefined ? action.text : (action.value || '');

    if (op === 'go') {
      this.currentPage = action.pageId || 'dashboard';
      return { op, ref, result: 'ok' };
    }

    if (op === 'open_record') {
      if (action.kind === 'maternity') this.currentPage = 'maternity';
      else this.currentPage = 'visit';
      return { op, ref, result: 'ok' };
    }

    if (op === 'open_row') {
      const match = this.patients.find((p) => p.fullName.toLowerCase().includes((patient || '').toLowerCase()));
      if (match) {
        this.activePatient = match;
        this.currentPage = 'visit';
        return { op, ref, result: 'ok' };
      }
      return { op, ref, result: 'not_found', reason: 'Patient row not found' };
    }

    if (op === 'click') {
      if (ref === 'r_notes_btn') {
        this.notesOpen = true;
        return { op, ref, result: 'ok' };
      }
      if (ref === 'r_add_med') {
        this.medicines.push({ name: '', dose: '', frequency: '', duration: '' });
        return { op, ref, result: 'ok' };
      }
      if (ref === 'r_tpl_opt') {
        this.medicines.push({ name: 'Amoxicillin', dose: '500 mg', frequency: 'TDS', duration: '5 days' });
        this.templateSelected = this.templateSearch;
        return { op, ref, result: 'ok' };
      }
      if (ref === 'r_end_visit') {
        this.visitClosed = true;
        return { op, ref, result: 'ok' };
      }
      if (ref.startsWith('nav_')) {
        const target = ref.replace('nav_', '');
        if (target === 'dash') this.currentPage = 'dashboard';
        else if (target === 'sched') this.currentPage = 'schedule';
        else if (target === 'pat') this.currentPage = 'patients';
        else if (target === 'new') this.currentPage = 'new_appointment';
        else if (target === 'mat') this.currentPage = 'maternity';
        return { op, ref, result: 'ok' };
      }
      return { op, ref, result: 'ok' };
    }

    if (op === 'type' || op === 'append' || op === 'replace') {
      const textToSet = op === 'append' && this.notes ? `${this.notes}\n${value}` : value;
      if (ref === 'r_notes_area') {
        this.notes = textToSet;
        return { op, ref, result: 'ok' };
      }
      if (ref === 'r_tpl_search') {
        this.templateSearch = value;
        return { op, ref, result: 'ok' };
      }
      if (ref.startsWith('r_med_')) {
        const parts = ref.split('_');
        const field = parts[2];
        const row = parseInt(parts[3], 10) - 1;
        if (this.medicines[row]) {
          this.medicines[row][field] = value;
          return { op, ref, result: 'ok' };
        }
      }
      if (ref === 'inp_sched_at') this.appointment.scheduledAt = value;
      if (ref === 'inp_pat_name') this.appointment.patientFullName = value;
      if (ref === 'inp_pat_email') this.appointment.patientEmail = value;
      return { op, ref, result: 'ok' };
    }

    if (op === 'check') {
      if (ref === 'r_chk_bp') this.checklist.add('BP check');
      if (ref === 'r_chk_iron') this.checklist.add('Iron advice');
      return { op, ref, result: 'ok' };
    }

    if (op === 'key') {
      return { op, ref, result: 'ok' };
    }

    return { op, ref, result: 'refused', reason: 'Unknown op' };
  }
}

module.exports = { ClinicSimulator };
