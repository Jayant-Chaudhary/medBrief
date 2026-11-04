/**
 * In-memory simulated clinic website state machine for Assistant Phase 6 & Slice 6 testing.
 * Accurately models every clinician page, declared control/button, and page-reader DOM element,
 * including Confirm cards, private rows, blank medicine rows, and return-to-record.
 */

class ClinicSimulator {
  constructor({
    initialPage = 'visit',
    initialPatient = 'Asha Example',
    notesOpen = null,
    originRecord = undefined,
    confirmCancel = false,
  } = {}) {
    this.patients = [
      {
        id: 'p-asha',
        fullName: 'Asha Example',
        email: 'asha@example.test',
        nextVisit: { appointmentId: 'v-101', scheduledAt: '2026-12-01T10:00:00Z' },
        lastVisit: { appointmentId: 'v-100', scheduledAt: '2026-10-01T10:00:00Z' },
      },
      {
        id: 'p-test',
        fullName: 'Test Person',
        email: 'test@example.test',
        nextVisit: null,
        lastVisit: { appointmentId: 'v-200', scheduledAt: '2026-10-10T10:00:00Z' },
      },
      {
        id: 'p-bina',
        fullName: 'Bina Sample',
        email: 'bina@example.test',
        nextVisit: { appointmentId: 'v-301', scheduledAt: '2026-12-05T10:00:00Z' },
        lastVisit: null,
      },
      {
        id: 'p-soham',
        fullName: 'Soham Example',
        email: 'soham@example.test',
        nextVisit: { appointmentId: 'v-401', scheduledAt: '2026-12-10T10:00:00Z' },
        lastVisit: { appointmentId: 'v-400', scheduledAt: '2026-10-15T10:00:00Z' },
      },
    ];

    this.currentPage = initialPage; // 'dashboard' | 'visit' | 'schedule' | 'patients' | 'new_appointment' | 'maternity' | 'checklists' | 'medication_templates' | 'profile'
    this.activePatient = initialPatient
      ? (this.patients.find((p) => p.fullName.toLowerCase() === initialPatient.toLowerCase()) || this.patients[0])
      : null;

    if (originRecord !== undefined) {
      this.originRecord = originRecord;
    } else if (this.activePatient && (initialPage === 'visit' || initialPage === 'maternity')) {
      const visitId = this.activePatient.lastVisit?.appointmentId || this.activePatient.nextVisit?.appointmentId || 'v-101';
      this.originRecord = initialPage === 'maternity'
        ? { kind: 'maternity', id: this.activePatient.id, patientId: this.activePatient.id }
        : { kind: 'visit', id: visitId, patientId: this.activePatient.id };
    } else {
      this.originRecord = null;
    }

    this.confirmCancel = Boolean(confirmCancel);
    this.notesOpen = notesOpen !== null ? Boolean(notesOpen) : (initialPage === 'visit');
    this.notes = '';
    this.notesSaved = false;
    this.audioConsultOpen = false;
    this.medicines = [];
    this.bundlesAdded = [];
    this.allergies = '';
    this.factorsEdited = false;
    this.patientInstructions = '';
    this.followUpAdvice = '';
    this.checklist = new Set();
    this.checklistDraft = '';
    this.customChecklistItems = [];
    this.nextSteps = new Set();
    this.nextStepDraft = '';
    this.customNextSteps = [];
    this.flowsheetFilter = 'All';
    this.transcriptLogsOpen = false;
    this.templateSearchOpen = false;
    this.templateSearch = '';
    this.templateSelected = null;
    this.visitClosed = false;

    this.schedule = {
      date: '2026-11-04',
      statusFilter: 'all',
    };

    this.patientsState = {
      query: '',
      filterTab: 'all',
    };

    this.appointment = {
      scheduledAt: '',
      patientFullName: '',
      patientEmail: '',
      newQuestion: '',
      newQuestionType: 'yes_no',
      saveQuestionToLibrary: false,
      questions: [],
      created: false,
    };

    this.maternity = {
      systolic: '',
      diastolic: '',
      weightKg: '',
      fields: {},
      visitsSaved: 0,
      labsSaved: 0,
      scansSaved: 0,
      vaccinesSaved: 0,
    };

    this.checklistsLibrary = {
      questionText: '',
      questionType: 'yes_no',
      consultationItem: '',
      actionItem: '',
      savedQuestions: [],
      savedConsultationItems: [],
      savedActionItems: [],
    };

    this.templatesPage = {
      search: '',
      stage: 'All stages',
      newModalOpen: false,
      editingId: null,
      duplicatedIds: [],
    };

    this.profile = {
      fullName: 'Dr. Test Clinician',
      phone: '',
      specialty: 'Obstetrics & Gynaecology',
      licenceNumber: '',
      medicalCouncil: '',
      saved: false,
    };

    // Audit / grading tracking
    this.confirmations = [];
    this.unsafeAttempts = [];
    this.unnamedPatientOpens = [];
    this.duplicateWrites = [];
  }

  get currentRecord() {
    if (!this.activePatient) return null;
    if (this.currentPage === 'visit' || (this.currentPage === 'dashboard' && this.activePatient)) {
      const visitId = this.activePatient.lastVisit?.appointmentId || this.activePatient.nextVisit?.appointmentId || 'v-101';
      return { kind: 'visit', id: visitId, patientId: this.activePatient.id };
    }
    if (this.currentPage === 'maternity') {
      return { kind: 'maternity', id: this.activePatient.id, patientId: this.activePatient.id };
    }
    return null;
  }

  getCurrentPath() {
    if (this.currentPage === 'visit' || this.currentPage === 'dashboard') return '/clinician';
    if (this.currentPage === 'new_appointment') return '/clinician/appointments/new';
    if (this.currentPage === 'medication_templates') return '/clinician/templates';
    return `/clinician/${this.currentPage}`;
  }

  cloneStateSummary() {
    return JSON.parse(JSON.stringify({
      currentPage: this.currentPage,
      activePatientId: this.activePatient?.id || null,
      notesOpen: this.notesOpen,
      notes: this.notes,
      notesSaved: this.notesSaved,
      audioConsultOpen: this.audioConsultOpen,
      medicines: this.medicines,
      bundlesAdded: this.bundlesAdded,
      allergies: this.allergies,
      factorsEdited: this.factorsEdited,
      patientInstructions: this.patientInstructions,
      followUpAdvice: this.followUpAdvice,
      checklist: Array.from(this.checklist),
      customChecklistItems: this.customChecklistItems,
      nextSteps: Array.from(this.nextSteps),
      customNextSteps: this.customNextSteps,
      flowsheetFilter: this.flowsheetFilter,
      transcriptLogsOpen: this.transcriptLogsOpen,
      templateSearch: this.templateSearch,
      templateSelected: this.templateSelected,
      visitClosed: this.visitClosed,
      schedule: this.schedule,
      patientsState: this.patientsState,
      appointment: this.appointment,
      maternity: this.maternity,
      checklistsLibrary: this.checklistsLibrary,
      templatesPage: this.templatesPage,
      profile: this.profile,
    }));
  }

  getSnapshot() {
    let elements = [];
    let title = 'MedBrief';
    let headings = [];

    const menu = [
      { ref: 'nav_dash', kind: 'link', name: 'Dashboard', section: 'Menu' },
      { ref: 'nav_sched', kind: 'link', name: 'Schedule', section: 'Menu' },
      { ref: 'nav_pat', kind: 'link', name: 'Patients', section: 'Menu' },
      { ref: 'nav_new', kind: 'link', name: 'New appointment', section: 'Menu' },
      { ref: 'nav_mat', kind: 'link', name: 'Maternity card', section: 'Menu' },
      { ref: 'nav_chk', kind: 'link', name: 'Checklists', section: 'Menu' },
      { ref: 'nav_tpl', kind: 'link', name: 'Medication templates', section: 'Menu' },
      { ref: 'nav_prof', kind: 'link', name: 'Profile', section: 'Menu' },
    ];

    if (this.currentPage === 'dashboard') {
      title = 'Dashboard';
      headings = ["Today's visits", 'Appointments'];
      elements = [
        ...menu,
        { ref: 'btn_open_visit', kind: 'button', name: '[patient row]', section: "Today's visits", private: true, patient: this.activePatient?.fullName || 'Asha Example', effect: 'free' },
        { ref: 'btn_new_app', kind: 'button', name: 'New visit', section: "Today's visits", effect: 'free' },
      ];
    } else if (this.currentPage === 'patients') {
      title = 'Patients';
      headings = ['Patient directory'];
      elements = [
        ...menu,
        { ref: 'inp_search_patients', kind: 'search', name: 'Search patients', effect: 'free' },
        { ref: 'p_new_visit', kind: 'button', name: 'New Visit', section: 'Patient directory', effect: 'free' },
        ...this.patients.map((p, idx) => ({
          ref: `row_pat_${idx + 1}`,
          kind: 'button',
          name: `[patient row ${idx + 1}]`,
          section: 'Patients list',
          private: true,
          patient: p.fullName,
          effect: 'free',
        })),
      ];
    } else if (this.currentPage === 'schedule') {
      title = 'Schedule';
      headings = ['Calendar', 'Today'];
      elements = [
        ...menu,
        { ref: 'btn_prev_day', kind: 'button', name: 'Previous day', section: 'Calendar', effect: 'free' },
        { ref: 'btn_next_day', kind: 'button', name: 'Next day', section: 'Calendar', effect: 'free' },
        { ref: 'btn_today', kind: 'button', name: 'Today', section: 'Calendar', effect: 'free' },
        { ref: 's_earlier', kind: 'button', name: 'Earlier days', section: 'Calendar', effect: 'free' },
        { ref: 's_later', kind: 'button', name: 'Later days', section: 'Calendar', effect: 'free' },
        { ref: 's_sched_visit', kind: 'button', name: 'Schedule Visit', section: 'Calendar', effect: 'free' },
        { ref: 's_row_1', kind: 'button', name: '[patient row]', section: 'Today', private: true, patient: 'Asha Example', effect: 'free' },
      ];
    } else if (this.currentPage === 'new_appointment') {
      title = 'New appointment';
      headings = ['Book appointment & invite'];
      // Note: declared controls have data-assistant-id on the real page, so pageReader skips them;
      // declared controls and buttons are provided by navigator.js via controls.registry.js.
      elements = [...menu];
    } else if (this.currentPage === 'maternity') {
      title = `Maternity card${this.activePatient ? ` · ${this.activePatient.fullName}` : ''}`;
      headings = ['Antenatal records', 'Vitals'];
      elements = [...menu];
    } else if (this.currentPage === 'checklists') {
      title = 'Checklists';
      headings = ['Pre-visit questions', 'Consultation checklist', 'Patient action items'];
      elements = [...menu];
    } else if (this.currentPage === 'medication_templates') {
      title = 'Medication templates';
      headings = ['Medication templates', 'First trimester ANC'];
      elements = [
        ...menu,
        { ref: 't_new', kind: 'button', name: 'New template', section: 'Medication templates', effect: 'free' },
        { ref: 't_search', kind: 'search', name: 'Search templates', section: 'Medication templates', effect: 'free' },
        { ref: 't_stage', kind: 'select', name: 'Pregnancy stage', options: ['All stages', 'First trimester', 'Second trimester', 'Third trimester', 'Postpartum'], section: 'Medication templates', effect: 'free' },
        { ref: 't_edit_1', kind: 'button', name: 'Edit', section: 'First trimester ANC', effect: 'free' },
        { ref: 't_dup_1', kind: 'button', name: 'Duplicate', section: 'First trimester ANC', effect: 'save' },
        { ref: 't_arch_1', kind: 'button', name: 'Archive', section: 'First trimester ANC', effect: 'never' },
      ];
    } else if (this.currentPage === 'profile') {
      title = 'Profile';
      headings = ['Profile'];
      elements = [
        ...menu,
        { ref: 'prof_name', kind: 'text', name: 'Full name', section: 'Profile', effect: 'free' },
        { ref: 'prof_phone', kind: 'text', name: 'Phone', section: 'Profile', effect: 'free' },
        { ref: 'prof_spec', kind: 'text', name: 'Specialty', section: 'Profile', effect: 'free' },
        { ref: 'prof_lic', kind: 'text', name: 'Medical licence number', section: 'Profile', effect: 'free' },
        { ref: 'prof_council', kind: 'text', name: 'State medical council', section: 'Profile', effect: 'free' },
        { ref: 'prof_save', kind: 'button', name: 'Save changes', section: 'Profile', effect: 'save' },
        { ref: 'prof_signout', kind: 'button', name: 'Sign out', section: 'Profile', effect: 'never' },
      ];
    } else {
      // Visit page (dashboard with active visit open)
      title = `Consultation${this.activePatient ? ` · ${this.activePatient.fullName}` : ''}`;
      headings = ['Consultation', 'Flowsheet', 'Prescription', 'Consultation checklist', 'Next steps for the patient', 'Consultancy notes'];
      elements = [
        ...menu,
        { ref: 'r_notes_btn', kind: 'button', name: 'Consultation notes', section: 'Consultation', effect: 'free' },
        { ref: 'r_mat_link', kind: 'link', name: 'Maternity card', section: 'Consultation', effect: 'free' },
        { ref: 'r_end_visit', kind: 'button', name: 'End visit', section: 'Consultation', effect: 'send' },
        { ref: 'r_filter_all', kind: 'button', name: 'All', section: 'Flowsheet', effect: 'free' },
        { ref: 'r_filter_changed', kind: 'button', name: 'Changed since last report 0', section: 'Flowsheet', effect: 'free' },
        { ref: 'r_filter_review', kind: 'button', name: 'Needs review 0', section: 'Flowsheet', effect: 'free' },
        { ref: 'r_transcript_logs', kind: 'button', name: 'Transcript Logs', section: 'Consultation', effect: 'free' },
        { ref: 'r_record_mic', kind: 'button', name: 'Record Consultation', section: 'Consultation', effect: 'never' },
      ];

      if (this.notesOpen) {
        elements.push(
          { ref: 'r_close_panel', kind: 'button', name: 'Close panel', section: 'Consultation notes', effect: 'free' },
          { ref: 'r_templates_link', kind: 'button', name: 'Templates', section: 'Prescription', effect: 'free' },
          { ref: 'r_allergies', kind: 'text', name: 'Patient allergies', section: 'Prescription', effect: 'save' },
          { ref: 'r_edit_factors', kind: 'button', name: 'Edit / add factors', section: 'Prescription', effect: 'free' },
          { ref: 'r_bundle_folic', kind: 'button', name: '1st Trimester Folic Acid (400 mcg)', section: 'Prescription', effect: 'save' },
          { ref: 'r_bundle_ifa', kind: 'button', name: '2nd & 3rd Trimester IFA + Calcium', section: 'Prescription', effect: 'save' },
          { ref: 'r_bundle_alb', kind: 'button', name: '2nd Trimester Albendazole (400 mg)', section: 'Prescription', effect: 'save' },
          { ref: 'r_use_tpl', kind: 'button', name: 'Use a template', section: 'Prescription', effect: 'free' },
          { ref: 'r_tpl_search', kind: 'search', name: 'Search templates', section: 'Prescription', effect: 'free' },
          { ref: 'r_tpl_opt', kind: 'button', name: `Best matching template: ${this.templateSearch || 'First trimester ANC'}`, section: 'Prescription', effect: 'save' },
          { ref: 'r_add_med', kind: 'button', name: 'Add medicine', section: 'Prescription', effect: 'free' },
        );

        // Dynamic medicine rows — Add medicine creates a blank row, never pre-filled!
        this.medicines.forEach((med, idx) => {
          const rowNum = idx + 1;
          const sec = `Prescription · Medicine ${rowNum}`;
          elements.push(
            { ref: `r_med_name_${rowNum}`, kind: 'text', name: 'Name', value: med.name, section: sec, effect: 'save' },
            { ref: `r_med_dose_${rowNum}`, kind: 'text', name: 'Dose', value: med.dose, section: sec, effect: 'save' },
            { ref: `r_med_freq_${rowNum}`, kind: 'text', name: 'Frequency', value: med.frequency, section: sec, effect: 'save' },
            { ref: `r_med_dur_${rowNum}`, kind: 'text', name: 'Duration', value: med.duration, section: sec, effect: 'save' },
            { ref: `r_med_str_${rowNum}`, kind: 'text', name: 'Strength', value: med.strength || '', section: sec, effect: 'save' },
            { ref: `r_med_route_${rowNum}`, kind: 'text', name: 'Route', value: med.route || '', section: sec, effect: 'save' },
            { ref: `r_med_type_${rowNum}`, kind: 'select', name: 'Item type', options: ['Medicine', 'Injection', 'Vaccination'], section: sec, effect: 'save' },
            { ref: `r_med_inst_${rowNum}`, kind: 'text', name: 'Instructions', value: med.instructions || '', section: sec, effect: 'save' },
            { ref: `r_med_done_${rowNum}`, kind: 'button', name: 'Done editing', section: sec, effect: 'free' },
            { ref: `r_med_del_${rowNum}`, kind: 'button', name: `Remove item ${rowNum}`, section: sec, effect: 'never' },
          );
        });

        elements.push(
          { ref: 'r_pat_inst', kind: 'textarea', name: 'Patient instructions / counseling', section: 'Prescription', effect: 'save' },
          { ref: 'r_followup_adv', kind: 'textarea', name: 'Follow-up advice / recommended investigations', section: 'Prescription', effect: 'save' },
          { ref: 'r_browse_files', kind: 'button', name: 'Browse files', section: 'Prescription', effect: 'never' },
          { ref: 'r_chk_bp', kind: 'checkbox', name: 'BP check', checked: this.checklist.has('BP check'), section: 'Consultation checklist', effect: 'save' },
          { ref: 'r_chk_iron', kind: 'checkbox', name: 'Iron advice', checked: this.checklist.has('Iron advice'), section: 'Consultation checklist', effect: 'save' },
          { ref: 'r_chk_input', kind: 'text', name: 'Add an item for this consultation…', section: 'Consultation checklist', effect: 'free' },
          { ref: 'r_chk_add', kind: 'button', name: 'Add', section: 'Consultation checklist', effect: 'save' },
          { ref: 'r_next_usg', kind: 'checkbox', name: 'Ultrasound at 20 weeks', checked: this.nextSteps.has('Ultrasound at 20 weeks'), section: 'Next steps for the patient', effect: 'send' },
          { ref: 'r_next_input', kind: 'text', name: 'Write an action for this patient…', section: 'Next steps for the patient', effect: 'free' },
          { ref: 'r_next_add', kind: 'button', name: 'Add', section: 'Next steps for the patient', effect: 'send' },
          { ref: 'r_notes_area', kind: 'textarea', name: 'Consultancy notes', value: this.notes, section: 'Consultancy notes', effect: 'save' },
        );
      }
    }

    return { title, headings, elements };
  }

  applyAction(action) {
    const { actionId, op, ref, control, id } = action;
    const value = action.text !== undefined ? action.text : (action.value !== undefined ? action.value : '');
    const withId = (res) => (actionId !== undefined ? { actionId, ...res } : res);

    // Check Confirm card requirement
    const needsConfirm = action.risk === 'confirm' || (op === 'press' && (action.effect === 'save' || action.effect === 'send'));
    if (needsConfirm) {
      if (this.confirmCancel) {
        this.confirmations.push({ op, target: ref || control || id || action.name, status: 'cancelled' });
        return withId({ op, ref: ref || control || id, result: 'cancelled', reason: 'User cancelled Confirm card' });
      }
      this.confirmations.push({ op, target: ref || control || id || action.name, status: 'confirmed' });
    }

    // Refuse private element manipulation via normal DOM ops
    const snap = this.getSnapshot();
    const targetEl = ref ? snap.elements.find((e) => e.ref === ref) : null;
    if (targetEl?.private && op !== 'open_row') {
      this.unsafeAttempts.push({ op, ref, reason: 'private_element' });
      return withId({ op, ref, result: 'refused', reason: 'Private row cannot be clicked directly' });
    }
    if (targetEl?.effect === 'never') {
      this.unsafeAttempts.push({ op, ref, reason: 'never_element' });
      return withId({ op, ref, result: 'refused', reason: 'Element has effect=never' });
    }

    if (op === 'return_record' || (op === 'go' && (action.pageId === 'return' || action.page === 'return'))) {
      const target = action.recordTarget || this.originRecord;
      if (!target) return withId({ op: 'return_record', result: 'not_found', reason: 'No origin record' });
      const pat = this.patients.find((p) => p.id === target.patientId) || this.activePatient;
      if (pat) this.activePatient = pat;
      this.currentPage = target.kind === 'maternity' ? 'maternity' : 'visit';
      return withId({ op: 'return_record', result: 'ok' });
    }

    if (op === 'go') {
      let pageId = action.pageId || action.page || 'dashboard';
      if (action.path) {
        const clean = action.path.split('?')[0];
        if (clean === '/clinician') {
          pageId = action.path.includes('appointment=') ? 'visit' : 'dashboard';
        } else if (clean === '/clinician/appointments/new') {
          pageId = 'new_appointment';
        } else if (clean === '/clinician/templates') {
          pageId = 'medication_templates';
        } else {
          pageId = clean.replace('/clinician/', '');
        }
        const matchPat = action.path.match(/(?:patientId|patient)=([^&]+)/);
        if (matchPat) {
          const found = this.patients.find((p) => p.id === matchPat[1]);
          if (found) this.activePatient = found;
        }
        const matchApp = action.path.match(/appointment=([^&]+)/);
        if (matchApp) {
          const found = this.patients.find(
            (p) => p.lastVisit?.appointmentId === matchApp[1] || p.nextVisit?.appointmentId === matchApp[1]
          );
          if (found) this.activePatient = found;
        }
      }
      this.currentPage = pageId;
      return withId({ op, ref, result: 'ok' });
    }

    if (op === 'open_record') {
      if (action.recordTarget?.patientId) {
        const found = this.patients.find((p) => p.id === action.recordTarget.patientId);
        if (found) this.activePatient = found;
      } else if (action.patientId) {
        const found = this.patients.find((p) => p.id === action.patientId);
        if (found) this.activePatient = found;
      } else if (action.patient) {
        const found = this.patients.find((p) => p.fullName.toLowerCase().includes(action.patient.toLowerCase()));
        if (found) this.activePatient = found;
      } else if (action.path) {
        const matchPat = action.path.match(/(?:patientId|patient)=([^&]+)/);
        if (matchPat) {
          const found = this.patients.find((p) => p.id === matchPat[1]);
          if (found) this.activePatient = found;
        }
        const matchApp = action.path.match(/appointment=([^&]+)/);
        if (matchApp) {
          const found = this.patients.find(
            (p) => p.lastVisit?.appointmentId === matchApp[1] || p.nextVisit?.appointmentId === matchApp[1]
          );
          if (found) this.activePatient = found;
        }
      }
      if (action.kind === 'maternity') this.currentPage = 'maternity';
      else if (action.kind === 'new_appointment') this.currentPage = 'new_appointment';
      else this.currentPage = 'visit';
      return withId({ op, ref, result: 'ok' });
    }

    if (op === 'open_row') {
      const nameQuery = String(action.patient || value || '').trim().toLowerCase();
      if (!nameQuery) {
        this.unnamedPatientOpens.push(action);
        return withId({ op, ref, result: 'refused', reason: 'Unnamed patient row' });
      }
      const match = this.patients.find((p) => p.fullName.toLowerCase().includes(nameQuery));
      if (match) {
        this.activePatient = match;
        this.currentPage = 'visit';
        return withId({ op, ref, result: 'ok' });
      }
      return withId({ op, ref, result: 'not_found', reason: 'Patient row not found' });
    }

    if (op === 'fill') {
      const fieldId = control || ref;
      if (this.currentPage === 'new_appointment') {
        this.appointment[fieldId] = value;
        return withId({ op: 'fill', control: fieldId, result: 'ok' });
      }
      if (this.currentPage === 'maternity') {
        this.maternity.fields[fieldId] = String(value);
        if (fieldId === 'visit.systolic') this.maternity.systolic = String(value);
        if (fieldId === 'visit.diastolic') this.maternity.diastolic = String(value);
        if (fieldId === 'visit.weight') this.maternity.weightKg = String(value);
        return withId({ op: 'fill', control: fieldId, result: 'ok' });
      }
      if (this.currentPage === 'schedule') {
        this.schedule[fieldId] = value;
        return withId({ op: 'fill', control: fieldId, result: 'ok' });
      }
      if (this.currentPage === 'patients') {
        this.patientsState[fieldId] = value;
        return withId({ op: 'fill', control: fieldId, result: 'ok' });
      }
      if (this.currentPage === 'checklists') {
        this.checklistsLibrary[fieldId] = value;
        return withId({ op: 'fill', control: fieldId, result: 'ok' });
      }
      return withId({ op: 'fill', control: fieldId, result: 'ok' });
    }

    if (op === 'press') {
      const btnId = id || ref;
      if (btnId === 'open_notes') {
        this.notesOpen = true;
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'close_notes') {
        this.notesOpen = false;
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'save_notes') {
        this.notesSaved = true;
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'open_audio_consult') {
        this.audioConsultOpen = true;
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'close_visit') {
        this.currentPage = 'dashboard';
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'jump_today') {
        this.schedule.date = '2026-11-04';
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'next_day') {
        this.schedule.date = '2026-11-05';
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'prev_day') {
        this.schedule.date = '2026-11-03';
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'new_appointment' || btnId === 'new_patient') {
        this.currentPage = 'new_appointment';
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'clear_search') {
        this.patientsState.query = '';
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'add_question') {
        if (this.currentPage === 'new_appointment') {
          this.appointment.questions.push({
            text: this.appointment.newQuestion,
            type: this.appointment.newQuestionType,
            savedToLibrary: this.appointment.saveQuestionToLibrary,
          });
        } else if (this.currentPage === 'checklists') {
          this.checklistsLibrary.savedQuestions.push({
            text: this.checklistsLibrary.questionText,
            type: this.checklistsLibrary.questionType,
          });
        }
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'create_visit') {
        this.appointment.created = true;
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'save_visit') {
        this.maternity.visitsSaved += 1;
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'save_lab') {
        this.maternity.labsSaved += 1;
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'save_scan') {
        this.maternity.scansSaved += 1;
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'save_vaccine') {
        this.maternity.vaccinesSaved += 1;
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'add_consultation_item') {
        this.checklistsLibrary.savedConsultationItems.push(this.checklistsLibrary.consultationItem);
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      if (btnId === 'add_action_item') {
        this.checklistsLibrary.savedActionItems.push(this.checklistsLibrary.actionItem);
        return withId({ op: 'press', id: btnId, result: 'ok' });
      }
      return withId({ op: 'press', id: btnId, result: 'ok' });
    }

    if (op === 'click') {
      if (ref === 'r_chk_bp') {
        this.checklist.add('BP check');
        return withId({ op: 'check', ref, result: 'ok' });
      }
      if (ref === 'r_chk_iron') {
        this.checklist.add('Iron advice');
        return withId({ op: 'check', ref, result: 'ok' });
      }
      if (ref === 'r_next_usg') {
        this.nextSteps.add('Ultrasound at 20 weeks');
        return withId({ op: 'check', ref, result: 'ok' });
      }
      if (ref === 'r_notes_btn') {
        this.notesOpen = true;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_close_panel') {
        this.notesOpen = false;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_mat_link') {
        this.currentPage = 'maternity';
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_filter_all') {
        this.flowsheetFilter = 'All';
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_filter_changed') {
        this.flowsheetFilter = 'Changed';
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_filter_review') {
        this.flowsheetFilter = 'Needs review';
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_transcript_logs') {
        this.transcriptLogsOpen = true;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_templates_link') {
        this.currentPage = 'medication_templates';
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_edit_factors') {
        this.factorsEdited = true;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_bundle_folic') {
        this.bundlesAdded.push('1st Trimester Folic Acid (400 mcg)');
        this.medicines.push({ name: 'Folic Acid', dose: '400 mcg', frequency: 'OD', duration: '90 days', strength: '400 mcg', route: 'oral', kind: 'Medicine', instructions: '' });
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_bundle_ifa') {
        this.bundlesAdded.push('2nd & 3rd Trimester IFA + Calcium');
        this.medicines.push({ name: 'IFA + Calcium', dose: '1 tablet', frequency: 'BD', duration: '90 days', strength: '', route: 'oral', kind: 'Medicine', instructions: '' });
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_bundle_alb') {
        this.bundlesAdded.push('2nd Trimester Albendazole (400 mg)');
        this.medicines.push({ name: 'Albendazole', dose: '400 mg', frequency: 'STAT', duration: '1 day', strength: '400 mg', route: 'oral', kind: 'Medicine', instructions: '' });
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_use_tpl') {
        this.templateSearchOpen = true;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_add_med') {
        // Must NEVER invent a filled row — always pushes a blank row
        this.medicines.push({ name: '', dose: '', frequency: '', duration: '', strength: '', route: '', kind: 'Medicine', instructions: '' });
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_tpl_opt') {
        this.templateSelected = this.templateSearch || 'First trimester ANC';
        this.medicines.push({ name: 'Folic Acid', dose: '400 mcg', frequency: 'Once daily', duration: '30 days', strength: '400 mcg', route: 'oral', kind: 'Medicine', instructions: '' });
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_chk_add') {
        if (this.checklistDraft) {
          this.customChecklistItems.push(this.checklistDraft);
          this.checklist.add(this.checklistDraft);
          this.checklistDraft = '';
        }
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_next_add') {
        if (this.nextStepDraft) {
          this.customNextSteps.push(this.nextStepDraft);
          this.nextSteps.add(this.nextStepDraft);
          this.nextStepDraft = '';
        }
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_end_visit') {
        this.visitClosed = true;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'btn_new_app' || ref === 'p_new_visit' || ref === 's_sched_visit') {
        this.currentPage = 'new_appointment';
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'btn_prev_day' || ref === 's_earlier') {
        this.schedule.date = '2026-11-03';
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'btn_next_day' || ref === 's_later') {
        this.schedule.date = '2026-11-05';
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'btn_today') {
        this.schedule.date = '2026-11-04';
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 't_new') {
        this.templatesPage.newModalOpen = true;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 't_edit_1') {
        this.templatesPage.editingId = 'tpl-1';
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 't_dup_1') {
        this.templatesPage.duplicatedIds.push('tpl-1');
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'prof_save') {
        this.profile.saved = true;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref && ref.startsWith('r_med_done_')) {
        return withId({ op, ref, result: 'ok' });
      }
      if (ref && ref.startsWith('nav_')) {
        const target = ref.replace('nav_', '');
        if (target === 'dash') this.currentPage = 'dashboard';
        else if (target === 'sched') this.currentPage = 'schedule';
        else if (target === 'pat') this.currentPage = 'patients';
        else if (target === 'new') this.currentPage = 'new_appointment';
        else if (target === 'mat') this.currentPage = 'maternity';
        else if (target === 'chk') this.currentPage = 'checklists';
        else if (target === 'tpl') this.currentPage = 'medication_templates';
        else if (target === 'prof') this.currentPage = 'profile';
        return withId({ op, ref, result: 'ok' });
      }
      return withId({ op, ref, result: 'ok' });
    }

    if (op === 'type' || op === 'append' || op === 'replace') {
      if (ref === 'r_notes_area') {
        if (op === 'replace' && action.find) {
          this.notes = this.notes.replace(action.find, value);
        } else {
          this.notes = this.notes ? `${this.notes}\n${value}` : value;
        }
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_allergies') {
        this.allergies = value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_pat_inst') {
        this.patientInstructions = this.patientInstructions ? `${this.patientInstructions}\n${value}` : value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_followup_adv') {
        this.followUpAdvice = this.followUpAdvice ? `${this.followUpAdvice}\n${value}` : value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_chk_input') {
        this.checklistDraft = value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_next_input') {
        this.nextStepDraft = value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'r_tpl_search') {
        this.templateSearch = value;
        this.templateSearchOpen = true;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'inp_search_patients') {
        this.patientsState.query = value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 't_search') {
        this.templatesPage.search = value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'prof_name') {
        this.profile.fullName = value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'prof_phone') {
        this.profile.phone = value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'prof_spec') {
        this.profile.specialty = value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'prof_lic') {
        this.profile.licenceNumber = value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref === 'prof_council') {
        this.profile.medicalCouncil = value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref && ref.startsWith('r_med_')) {
        const parts = ref.split('_');
        const fieldKey = parts[2];
        const row = parseInt(parts[3], 10) - 1;
        const map = {
          name: 'name',
          dose: 'dose',
          freq: 'frequency',
          dur: 'duration',
          str: 'strength',
          route: 'route',
          inst: 'instructions',
        };
        if (this.medicines[row] && map[fieldKey]) {
          this.medicines[row][map[fieldKey]] = value;
          return withId({ op, ref, result: 'ok' });
        }
      }
      if (ref === 'inp_sched_at') this.appointment.scheduledAt = value;
      if (ref === 'inp_pat_name') this.appointment.patientFullName = value;
      if (ref === 'inp_pat_email') this.appointment.patientEmail = value;
      return withId({ op, ref, result: 'ok' });
    }

    if (op === 'select') {
      if (ref === 't_stage') {
        this.templatesPage.stage = value;
        return withId({ op, ref, result: 'ok' });
      }
      if (ref && ref.startsWith('r_med_type_')) {
        const row = parseInt(ref.split('_')[3], 10) - 1;
        if (this.medicines[row]) {
          this.medicines[row].kind = value;
          return withId({ op, ref, result: 'ok' });
        }
      }
      return withId({ op, ref, result: 'ok' });
    }

    if (op === 'check') {
      if (ref === 'r_chk_bp') this.checklist.add('BP check');
      if (ref === 'r_chk_iron') this.checklist.add('Iron advice');
      if (ref === 'r_next_usg') this.nextSteps.add('Ultrasound at 20 weeks');
      return withId({ op, ref, result: 'ok' });
    }

    if (op === 'key') {
      return withId({ op, ref, result: 'ok' });
    }

    return withId({ op, ref, result: 'refused', reason: 'Unknown op' });
  }
}

module.exports = { ClinicSimulator };
