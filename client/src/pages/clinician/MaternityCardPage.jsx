import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Sidebar } from '../../components/layout/Sidebar.jsx';
import { Icon } from '../../components/common/Icon.jsx';
import {
  fetchMyPatients,
  fetchMaternityCard,
  saveMaternityDetails,
  saveMaternityDelivery,
  addMaternityRow,
  updateMaternityRow,
  deleteMaternityRow,
  importMaternityReports,
} from '../../services/clinicianService.js';
import './MaternityCard.css';

const URINE_OPTIONS = ['Negative', 'Trace', '1+', '2+', '3+', '4+', 'Not tested'];
const PRESENTATION_OPTIONS = ['Cephalic', 'Breech', 'Transverse', 'Oblique', 'Not assessed', 'Other'];
const BLOOD_OPTIONS = ['A+', 'A−', 'B+', 'B−', 'AB+', 'AB−', 'O+', 'O−'];
const DELIVERY_TYPES = ['Vaginal', 'Assisted vaginal', 'Caesarean', 'Other'];
const BABY_SEXES = ['Female', 'Male', 'Indeterminate'];

const SECTIONS = [
  { id: 'patient', label: 'Patient', title: '1. Patient details', hint: 'Live on card · Auto-calculates EDD from LMP' },
  { id: 'investigations', label: 'Baseline', title: '2. Baseline investigations', hint: 'First attendance baseline tests & vitals' },
  { id: 'visits', label: 'Visits', title: '3. Antenatal visits', noun: 'visit', hint: 'Add a dated entry at each antenatal visit' },
  { id: 'labs', label: 'Labs', title: '4. Investigations / Labs', noun: 'test result', hint: 'Blood tests, serology & lab investigations' },
  { id: 'scans', label: 'Ultrasound', title: '5. Ultrasound examination', noun: 'scan', hint: 'Ultrasound reports & gestational dating' },
  { id: 'vaccines', label: 'Vaccines', title: '6. Vaccinations & injections', noun: 'vaccination', hint: 'Immunization schedule & pregnancy prophylaxis' },
  { id: 'delivery', label: 'Delivery', title: '7. Delivery & postnatal', hint: 'Delivery outcome & postnatal advice' },
];

const DEFAULT_STATE = {
  version: 1,
  patient: {
    name: '', id: '', age: '', phone: '', attendance: '',
    gravida: '', para: '', living: '', abortions: '',
    lmp: '', edd: '', history: '',
  },
  investigations: {
    blood: '', resultsDate: '', hb: '', tsh: '', chest: '', cvs: '', results: '',
  },
  delivery: {
    type: 'Vaginal', when: '', indication: '', sex: '', weight: '',
    apgar1: '', apgar5: '', next: '', advice: '',
  },
  visits: [],
  labs: [],
  scans: [],
  vaccines: [],
  pending: {},
  updatedAt: '',
};

const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

// What the patient record stores for each part of the card. Name, phone and
// age come from the patient's account, so they are never sent.
const DETAIL_FIELDS = {
  patient: ['attendance', 'lmp', 'edd', 'gravida', 'para', 'living', 'abortions', 'history'],
  investigations: ['blood', 'chest', 'cvs', 'resultsDate', 'hb', 'tsh', 'results'],
};
const DELIVERY_FIELDS = ['type', 'when', 'indication', 'sex', 'weight', 'apgar1', 'apgar5', 'next', 'advice'];
const ROW_FIELDS = {
  visits: ['date', 'weight', 'systolic', 'diastolic', 'weeks', 'days', 'fundal', 'presentation', 'brim', 'fhr', 'albumin', 'sugar', 'hb', 'tsh', 'next', 'clinician', 'advice'],
  labs: ['date', 'test', 'result', 'unit', 'notes'],
  scans: ['date', 'weeks', 'days', 'report'],
  vaccines: ['name', 'dose', 'date', 'next', 'notes'],
};
// Typing pauses this long before details are sent to the record.
const SAVE_DELAY_MS = 600;

const pick = (source, keys) => Object.fromEntries(keys.map((k) => [k, source?.[k] == null ? '' : String(source[k])]));
const timeNow = () => new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

/** The server's first per-field complaint, else its message. */
function saveError(err) {
  const fields = err?.details?.fieldErrors;
  const first = fields && Object.entries(fields).find(([, messages]) => messages?.length);
  return first ? `${first[0]}: ${first[1][0]}` : err?.message || 'Could not save';
}

// Unfinished visit/lab/scan/vaccine entries stay on this device until added.
function readDrafts(key) {
  try {
    const parsed = JSON.parse(localStorage.getItem(`${key}.drafts`) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}
function writeDrafts(key, pending) {
  try {
    localStorage.setItem(`${key}.drafts`, JSON.stringify(pending || {}));
  } catch {
    // Drafts are a convenience; the record itself is on the server.
  }
}

function parseDate(v) {
  if (!v) return null;
  const [y, m, d] = String(v).slice(0, 10).split('-').map(Number);
  return y && m && d ? new Date(Date.UTC(y, m - 1, d)) : null;
}

function fmtDate(v) {
  if (!v) return '';
  const [date, time] = String(v).split('T');
  const parts = date.split('-');
  if (parts.length === 3) {
    return `${parts[2]}/${parts[1]}/${parts[0]}${time ? ' · ' + time.slice(0, 5) : ''}`;
  }
  return v;
}

function addDays(value, days) {
  const d = parseDate(value);
  if (!d) return '';
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function todayISO() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
}

function gestation(lmp, onDate) {
  const from = parseDate(lmp);
  const to = parseDate(onDate || todayISO());
  if (!from || !to) return null;
  const days = Math.round((to - from) / 86400000);
  return days < 0 || days > 310 ? null : { weeks: Math.floor(days / 7), days: days % 7 };
}

const gaText = r => (r && r.weeks ? `${r.weeks}w ${r.days || 0}d` : '');
const bpHigh = r => Number(r.systolic) >= 140 || Number(r.diastolic) >= 90;
const hbLow = v => v !== '' && v != null && Number(v) < 11;
const fhrAbnormal = v => v && (Number(v) < 110 || Number(v) > 160);
const urinePositive = v => ['1+', '2+', '3+', '4+'].includes(v);

export function MaternityCardPage() {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [entryPanelOpen, setEntryPanelOpen] = useState(true);
  const [searchParams, setSearchParams] = useSearchParams();
  const urlPatientId = searchParams.get('patientId') || '';
  const urlPatientName = searchParams.get('patientName') || '';
  const urlPhone = searchParams.get('phone') || '';

  const [patients, setPatients] = useState([]);
  const [activePatientId, setActivePatientId] = useState(urlPatientId);
  const [state, setState] = useState(() => JSON.parse(JSON.stringify(DEFAULT_STATE)));
  const [saveStatus, setSaveStatus] = useState('New card · Local draft');
  const [activeSection, setActiveSection] = useState('patient');
  const [toastMsg, setToastMsg] = useState('');
  // With a patient chosen the card is their stored record; without one it is a
  // draft on this device. Record edits wait for the record to load, so a failed
  // load can never be saved over the real one.
  const [recordState, setRecordState] = useState('none'); // none | loading | ready | error
  const isRecord = Boolean(activePatientId);
  // Whether lab report values can be brought in yet: { status, added } from the server.
  const [labImport, setLabImport] = useState(null);
  const labImportRef = useRef(null);
  labImportRef.current = labImport;

  const saveTimerRef = useRef(null);
  const syncTimersRef = useRef({});
  const activePatientRef = useRef(activePatientId);
  activePatientRef.current = activePatientId;
  const toastTimerRef = useRef(null);
  const panelRef = useRef(null);

  // Close sidebar drawer on Escape key press
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape' && sidebarOpen) {
        setSidebarOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [sidebarOpen]);

  const storageKey = useMemo(() => {
    return `health-on.maternity-card.v1.${activePatientId || 'standalone'}`;
  }, [activePatientId]);

  const showToast = (text) => {
    setToastMsg(text);
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    toastTimerRef.current = setTimeout(() => setToastMsg(''), 3000);
  };

  // Load patient list for selector
  useEffect(() => {
    fetchMyPatients()
      .then(setPatients)
      .catch((err) => console.error('Failed to load clinic patients:', err));
  }, []);

  // Load the card: the patient's record from the server, or the local draft.
  useEffect(() => {
    if (!activePatientId) {
      setRecordState('none');
      setLabImport(null);
      try {
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          setState(prev => ({ ...prev, ...parsed, pending: {} }));
          setSaveStatus('Restored from draft');
        } else {
          const fresh = JSON.parse(JSON.stringify(DEFAULT_STATE));
          if (urlPatientName) {
            fresh.patient.name = urlPatientName;
            fresh.patient.phone = urlPhone;
          }
          setState(fresh);
          setSaveStatus('Draft on this device · choose a patient to save to their record');
        }
      } catch {
        setState(JSON.parse(JSON.stringify(DEFAULT_STATE)));
      }
      return undefined;
    }

    let cancelled = false;
    setRecordState('loading');
    setSaveStatus('Loading record…');
    fetchMaternityCard(activePatientId)
      .then((card) => {
        if (cancelled) return;
        const blank = JSON.parse(JSON.stringify(DEFAULT_STATE));
        setState({
          ...blank,
          patient: { ...blank.patient, ...card.patient },
          investigations: { ...blank.investigations, ...card.investigations },
          delivery: { ...blank.delivery, ...card.delivery },
          visits: card.visits,
          labs: card.labs,
          scans: card.scans,
          vaccines: card.vaccines,
          pending: readDrafts(storageKey),
        });
        setRecordState('ready');
        setLabImport(card.labImport ?? null);
        setSaveStatus(card.episodeId ? 'Loaded from patient record' : 'New record · saves to patient record');
        const added = card.labImport?.added ?? 0;
        if (added > 0) showToast(`Added ${added} value${added === 1 ? '' : 's'} from lab reports`);
      })
      .catch((err) => {
        if (cancelled) return;
        setRecordState('error');
        setSaveStatus('Record not loaded · changes are not saved');
        showToast(err.message || 'Could not load the maternity record');
      });
    return () => {
      cancelled = true;
    };
  }, [storageKey, activePatientId, urlPatientName, urlPhone]);

  // Send edits still waiting on the save delay before switching patient or leaving.
  useEffect(
    () => () => {
      Object.values(syncTimersRef.current).forEach(({ timer, run }) => {
        clearTimeout(timer);
        run();
      });
      syncTimersRef.current = {};
    },
    [activePatientId]
  );

  /** Debounced save of one part of the record (`details` or `delivery`). */
  const scheduleSync = (target, send) => {
    const waiting = syncTimersRef.current[target];
    if (waiting) clearTimeout(waiting.timer);
    const run = () => {
      delete syncTimersRef.current[target];
      send()
        .then(() => setSaveStatus(`Saved to record · ${timeNow()}`))
        .catch((err) => setSaveStatus(`Not saved · ${saveError(err)}`));
    };
    syncTimersRef.current[target] = { run, timer: setTimeout(run, SAVE_DELAY_MS) };
  };

  /**
   * Update the card. A local draft is saved whole to this device; a patient
   * record sends only the part that changed (`sync`), and keeps unfinished
   * entries on this device.
   */
  const persistState = (nextState, sync) => {
    setState(nextState);

    if (!isRecord) {
      setSaveStatus('Saving…');
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        try {
          const toSave = { ...nextState, updatedAt: new Date().toISOString() };
          localStorage.setItem(storageKey, JSON.stringify(toSave));
          setSaveStatus(`Saved on this device · ${timeNow()}`);
        } catch {
          setSaveStatus('Storage warning · print before closing');
        }
      }, 250);
      return;
    }

    writeDrafts(storageKey, nextState.pending);
    if (!sync) return;
    if (recordState !== 'ready') {
      setSaveStatus('Record not loaded · changes are not saved');
      return;
    }

    setSaveStatus('Saving…');
    const patientId = activePatientId;
    if (sync === 'details') {
      const values = {
        ...pick(nextState.patient, DETAIL_FIELDS.patient),
        ...pick(nextState.investigations, DETAIL_FIELDS.investigations),
      };
      scheduleSync('details', async () => {
        const saved = await saveMaternityDetails(patientId, values);
        // The first LMP or EDD dates the pregnancy, so reports can now be matched to it.
        if ((values.lmp || values.edd) && labImportRef.current?.status !== 'imported') {
          checkReports({ quiet: true });
        }
        return saved;
      });
    } else if (sync === 'delivery') {
      const values = pick(nextState.delivery, DELIVERY_FIELDS);
      scheduleSync('delivery', () => saveMaternityDelivery(patientId, values));
    }
  };

  /** Apply a saved change to the record once the server has accepted it. */
  const applyRecordChange = (patientId, change) => {
    // The clinician may have switched patient while the request was in flight.
    if (activePatientRef.current !== patientId) return;
    setState((prev) => {
      const next = change(prev);
      writeDrafts(storageKey, next.pending);
      return next;
    });
  };

  /**
   * Bring in confirmed values from lab reports shared since the card loaded.
   * Each report adds new rows; nothing already on the card changes.
   */
  const checkReports = async ({ quiet = false } = {}) => {
    if (!isRecord) return;
    const patientId = activePatientId;
    try {
      const result = await importMaternityReports(patientId);
      if (activePatientRef.current !== patientId) return;
      setLabImport(result.labImport);
      applyRecordChange(patientId, (prev) => ({ ...prev, labs: result.labs }));
      const { status, added } = result.labImport;
      if (added > 0) showToast(`Added ${added} value${added === 1 ? '' : 's'} from lab reports`);
      else if (!quiet) showToast(status === 'needs_dates' ? 'Add LMP or EDD first' : 'No new lab report values');
    } catch (err) {
      if (!quiet) showToast(err.message || 'Could not check lab reports');
    }
  };

  // Smooth jump to any section
  const jumpToSection = (sectionId, focusFirst = false) => {
    setEntryPanelOpen(true);
    setTimeout(() => {
      const el = document.getElementById(sectionId);
      if (!el) return;
      el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      el.classList.add('highlight-pulse');
      setTimeout(() => el.classList.remove('highlight-pulse'), 1200);
      if (focusFirst) {
        const input = el.querySelector('input:not([type=hidden]), select, textarea');
        input?.focus({ preventScroll: true });
      }
    }, 60);
  };

  // Scroll spy for quick-jump navigation
  useEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    const handleScroll = () => {
      const sections = panel.querySelectorAll('.entry-section');
      const scrollPos = panel.scrollTop + 60;
      let curr = 'patient';
      sections.forEach(sec => {
        if (sec.offsetTop <= scrollPos) {
          curr = sec.id.replace('section-', '');
        }
      });
      setActiveSection(curr);
    };
    panel.addEventListener('scroll', handleScroll, { passive: true });
    return () => panel.removeEventListener('scroll', handleScroll);
  }, []);

  // Update static fields
  const handlePatientChange = (key, value) => {
    const nextPatient = { ...state.patient, [key]: value };
    if (key === 'lmp' && value) {
      const edd = nextPatient.edd;
      const prevLmp = state.patient.lmp;
      if (!edd || edd === addDays(prevLmp, 280)) {
        nextPatient.edd = addDays(value, 280);
      }
    }
    persistState({ ...state, patient: nextPatient }, 'details');
  };

  const handleInvestigationChange = (key, value) => {
    persistState(
      {
        ...state,
        investigations: { ...state.investigations, [key]: value },
      },
      'details'
    );
  };

  const handleDeliveryChange = (key, value) => {
    persistState(
      {
        ...state,
        delivery: { ...state.delivery, [key]: value },
      },
      'delivery'
    );
  };

  // List Items CRUD
  const getPendingDraft = (kind) => {
    return state.pending[kind] || { editId: null, values: {} };
  };

  const setPendingValues = (kind, newValues) => {
    const draft = getPendingDraft(kind);
    // Auto gestation on date change
    if (newValues.date && kind === 'visits' && !draft.values.weeks) {
      const ga = gestation(state.patient.lmp, newValues.date);
      if (ga) {
        newValues.weeks = String(ga.weeks);
        newValues.days = String(ga.days);
      }
    }
    persistState({
      ...state,
      pending: {
        ...state.pending,
        [kind]: { ...draft, values: { ...draft.values, ...newValues } },
      },
    });
  };

  const startEditRow = (kind, row) => {
    persistState({
      ...state,
      pending: {
        ...state.pending,
        [kind]: { editId: row.id, values: { ...row } },
      },
    });
    jumpToSection(`section-${kind}`, true);
  };

  const cancelEditRow = (kind) => {
    const nextPending = { ...state.pending };
    delete nextPending[kind];
    persistState({ ...state, pending: nextPending });
  };

  const deleteRow = async (kind, id) => {
    if (!confirm(`Delete this entry from the card?`)) return;

    if (isRecord) {
      if (recordState !== 'ready') {
        showToast('Record not loaded · nothing was deleted');
        return;
      }
      const patientId = activePatientId;
      try {
        await deleteMaternityRow(patientId, kind, id);
      } catch (err) {
        showToast(err.message || 'Could not delete the entry');
        return;
      }
      applyRecordChange(patientId, (prev) => {
        const pending = { ...prev.pending };
        if (pending[kind]?.editId === id) delete pending[kind];
        return { ...prev, [kind]: prev[kind].filter((r) => r.id !== id), pending };
      });
      setSaveStatus(`Saved to record · ${timeNow()}`);
      showToast('Entry deleted');
      return;
    }

    const nextPending = { ...state.pending };
    if (nextPending[kind]?.editId === id) delete nextPending[kind];
    persistState({
      ...state,
      [kind]: state[kind].filter(r => r.id !== id),
      pending: nextPending,
    });
    showToast('Entry deleted');
  };

  const saveListEntry = async (e, kind) => {
    e.preventDefault();
    const draft = getPendingDraft(kind);
    const editId = draft.editId;

    if (isRecord) {
      if (recordState !== 'ready') {
        showToast('Record not loaded · entry not saved');
        return;
      }
      const patientId = activePatientId;
      const values = pick(draft.values, ROW_FIELDS[kind]);
      setSaveStatus('Saving…');
      try {
        const saved = editId
          ? await updateMaternityRow(patientId, kind, editId, values)
          : await addMaternityRow(patientId, kind, values);
        applyRecordChange(patientId, (prev) => {
          const pending = { ...prev.pending };
          delete pending[kind];
          const list = editId ? prev[kind].map((r) => (r.id === editId ? saved : r)) : [...prev[kind], saved];
          return { ...prev, [kind]: list, pending };
        });
        setSaveStatus(`Saved to record · ${timeNow()}`);
        showToast(editId ? 'Changes saved' : 'New entry added to card');
      } catch (err) {
        setSaveStatus('Entry not saved');
        showToast(saveError(err));
      }
      return;
    }

    const row = { ...draft.values, id: editId || uid() };

    let nextList;
    if (editId) {
      nextList = state[kind].map(item => (item.id === editId ? row : item));
    } else {
      nextList = [...state[kind], row];
    }

    const nextPending = { ...state.pending };
    delete nextPending[kind];

    persistState({
      ...state,
      [kind]: nextList,
      pending: nextPending,
    });
    showToast(editId ? 'Changes saved' : 'New entry added to card');
  };

  // Only the local draft can be blanked; a patient's record is never wiped from here.
  const handleNewCard = () => {
    if (isRecord) return;
    if (!confirm('Start a blank card? This replaces the current card saved on this device.')) return;
    const fresh = JSON.parse(JSON.stringify(DEFAULT_STATE));
    persistState(fresh);
    showToast('Started blank maternity card');
  };

  // Gestation status today
  const gaToday = state.delivery.when
    ? 'Delivered'
    : (ga => (ga ? `${ga.weeks}w ${ga.days}d` : ''))(gestation(state.patient.lmp, todayISO()));

  const obstetricText = [state.patient.gravida, state.patient.para, state.patient.living, state.patient.abortions].some(Boolean)
    ? `G${state.patient.gravida || '–'} P${state.patient.para || '–'} L${state.patient.living || '–'} A${state.patient.abortions || '–'}`
    : '';

  // Sorted and draft-integrated rows for card preview
  const getCardRows = (kind) => {
    const draft = state.pending[kind];
    let rows = state[kind].map(row => (draft?.editId === row.id ? { ...row, ...draft.values, status: 'editing' } : row));
    rows.sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'));
    if (draft && !draft.editId && Object.values(draft.values || {}).some(v => String(v || '').trim())) {
      rows.push({ ...draft.values, id: 'temp-draft', status: 'draft' });
    }
    return rows;
  };

  const cardVisits = getCardRows('visits');
  const cardLabs = getCardRows('labs');
  const cardScans = getCardRows('scans');
  const cardVaccines = getCardRows('vaccines');

  return (
    <div className="flex h-screen overflow-hidden maternity-container" style={{ colorScheme: 'light' }}>
      {/* MedBrief Left Navigation Drawer (closed by default; toggled via the Menu button) */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 flex animate-in fade-in duration-150">
          {/* Backdrop */}
          <div
            className="fixed inset-0 bg-ink/40 backdrop-blur-xs transition-opacity"
            onClick={() => setSidebarOpen(false)}
            aria-hidden="true"
          />
          {/* Sliding sidebar container */}
          <div className="relative z-10 flex h-full shadow-2xl animate-in slide-in-from-left duration-200">
            <Sidebar collapsed={false} onToggle={() => setSidebarOpen(false)} />
          </div>
        </div>
      )}

      {/* Main Container: occupies 100% full screen width for the side-by-side maternity card */}
      <div className="flex min-w-0 flex-1 flex-col overflow-y-auto">
        {/* Top bar */}
        <header className="maternity-topbar no-print">
          <div className="brand">
            {/* MedBrief navigation toggle button */}
            <button
              type="button"
              onClick={() => setSidebarOpen(prev => !prev)}
              className="m-sidebar-btn"
              aria-label={sidebarOpen ? 'Close navigation menu' : 'Open navigation menu'}
              title={sidebarOpen ? 'Close MedBrief Menu' : 'Open MedBrief Menu'}
            >
              <Icon name="panelLeft" size={18} />
              <span>{sidebarOpen ? 'Close' : 'Menu'}</span>
            </button>

            <Link to="/clinician" title="Back to Clinician Dashboard" className="brand-mark">
              +
            </Link>
            <div>
              <div className="eyebrow" style={{ color: '#c2dfd5' }}>MedBrief · Clinical Record</div>
              <h1>Maternity record</h1>
              <p>One patient · complete 9-month pregnancy & postnatal card</p>
            </div>
          </div>

          <div className="maternity-top-actions">
            {/* Patient selector */}
            <div className="patient-select-wrap">
              <label htmlFor="pSelect" className="font-semibold text-white/80">Patient:</label>
              <select
                id="pSelect"
                value={activePatientId}
                onChange={(e) => {
                  const id = e.target.value;
                  setActivePatientId(id);
                  setSearchParams(id ? { patientId: id } : {});
                }}
              >
                <option value="">(No patient · draft on this device)</option>
                {patients.map(p => (
                  <option key={p.id} value={p.id}>
                    {p.fullName || 'Unnamed'} {p.email ? `(${p.email})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <span className="maternity-save-status" role="status">
              {saveStatus}
            </span>

            {/* Toggle Full Page Card View */}
            <button
              type="button"
              onClick={() => setEntryPanelOpen(prev => !prev)}
              className={`m-btn ${!entryPanelOpen ? 'active-full-btn' : ''}`}
              title={entryPanelOpen ? 'Close left form and view full-page card without scrolling' : 'Show left details form'}
              aria-label={entryPanelOpen ? 'Full-page card view' : 'Show details form'}
            >
              <Icon name={entryPanelOpen ? 'maximize' : 'panelLeft'} size={15} />
              <span>{entryPanelOpen ? 'Full card' : 'Show form'}</span>
            </button>

            <button
              type="button"
              onClick={handleNewCard}
              className="m-btn"
              disabled={isRecord}
              title={isRecord ? "A patient's saved record cannot be blanked from here" : 'Start a blank draft'}
            >
              New card
            </button>
            <button type="button" onClick={() => window.print()} className="m-btn primary">
              Print / Save PDF
            </button>
          </div>
        </header>

        {/* 2-Column Single-Tab Workspace (or Full Page View when left panel is closed) */}
        <div className={`maternity-workspace ${!entryPanelOpen ? 'entry-closed' : ''}`}>
          {/* ============================================================ */}
          {/* LEFT: Unified Single-Tab Entry Panel (All 7 Sections)         */}
          {/* ============================================================ */}
          <aside className="maternity-entry no-print" aria-label="Enter clinical details">
            <div className="maternity-entry-head">
              <div className="maternity-entry-head-row">
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', minWidth: 0 }}>
                  <h2>Enter details</h2>
                  <span className="all-in-one-tag">One tab</span>
                </div>
                <button
                  type="button"
                  onClick={() => setEntryPanelOpen(false)}
                  className="entry-collapse-btn"
                  title="Close form and view full card on one page"
                  aria-label="Collapse details form"
                >
                  <span>Full card</span>
                  <Icon name="chevronRight" size={13} />
                </button>
              </div>

              {/* Quick Jump Navigation (Smoothly scrolls within the single tab) */}
              <nav className="quick-nav" aria-label="Quick jump to card sections">
                {SECTIONS.map(sec => {
                  const count = ['visits', 'labs', 'scans', 'vaccines'].includes(sec.id) ? state[sec.id]?.length || 0 : null;
                  return (
                    <button
                      key={sec.id}
                      type="button"
                      data-tone={sec.id}
                      className={`quick-pill ${activeSection === sec.id ? 'is-active' : ''}`}
                      onClick={() => jumpToSection(`section-${sec.id}`, true)}
                    >
                      <span>{sec.label}</span>
                      {count !== null && <span className="count">{count}</span>}
                    </button>
                  );
                })}
              </nav>
            </div>

            <div ref={panelRef} className="maternity-entry-body">
              {/* 1. PATIENT DETAILS */}
              <section id="section-patient" className="entry-section" data-tone="patient">
                <div className="entry-section-head">
                  <h3 className="entry-section-title">1. Patient details</h3>
                </div>
                <div className="entry-section-body">
                  <p className="entry-section-hint">Bio & obstetric history. Updates the card live.</p>
                  <div className="field-grid">
                    <label className="field span-12">
                      <span className="field-label">Patient name</span>
                      <input
                        type="text"
                        value={state.patient.name || ''}
                        onChange={e => handlePatientChange('name', e.target.value)}
                        placeholder="e.g. Sarah Jenkins"
                        readOnly={isRecord}
                        title={isRecord ? "From the patient's account" : undefined}
                      />
                    </label>
                    <label className="field span-6">
                      <span className="field-label">Hospital ID</span>
                      <input
                        type="text"
                        value={state.patient.id || ''}
                        onChange={e => handlePatientChange('id', e.target.value)}
                        placeholder="e.g. MED-8291"
                        readOnly={isRecord}
                        title={isRecord ? "From the patient's account" : undefined}
                      />
                    </label>
                    <label className="field span-6">
                      <span className="field-label">Phone</span>
                      <input
                        type="tel"
                        value={state.patient.phone || ''}
                        onChange={e => handlePatientChange('phone', e.target.value)}
                        placeholder="+91 98765 43210"
                        readOnly={isRecord}
                        title={isRecord ? "From the patient's account" : undefined}
                      />
                    </label>
                    <label className="field span-4">
                      <span className="field-label">Age (years)</span>
                      <input
                        type="number"
                        value={state.patient.age || ''}
                        onChange={e => handlePatientChange('age', e.target.value)}
                        placeholder="28"
                        readOnly={isRecord}
                        title={isRecord ? "From the patient's account (date of birth)" : undefined}
                      />
                    </label>
                    <label className="field span-8">
                      <span className="field-label">First attendance</span>
                      <input
                        type="date"
                        value={state.patient.attendance || ''}
                        onChange={e => handlePatientChange('attendance', e.target.value)}
                      />
                    </label>
                    <label className="field span-3">
                      <span className="field-label">Gravida</span>
                      <input
                        type="number"
                        value={state.patient.gravida || ''}
                        onChange={e => handlePatientChange('gravida', e.target.value)}
                        placeholder="0"
                      />
                    </label>
                    <label className="field span-3">
                      <span className="field-label">Para</span>
                      <input
                        type="number"
                        value={state.patient.para || ''}
                        onChange={e => handlePatientChange('para', e.target.value)}
                        placeholder="0"
                      />
                    </label>
                    <label className="field span-3">
                      <span className="field-label">Living</span>
                      <input
                        type="number"
                        value={state.patient.living || ''}
                        onChange={e => handlePatientChange('living', e.target.value)}
                        placeholder="0"
                      />
                    </label>
                    <label className="field span-3">
                      <span className="field-label">Abortions</span>
                      <input
                        type="number"
                        value={state.patient.abortions || ''}
                        onChange={e => handlePatientChange('abortions', e.target.value)}
                        placeholder="0"
                      />
                    </label>
                    <label className="field span-6">
                      <span className="field-label">LMP</span>
                      <input
                        type="date"
                        value={state.patient.lmp || ''}
                        onChange={e => handlePatientChange('lmp', e.target.value)}
                      />
                    </label>
                    <label className="field span-6">
                      <span className="field-label">EDD</span>
                      <input
                        type="date"
                        value={state.patient.edd || ''}
                        onChange={e => handlePatientChange('edd', e.target.value)}
                      />
                      <span className="field-hint">Auto: LMP + 280 days</span>
                    </label>
                    <label className="field span-12">
                      <span className="field-label">Relevant history / allergies</span>
                      <textarea
                        rows={2}
                        value={state.patient.history || ''}
                        onChange={e => handlePatientChange('history', e.target.value)}
                        placeholder="e.g. Hypothyroidism, Penicillin allergy"
                      />
                    </label>
                  </div>
                  <div className="live-note">Shown live on the card</div>
                </div>
              </section>

              {/* 2. BASELINE INVESTIGATIONS */}
              <section id="section-investigations" className="entry-section" data-tone="investigations">
                <div className="entry-section-head">
                  <h3 className="entry-section-title">2. Baseline investigations</h3>
                </div>
                <div className="entry-section-body">
                  <p className="entry-section-hint">First attendance vitals & baseline labs.</p>
                  <div className="field-grid">
                    <label className="field span-6">
                      <span className="field-label">Blood group</span>
                      <select
                        value={state.investigations.blood || ''}
                        onChange={e => handleInvestigationChange('blood', e.target.value)}
                      >
                        <option value="">Select…</option>
                        {BLOOD_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </label>
                    <label className="field span-6">
                      <span className="field-label">Date tested</span>
                      <input
                        type="date"
                        value={state.investigations.resultsDate || ''}
                        onChange={e => handleInvestigationChange('resultsDate', e.target.value)}
                      />
                    </label>
                    <label className="field span-6">
                      <span className="field-label">Hb (g/dL)</span>
                      <input
                        type="number"
                        step="0.1"
                        value={state.investigations.hb || ''}
                        onChange={e => handleInvestigationChange('hb', e.target.value)}
                        placeholder="e.g. 11.5"
                      />
                    </label>
                    <label className="field span-6">
                      <span className="field-label">TSH (mIU/L)</span>
                      <input
                        type="number"
                        step="0.01"
                        value={state.investigations.tsh || ''}
                        onChange={e => handleInvestigationChange('tsh', e.target.value)}
                        placeholder="e.g. 2.10"
                      />
                    </label>
                    <label className="field span-6">
                      <span className="field-label">Chest</span>
                      <input
                        type="text"
                        value={state.investigations.chest || ''}
                        onChange={e => handleInvestigationChange('chest', e.target.value)}
                        placeholder="Clear / Normal"
                      />
                    </label>
                    <label className="field span-6">
                      <span className="field-label">CVS</span>
                      <input
                        type="text"
                        value={state.investigations.cvs || ''}
                        onChange={e => handleInvestigationChange('cvs', e.target.value)}
                        placeholder="S1 S2 heard"
                      />
                    </label>
                    <label className="field span-12">
                      <span className="field-label">Other baseline results</span>
                      <textarea
                        rows={2}
                        value={state.investigations.results || ''}
                        onChange={e => handleInvestigationChange('results', e.target.value)}
                        placeholder="HIV negative, VDRL non-reactive, etc."
                      />
                    </label>
                  </div>
                  <div className="live-note">Shown live on the card</div>
                </div>
              </section>

              {/* 3. ANTENATAL VISITS */}
              <section id="section-visits" className="entry-section" data-tone="visits">
                <div className="entry-section-head">
                  <h3 className="entry-section-title">
                    3. Antenatal visits
                    <span className="entry-section-count">{state.visits.length}</span>
                  </h3>
                  <button
                    type="button"
                    className="entry-section-action"
                    onClick={() => cancelEditRow('visits')}
                  >
                    + Add visit
                  </button>
                </div>

                <div className="entry-section-body">
                  {/* Saved visits summary list */}
                  {state.visits.length > 0 && (
                    <div className="saved-list">
                      <div className="saved-list-heading">Recorded visits ({state.visits.length})</div>
                      {[...state.visits]
                        .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999'))
                        .map(row => {
                          const isEd = state.pending.visits?.editId === row.id;
                          return (
                            <div key={row.id} className={`saved-row ${isEd ? 'is-editing' : ''}`}>
                              <span className="saved-row-text">
                                <strong>{fmtDate(row.date)}</strong>
                                {row.weeks ? ` · ${row.weeks}w ${row.days || 0}d` : ''}
                                {row.weight ? ` · ${row.weight}kg` : ''}
                                {(row.systolic || row.diastolic) ? ` · BP ${row.systolic || '–'}/${row.diastolic || '–'}` : ''}
                              </span>
                              <div className="saved-row-actions">
                                {isEd ? (
                                  <span className="tag">Editing</span>
                                ) : (
                                  <button type="button" className="saved-row-btn" onClick={() => startEditRow('visits', row)}>
                                    Edit
                                  </button>
                                )}
                                <button type="button" className="saved-row-btn danger" onClick={() => deleteRow('visits', row.id)}>
                                  ×
                                </button>
                              </div>
                            </div>
                          );
                        })}
                    </div>
                  )}

                  {/* Visit Form */}
                  {(() => {
                    const draft = getPendingDraft('visits');
                    const isEditing = Boolean(draft.editId);
                    const v = draft.values || {};
                    return (
                      <form onSubmit={e => saveListEntry(e, 'visits')}>
                        <div className="panel-title">{isEditing ? 'Edit visit' : '+ Add new visit'}</div>
                        <div className="panel-hint">
                          {isEditing ? 'Editing selected visit row. Updates live on card.' : 'Enter visit details below. Card updates live.'}
                        </div>
                        <div className="field-grid">
                          <label className="field span-6">
                            <span className="field-label">Visit date <span className="req">*</span></span>
                            <input
                              type="date"
                              required
                              value={v.date || ''}
                              onChange={e => setPendingValues('visits', { date: e.target.value })}
                            />
                          </label>
                          <label className="field span-3">
                            <span className="field-label">GA weeks</span>
                            <input
                              type="number"
                              value={v.weeks || ''}
                              onChange={e => setPendingValues('visits', { weeks: e.target.value })}
                              placeholder="14"
                            />
                          </label>
                          <label className="field span-3">
                            <span className="field-label">+ days</span>
                            <input
                              type="number"
                              value={v.days || ''}
                              onChange={e => setPendingValues('visits', { days: e.target.value })}
                              placeholder="2"
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Weight (kg)</span>
                            <input
                              type="number"
                              step="0.1"
                              value={v.weight || ''}
                              onChange={e => setPendingValues('visits', { weight: e.target.value })}
                              placeholder="58.5"
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Fundal height (cm)</span>
                            <input
                              type="number"
                              step="0.1"
                              value={v.fundal || ''}
                              onChange={e => setPendingValues('visits', { fundal: e.target.value })}
                              placeholder="16"
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">BP systolic (mmHg)</span>
                            <input
                              type="number"
                              value={v.systolic || ''}
                              onChange={e => setPendingValues('visits', { systolic: e.target.value })}
                              placeholder="120"
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">BP diastolic (mmHg)</span>
                            <input
                              type="number"
                              value={v.diastolic || ''}
                              onChange={e => setPendingValues('visits', { diastolic: e.target.value })}
                              placeholder="80"
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Presentation</span>
                            <select
                              value={v.presentation || ''}
                              onChange={e => setPendingValues('visits', { presentation: e.target.value })}
                            >
                              <option value="">Select…</option>
                              {PRESENTATION_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Relation to brim</span>
                            <input
                              type="text"
                              value={v.brim || ''}
                              onChange={e => setPendingValues('visits', { brim: e.target.value })}
                              placeholder="3/5 palpable"
                            />
                          </label>
                          <label className="field span-4">
                            <span className="field-label">FHR (bpm)</span>
                            <input
                              type="number"
                              value={v.fhr || ''}
                              onChange={e => setPendingValues('visits', { fhr: e.target.value })}
                              placeholder="140"
                            />
                          </label>
                          <label className="field span-4">
                            <span className="field-label">Urine albumin</span>
                            <select
                              value={v.albumin || ''}
                              onChange={e => setPendingValues('visits', { albumin: e.target.value })}
                            >
                              <option value="">Select…</option>
                              {URINE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          </label>
                          <label className="field span-4">
                            <span className="field-label">Urine sugar</span>
                            <select
                              value={v.sugar || ''}
                              onChange={e => setPendingValues('visits', { sugar: e.target.value })}
                            >
                              <option value="">Select…</option>
                              {URINE_OPTIONS.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                            </select>
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Hb (g/dL)</span>
                            <input
                              type="number"
                              step="0.1"
                              value={v.hb || ''}
                              onChange={e => setPendingValues('visits', { hb: e.target.value })}
                              placeholder="11.2"
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">TSH (mIU/L)</span>
                            <input
                              type="number"
                              step="0.01"
                              value={v.tsh || ''}
                              onChange={e => setPendingValues('visits', { tsh: e.target.value })}
                              placeholder="2.0"
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Next visit</span>
                            <input
                              type="date"
                              value={v.next || ''}
                              onChange={e => setPendingValues('visits', { next: e.target.value })}
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Clinician</span>
                            <input
                              type="text"
                              value={v.clinician || ''}
                              onChange={e => setPendingValues('visits', { clinician: e.target.value })}
                              placeholder="Dr. Name"
                            />
                          </label>
                          <label className="field span-12">
                            <span className="field-label">Advice / notes</span>
                            <textarea
                              rows={2}
                              value={v.advice || ''}
                              onChange={e => setPendingValues('visits', { advice: e.target.value })}
                              placeholder="Prescribed calcium & iron, normal movements"
                            />
                          </label>
                        </div>
                        <div className="form-actions">
                          {isEditing && (
                            <button
                              type="button"
                              className="saved-row-btn danger"
                              onClick={() => deleteRow('visits', draft.editId)}
                            >
                              Delete
                            </button>
                          )}
                          <div className="spacer" />
                          <button
                            type="button"
                            className="saved-row-btn"
                            onClick={() => cancelEditRow('visits')}
                          >
                            {isEditing ? 'Cancel' : 'Clear'}
                          </button>
                          <button type="submit" className="m-btn primary" style={{ color: '#15463d' }}>
                            {isEditing ? 'Save changes' : '+ Add visit'}
                          </button>
                        </div>
                      </form>
                    );
                  })()}
                </div>
              </section>

              {/* 4. INVESTIGATIONS / LABS */}
              <section id="section-labs" className="entry-section" data-tone="labs">
                <div className="entry-section-head">
                  <h3 className="entry-section-title">
                    4. Investigations / Labs
                    <span className="entry-section-count">{state.labs.length}</span>
                  </h3>
                  <button type="button" className="entry-section-action" onClick={() => cancelEditRow('labs')}>
                    + Add lab
                  </button>
                </div>
                <div className="entry-section-body">
                  {isRecord && (
                    <div className={`report-import ${labImport?.status === 'imported' ? '' : 'needs-dates'}`}>
                      <span>
                        {labImport?.status !== 'imported'
                          ? 'Add LMP or EDD in section 1 to bring in values from lab reports.'
                          : 'Confirmed values from shared lab reports are added here as new entries, dated by the report.'}
                      </span>
                      <button
                        type="button"
                        className="saved-row-btn"
                        onClick={() => checkReports()}
                        disabled={recordState !== 'ready'}
                      >
                        Check reports
                      </button>
                    </div>
                  )}
                  {state.labs.length > 0 && (
                    <div className="saved-list">
                      <div className="saved-list-heading">Recorded lab tests ({state.labs.length})</div>
                      {state.labs.map(row => {
                        const isEd = state.pending.labs?.editId === row.id;
                        return (
                          <div key={row.id} className={`saved-row ${isEd ? 'is-editing' : ''}`}>
                            <span className="saved-row-text">
                              {row.fromReport && <span className="tag from-report" title={row.notes}>Report</span>}
                              <strong>{row.test || 'Test'}</strong>: {[row.result, row.unit].filter(Boolean).join(' ')} ({fmtDate(row.date)})
                            </span>
                            <div className="saved-row-actions">
                              {isEd ? (
                                <span className="tag">Editing</span>
                              ) : (
                                <button type="button" className="saved-row-btn" onClick={() => startEditRow('labs', row)}>
                                  Edit
                                </button>
                              )}
                              <button type="button" className="saved-row-btn danger" onClick={() => deleteRow('labs', row.id)}>
                                ×
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {(() => {
                    const draft = getPendingDraft('labs');
                    const isEditing = Boolean(draft.editId);
                    const v = draft.values || {};
                    return (
                      <form onSubmit={e => saveListEntry(e, 'labs')}>
                        <div className="panel-title">{isEditing ? 'Edit lab result' : '+ Add lab result'}</div>
                        <div className="panel-hint">Blood tests, serology & urinalysis. Card updates live.</div>
                        <div className="field-grid">
                          <label className="field span-6">
                            <span className="field-label">Date tested <span className="req">*</span></span>
                            <input
                              type="date"
                              required
                              value={v.date || ''}
                              onChange={e => setPendingValues('labs', { date: e.target.value })}
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Investigation <span className="req">*</span></span>
                            <input
                              type="text"
                              required
                              list="testOptions"
                              value={v.test || ''}
                              onChange={e => setPendingValues('labs', { test: e.target.value })}
                              placeholder="e.g. OGTT, Hb, Platelets"
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Result <span className="req">*</span></span>
                            <input
                              type="text"
                              required
                              value={v.result || ''}
                              onChange={e => setPendingValues('labs', { result: e.target.value })}
                              placeholder="e.g. 125, Negative"
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Unit</span>
                            <input
                              type="text"
                              value={v.unit || ''}
                              onChange={e => setPendingValues('labs', { unit: e.target.value })}
                              placeholder="mg/dL"
                            />
                          </label>
                          <label className="field span-12">
                            <span className="field-label">Notes / reference range</span>
                            <textarea
                              rows={2}
                              value={v.notes || ''}
                              onChange={e => setPendingValues('labs', { notes: e.target.value })}
                              placeholder="Fasting 92, 2h 130 normal"
                            />
                          </label>
                        </div>
                        <div className="form-actions">
                          {isEditing && (
                            <button
                              type="button"
                              className="saved-row-btn danger"
                              onClick={() => deleteRow('labs', draft.editId)}
                            >
                              Delete
                            </button>
                          )}
                          <div className="spacer" />
                          <button type="button" className="saved-row-btn" onClick={() => cancelEditRow('labs')}>
                            {isEditing ? 'Cancel' : 'Clear'}
                          </button>
                          <button type="submit" className="m-btn primary" style={{ color: '#15463d' }}>
                            {isEditing ? 'Save changes' : '+ Add result'}
                          </button>
                        </div>
                      </form>
                    );
                  })()}
                </div>
              </section>

              {/* 5. ULTRASOUND SCANS */}
              <section id="section-scans" className="entry-section" data-tone="scans">
                <div className="entry-section-head">
                  <h3 className="entry-section-title">
                    5. Ultrasound examination
                    <span className="entry-section-count">{state.scans.length}</span>
                  </h3>
                  <button type="button" className="entry-section-action" onClick={() => cancelEditRow('scans')}>
                    + Add scan
                  </button>
                </div>
                <div className="entry-section-body">
                  {state.scans.length > 0 && (
                    <div className="saved-list">
                      <div className="saved-list-heading">Recorded scans ({state.scans.length})</div>
                      {state.scans.map(row => {
                        const isEd = state.pending.scans?.editId === row.id;
                        return (
                          <div key={row.id} className={`saved-row ${isEd ? 'is-editing' : ''}`}>
                            <span className="saved-row-text">
                              <strong>{fmtDate(row.date)}</strong>
                              {row.weeks ? ` (${row.weeks}w ${row.days || 0}d)` : ''} · {row.report}
                            </span>
                            <div className="saved-row-actions">
                              {isEd ? (
                                <span className="tag">Editing</span>
                              ) : (
                                <button type="button" className="saved-row-btn" onClick={() => startEditRow('scans', row)}>
                                  Edit
                                </button>
                              )}
                              <button type="button" className="saved-row-btn danger" onClick={() => deleteRow('scans', row.id)}>
                                ×
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {(() => {
                    const draft = getPendingDraft('scans');
                    const isEditing = Boolean(draft.editId);
                    const v = draft.values || {};
                    return (
                      <form onSubmit={e => saveListEntry(e, 'scans')}>
                        <div className="panel-title">{isEditing ? 'Edit scan report' : '+ Add scan report'}</div>
                        <div className="panel-hint">Ultrasound dating, anomaly, & growth scans.</div>
                        <div className="field-grid">
                          <label className="field span-6">
                            <span className="field-label">Scan date <span className="req">*</span></span>
                            <input
                              type="date"
                              required
                              value={v.date || ''}
                              onChange={e => setPendingValues('scans', { date: e.target.value })}
                            />
                          </label>
                          <label className="field span-3">
                            <span className="field-label">GA weeks</span>
                            <input
                              type="number"
                              value={v.weeks || ''}
                              onChange={e => setPendingValues('scans', { weeks: e.target.value })}
                              placeholder="18"
                            />
                          </label>
                          <label className="field span-3">
                            <span className="field-label">+ days</span>
                            <input
                              type="number"
                              value={v.days || ''}
                              onChange={e => setPendingValues('scans', { days: e.target.value })}
                              placeholder="4"
                            />
                          </label>
                          <label className="field span-12">
                            <span className="field-label">Report / findings <span className="req">*</span></span>
                            <textarea
                              rows={3}
                              required
                              value={v.report || ''}
                              onChange={e => setPendingValues('scans', { report: e.target.value })}
                              placeholder="Single live intrauterine gestation, normal liquor, anterior placenta."
                            />
                          </label>
                        </div>
                        <div className="form-actions">
                          {isEditing && (
                            <button
                              type="button"
                              className="saved-row-btn danger"
                              onClick={() => deleteRow('scans', draft.editId)}
                            >
                              Delete
                            </button>
                          )}
                          <div className="spacer" />
                          <button type="button" className="saved-row-btn" onClick={() => cancelEditRow('scans')}>
                            {isEditing ? 'Cancel' : 'Clear'}
                          </button>
                          <button type="submit" className="m-btn primary" style={{ color: '#15463d' }}>
                            {isEditing ? 'Save changes' : '+ Add scan'}
                          </button>
                        </div>
                      </form>
                    );
                  })()}
                </div>
              </section>

              {/* 6. VACCINATIONS & INJECTIONS */}
              <section id="section-vaccines" className="entry-section" data-tone="vaccines">
                <div className="entry-section-head">
                  <h3 className="entry-section-title">
                    6. Vaccinations & injections
                    <span className="entry-section-count">{state.vaccines.length}</span>
                  </h3>
                  <button type="button" className="entry-section-action" onClick={() => cancelEditRow('vaccines')}>
                    + Add vaccine
                  </button>
                </div>
                <div className="entry-section-body">
                  {state.vaccines.length > 0 && (
                    <div className="saved-list">
                      <div className="saved-list-heading">Recorded vaccines ({state.vaccines.length})</div>
                      {state.vaccines.map(row => {
                        const isEd = state.pending.vaccines?.editId === row.id;
                        return (
                          <div key={row.id} className={`saved-row ${isEd ? 'is-editing' : ''}`}>
                            <span className="saved-row-text">
                              <strong>{row.name || 'Vaccine'}</strong> ({fmtDate(row.date)}) {row.dose ? `· ${row.dose}` : ''}
                            </span>
                            <div className="saved-row-actions">
                              {isEd ? (
                                <span className="tag">Editing</span>
                              ) : (
                                <button type="button" className="saved-row-btn" onClick={() => startEditRow('vaccines', row)}>
                                  Edit
                                </button>
                              )}
                              <button type="button" className="saved-row-btn danger" onClick={() => deleteRow('vaccines', row.id)}>
                                ×
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {(() => {
                    const draft = getPendingDraft('vaccines');
                    const isEditing = Boolean(draft.editId);
                    const v = draft.values || {};
                    return (
                      <form onSubmit={e => saveListEntry(e, 'vaccines')}>
                        <div className="panel-title">{isEditing ? 'Edit vaccination' : '+ Add vaccination'}</div>
                        <div className="panel-hint">Immunization schedule & pregnancy prophylaxis.</div>
                        <div className="field-grid">
                          <label className="field span-12">
                            <span className="field-label">Vaccine / injection <span className="req">*</span></span>
                            <input
                              type="text"
                              required
                              list="vaccineOptions"
                              value={v.name || ''}
                              onChange={e => setPendingValues('vaccines', { name: e.target.value })}
                              placeholder="e.g. Td, Tdap, Anti-D"
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Dose / details</span>
                            <input
                              type="text"
                              value={v.dose || ''}
                              onChange={e => setPendingValues('vaccines', { dose: e.target.value })}
                              placeholder="0.5 mL IM, Dose 1"
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Date given <span className="req">*</span></span>
                            <input
                              type="date"
                              required
                              value={v.date || ''}
                              onChange={e => setPendingValues('vaccines', { date: e.target.value })}
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Next dose</span>
                            <input
                              type="date"
                              value={v.next || ''}
                              onChange={e => setPendingValues('vaccines', { next: e.target.value })}
                            />
                          </label>
                          <label className="field span-6">
                            <span className="field-label">Notes</span>
                            <input
                              type="text"
                              value={v.notes || ''}
                              onChange={e => setPendingValues('vaccines', { notes: e.target.value })}
                              placeholder="Left deltoid"
                            />
                          </label>
                        </div>
                        <div className="form-actions">
                          {isEditing && (
                            <button
                              type="button"
                              className="saved-row-btn danger"
                              onClick={() => deleteRow('vaccines', draft.editId)}
                            >
                              Delete
                            </button>
                          )}
                          <div className="spacer" />
                          <button type="button" className="saved-row-btn" onClick={() => cancelEditRow('vaccines')}>
                            {isEditing ? 'Cancel' : 'Clear'}
                          </button>
                          <button type="submit" className="m-btn primary" style={{ color: '#15463d' }}>
                            {isEditing ? 'Save changes' : '+ Add vaccination'}
                          </button>
                        </div>
                      </form>
                    );
                  })()}
                </div>
              </section>

              {/* 7. DELIVERY & POSTNATAL */}
              <section id="section-delivery" className="entry-section" data-tone="delivery">
                <div className="entry-section-head">
                  <h3 className="entry-section-title">7. Delivery & postnatal</h3>
                </div>
                <div className="entry-section-body">
                  <p className="entry-section-hint">Birth outcome, baby metrics & postnatal checkup.</p>
                  <div className="field-grid">
                    <label className="field span-6">
                      <span className="field-label">Type of delivery</span>
                      <select
                        value={state.delivery.type || ''}
                        onChange={e => handleDeliveryChange('type', e.target.value)}
                      >
                        {DELIVERY_TYPES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </label>
                    <label className="field span-6">
                      <span className="field-label">Date & time</span>
                      <input
                        type="datetime-local"
                        value={state.delivery.when || ''}
                        onChange={e => handleDeliveryChange('when', e.target.value)}
                      />
                    </label>
                    <label className="field span-12">
                      <span className="field-label">Indication</span>
                      <input
                        type="text"
                        value={state.delivery.indication || ''}
                        onChange={e => handleDeliveryChange('indication', e.target.value)}
                        placeholder="e.g. Spontaneous vaginal / Foetal distress"
                      />
                    </label>
                    <label className="field span-6">
                      <span className="field-label">Sex of baby</span>
                      <select
                        value={state.delivery.sex || ''}
                        onChange={e => handleDeliveryChange('sex', e.target.value)}
                      >
                        <option value="">Select…</option>
                        {BABY_SEXES.map(opt => <option key={opt} value={opt}>{opt}</option>)}
                      </select>
                    </label>
                    <label className="field span-6">
                      <span className="field-label">Birth weight (kg)</span>
                      <input
                        type="number"
                        step="0.001"
                        value={state.delivery.weight || ''}
                        onChange={e => handleDeliveryChange('weight', e.target.value)}
                        placeholder="3.250"
                      />
                    </label>
                    <label className="field span-4">
                      <span className="field-label">APGAR · 1 min</span>
                      <input
                        type="number"
                        max="10"
                        value={state.delivery.apgar1 || ''}
                        onChange={e => handleDeliveryChange('apgar1', e.target.value)}
                        placeholder="8"
                      />
                    </label>
                    <label className="field span-4">
                      <span className="field-label">APGAR · 5 min</span>
                      <input
                        type="number"
                        max="10"
                        value={state.delivery.apgar5 || ''}
                        onChange={e => handleDeliveryChange('apgar5', e.target.value)}
                        placeholder="9"
                      />
                    </label>
                    <label className="field span-4">
                      <span className="field-label">Next postnatal</span>
                      <input
                        type="date"
                        value={state.delivery.next || ''}
                        onChange={e => handleDeliveryChange('next', e.target.value)}
                      />
                    </label>
                    <label className="field span-12">
                      <span className="field-label">Postnatal advice / notes</span>
                      <textarea
                        rows={2}
                        value={state.delivery.advice || ''}
                        onChange={e => handleDeliveryChange('advice', e.target.value)}
                        placeholder="Exclusive breastfeeding, immunize at 6 weeks, follow up in 2 weeks"
                      />
                    </label>
                  </div>
                  <div className="live-note">Shown live on the card</div>
                </div>
              </section>
            </div>
          </aside>

          {/* ============================================================ */}
          {/* RIGHT: Live Structured Clinical Maternity Card                */}
          {/* ============================================================ */}
          <main className="card-area">
            <article id="card" className="card" aria-label="Maternity Card">
              {/* Card Header */}
              <header className="card-head">
                <div>
                  <div className="eyebrow">Antenatal & postnatal record</div>
                  <h2>Maternity card</h2>
                </div>
                <div className="card-meta">
                  <div className="card-meta-badges">
                    <span className="confidential">CONFIDENTIAL</span>
                    {!entryPanelOpen && (
                      <button
                        type="button"
                        onClick={() => setEntryPanelOpen(true)}
                        className="card-open-form-btn no-print"
                        title="Open form to enter or edit clinical details"
                      >
                        <Icon name="notes" size={13} />
                        <span>Edit / Open form</span>
                      </button>
                    )}
                  </div>
                  <div>
                    {state.updatedAt
                      ? `Last saved ${new Date(state.updatedAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
                      : 'Draft card · auto-saving'}
                  </div>
                </div>
              </header>

              <div className="card-body">
                {/* 1. Patient Details Block */}
                <section className="block" data-tone="patient">
                  <header className="block-head">
                    <h3>Patient details</h3>
                    <button
                      type="button"
                      className="block-edit no-print"
                      onClick={() => jumpToSection('section-patient', true)}
                    >
                      Edit
                    </button>
                  </header>
                  <dl className="kv-grid">
                    <div className="kv big">
                      <dt>Patient name</dt>
                      <dd className={state.patient.name ? '' : 'empty'}>{state.patient.name || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>Hospital ID</dt>
                      <dd className={state.patient.id ? '' : 'empty'}>{state.patient.id || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>Age</dt>
                      <dd className={state.patient.age ? '' : 'empty'}>
                        {state.patient.age ? `${state.patient.age} yrs` : '—'}
                      </dd>
                    </div>
                    <div className="kv">
                      <dt>Phone</dt>
                      <dd className={state.patient.phone ? '' : 'empty'}>{state.patient.phone || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>First attendance</dt>
                      <dd className={state.patient.attendance ? '' : 'empty'}>
                        {fmtDate(state.patient.attendance) || '—'}
                      </dd>
                    </div>
                    <div className="kv">
                      <dt>Obstetric history</dt>
                      <dd className={obstetricText ? '' : 'empty'}>{obstetricText || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>LMP</dt>
                      <dd className={state.patient.lmp ? '' : 'empty'}>{fmtDate(state.patient.lmp) || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>EDD</dt>
                      <dd className={state.patient.edd ? '' : 'empty'}>{fmtDate(state.patient.edd) || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>Gestation today</dt>
                      <dd className={gaToday ? '' : 'empty'}>{gaToday || '—'}</dd>
                    </div>
                    <div className="kv wide">
                      <dt>History / allergies</dt>
                      <dd className={state.patient.history ? '' : 'empty'}>{state.patient.history || '—'}</dd>
                    </div>
                  </dl>
                </section>

                {/* 2. Quad: Baseline, Labs, Ultrasound, Vaccines */}
                <div className="quad">
                  {/* Baseline Block */}
                  <section className="block baseline" data-tone="investigations">
                    <header className="block-head">
                      <h3>Baseline</h3>
                      <button
                        type="button"
                        className="block-edit no-print"
                        onClick={() => jumpToSection('section-investigations', true)}
                      >
                        Edit
                      </button>
                    </header>
                    <dl className="kv-grid">
                      <div className="kv">
                        <dt>Blood group</dt>
                        <dd className={state.investigations.blood ? '' : 'empty'}>
                          {state.investigations.blood || '—'}
                        </dd>
                      </div>
                      <div className="kv">
                        <dt>Date</dt>
                        <dd className={state.investigations.resultsDate ? '' : 'empty'}>
                          {fmtDate(state.investigations.resultsDate) || '—'}
                        </dd>
                      </div>
                      <div className="kv">
                        <dt>Hb</dt>
                        <dd className={state.investigations.hb ? '' : 'empty'}>
                          {state.investigations.hb ? (
                            hbLow(state.investigations.hb) ? (
                              <span className="flag">{state.investigations.hb} g/dL</span>
                            ) : (
                              `${state.investigations.hb} g/dL`
                            )
                          ) : (
                            '—'
                          )}
                        </dd>
                      </div>
                      <div className="kv">
                        <dt>TSH</dt>
                        <dd className={state.investigations.tsh ? '' : 'empty'}>
                          {state.investigations.tsh ? `${state.investigations.tsh} mIU/L` : '—'}
                        </dd>
                      </div>
                      <div className="kv">
                        <dt>Chest</dt>
                        <dd className={state.investigations.chest ? '' : 'empty'}>
                          {state.investigations.chest || '—'}
                        </dd>
                      </div>
                      <div className="kv">
                        <dt>CVS</dt>
                        <dd className={state.investigations.cvs ? '' : 'empty'}>
                          {state.investigations.cvs || '—'}
                        </dd>
                      </div>
                      <div className="kv wide">
                        <dt>Other results</dt>
                        <dd className={state.investigations.results ? '' : 'empty'}>
                          {state.investigations.results || '—'}
                        </dd>
                      </div>
                    </dl>
                  </section>

                  {/* Labs Block */}
                  <section className="block" data-tone="labs">
                    <header className="block-head">
                      <h3>
                        Investigations
                        {state.labs.length > 0 && <span className="block-count">({state.labs.length})</span>}
                      </h3>
                      <button
                        type="button"
                        className="block-edit no-print"
                        onClick={() => {
                          cancelEditRow('labs');
                          jumpToSection('section-labs', true);
                        }}
                      >
                        + Add
                      </button>
                    </header>
                    <table className="sheet">
                      <colgroup>
                        <col style={{ width: '28%' }} />
                        <col style={{ width: '32%' }} />
                        <col style={{ width: '40%' }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Test</th>
                          <th>Result</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cardLabs.map(row => (
                          <tr
                            key={row.id}
                            className={`row ${row.status === 'editing' ? 'is-editing' : ''} ${row.status === 'draft' ? 'is-draft' : ''}`}
                            onClick={() => (row.status === 'draft' ? jumpToSection('section-labs', true) : startEditRow('labs', row))}
                          >
                            <td>
                              <span className="line">{fmtDate(row.date)}</span>
                              {row.status === 'editing' && <span className="tag">Editing</span>}
                              {row.status === 'draft' && <span className="tag">Draft</span>}
                            </td>
                            <td><span className="line">{row.test}</span></td>
                            <td>
                              <span className="line">{[row.result, row.unit].filter(Boolean).join(' ')}</span>
                              {row.notes && <span className="sub">{row.notes}</span>}
                            </td>
                          </tr>
                        ))}
                        {Array.from({ length: Math.max(4 - cardLabs.length, 1) }).map((_, i) => (
                          <tr
                            key={`blank-lab-${i}`}
                            className="blank"
                            onClick={() => {
                              cancelEditRow('labs');
                              jumpToSection('section-labs', true);
                            }}
                          >
                            <td>{i === 0 && <span className="add-hint">+ Add test</span>}</td>
                            <td /><td />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  {/* Ultrasound Block */}
                  <section className="block" data-tone="scans">
                    <header className="block-head">
                      <h3>
                        Ultrasound
                        {state.scans.length > 0 && <span className="block-count">({state.scans.length})</span>}
                      </h3>
                      <button
                        type="button"
                        className="block-edit no-print"
                        onClick={() => {
                          cancelEditRow('scans');
                          jumpToSection('section-scans', true);
                        }}
                      >
                        + Add
                      </button>
                    </header>
                    <table className="sheet">
                      <colgroup>
                        <col style={{ width: '28%' }} />
                        <col style={{ width: '72%' }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Date</th>
                          <th>Findings / Report</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cardScans.map(row => (
                          <tr
                            key={row.id}
                            className={`row ${row.status === 'editing' ? 'is-editing' : ''} ${row.status === 'draft' ? 'is-draft' : ''}`}
                            onClick={() => (row.status === 'draft' ? jumpToSection('section-scans', true) : startEditRow('scans', row))}
                          >
                            <td>
                              <span className="line">{fmtDate(row.date)}</span>
                              {gaText(row) && <span className="sub">{gaText(row)}</span>}
                              {row.status === 'editing' && <span className="tag">Editing</span>}
                              {row.status === 'draft' && <span className="tag">Draft</span>}
                            </td>
                            <td><span className="line">{row.report}</span></td>
                          </tr>
                        ))}
                        {Array.from({ length: Math.max(4 - cardScans.length, 1) }).map((_, i) => (
                          <tr
                            key={`blank-scan-${i}`}
                            className="blank"
                            onClick={() => {
                              cancelEditRow('scans');
                              jumpToSection('section-scans', true);
                            }}
                          >
                            <td>{i === 0 && <span className="add-hint">+ Add scan</span>}</td>
                            <td />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>

                  {/* Vaccines Block */}
                  <section className="block" data-tone="vaccines">
                    <header className="block-head">
                      <h3>
                        Vaccinations
                        {state.vaccines.length > 0 && <span className="block-count">({state.vaccines.length})</span>}
                      </h3>
                      <button
                        type="button"
                        className="block-edit no-print"
                        onClick={() => {
                          cancelEditRow('vaccines');
                          jumpToSection('section-vaccines', true);
                        }}
                      >
                        + Add
                      </button>
                    </header>
                    <table className="sheet">
                      <colgroup>
                        <col style={{ width: '42%' }} />
                        <col style={{ width: '29%' }} />
                        <col style={{ width: '29%' }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Vaccine</th>
                          <th>Given</th>
                          <th>Next</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cardVaccines.map(row => (
                          <tr
                            key={row.id}
                            className={`row ${row.status === 'editing' ? 'is-editing' : ''} ${row.status === 'draft' ? 'is-draft' : ''}`}
                            onClick={() => (row.status === 'draft' ? jumpToSection('section-vaccines', true) : startEditRow('vaccines', row))}
                          >
                            <td>
                              <span className="line">{row.name}</span>
                              {row.dose && <span className="sub">{row.dose}</span>}
                              {row.status === 'editing' && <span className="tag">Editing</span>}
                              {row.status === 'draft' && <span className="tag">Draft</span>}
                            </td>
                            <td><span className="line">{fmtDate(row.date)}</span></td>
                            <td><span className="line">{fmtDate(row.next)}</span></td>
                          </tr>
                        ))}
                        {Array.from({ length: Math.max(4 - cardVaccines.length, 1) }).map((_, i) => (
                          <tr
                            key={`blank-vaccine-${i}`}
                            className="blank"
                            onClick={() => {
                              cancelEditRow('vaccines');
                              jumpToSection('section-vaccines', true);
                            }}
                          >
                            <td>{i === 0 && <span className="add-hint">+ Add vaccine</span>}</td>
                            <td /><td />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </section>
                </div>

                {/* 3. Antenatal Visits Sheet Table */}
                <section className="block" data-tone="visits">
                  <header className="block-head">
                    <h3>
                      Antenatal visits
                      {state.visits.length > 0 && <span className="block-count">({state.visits.length})</span>}
                    </h3>
                    <button
                      type="button"
                      className="block-edit no-print"
                      onClick={() => {
                        cancelEditRow('visits');
                        jumpToSection('section-visits', true);
                      }}
                    >
                      + Add visit
                    </button>
                  </header>

                  <div className="table-scroll">
                    <table className="sheet visits-table">
                      <colgroup>
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '6%' }} />
                        <col style={{ width: '10%' }} />
                        <col style={{ width: '7%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '8%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '9%' }} />
                        <col style={{ width: '18%' }} />
                      </colgroup>
                      <thead>
                        <tr>
                          <th>Date / GA</th>
                          <th>Weight</th>
                          <th>BP (mmHg)</th>
                          <th>Fundal</th>
                          <th>Presentation</th>
                          <th>FHR</th>
                          <th>Urine</th>
                          <th>Hb / TSH</th>
                          <th>Next</th>
                          <th>Clinician</th>
                          <th>Advice / Notes</th>
                        </tr>
                      </thead>
                      <tbody>
                        {cardVisits.map(row => (
                          <tr
                            key={row.id}
                            className={`row ${row.status === 'editing' ? 'is-editing' : ''} ${row.status === 'draft' ? 'is-draft' : ''}`}
                            onClick={() => (row.status === 'draft' ? jumpToSection('section-visits', true) : startEditRow('visits', row))}
                          >
                            <td>
                              <span className="line">{fmtDate(row.date)}</span>
                              {gaText(row) && <span className="sub">{gaText(row)}</span>}
                              {row.status === 'editing' && <span className="tag">Editing</span>}
                              {row.status === 'draft' && <span className="tag">Draft</span>}
                            </td>
                            <td>{row.weight ? `${row.weight} kg` : ''}</td>
                            <td>
                              {(row.systolic || row.diastolic) && (
                                <span className={bpHigh(row) ? 'flag' : ''}>
                                  {row.systolic || '–'}/{row.diastolic || '–'}
                                </span>
                              )}
                            </td>
                            <td>{row.fundal ? `${row.fundal} cm` : ''}</td>
                            <td>
                              <span className="line">{row.presentation}</span>
                              {row.brim && <span className="sub">{row.brim}</span>}
                            </td>
                            <td>
                              {row.fhr && (
                                <span className={fhrAbnormal(row.fhr) ? 'flag' : ''}>
                                  {row.fhr} bpm
                                </span>
                              )}
                            </td>
                            <td>
                              {row.albumin && (
                                <span className={`line ${urinePositive(row.albumin) ? 'flag' : ''}`}>
                                  Alb: {row.albumin}
                                </span>
                              )}
                              {row.sugar && (
                                <span className={`sub ${urinePositive(row.sugar) ? 'flag' : ''}`}>
                                  Sug: {row.sugar}
                                </span>
                              )}
                            </td>
                            <td>
                              {row.hb && (
                                <span className={`line ${hbLow(row.hb) ? 'flag' : ''}`}>
                                  Hb {row.hb}
                                </span>
                              )}
                              {row.tsh && <span className="sub">TSH {row.tsh}</span>}
                            </td>
                            <td>{fmtDate(row.next)}</td>
                            <td>{row.clinician}</td>
                            <td>{row.advice}</td>
                          </tr>
                        ))}
                        {Array.from({ length: Math.max(5 - cardVisits.length, 1) }).map((_, i) => (
                          <tr
                            key={`blank-visit-${i}`}
                            className="blank"
                            onClick={() => {
                              cancelEditRow('visits');
                              jumpToSection('section-visits', true);
                            }}
                          >
                            <td>{i === 0 && <span className="add-hint">+ Add visit</span>}</td>
                            <td /><td /><td /><td /><td /><td /><td /><td /><td /><td />
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>

                {/* 4. Delivery & Postnatal Block */}
                <section className="block" data-tone="delivery">
                  <header className="block-head">
                    <h3>Delivery & postnatal</h3>
                    <button
                      type="button"
                      className="block-edit no-print"
                      onClick={() => jumpToSection('section-delivery', true)}
                    >
                      Edit
                    </button>
                  </header>
                  <dl className="kv-grid">
                    <div className="kv">
                      <dt>Type of delivery</dt>
                      <dd className={state.delivery.type ? '' : 'empty'}>{state.delivery.type || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>Date & time</dt>
                      <dd className={state.delivery.when ? '' : 'empty'}>{fmtDate(state.delivery.when) || '—'}</dd>
                    </div>
                    <div className="kv wide">
                      <dt>Indication</dt>
                      <dd className={state.delivery.indication ? '' : 'empty'}>
                        {state.delivery.indication || '—'}
                      </dd>
                    </div>
                    <div className="kv">
                      <dt>Sex of baby</dt>
                      <dd className={state.delivery.sex ? '' : 'empty'}>{state.delivery.sex || '—'}</dd>
                    </div>
                    <div className="kv">
                      <dt>Birth weight</dt>
                      <dd className={state.delivery.weight ? '' : 'empty'}>
                        {state.delivery.weight ? `${state.delivery.weight} kg` : '—'}
                      </dd>
                    </div>
                    <div className="kv">
                      <dt>APGAR 1 / 5 min</dt>
                      <dd className={state.delivery.apgar1 || state.delivery.apgar5 ? '' : 'empty'}>
                        {state.delivery.apgar1 || state.delivery.apgar5
                          ? `${state.delivery.apgar1 || '–'} / ${state.delivery.apgar5 || '–'}`
                          : '—'}
                      </dd>
                    </div>
                    <div className="kv">
                      <dt>Next postnatal visit</dt>
                      <dd className={state.delivery.next ? '' : 'empty'}>{fmtDate(state.delivery.next) || '—'}</dd>
                    </div>
                    <div className="kv wide">
                      <dt>Postnatal advice</dt>
                      <dd className={state.delivery.advice ? '' : 'empty'}>{state.delivery.advice || '—'}</dd>
                    </div>
                  </dl>
                </section>

                {/* Footer notes */}
                <footer className="card-foot">
                  <span>
                    <span className="flag">Flagged</span>: BP ≥ 140/90 · Hb &lt; 11 g/dL · FHR outside 110–160 · urine protein 1+ or more
                  </span>
                  <span>Same patient record throughout pregnancy · each row is a separate dated entry</span>
                </footer>
              </div>
            </article>
          </main>
        </div>
      </div>

      {/* Datalists for Autocomplete */}
      <datalist id="testOptions">
        <option value="Hb" /><option value="TSH" /><option value="Blood glucose" /><option value="OGTT" />
        <option value="Platelet count" /><option value="HIV" /><option value="HBsAg" /><option value="VDRL" />
        <option value="Urine routine" /><option value="Urine culture" />
      </datalist>
      <datalist id="vaccineOptions">
        <option value="Td" /><option value="Tdap" /><option value="Anti-D" /><option value="Influenza" />
      </datalist>

      {/* Toast Feedback */}
      {toastMsg && (
        <div style={{
          position: 'fixed',
          left: '50%',
          bottom: '24px',
          zIndex: 50,
          transform: 'translateX(-50%)',
          padding: '10px 20px',
          borderRadius: '8px',
          background: '#1b4d43',
          color: '#fff',
          fontSize: '13px',
          fontWeight: 600,
          boxShadow: '0 6px 20px rgba(0,0,0,0.2)'
        }}>
          {toastMsg}
        </div>
      )}
    </div>
  );
}

export default MaternityCardPage;
