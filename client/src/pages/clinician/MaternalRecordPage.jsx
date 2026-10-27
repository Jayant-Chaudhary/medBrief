import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Eye, Pencil, Plus, Save, Trash2 } from 'lucide-react';
import { Sidebar } from '../../components/layout/Sidebar.jsx';
import { LabSummaryOverlay } from '../../components/clinician/LabSummaryOverlay.jsx';
import { Spinner } from '../../components/common/Spinner.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { fetchMyPatients } from '../../services/clinicianService.js';
import { maternalRecordService } from '../../services/maternalRecordService.js';

const EMPTY_EPISODE = {
  status: 'ongoing', first_anc_date: '', last_menstrual_period: '', due_date: '', date_of_quickening: '',
  gravida: '', para: '', chest_history: '', cvs_history: '', alcohol_history: '', smoking_history: '',
  vomiting_history: '', discharge_history: '', bleeding_history: '',
};
const EMPTY_VISIT = {
  visit_date: '', weight_kg: '', bp_systolic: '', bp_diastolic: '', gestational_weeks: '', gestational_days: '',
  fundal_height_cm: '', present_position: '', relation_presentation_to_brim: '', fetal_heart_rate: '',
  urine_albumin: '', urine_sugar: '', tsh: '', hemoglobin_percent: '', next_visit_date: '', signature: '', advice: '',
};
const EMPTY_INVESTIGATION = { investigation_key: '', investigation_name: '', performed_on: '', result_text: '', result_value: '', result_unit: '', lab_report_id: '' };
const EMPTY_ULTRASOUND = { performed_on: '', report_text: '' };
const EMPTY_VACCINE = { vaccine_name: '', dose_label: '', administered_on: '', notes: '' };
const EMPTY_DELIVERY = { delivery_type: '', indication: '', delivered_at: '', baby_sex: '', baby_weight_kg: '', apgar_score: '', postnatal_advice: '', next_visit_date: '' };
const COMMON_INVESTIGATIONS = [
  'CBC', 'Blood Group', 'Thyroid Screen (TSH, FT3, FT4)', 'Bi Sugar R / GCT', 'Hepatitis B', 'HIV',
  'Anti HCV', 'VDRL', 'Urine R/E', 'Urine C/S', 'Rubella', 'Dual Test', 'ICT', 'LFT', 'KFT', 'Hb Electrophoresis',
  'Hemoglobin', 'Fasting Blood Sugar', 'Post-prandial Blood Sugar', 'Random Blood Sugar', 'OGTT', 'TSH', 'FT3', 'FT4',
  'Platelet Count', 'Creatinine', 'AST (SGOT)', 'ALT (SGPT)', 'HbA1c',
];

// Composite and qualitative investigations are recorded as text. Numeric
// fields are only shown for single-analyte tests with a clear unit.
function investigationInput(name) {
  const key = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  const numericTests = [
    [/^(bi sugar r \/ gct|gct|ogtt|fasting blood sugar|post-prandial blood sugar|random blood sugar|blood sugar.*|glucose.*)$/, 'mg/dL'],
    [/^(hemoglobin|hb)$/, 'g/dL'],
    [/^tsh$/, 'µIU/mL'],
    [/^ft3$/, 'pg/mL'],
    [/^ft4$/, 'ng/dL'],
    [/^(platelet count|platelets)$/, '/cumm'],
    [/^(creatinine|blood urea)$/, 'mg/dL'],
    [/^(ast \(sgot\)|sgot|alt \(sgpt\)|sgpt)$/, 'U/L'],
    [/^(hba1c|hb a1c)$/, '%'],
  ];
  const match = numericTests.find(([pattern]) => pattern.test(key));
  return match ? { numeric: true, unit: match[1] } : { numeric: false, unit: '' };
}
const COMMON_VACCINES = ['Tetanus toxoid', 'T. Dap', 'Anti D', 'Flu'];

const VISIT_FIELDS = [
  ['visit_date', 'Date', 'date'], ['weight_kg', 'Weight (kg)', 'number'], ['bp_systolic', 'BP systolic', 'number'], ['bp_diastolic', 'BP diastolic', 'number'],
  ['gestational_weeks', 'Weeks', 'number'], ['gestational_days', 'Days', 'number'], ['fundal_height_cm', 'Fundal height (cm)', 'number'],
  ['present_position', 'Present position', 'text'], ['relation_presentation_to_brim', 'Presentation to brim', 'text'],
  ['fetal_heart_rate', 'Fetal heart rate', 'text'], ['urine_albumin', 'Urine albumin', 'text'], ['urine_sugar', 'Urine sugar', 'text'],
  ['tsh', 'TSH', 'number'], ['hemoglobin_percent', 'Hb (%)', 'number'], ['next_visit_date', 'Next visit', 'date'], ['signature', 'Signature', 'text'], ['advice', 'Advice', 'textarea'],
];

function cleanPayload(form, numericKeys = []) {
  const numeric = new Set(numericKeys);
  return Object.fromEntries(Object.entries(form).map(([key, value]) => [
    key,
    value == null || value === '' ? null : (numeric.has(key) ? Number(value) : value),
  ]));
}

function Field({ label, value, onChange, type = 'text', multiline = false, required = false, list, hint }) {
  const common = {
    value: value ?? '',
    onChange: (event) => onChange(event.target.value),
    required,
    className: 'field w-full',
  };
  return (
    <label className="block space-y-1 text-label-sm text-ink-2">
      <span>{label}{hint && <span className="ml-1 text-ink-3">({hint})</span>}</span>
      {multiline ? <textarea {...common} rows={3} /> : <input {...common} type={type} list={list} step={type === 'number' ? 'any' : undefined} />}
    </label>
  );
}

function Section({ title, description, children, action }) {
  return (
    <section className="card space-y-4 p-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="font-display text-head-sm text-ink">{title}</h2>{description && <p className="mt-1 text-body-sm text-ink-3">{description}</p>}</div>
        {action}
      </header>
      {children}
    </section>
  );
}

export default function MaternalRecordPage() {
  const { patientId } = useParams();
  const { showToast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [patient, setPatient] = useState(null);
  const [record, setRecord] = useState(null);
  const [episodeId, setEpisodeId] = useState('');
  const [episodeForm, setEpisodeForm] = useState(EMPTY_EPISODE);
  const [visitForm, setVisitForm] = useState(EMPTY_VISIT);
  const [investigationForm, setInvestigationForm] = useState(EMPTY_INVESTIGATION);
  const [ultrasoundForm, setUltrasoundForm] = useState(EMPTY_ULTRASOUND);
  const [vaccineForm, setVaccineForm] = useState(EMPTY_VACCINE);
  const [deliveryForm, setDeliveryForm] = useState(EMPTY_DELIVERY);
  const [editing, setEditing] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [labSummaryOpen, setLabSummaryOpen] = useState(false);
  const closeLabSummary = useCallback(() => setLabSummaryOpen(false), []);

  const load = useCallback(async ({ showSpinner = true, preserveForms = false } = {}) => {
    if (showSpinner) setLoading(true);
    try {
      const [patients, patientRecord] = await Promise.all([
        fetchMyPatients(),
        maternalRecordService.getPatientRecord(patientId),
      ]);
      setPatient(patients.find((item) => item.id === patientId) || null);
      setRecord(patientRecord);
      const selectedEpisodeId = episodeId && patientRecord.episodes.some((item) => item.id === episodeId)
        ? episodeId
        : patientRecord.episodes[0]?.id || '';
      setEpisodeId(selectedEpisodeId);
      const episode = patientRecord.episodes.find((item) => item.id === selectedEpisodeId);
      if (episode && !preserveForms) setEpisodeForm(Object.fromEntries(Object.keys(EMPTY_EPISODE).map((key) => [key, episode[key] ?? ''])));
      const delivery = patientRecord.deliveries.find((item) => item.pregnancy_episode_id === selectedEpisodeId);
      if (!preserveForms) {
        setDeliveryForm(delivery
          ? Object.fromEntries(Object.keys(EMPTY_DELIVERY).map((key) => [key, delivery[key] ?? '']))
          : EMPTY_DELIVERY);
      }
    } catch (error) {
      showToast(error.message || 'Could not load the maternal record.', 'error');
    } finally {
      if (showSpinner) setLoading(false);
    }
  }, [episodeId, patientId, showToast]);

  useEffect(() => { load(); }, [load]);

  const selectedEpisode = useMemo(() => record?.episodes.find((item) => item.id === episodeId) || null, [record, episodeId]);
  const visits = useMemo(() => (record?.antenatal_visits || []).filter((item) => item.pregnancy_episode_id === episodeId), [record, episodeId]);
  const investigations = useMemo(() => (record?.investigations || []).filter((item) => item.pregnancy_episode_id === episodeId), [record, episodeId]);
  const ultrasounds = useMemo(() => (record?.ultrasounds || []).filter((item) => item.pregnancy_episode_id === episodeId), [record, episodeId]);
  const vaccinations = useMemo(() => (record?.vaccinations || []).filter((item) => item.pregnancy_episode_id === episodeId), [record, episodeId]);

  async function save(action, successMessage) {
    if (saving) return;
    setSaving(true);
    try {
      await action();
      await load({ showSpinner: false, preserveForms: true });
      showToast(successMessage);
    } catch (error) {
      showToast(error.message || 'Could not save the record.', 'error');
    } finally {
      setSaving(false);
    }
  }

  async function startEpisode(event) {
    event.preventDefault();
    setSaving(true);
    try {
      const created = await maternalRecordService.createEpisode(patientId, cleanPayload(episodeForm, ['gravida', 'para']));
      setEpisodeId(created.id);
      await load();
      showToast('Pregnancy record created.');
    } catch (error) {
      showToast(error.message || 'Could not create the pregnancy record.', 'error');
    } finally { setSaving(false); }
  }

  async function addRecord(collection, form, numericKeys, reset) {
    const editId = editing[collection];
    await save(async () => {
      const payload = cleanPayload(form, numericKeys);
      if (editId) await maternalRecordService.updateRecord(collection, editId, payload);
      else await maternalRecordService.createRecord(episodeId, collection, payload);
      reset();
      setEditing((current) => ({ ...current, [collection]: '' }));
    }, 'Record added.');
  }

  function editRow(collection, row, setForm, emptyForm) {
    const form = Object.fromEntries(Object.keys(emptyForm).map((key) => [key, row[key] ?? '']));
    setForm(form);
    setEditing((current) => ({ ...current, [collection]: row.id }));
  }

  function cancelEdit(collection, setForm, emptyForm) {
    setForm(emptyForm);
    setEditing((current) => ({ ...current, [collection]: '' }));
  }

  async function removeRecord(collection, id) {
    if (!window.confirm('Remove this entry from the maternal record?')) return;
    await save(() => maternalRecordService.deleteRecord(collection, id), 'Entry removed.');
  }

  if (loading) return <div className="flex h-screen items-center justify-center gap-3 text-ink-3"><Spinner /> Loading maternal record…</div>;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <main className="min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <div className="mx-auto max-w-7xl space-y-5">
          <Link to="/clinician/patients" className="inline-flex items-center gap-2 text-label-md text-cypress hover:underline"><ArrowLeft size={16} /> Patients</Link>
          <header className="flex flex-wrap items-end justify-between gap-4">
            <div>
              <h1 className="font-display text-head-lg text-ink">Maternal record</h1>
              <p className="text-body-md text-ink-2">{patient?.fullName || patient?.email || 'Patient'} · pregnancy history and antenatal entries</p>
            </div>
            {record?.episodes?.length > 0 && (
              <label className="min-w-56 space-y-1 text-label-sm text-ink-2">Pregnancy episode
                <select className="field w-full" value={episodeId} onChange={(event) => setEpisodeId(event.target.value)}>
                  {record.episodes.map((episode, index) => <option key={episode.id} value={episode.id}>{episode.due_date ? `EDD ${episode.due_date}` : `Pregnancy ${record.episodes.length - index}`} · {episode.status}</option>)}
                </select>
              </label>
            )}
          </header>

          {!selectedEpisode ? (
            <Section title="Start pregnancy record" description="Create a pregnancy episode, then add antenatal visits, investigations, and delivery details.">
              <form onSubmit={startEpisode} className="space-y-4">
                <EpisodeFields form={episodeForm} setForm={setEpisodeForm} />
                <button className="inline-flex items-center gap-2 rounded-xl bg-cypress px-4 py-2.5 text-label-md text-white disabled:opacity-50" disabled={saving}><Plus size={16} /> Create pregnancy record</button>
              </form>
            </Section>
          ) : (
            <>
              <Section title="Pregnancy and intake" description="Enter the printed pregnancy and history fields from the antenatal card." action={<button type="button" onClick={() => save(() => maternalRecordService.updateEpisode(episodeId, cleanPayload(episodeForm, ['gravida', 'para'])), 'Pregnancy details saved.')} className="inline-flex items-center gap-2 rounded-lg border border-line px-3 py-2 text-label-sm text-ink-2"><Save size={15} /> Save</button>}>
                <EpisodeFields form={episodeForm} setForm={setEpisodeForm} />
              </Section>

              <Section title="Antenatal visit table" description="One row per visit. Scroll horizontally to reach all fields.">
                <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => { event.preventDefault(); addRecord('antenatal_visits', visitForm, ['weight_kg', 'bp_systolic', 'bp_diastolic', 'gestational_weeks', 'gestational_days', 'fundal_height_cm', 'tsh', 'hemoglobin_percent'], () => setVisitForm(EMPTY_VISIT)); }}>
                  {VISIT_FIELDS.map(([key, label, type]) => <Field key={key} label={label} type={type} multiline={type === 'textarea'} required={key === 'visit_date'} value={visitForm[key]} onChange={(value) => setVisitForm((current) => ({ ...current, [key]: value }))} />)}
                  <div className="sm:col-span-2 xl:col-span-4 flex gap-2"><button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-cypress px-4 py-2 text-label-sm text-white disabled:opacity-50">{editing.antenatal_visits ? <Save size={15} /> : <Plus size={15} />}{editing.antenatal_visits ? 'Save visit row' : 'Add visit row'}</button>{editing.antenatal_visits && <button type="button" onClick={() => cancelEdit('antenatal_visits', setVisitForm, EMPTY_VISIT)} className="rounded-lg border border-line px-4 py-2 text-label-sm">Cancel</button>}</div>
                </form>
                <div className="overflow-x-auto rounded-xl border border-line">
                  <table className="min-w-[1500px] w-full text-left text-body-sm"><thead className="bg-subcanvas text-label-sm text-ink-3"><tr>{VISIT_FIELDS.map(([, label]) => <th key={label} className="px-3 py-2 font-semibold">{label}</th>)}<th className="px-3 py-2" /></tr></thead><tbody>
                    {visits.map((visit) => <tr key={visit.id} className="border-t border-line">{VISIT_FIELDS.map(([key]) => <td key={key} className="max-w-56 px-3 py-2 text-ink-2">{visit[key] ?? '—'}</td>)}<td className="px-3 py-2"><div className="flex gap-2"><button aria-label="Edit visit" onClick={() => editRow('antenatal_visits', visit, setVisitForm, EMPTY_VISIT)} className="text-cypress"><Pencil size={15} /></button><button aria-label="Delete visit" onClick={() => removeRecord('antenatal_visits', visit.id)} className="text-terracotta"><Trash2 size={15} /></button></div></td></tr>)}
                    {!visits.length && <tr><td colSpan={VISIT_FIELDS.length + 1} className="px-4 py-6 text-center text-ink-3">No antenatal visits entered yet.</td></tr>}
                  </tbody></table>
                </div>
              </Section>

              <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(320px,0.8fr)]">
                <div className="space-y-5">
                  <Section title="Initial investigations" description="Enter investigation rows manually. Lab summaries are shown beside this section for reference.">
                    <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => {
                      event.preventDefault();
                      const numeric = investigationInput(investigationForm.investigation_name).numeric;
                      addRecord('pregnancy_investigations', {
                        ...investigationForm,
                        result_value: numeric ? investigationForm.result_value : null,
                        result_unit: numeric ? investigationForm.result_unit : null,
                      }, numeric ? ['result_value'] : [], () => setInvestigationForm(EMPTY_INVESTIGATION));
                    }}>
                      <Field label="Investigation" required list="common-investigations" value={investigationForm.investigation_name} onChange={(value) => setInvestigationForm((f) => {
                        const suggestion = investigationInput(value);
                        return {
                          ...f,
                          investigation_name: value,
                          result_value: suggestion.numeric ? f.result_value : '',
                          result_unit: suggestion.numeric ? suggestion.unit : '',
                        };
                      })} />
                      <datalist id="common-investigations">{COMMON_INVESTIGATIONS.map((name) => <option key={name} value={name} />)}</datalist>
                      <Field label="Date" type="date" value={investigationForm.performed_on} onChange={(value) => setInvestigationForm((f) => ({ ...f, performed_on: value }))} />
                      {investigationInput(investigationForm.investigation_name).numeric && <>
                        <Field label="Numeric result" type="number" value={investigationForm.result_value} onChange={(value) => setInvestigationForm((f) => ({ ...f, result_value: value }))} />
                        <Field label="Unit" hint={`Suggested: ${investigationInput(investigationForm.investigation_name).unit}`} value={investigationForm.result_unit || investigationInput(investigationForm.investigation_name).unit} onChange={(value) => setInvestigationForm((f) => ({ ...f, result_unit: value }))} />
                      </>}
                      <div className="sm:col-span-2 xl:col-span-4"><Field label="Result / notes" multiline value={investigationForm.result_text} onChange={(value) => setInvestigationForm((f) => ({ ...f, result_text: value }))} /></div>
                      <div className="flex gap-2"><button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-cypress px-4 py-2 text-label-sm text-white disabled:opacity-50">{editing.pregnancy_investigations ? <Save size={15} /> : <Plus size={15} />}{editing.pregnancy_investigations ? 'Save investigation' : 'Add investigation'}</button>{editing.pregnancy_investigations && <button type="button" onClick={() => cancelEdit('pregnancy_investigations', setInvestigationForm, EMPTY_INVESTIGATION)} className="rounded-lg border border-line px-3 py-2 text-label-sm">Cancel</button>}</div>
                    </form>
                    <EntryTable rows={investigations} columns={[["investigation_name", "Investigation"], ["performed_on", "Date"], ["result_display", "Result", (row) => [row.result_text, row.result_value == null ? '' : `${row.result_value}${row.result_unit ? ` ${row.result_unit}` : ''}`].filter(Boolean).join(' · ') || '—']]} onEdit={(row) => editRow('pregnancy_investigations', row, setInvestigationForm, EMPTY_INVESTIGATION)} onDelete={(row) => removeRecord('pregnancy_investigations', row.id)} />
                  </Section>
                  <Section title="Ultrasound examinations">
                    <form className="grid gap-3 sm:grid-cols-[180px_1fr_auto]" onSubmit={(event) => { event.preventDefault(); addRecord('pregnancy_ultrasounds', ultrasoundForm, [], () => setUltrasoundForm(EMPTY_ULTRASOUND)); }}>
                      <Field label="Date" type="date" value={ultrasoundForm.performed_on} onChange={(value) => setUltrasoundForm((f) => ({ ...f, performed_on: value }))} />
                      <Field label="Report / findings" multiline value={ultrasoundForm.report_text} onChange={(value) => setUltrasoundForm((f) => ({ ...f, report_text: value }))} />
                      <div className="flex items-end gap-2"><button disabled={saving} className="rounded-lg bg-cypress px-4 py-2 text-label-sm text-white">{editing.pregnancy_ultrasounds ? 'Save' : 'Add'}</button>{editing.pregnancy_ultrasounds && <button type="button" onClick={() => cancelEdit('pregnancy_ultrasounds', setUltrasoundForm, EMPTY_ULTRASOUND)} className="rounded-lg border border-line px-3 py-2 text-label-sm">Cancel</button>}</div>
                    </form>
                    <EntryTable rows={ultrasounds} columns={[["performed_on", "Date"], ["report_text", "Report"]]} onEdit={(row) => editRow('pregnancy_ultrasounds', row, setUltrasoundForm, EMPTY_ULTRASOUND)} onDelete={(row) => removeRecord('pregnancy_ultrasounds', row.id)} />
                  </Section>
                  <Section title="Vaccinations">
                    <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => { event.preventDefault(); addRecord('pregnancy_vaccinations', vaccineForm, [], () => setVaccineForm(EMPTY_VACCINE)); }}>
                      <Field label="Vaccine" required list="common-vaccines" value={vaccineForm.vaccine_name} onChange={(value) => setVaccineForm((f) => ({ ...f, vaccine_name: value }))} />
                      <datalist id="common-vaccines">{COMMON_VACCINES.map((name) => <option key={name} value={name} />)}</datalist>
                      <Field label="Dose" value={vaccineForm.dose_label} onChange={(value) => setVaccineForm((f) => ({ ...f, dose_label: value }))} />
                      <Field label="Date" type="date" value={vaccineForm.administered_on} onChange={(value) => setVaccineForm((f) => ({ ...f, administered_on: value }))} />
                      <Field label="Notes" value={vaccineForm.notes} onChange={(value) => setVaccineForm((f) => ({ ...f, notes: value }))} />
                      <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-cypress px-4 py-2 text-label-sm text-white">{editing.pregnancy_vaccinations ? <Save size={15} /> : <Plus size={15} />}{editing.pregnancy_vaccinations ? 'Save vaccination' : 'Add vaccination'}</button>{editing.pregnancy_vaccinations && <button type="button" onClick={() => cancelEdit('pregnancy_vaccinations', setVaccineForm, EMPTY_VACCINE)} className="rounded-lg border border-line px-3 py-2 text-label-sm">Cancel</button>}
                    </form>
                    <EntryTable rows={vaccinations} columns={[["vaccine_name", "Vaccine"], ["dose_label", "Dose"], ["administered_on", "Date"], ["notes", "Notes"]]} onEdit={(row) => editRow('pregnancy_vaccinations', row, setVaccineForm, EMPTY_VACCINE)} onDelete={(row) => removeRecord('pregnancy_vaccinations', row.id)} />
                  </Section>
                </div>

                <aside className="card h-fit space-y-4 p-5 xl:sticky xl:top-4">
                  <div><h2 className="font-display text-head-sm text-ink">Lab report summaries</h2><p className="mt-1 text-body-sm text-ink-3">Review the latest five shared reports by test field, with a trend graph. Values remain reference only and are not copied into the maternal record.</p></div>
                  <p className="text-body-sm text-ink-2">{record?.lab_report_summaries?.length || 0} shared report{record?.lab_report_summaries?.length === 1 ? '' : 's'} available.</p>
                  <button type="button" onClick={() => setLabSummaryOpen(true)} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-cypress px-4 py-2.5 text-label-md text-white hover:bg-cypress/90"><Eye size={16} /> View lab report summaries</button>
                </aside>
              </div>

              <Section title="Delivery and postpartum">
                <form className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4" onSubmit={(event) => { event.preventDefault(); save(() => maternalRecordService.saveDelivery(episodeId, { ...deliveryForm, baby_weight_kg: deliveryForm.baby_weight_kg === '' ? null : Number(deliveryForm.baby_weight_kg), delivered_at: deliveryForm.delivered_at ? new Date(deliveryForm.delivered_at).toISOString() : null }), 'Delivery details saved.'); }}>
                  <Field label="Type of delivery" value={deliveryForm.delivery_type} onChange={(value) => setDeliveryForm((f) => ({ ...f, delivery_type: value }))} />
                  <Field label="Indication" value={deliveryForm.indication} onChange={(value) => setDeliveryForm((f) => ({ ...f, indication: value }))} />
                  <Field label="Date and time" type="datetime-local" value={deliveryForm.delivered_at ? deliveryForm.delivered_at.slice(0, 16) : ''} onChange={(value) => setDeliveryForm((f) => ({ ...f, delivered_at: value }))} />
                  <Field label="Sex of baby" value={deliveryForm.baby_sex} onChange={(value) => setDeliveryForm((f) => ({ ...f, baby_sex: value }))} />
                  <Field label="Baby weight (kg)" type="number" value={deliveryForm.baby_weight_kg} onChange={(value) => setDeliveryForm((f) => ({ ...f, baby_weight_kg: value }))} />
                  <Field label="APGAR score" value={deliveryForm.apgar_score} onChange={(value) => setDeliveryForm((f) => ({ ...f, apgar_score: value }))} />
                  <Field label="Next visit" type="date" value={deliveryForm.next_visit_date} onChange={(value) => setDeliveryForm((f) => ({ ...f, next_visit_date: value }))} />
                  <Field label="Postnatal advice" multiline value={deliveryForm.postnatal_advice} onChange={(value) => setDeliveryForm((f) => ({ ...f, postnatal_advice: value }))} />
                  <button disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-cypress px-4 py-2 text-label-sm text-white"><Save size={15} /> Save delivery details</button>
                </form>
              </Section>
            </>
          )}
        </div>
      </main>
      <LabSummaryOverlay open={labSummaryOpen} onClose={closeLabSummary} patientId={patientId} reports={record?.lab_report_summaries || []} />
    </div>
  );
}

function EpisodeFields({ form, setForm }) {
  const update = (key) => (value) => setForm((current) => ({ ...current, [key]: value }));
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <label className="space-y-1 text-label-sm text-ink-2">Episode status<select className="field w-full" value={form.status} onChange={(event) => update('status')(event.target.value)}><option value="ongoing">Ongoing</option><option value="completed">Completed</option><option value="other">Other</option></select></label>
      <Field label="First ANC date" type="date" value={form.first_anc_date} onChange={update('first_anc_date')} />
      <Field label="Last menstrual period" type="date" value={form.last_menstrual_period} onChange={update('last_menstrual_period')} />
      <Field label="Due date" type="date" value={form.due_date} onChange={update('due_date')} />
      <Field label="Date of quickening" type="date" value={form.date_of_quickening} onChange={update('date_of_quickening')} />
      <Field label="Gravida" type="number" value={form.gravida} onChange={update('gravida')} />
      <Field label="Para" type="number" value={form.para} onChange={update('para')} />
      {[["chest_history", "Chest history"], ["cvs_history", "CVS history"], ["alcohol_history", "Alcohol"], ["smoking_history", "Smoking"], ["vomiting_history", "Vomiting"], ["discharge_history", "Discharge"], ["bleeding_history", "Bleeding"]].map(([key, label]) => <Field key={key} label={label} value={form[key]} onChange={update(key)} />)}
    </div>
  );
}

function EntryTable({ rows, columns, onEdit, onDelete }) {
  return <div className="overflow-x-auto rounded-xl border border-line"><table className="w-full min-w-[520px] text-left text-body-sm"><thead className="bg-subcanvas text-label-sm text-ink-3"><tr>{columns.map(([, label]) => <th key={label} className="px-3 py-2">{label}</th>)}<th className="px-3 py-2" /></tr></thead><tbody>{rows.map((row) => <tr key={row.id} className="border-t border-line">{columns.map(([key, , render]) => <td key={key} className="max-w-72 px-3 py-2 text-ink-2">{render ? render(row) : row[key] ?? '—'}</td>)}<td className="px-3 py-2"><div className="flex gap-2"><button aria-label="Edit entry" onClick={() => onEdit(row)} className="text-cypress"><Pencil size={15} /></button><button aria-label="Delete entry" onClick={() => onDelete(row)} className="text-terracotta"><Trash2 size={15} /></button></div></td></tr>)}{!rows.length && <tr><td colSpan={columns.length + 1} className="px-4 py-5 text-center text-ink-3">No entries yet.</td></tr>}</tbody></table></div>;
}
