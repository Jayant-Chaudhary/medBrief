import { useEffect, useMemo, useRef, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, X, Copy, Archive, Check, ArrowRight, BookOpen, Pencil, ChevronRight, FileText, SlidersHorizontal } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext.jsx';
import { Sidebar } from '../layout/Sidebar.jsx';
import { blankDraft, blankMedication, blankTemplate, templateFromDraft, evaluateTemplate, buildPatientContext, rankTemplates, allergyReview, storageKeys, readLocal, validDraft, validLibrary } from './templateModel.js';
import { usePrescriptionFactors, FactorsEditor, FactorRuleEditor } from './FactorsEditor.jsx';
import { contextWithFactors, usableFactor, DEFAULT_FACTORS } from './factorModel.js';
import { fetchMedicationTemplates, saveMedicationTemplate, fetchMedicationContext, savePatientAllergies, fetchPrescriptionDraft, savePrescriptionDraft, searchMedicationCatalog, submitMedicationFeedback, fetchMedicationFeedbackAnalytics, fetchMedicationFactorCatalog } from '../../services/medicationDecisionService.js';
import { TemplateAutocomplete } from './TemplateAutocomplete.jsx';
import { useLiveTemplateSearch } from './useLiveTemplateSearch.js';
import { fillDraftFromTemplate } from './templateSearchModel.js';
import { InlineGhostField } from './InlineGhostField.jsx';
import { medicineCompletion } from './inlineGhostModel.js';
import './prescriptions.css';

function Dialog({ title, subtitle, onClose, children }) {
  const ref = useRef(null);
  const titleId = useId();
  useEffect(() => {
    const previous = document.activeElement;
    const dialog = ref.current;
    dialog.showModal();
    return () => { dialog.close(); previous?.focus?.(); };
  }, []);
  return createPortal(
    <dialog className="rx-dialog" ref={ref} aria-labelledby={titleId}
      onCancel={event => { event.preventDefault(); onClose(); }} onKeyDown={event => event.stopPropagation()}>
      <div className="rx-dialog-head">
        <div><h2 id={titleId}>{title}</h2><p>{subtitle}</p></div>
        <button type="button" className="rx-icon" aria-label="Close prescription dialog" onClick={onClose}><X size={19}/></button>
      </div>
      <div className="rx-dialog-body">{children}</div>
    </dialog>, document.body,
  );
}
const allergenKey = value => value.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
function stableLegacyTemplateId(value) {
  const seeds = [2166136261, 2246822519, 3266489917, 668265263];
  const hashes = seeds.map((seed, index) => {
    let hash = seed;
    for (const char of String(value)) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619 + index * 2);
    return (hash >>> 0).toString(16).padStart(8, '0');
  }).join('');
  const hex = `${hashes.slice(0, 8)}${hashes.slice(8, 12)}5${hashes.slice(13, 16)}8${hashes.slice(17, 20)}${hashes.slice(20, 32)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}
function AllergyEditor({ context, appointmentId, onClose, onSaved }) {
  const [status, setStatus] = useState(context.allergyReview?.status || 'not_assessed');
  const [allergies, setAllergies] = useState(context.allergies || []);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    const rows = status === 'allergies_documented' ? allergies.map(row => ({ ...row, substance_display: row.substance_display.trim(), substance_key: row.substance_key || allergenKey(row.substance_display) })).filter(row => row.substance_display) : [];
    if (status === 'allergies_documented' && !rows.length) { setError('Add at least one allergy or choose another review status.'); return; }
    if (rows.some(row => !row.substance_key)) { setError('Each allergy needs a usable name.'); return; }
    setSaving(true);
    try { const saved = await savePatientAllergies(appointmentId, { status, allergies: rows }); await onSaved(saved); onClose(); }
    catch { setError('The allergy record could not be saved. Check the database migration and server connection.'); }
    finally { setSaving(false); }
  }
  return <Dialog title="Patient allergy record" subtitle="This record is used to flag known medicine–allergen associations in template review." onClose={onClose}>
    <form className="rx-stack" onSubmit={submit}>
      <label className="rx-field"><span>Review status</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="not_assessed">Not assessed</option><option value="none_known">No known drug allergies</option><option value="allergies_documented">Allergies documented</option></select></label>
      {status === 'allergies_documented' && <div className="rx-stack">{allergies.map((row, index) => <div className="rx-allergy-entry" key={`${row.substance_key || 'new'}-${index}`}>
        <Field label="Allergen / substance" value={row.substance_display} onChange={value => setAllergies(current => current.map((item, i) => i === index ? { ...item, substance_display: value, substance_key: allergenKey(value) } : item))} placeholder="e.g. penicillin" required/>
        <Field label="Reaction (optional)" value={row.reaction || ''} onChange={value => setAllergies(current => current.map((item, i) => i === index ? { ...item, reaction: value } : item))} placeholder="Clinician-recorded reaction"/>
        <button className="rx-text" type="button" onClick={() => setAllergies(current => current.filter((_, i) => i !== index))}>Remove allergy</button>
      </div>)}
      <button type="button" className="rx-button" onClick={() => setAllergies(current => [...current, { substance_key: '', substance_display: '', reaction: '' }])}><Plus size={14}/> Add allergy</button>
      <p className="rx-muted">The substance key is generated from the name. It must match the key used by the curated medicine–allergen reference data.</p></div>}
      {error && <p className="rx-error" role="alert">{error}</p>}
      <div className="rx-footer"><button className="rx-button" type="button" onClick={onClose}>Cancel</button><button className="rx-button rx-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save allergy record'}</button></div>
    </form>
  </Dialog>;
}
function Field({ label, value, onChange, multiline = false, ...props }) {
  const Component = multiline ? 'textarea' : 'input';
  return <label className="rx-field"><span>{label}</span><Component {...props} value={value ?? ''} onChange={event => onChange(event.target.value)} rows={multiline ? 3 : undefined}/></label>;
}
const medicationSummary = row => [row.strength, row.dose, row.route, row.frequency, row.duration].filter(Boolean).join(' · ');
const typeLabel = row => ({ injection: 'Injection', vaccination: 'Vaccination' }[row.kind] || 'Medicine');
const factorDate = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString('en-IN') : 'Date not recorded';
function IngredientCatalogPicker({ value, onSelect }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  useEffect(() => {
    if (query.trim().length < 2) { setResults([]); return; }
    let active = true;
    const timer = setTimeout(async () => {
      setLoading(true);
      try { const rows = await searchMedicationCatalog(query.trim()); if (active) setResults(rows); }
      catch { if (active) setResults([]); }
      finally { if (active) setLoading(false); }
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [query]);
  return <div className="rx-catalog-picker"><label className="rx-field"><span>Active ingredient (medicine reference)</span><input value={query} onChange={event => { setQuery(event.target.value); onSelect(''); }} placeholder={value ? `Selected: ${value}` : 'Search curated medicine reference'} autoComplete="off"/></label>
    {loading && <small className="rx-muted">Searching reference data…</small>}
    {results.length > 0 && <div className="rx-catalog-results" role="listbox">{results.map(item => <button type="button" key={item.medication_key} onClick={() => { onSelect(item.medication_key); setQuery(item.display_name); setResults([]); }}><strong>{item.display_name}{item.is_demo && ' · DEMO ONLY'}</strong><small>{item.medication_key}</small></button>)}</div>}
    {query.length >= 2 && !loading && !results.length && <small className="rx-muted">No curated catalog match. Allergy associations will be unavailable for this item.</small>}
    {value && <small className="rx-muted">Catalog key: {value}</small>}
  </div>;
}
function MedicationEditor({ rows, onChange, selectedIds, inlineTemplates = [], allergyItems = [] }) {
  const previewRow = useRef(null);
  if (!previewRow.current) previewRow.current = blankMedication();
  const displayRows = rows.length ? rows : inlineTemplates.length ? [previewRow.current] : [];
  function update(id, key, value, suggestion) {
    onChange(displayRows.map(row => row.id === id ? { ...row, [key]: value,
      ...(suggestion && !row.source ? { source: { id: suggestion.template.id, version: suggestion.template.version, name: suggestion.template.name, preserveOnTemplateSwitch: true } } : {}),
    } : row));
  }
  return <div className="rx-stack">
    {displayRows.map((row, index) => { const suggestion = medicineCompletion(inlineTemplates, row, displayRows); return <fieldset className="rx-medication" key={row.id}>
      <legend>{typeLabel(row)} {index + 1}</legend>
      <div className="rx-med-head">
        <span className="rx-muted">{row.source ? `From ${row.source.name} · v${row.source.version}` : 'Prescription item'}</span>
        <button type="button" className="rx-text" onClick={() => onChange(rows.filter(item => item.id !== row.id))} aria-label={`Remove item ${index + 1}`}>Remove</button>
      </div>
      {allergyItems.find(item => item.medicationId === row.id)?.matches.length > 0 && <p className="rx-allergy-tag">Recorded medicine–allergy association. Review patient allergies before completing this prescription.</p>}
      <InlineGhostField label="Name" value={row.name} suggestedValue={suggestion?.medication.name}
        onChange={value => update(row.id, 'name', value)} onAccept={value => update(row.id, 'name', value, suggestion)}
        placeholder="Medicine, injection or vaccine" required={!selectedIds || selectedIds.includes(row.id)}/>
      <div className="rx-fields rx-three">
        {['dose', 'frequency', 'duration'].map(key => <InlineGhostField key={key} label={key[0].toUpperCase() + key.slice(1)} value={row[key]}
          suggestedValue={suggestion?.medication[key]} onChange={value => update(row.id, key, value)} onAccept={value => update(row.id, key, value, suggestion)}/>)}
      </div>
      <details className="rx-details"><summary>Strength, route & instructions</summary>
        <div className="rx-fields">
          <IngredientCatalogPicker value={row.ingredientKey} onSelect={value => update(row.id, 'ingredientKey', value)}/>
          <Field label="Strength" value={row.strength} onChange={value => update(row.id, 'strength', value)}/>
          <Field label="Route" value={row.route} onChange={value => update(row.id, 'route', value)}/>
          <label className="rx-field"><span>Item type</span><select value={row.kind || 'medicine'} onChange={event => update(row.id, 'kind', event.target.value)}><option value="medicine">Medicine</option><option value="injection">Injection</option><option value="vaccination">Vaccination</option></select></label>
          <Field label="Instructions" multiline value={row.instructions} onChange={value => update(row.id, 'instructions', value)}/>
        </div>
      </details>
    </fieldset>; })}
    <button type="button" className="rx-button" onClick={() => onChange([...rows, blankMedication()])}><Plus size={15}/> Add medicine</button>
  </div>;
}
function MatchingRules({ value, setValue, definitions }) {
  const change = key => next => setValue({ ...value, [key]: next });
  return <><FactorRuleEditor rules={value.factorRules || []} definitions={definitions} onChange={factorRules => setValue({ ...value, factorRules })}/><details className="rx-details"><summary>General criteria / existing tag rules</summary><div className="rx-fields">
    <label className="rx-field"><span>Pregnancy stage</span><select value={value.pregnancy} onChange={event => change('pregnancy')(event.target.value)}><option value="">Not specified</option>{['Not pregnant', 'First trimester', 'Second trimester', 'Third trimester', 'Postnatal'].map(stage => <option key={stage}>{stage}</option>)}</select></label>
    <Field label="Required factors" value={value.required} onChange={change('required')} placeholder="Comma separated"/>
    <Field label="Optional factors" value={value.optional} onChange={change('optional')} placeholder="Comma separated"/>
    <Field label="Excluded factors" value={value.exclusions} onChange={change('exclusions')} placeholder="Comma separated"/>
    <div className="rx-fields"><Field label="Minimum age" type="number" min="0" max="130" value={value.minAge} onChange={change('minAge')}/><Field label="Maximum age" type="number" min="0" max="130" value={value.maxAge} onChange={change('maxAge')}/></div>
  </div></details></>;
}
function TemplateEditor({ initial, onSave, onClose, definitions }) {
  const [value, setValue] = useState(() => structuredClone(initial));
  const [selected, setSelected] = useState(() => initial.medications.map(row => row.id));
  const [instructions, setInstructions] = useState(true);
  const [followUp, setFollowUp] = useState(true);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  async function submit(event) {
    event.preventDefault();
    if (saving) return;
    if (!value.name.trim()) { setError('Enter a template name.'); return; }
    if (value.minAge !== '' && value.maxAge !== '' && +value.minAge > +value.maxAge) { setError('Check the age range.'); return; }
    const result = { ...value, name: value.name.trim(), medications: value.medications.filter(row => selected.includes(row.id)), instructions: instructions ? value.instructions.trim() : '', followUp: followUp ? value.followUp.trim() : '' };
    if (!result.medications.length && !result.instructions && !result.followUp) { setError('Select at least one reusable item.'); return; }
    setSaving(true);
    try { if (await onSave(result)) onClose(); else setError('Could not save this template. Keep the dialog open and check the server connection.'); }
    catch { setError('Could not save this template. Check the server connection and try again.'); }
    finally { setSaving(false); }
  }
  return <Dialog title={initial.name ? 'Edit template' : 'Save for reuse'} subtitle="Set matching rules once; future visits reuse them." onClose={onClose}>
    <form className="rx-stack" onSubmit={submit}>
      <Field label="Template name" required maxLength={100} value={value.name} onChange={name => setValue({ ...value, name })} placeholder="A recognizable name"/>
      <Field label="Associated ailments / problem tags" value={value.purpose} onChange={purpose => setValue({ ...value, purpose })} placeholder="Optional · e.g. Type 1 diabetes, iron deficiency" aria-description="Organization tags only; template recommendations use patient factors and applicability rules."/>
      <p className="rx-muted">Review reusable text and remove patient names, dates and identifiers.</p>
      <details className="rx-details rx-rule-editor"><summary><SlidersHorizontal size={14}/> Matching rules</summary><p className="rx-muted">Rules apply to structured patient records. Unknown values stay unknown. Leave all rules blank for a general template.</p><MatchingRules value={value} setValue={setValue} definitions={definitions}/></details>
      <h3>Include in this template</h3>
      <div className="rx-inclusions">{value.medications.map((row, index) => <label key={row.id}><input type="checkbox" checked={selected.includes(row.id)} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))}/><span><strong>{row.name || `Item ${index + 1}`}</strong><span className="rx-med-summary">{medicationSummary(row)}</span></span></label>)}</div>
      <details className="rx-details" open={!value.medications.length && !value.instructions && !value.followUp}><summary>Edit reusable items</summary>
        <MedicationEditor rows={value.medications} selectedIds={selected} onChange={medications => {
          const existing = new Set(value.medications.map(row => row.id));
          setSelected(current => [...current.filter(id => medications.some(row => row.id === id)), ...medications.filter(row => !existing.has(row.id)).map(row => row.id)]);
          setValue({ ...value, medications });
        }}/>
      </details>
      <label className="rx-check"><input type="checkbox" checked={instructions} onChange={event => setInstructions(event.target.checked)}/> Include instructions</label>
      <Field label="Instructions" multiline value={value.instructions} onChange={next => setValue({ ...value, instructions: next })}/>
      <label className="rx-check"><input type="checkbox" checked={followUp} onChange={event => setFollowUp(event.target.checked)}/> Include follow-up</label>
      <Field label="Follow-up / investigations" multiline value={value.followUp} onChange={next => setValue({ ...value, followUp: next })}/>
      {error && <p role="alert" className="rx-error">{error}</p>}
      <div className="rx-footer"><span className="rx-muted">Clinician-saved template</span><button type="button" className="rx-button" onClick={onClose}>Cancel</button><button className="rx-button rx-primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save template'}</button></div>
    </form>
  </Dialog>;
}
function MatchScore({ match }) {
  return <div className={`rx-score ${match.conflicts.length ? 'rx-score-conflict' : ''}`}>
    <strong>{match.score === null ? '—' : `${match.score}%`}</strong><span>{match.score === null ? 'No comparison' : match.method === 'gower' ? 'patient similarity' : 'rules matched'}</span>
  </div>;
}
function MatchDetails({ match }) {
  const statistical = match.method === 'gower';
  return <div className="rx-match">
    <div className="rx-match-head"><MatchScore match={match}/><p>{statistical ? `${match.compared}/${match.featureCount} factors compared` : `${match.matched.length}/${match.total} rules matched`}<br/>{match.conflicts.length} rule conflicts</p></div>
    {statistical ? <>
      <p className="rx-muted">*Supported similarity = observed Gower similarity ({match.rawSimilarity === null ? 'unknown' : Math.round(match.rawSimilarity * 100) + '%'}) × data coverage ({Math.round(match.coverage * 100)}%). Numeric ranges come from prior accepted/edited suggestion cases. This is not a safety or treatment-success probability.</p>
      <details className="rx-details"><summary>Factor-by-factor comparison</summary>{match.similarityDetails.map(detail => <div className="rx-check-row" key={detail.factorId}><span>{detail.label}<small className="rx-comparison-values">Patient: {detail.actual ?? 'unknown'} ? Reference: {detail.expected ?? 'unknown'} {detail.unit}</small>{(detail.patientDate || detail.referenceDate) && <small className="rx-comparison-values">Patient date: {detail.patientDate || 'not supplied'} / Reference date: {detail.referenceDate || 'not supplied'}</small>}{detail.reason && <small className="rx-comparison-values">{detail.reason}</small>}</span><span>{detail.similarity === null ? 'Unknown' : Math.round(detail.similarity * 100) + '%'}</span></div>)}</details>
    </> : <p className="rx-muted">This template defines rules rather than a recorded numeric/categorical case. Its percentage describes rule compatibility, not statistical similarity.</p>}
    <details className="rx-details"><summary>Required criteria and exclusions</summary>{match.checks.map((check, index) => <div className="rx-check-row" key={index}><span>{check.label}</span><span className={check.status === 'conflict' ? 'rx-error' : check.status === 'unknown' ? 'rx-amber' : ''}>{({ matched: 'Matched', unknown: 'Unknown', conflict: 'Conflict', different: 'Different' })[check.status]}</span></div>)}</details>
  </div>;
}
function TemplatePreview({ template, context, onClose, onApply, onFeedback, eventId, patientName, similarityMatch, copyBlocked = false }) {
  const [selected, setSelected] = useState(template.medications.map(row => row.id));
  const [instructions, setInstructions] = useState(Boolean(template.instructions));
  const [followUp, setFollowUp] = useState(Boolean(template.followUp));
  const result = similarityMatch || evaluateTemplate(template, context);
  const allergy = allergyReview(template, context);
  const [applyError, setApplyError] = useState('');
  const [applying, setApplying] = useState(false);
  const [feedbackReason, setFeedbackReason] = useState('');
  const [feedbackComment, setFeedbackComment] = useState('');
  const [feedbackBusy, setFeedbackBusy] = useState(false);
  async function sendDecision(action) {
    if (!eventId || feedbackBusy) return;
    setFeedbackBusy(true); setApplyError('');
    try { await onFeedback({ eventId, templateId: template.id, action, reasonKey: feedbackReason || (action === 'deferred' ? 'review_later' : ''), comment: feedbackComment }); onClose(); }
    catch { setApplyError('The visit draft is unchanged, but this feedback could not be saved. Retry or record the decision later.'); }
    finally { setFeedbackBusy(false); }
  }
  return <Dialog title={template.name} subtitle={`For ${patientName} · Template version ${template.version}`} onClose={onClose}>
    <div className="rx-stack">
      <MatchDetails match={result}/>
      {(copyBlocked || result.conflicts.length > 0) && <p className="rx-amber">This template is available for review. Resolve its applicability conflicts before copying items into this visit.</p>}
      {result.missing.length > 0 && <p className="rx-amber">Some criteria are unknown. Review the patient record before using these items.</p>}
      {allergy.status === 'reported' && <section className={`rx-allergy-review ${allergy.matchedCount ? 'has-match' : ''}`} aria-label="Allergy review">
        <strong>{allergy.matchedCount ? 'Medicine–allergy association found — clinician review required' : 'Reported allergies — review before proceeding'}</strong>
        {allergy.allergies.length ? <p>Recorded in patient allergy record: {allergy.allergies.map(item => item.reaction ? `${item.name} (${item.reaction})` : item.name).join(', ')}</p> : <p>Allergy status says allergies are documented, but no allergy rows were returned. Check the patient record.</p>}
        {allergy.items.filter(item => item.matches.length).map(item => <p key={item.medicationId}><b>{item.medicationName}</b> is associated in the medicine reference data with: {item.matches.map(match => `${match.substance_display}${match.association_type ? ` (${match.association_type})` : ''}${match.source_name ? ` — ${match.source_name}` : ''}`).join(', ')}.</p>)}
        {allergy.uncheckedCount > 0 && <p>{allergy.uncheckedCount} medicine item(s) have no curated allergy mapping, so they could not be checked.</p>}
        <small>Associations are reference data for clinician review. Check the source and patient history before deciding whether to proceed.</small>
      </section>}
      {allergy.status !== 'reported' && allergy.status !== 'none-reported' && <p className="rx-amber">Drug allergy status is {allergy.status === 'review' ? 'not in a recognized state' : 'not assessed'}. Check the patient record before completing the prescription.</p>}
      {allergy.status === 'none-reported' && <p className="rx-muted">Allergy status recorded as no known drug allergies.</p>}
      {template.autoCapture && template.autoCapture.stage !== 'visit-completed' && <p className="rx-muted">This visit is still in progress. Its reusable copy becomes available after the visit ends.</p>}
      <h3>Select items to add</h3>
      {template.medications.map(row => { const itemAllergy = allergy.items.find(item => item.medicationId === row.id); return <label className={`rx-preview-item ${itemAllergy?.matches.length ? 'rx-allergy-item' : ''}`} key={row.id}><input type="checkbox" checked={selected.includes(row.id)} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))}/><span><span className="rx-overline">{typeLabel(row)}</span><strong>{row.name}</strong>{itemAllergy?.matches.length > 0 && <span className="rx-allergy-tag">Database association: {itemAllergy.matches.map(match => match.substance_display).join(', ')}</span>}{allergy.status === 'reported' && itemAllergy && !itemAllergy.checked && <span className="rx-amber">Allergy mapping unavailable for this medicine</span>}<span className="rx-med-summary">{medicationSummary(row) || 'Details to complete'}</span><span className="rx-preserve">{row.instructions}</span></span></label>; })}
      {template.instructions && <label className="rx-preview-item"><input type="checkbox" checked={instructions} onChange={event => setInstructions(event.target.checked)}/><span><strong>Instructions</strong><span className="rx-preserve">{template.instructions}</span></span></label>}
      {template.followUp && <label className="rx-preview-item"><input type="checkbox" checked={followUp} onChange={event => setFollowUp(event.target.checked)}/><span><strong>Follow-up / investigations</strong><span className="rx-preserve">{template.followUp}</span></span></label>}
      {eventId && <div className="rx-feedback-form"><strong>Suggestion decision</strong><p className="rx-muted">Your choice is stored to review the matcher. It is not a treatment outcome.</p><label className="rx-field"><span>Reason (optional)</span><select value={feedbackReason} onChange={event => setFeedbackReason(event.target.value)}><option value="">Choose a reason</option><option value="indication_mismatch">Ailment or category mismatch</option><option value="patient_context">Patient context</option><option value="allergy_or_safety_review">Allergy or safety review</option><option value="dose_or_regimen">Dose or regimen</option><option value="outdated_template">Template outdated</option><option value="other">Other</option></select></label><Field label="Comment (optional)" value={feedbackComment} onChange={setFeedbackComment} maxLength={1000} placeholder="Brief reason for this decision"/></div>}
      {allergy.status !== 'none-reported' && <section className="rx-allergy-list" aria-label="Patient allergy list"><strong>Patient allergy list</strong>{allergy.allergies.length ? <ul>{allergy.allergies.map((item, index) => <li key={`${item.name}-${index}`}>{item.name}{item.reaction && ` — ${item.reaction}`}</li>)}</ul> : <p>{allergy.status === 'reported' ? 'Allergy reported; details not recorded.' : 'No allergy details recorded.'}</p>}</section>}
      {applyError && <p role="alert" className="rx-error">{applyError}</p>}
      <div className="rx-footer"><span className="rx-muted">Adds to the editable draft for clinician review.</span><button type="button" className="rx-button" onClick={onClose}>Back</button>{eventId && <><button type="button" className="rx-button" disabled={feedbackBusy || applying} onClick={() => sendDecision('rejected')}>Not suitable</button><button type="button" className="rx-button" disabled={feedbackBusy || applying} onClick={() => sendDecision('deferred')}>Defer</button></>}<button type="button" className="rx-button rx-primary" disabled={applying || feedbackBusy || copyBlocked || result.conflicts.length > 0 || template.archived || (template.autoCapture && template.autoCapture.stage !== 'visit-completed') || (!selected.length && !instructions && !followUp)} onClick={async () => { setApplying(true); try { if (await onApply(template, selected, instructions, followUp, eventId, false, { reasonKey: feedbackReason, comment: feedbackComment })) onClose(); else setApplyError('The draft could not be saved to the server. Your selections remain open.'); } catch { setApplyError('The draft could not be saved to the server. Your selections remain open.'); } finally { setApplying(false); } }}>{applying ? 'Saving…' : <>Add to draft <ArrowRight size={15}/></>}</button></div>
    </div>
  </Dialog>;
}

function FeedbackHistory({ onClose }) {
  const [result, setResult] = useState(null);
  const [error, setError] = useState('');
  useEffect(() => { let active = true; fetchMedicationFeedbackAnalytics().then(value => { if (active) setResult(value); }).catch(() => { if (active) setError('Could not load saved recommendation feedback.'); }); return () => { active = false; }; }, []);
  return <Dialog title="Suggestion feedback" subtitle="Clinician decisions about template suggestions; this is not treatment outcome data." onClose={onClose}>
    {error ? <p className="rx-error" role="alert">{error}</p> : !result ? <p className="rx-muted">Loading feedback…</p> : <div className="rx-stack"><div className="rx-feedback-summary">{['total','accepted','edited','rejected','deferred'].map(key => <span key={key}><strong>{result.summary[key] || 0}</strong>{key}</span>)}</div>{result.events.length ? <div className="rx-feedback-list">{result.events.map(row => { const snapshot = row.recommendation?.feature_snapshot || {}; const records = Object.entries(snapshot.factorSnapshot || {}); const reports = snapshot.labReports || []; return <article key={row.id}><div><strong>{row.template_name}</strong><span>{row.action}{row.reason_key ? ` · ${row.reason_key.replaceAll('_', ' ')}` : ''}</span></div><small>{row.recommendation?.indication_display || 'Factor-based template search'} · {row.created_at ? new Date(row.created_at).toLocaleString() : 'Date unavailable'}</small>{row.clinician_comment && <p>{row.clinician_comment}</p>}<small>{Array.isArray(row.final_items) ? row.final_items.length : 0} selected item(s) captured</small>{row.recommendation && <details className="rx-details"><summary>Inputs and candidates shown</summary><p className="rx-muted">{records.length} confirmed factor(s) · {reports.length} linked lab report(s) · gestational week {snapshot.gestationalWeek ?? 'unknown'} · allergy review {snapshot.allergyReview?.status || 'not assessed'}</p>{row.recommendation.candidates?.map(candidate => <div className="rx-check-row" key={candidate.id}><span>{candidate.template_name}</span><span>{candidate.displayed ? `${candidate.displayed.score}% · ${candidate.displayed.method}` : 'Candidate'}</span></div>)}{records.length > 0 && <><strong>Similarity factors</strong>{records.map(([id, record]) => <div className="rx-check-row" key={id}><span>{record.label || id}</span><span>{record.value ?? 'Unknown'} {record.unit || ''}</span></div>)}</>}{reports.length > 0 && <><strong>Lab report values</strong>{reports.flatMap(report => (report.metrics || []).map(metric => <div className="rx-check-row" key={`${report.reportId}-${metric.id}`}><span>{metric.standard_key || metric.raw_key || 'Lab result'}<small className="rx-comparison-values">{report.reportDate || 'Date unavailable'} · {metric.needs_review ? 'review required' : 'recorded result'}</small></span><span>{metric.reviewed_value ?? metric.parsed_value ?? metric.raw_value ?? 'Unknown'} {metric.unit_standard || metric.unit_raw || ''}</span></div>))}</>}{(snapshot.vitals || []).length > 0 && <><strong>Visit vitals</strong>{snapshot.vitals.map(vital => <div className="rx-check-row" key={vital.id}><span>{vital.metric_key}<small className="rx-comparison-values">{vital.recorded_at || ''}</small></span><span>{vital.value} {vital.unit || ''}</span></div>)}</>}</details>}</article>; })}</div> : <p className="rx-muted">No suggestion decisions have been captured yet.</p>}<div className="rx-footer"><span className="rx-muted">Only explicit doctor decisions appear here.</span><button type="button" className="rx-button rx-primary" onClick={onClose}>Done</button></div></div>}
  </Dialog>;
}
function TemplateOption({ template, match, onPreview, matchLabel = '' }) {
  return <article className="rx-option">
    <MatchScore match={match}/>
    <div className="rx-option-content"><h4>{template.name}</h4><p>{template.medications.length} items{template.followUp ? ' · Follow-up' : ''}</p>{matchLabel && <small className="rx-match-label">{matchLabel}</small>}<span className={match.conflicts.length ? 'rx-error' : match.missing.length ? 'rx-amber' : 'rx-muted'}>{match.method === 'gower' ? `${match.compared}/${match.featureCount} compared / ${Math.round(match.coverage * 100)}% coverage${match.conflicts.length ? ' / Conflict' : ''}` : (match.total ? `${match.matched.length}/${match.total} rules matched` : 'No matching rules')}</span></div>
    <button type="button" className="rx-button rx-review" onClick={() => onPreview(template)}>Review <ChevronRight size={14}/></button>
  </article>;
}
function BrowseTemplates({ ranked, onClose, onPreview, onEdit, onArchive, onCreate }) {
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const visible = ranked.filter(({ template }) => Boolean(template.archived) === archived && `${template.name} ${template.required} ${template.purpose}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog title="Reusable template library" subtitle="Templates belong to the clinician library and can be reused across patients and visits." onClose={onClose}>
    <div className="rx-stack">
      <div className="rx-browse-tools"><label className="rx-search"><Search size={15}/><input aria-label="Search templates" value={query} placeholder="Search templates…" onChange={event => setQuery(event.target.value)}/></label><button className="rx-button" type="button" onClick={onCreate}><Plus size={15}/> Create</button></div>
      <label className="rx-check"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)}/> Show archived</label>
      {visible.map(({ template, match }) => <div className="rx-browse-card" key={template.id}><TemplateOption template={template} match={match} onPreview={onPreview}/><div className="rx-card-actions"><span className="rx-muted">v{template.version} · {template.status === 'draft' ? 'Needs clinician approval' : template.archived ? 'Archived' : 'Clinician approved'}{template.autoCapture ? (template.autoCapture.stage === 'visit-completed' ? ' · Auto-saved' : ' · Visit in progress') : ''}</span><button type="button" className="rx-text" onClick={() => onEdit(template)}><Pencil size={13}/> Edit</button><button type="button" className="rx-text" onClick={() => onEdit({ ...structuredClone(template), id: crypto.randomUUID(), name: template.name + ' (copy)', version: 1, archived: false, autoCapture: undefined, status: 'draft' })}><Copy size={13}/> Duplicate</button><button type="button" className="rx-text" onClick={() => onArchive(template)}><Archive size={13}/>{template.archived ? 'Restore' : 'Archive'}</button></div></div>)}
      {!visible.length && <p className="rx-muted">{query ? 'No templates match this search.' : archived ? 'No archived templates.' : 'No reusable templates yet. Create one here or use Medication Templates in the clinician navigation.'}</p>}
    </div>
  </Dialog>;
}

export function PrescriptionTemplates({ patient, appointment, appointmentId }) {
  const { user } = useAuthContext();
  if (!user?.id) return null;
  if (!patient?.id || !appointmentId) return <p className="rx-muted">Select a patient visit to open its prescription.</p>;
  return <Workspace key={`${user.id}:${patient.id}:${appointmentId}`} ownerId={user.id} patient={patient} appointment={appointment} appointmentId={appointmentId}/>;
}

export function MedicationTemplateLibraryPage() {
  const { user } = useAuthContext();
  const [collapsed, setCollapsed] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [definitions, setDefinitions] = useState(DEFAULT_FACTORS);
  const [dialog, setDialog] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [query, setQuery] = useState('');
  const [showArchived, setShowArchived] = useState(false);

  useEffect(() => {
    if (!user?.id) return undefined;
    let active = true;
    setLoading(true); setError('');
    Promise.all([fetchMedicationTemplates(), fetchMedicationFactorCatalog().catch(() => ({ definitions: [] }))]).then(async ([serverTemplates, catalog]) => {
      let rows = serverTemplates || [];
      const legacy = readLocal(storageKeys(user.id, '', '').library, [], validLibrary).value;
      const ids = new Set(rows.map(row => row.id));
      for (const item of legacy) {
        const id = item.autoCapture ? stableLegacyTemplateId(item.id) : item.id;
        if (ids.has(id)) continue;
        await saveMedicationTemplate({ ...item, id, autoCapture: undefined, factorSnapshot: undefined, clinicianApproved: true });
      }
      if (legacy.some(item => !ids.has(item.autoCapture ? stableLegacyTemplateId(item.id) : item.id))) rows = await fetchMedicationTemplates();
      if (!active) return;
      setTemplates(rows);
      if (Array.isArray(catalog?.definitions) && catalog.definitions.length) setDefinitions(catalog.definitions);
      setLoading(false);
    }).catch(() => { if (active) { setError('Could not load the clinician template library. Check the server and database migration.'); setLoading(false); } });
    return () => { active = false; };
  }, [user?.id]);

  async function save(value) {
    const existing = templates.find(item => item.id === value.id);
    await saveMedicationTemplate({ ...value, clinicianApproved: true, archived: existing ? Boolean(value.archived) : false, version: existing?.version || value.version || 1, updatedAt: new Date().toISOString() });
    setTemplates(await fetchMedicationTemplates()); setMessage('Reusable template saved. It is not linked to a patient visit.'); return true;
  }
  async function archive(template) {
    try {
      await saveMedicationTemplate({ ...template, archived: !template.archived, updatedAt: new Date().toISOString() });
      setTemplates(await fetchMedicationTemplates()); setMessage(template.archived ? 'Template restored.' : 'Template archived.');
    } catch { setError('Could not update this template.'); }
  }

  const visible = templates.filter(template => Boolean(template.archived) === showArchived && `${template.name} ${template.purpose} ${template.required} ${template.optional}`.toLowerCase().includes(query.toLowerCase()));
  return <div className="flex h-screen overflow-hidden bg-canvas"><Sidebar collapsed={collapsed} onToggle={() => setCollapsed(value => !value)}/><main className="flex-1 overflow-y-auto px-5 py-6 md:px-8"><div className="mx-auto max-w-5xl">
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4"><div><h1 className="font-display text-head-lg text-ink">Medication template library</h1><p className="mt-1 max-w-2xl text-body-md text-ink-2">Create and maintain reusable medicine regimens independently of a patient or consultation. Use ailment tags and factor rules to describe when a template may be relevant.</p></div><button type="button" className="rx-button rx-primary" onClick={() => setDialog({ type: 'edit', value: blankTemplate() })}><Plus size={15}/> Create template</button></header>
    <section className="rx-template-library"><div className="rx-browse-tools"><label className="rx-search"><Search size={15}/><input aria-label="Search templates" value={query} placeholder="Search names, ailments, or tags…" onChange={event => setQuery(event.target.value)}/></label><label className="rx-check"><input type="checkbox" checked={showArchived} onChange={event => setShowArchived(event.target.checked)}/> Show archived</label></div>
      {message && <p role="status" className="rx-success">{message}</p>}{error && <p role="alert" className="rx-error">{error}</p>}
      {loading ? <p className="rx-muted">Loading templates…</p> : visible.length ? <div className="rx-template-library-list">{visible.map(template => <article className="rx-template-library-card" key={template.id}><div className="rx-template-library-main"><div><h2>{template.name}</h2><p>{template.medications.length} medicine item(s) · v{template.version} · {template.status === 'active' && !template.archived ? 'Clinician approved' : template.archived ? 'Archived' : 'Draft'}</p>{template.purpose && <p><strong>Ailment tags:</strong> {template.purpose}</p>}{template.factorRules?.length > 0 && <p><strong>Applicability:</strong> {template.factorRules.map(rule => `${rule.label} ${({equals:'=',min:'≥',max:'≤'})[rule.operator]} ${rule.value}${rule.unit ? ` ${rule.unit}` : ''}`).join(' · ')}</p>}</div><div className="rx-template-library-actions"><button type="button" className="rx-text" onClick={() => setDialog({ type: 'edit', value: structuredClone(template) })}><Pencil size={13}/> Edit</button><button type="button" className="rx-text" onClick={() => setDialog({ type: 'edit', value: { ...structuredClone(template), id: crypto.randomUUID(), name: `${template.name} (copy)`, version: 1, archived: false } })}><Copy size={13}/> Duplicate</button><button type="button" className="rx-text" onClick={() => archive(template)}><Archive size={13}/>{template.archived ? 'Restore' : 'Archive'}</button></div></div>{template.medications.map(item => <div className="rx-template-library-med" key={item.id}><strong>{item.name}</strong><span>{medicationSummary(item) || 'Regimen details not specified'}</span></div>)}</article>)}</div> : <div className="rx-quiet-empty"><FileText size={22}/><div><strong>{query ? 'No templates match this search' : showArchived ? 'No archived templates' : 'No reusable templates yet'}</strong><p>Create a clinician-approved regimen here. It can later be suggested during any visit with matching recorded factors.</p></div></div>}
    </section>
    {dialog?.type === 'edit' && <TemplateEditor definitions={definitions} initial={dialog.value} onClose={() => setDialog(null)} onSave={save}/>}
  </div></main></div>;
}

function Workspace({ ownerId, patient, appointment, appointmentId, reports }) {
  const [templates, setTemplates] = useState([]);
  const [draft, setDraft] = useState(blankDraft());
  const [serverContext, setServerContext] = useState({ allergyReview: { status: 'not_assessed' }, allergies: [] });
  const [dataReady, setDataReady] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [reloadToken, setReloadToken] = useState(0);
  const draftRef = useRef(draft);
  const dataReadyRef = useRef(dataReady);
  draftRef.current = draft;
  dataReadyRef.current = dataReady;
  const [dialog, setDialog] = useState(null);
  const [message, setMessage] = useState('');
  const [templateQuery, setTemplateQuery] = useState('');
  const [templateSearchStarted, setTemplateSearchStarted] = useState(false);
  const [selectingTemplate, setSelectingTemplate] = useState(false);
  const templateSelectionBusy = useRef(false);
  const queuedTemplateSelection = useRef(null);
  const [error, setError] = useState('');
  const factors = usePrescriptionFactors({ ownerId, patient, appointment, appointmentId });
  const context = useMemo(() => ({ ...contextWithFactors(buildPatientContext(patient, appointment), factors.definitions, factors.records), ...serverContext }), [patient, appointment, factors.definitions, factors.records, serverContext]);
  const activeFactors = factors.definitions.filter(definition => definition.enabled);
  const populatedFactors = activeFactors.filter(definition => usableFactor(definition, factors.records[definition.id]));

  useEffect(() => {
    let active = true;
    setDataReady(false); setLoadError('');
    (async () => {
      const [initialTemplates, initialDraft, savedContext] = await Promise.all([fetchMedicationTemplates(), fetchPrescriptionDraft(appointmentId), fetchMedicationContext(appointmentId)]);
      let savedTemplates = initialTemplates || [];
      let savedDraft = initialDraft;
      const legacyKeys = storageKeys(ownerId, patient.id, appointmentId);
      const legacyTemplates = readLocal(legacyKeys.library, [], validLibrary).value;
      const savedTemplateIds = new Set(savedTemplates.map(template => template.id));
      for (const template of legacyTemplates) {
        const id = template.autoCapture ? stableLegacyTemplateId(template.id) : template.id;
        if (savedTemplateIds.has(id)) continue;
        await saveMedicationTemplate({ ...template, id, ...(template.autoCapture ? { factorRules: [] } : {}), factorSnapshot: undefined, clinicianApproved: !template.autoCapture });
      }
      if (legacyTemplates.some(template => !savedTemplateIds.has(template.autoCapture ? stableLegacyTemplateId(template.id) : template.id))) savedTemplates = await fetchMedicationTemplates();
      if (!savedDraft?.updatedAt) {
        const legacy = readLocal(legacyKeys.draft, blankDraft(), validDraft).value;
        if (legacy.medications.length || legacy.instructions || legacy.followUp) {
          await savePrescriptionDraft(appointmentId, legacy);
          savedDraft = { draft: legacy };
        }
      }
      if (active) {
        setTemplates(savedTemplates || []);
        setDraft(savedDraft?.draft || blankDraft());
        setServerContext({ allergyReview: savedContext?.allergyReview || { status: 'not_assessed' }, allergies: savedContext?.allergies || [] });
        setDataReady(true);
      }
    })().catch(() => { if (active) { setLoadError('Prescription templates, draft, or allergy data could not be loaded from the server. Retry after checking the connection and migration.'); setDataReady(false); } });
    return () => { active = false; };
  }, [ownerId, patient.id, appointmentId, reloadToken]);

  useEffect(() => {
    if (!dataReady) return undefined;
    const timer = setTimeout(() => savePrescriptionDraft(appointmentId, draft).catch(() => setError('The latest prescription draft could not be saved to the server.')) , 450);
    return () => clearTimeout(timer);
  }, [draft, dataReady, appointmentId]);
  useEffect(() => () => {
    if (dataReadyRef.current) savePrescriptionDraft(appointmentId, draftRef.current).catch(() => {});
  }, [appointmentId]);
  function saveDraft(next, announce = true) {
    draftRef.current = next;
    setDraft(next);
    if (announce) setMessage(next.feedbackEventIds?.length ? 'Draft saved; linked suggestion feedback will track the final medicine list.' : 'Draft saved to the patient visit.');
    else setMessage('');
    return true;
  }
  async function storeTemplate(value) {
    const clean = templateFromDraft(value);
    const row = { ...value, ...(value.autoCapture ? { autoCapture: { ...value.autoCapture, customized: true } } : {}), medications: clean.medications, factorSnapshot: undefined, clinicianApproved: true, version: templates.find(item => item.id === value.id)?.version || 1, updatedAt: new Date().toISOString() };
    await saveMedicationTemplate(row);
    const next = await fetchMedicationTemplates();
    setTemplates(next); setMessage('Clinician template saved to the database.'); return true;
  }
  async function archive(template) {
    try {
      const result = await saveMedicationTemplate({ ...template, archived: !template.archived, factorSnapshot: undefined, updatedAt: new Date().toISOString() });
      const next = await fetchMedicationTemplates(); setTemplates(next); return result;
    } catch { setError('The template could not be updated on the server.'); return false; }
  }
  const ranked = useMemo(() => {
    const active = templates.filter(template => template.status === 'active' && !template.archived);
    const recommended = rankTemplates(active, context, factors.definitions);
    const scored = new Set(recommended.map(item => item.template.id));
    const reviewOnly = templates.filter(template => !scored.has(template.id)).map(template => ({ template, match: { ...evaluateTemplate(template, context), candidate: false, suggested: false, method: 'rules' } }));
    return [...recommended, ...reviewOnly];
  }, [templates, context, factors.definitions]);
  const rankedForVisit = useMemo(() => rankTemplates(templates.filter(template => template.status === 'active' && !template.archived), context, factors.definitions), [templates, context, factors.definitions]);
  const searchReady = dataReady && !factors.loading && !factors.error && !factors.maternity.loading;
  const templateSearch = useLiveTemplateSearch({ appointmentId, ranked: rankedForVisit, context, query: templateQuery,
    enabled: templateSearchStarted && searchReady });
  const recommendationEvent = templateSearch.event;
  const candidateIds = recommendationEvent?.candidates?.map(candidate => candidate.id) || [];
  const confirmedSuggestions = templateSearch.matches;
  const draftAllergies = allergyReview(draft, context);
  const activeCount = templates.filter(template => template.status === 'active' && !template.archived).length;
  const close = () => setDialog(null);
  const showPreview = template => {
    const isCandidate = candidateIds.includes(template.id);
    setDialog({ type: 'preview', value: template, eventId: isCandidate ? recommendationEvent?.eventId : '', similarityMatch: (isCandidate ? rankedForVisit : ranked).find(item => item.template.id === template.id)?.match });
  };
  async function applyTemplateSelection(template, ids, instructions, followUp, eventId, direct = false, decision = null) {
    if (templateSelectionBusy.current) {
      if (direct) queuedTemplateSelection.current = () => applyTemplateSelection(template, ids, instructions, followUp, eventId, direct);
      return false;
    }
    if (template.archived || evaluateTemplate(template, context).conflicts.length || confirmedSuggestions.find(row => row.template.id === template.id)?.reviewOnly) {
      showPreview(template); return false;
    }
    const previous = draftRef.current;
    const result = fillDraftFromTemplate(previous, template, { selectedIds: ids, includeInstructions: instructions, includeFollowUp: followUp });
    const previousIds = new Set(previous.medications.map(item => item.id));
    const copiedIds = new Set(result.copiedIds || result.draft.medications.filter(item => !previousIds.has(item.id)).map(item => item.id));
    if (direct && !copiedIds.size && !result.replaced) { setMessage('These medicines are already in the prescription. Existing dose and frequency values were kept.'); return true; }
    templateSelectionBusy.current = true; setSelectingTemplate(true); setError('');
    saveDraft(result.draft, false);
    const duplicateCount = Math.max(0, result.skipped - (result.filled || 0));
    const message = direct ? 'Saved medicines, dose, frequency and duration filled into the editable prescription.' : 'Selected items added to your draft.';
    setMessage(message + (result.replaced ? ' Previous template medicines replaced.' : '') + (duplicateCount ? ` ${duplicateCount} existing item(s) kept.` : ''));
    try {
      await savePrescriptionDraft(appointmentId, result.draft);
      if (eventId && copiedIds.size) {
        try {
          const unchanged = !result.filled && ids.length === template.medications.length && result.skipped === 0 &&
            (direct ? !template.instructions && !template.followUp : instructions === Boolean(template.instructions) && followUp === Boolean(template.followUp));
          const feedback = await submitMedicationFeedback({ eventId, templateId: template.id, action: unchanged ? 'accepted' : 'edited',
            reasonKey: decision?.reasonKey || (unchanged ? null : 'selection_or_duplicate_edit'),
            comment: decision?.comment || '',
            finalItems: draftRef.current.medications.filter(item => copiedIds.has(item.id)).map(({ name, ingredientKey, strength, dose, route, frequency, duration, kind }) => ({ name, ingredientKey, strength, dose, route, frequency, duration, kind })) });
          const current = draftRef.current;
          const tracked = { ...current, feedbackEventIds: [...new Set([...(current.feedbackEventIds || []), feedback.id])],
            medications: current.medications.map(item => copiedIds.has(item.id) ? { ...item, source: { ...item.source, feedbackEventId: feedback.id } } : item) };
          draftRef.current = tracked; setDraft(tracked);
          await savePrescriptionDraft(appointmentId, tracked);
        } catch { setError('Prescription fields were filled and saved, but decision tracking could not be fully saved.'); }
      }
      return true;
    } catch { setError('Prescription fields were filled, but could not be saved to the server. Keep this visit open and check the connection.'); return false; }
    finally {
      templateSelectionBusy.current = false; setSelectingTemplate(false);
      const queued = queuedTemplateSelection.current; queuedTemplateSelection.current = null;
      if (queued) void queued();
    }
  }
  const selectTemplate = template => applyTemplateSelection(template, template.medications.map(row => row.id), false, false,
    candidateIds.includes(template.id) ? recommendationEvent?.eventId : '', true);
  async function recordFeedback(feedback) {
    await submitMedicationFeedback(feedback);
    setMessage(`Recorded the ${feedback.action} decision for this suggestion.`);
  }
  if (!dataReady) return <section className="rx-workspace rx-inline" aria-label="Prescription suggestions and draft">
    {loadError ? <div className="rx-note" role="alert"><p>{loadError}</p><button type="button" className="rx-button" onClick={() => setReloadToken(value => value + 1)}>Retry loading</button></div> : <p className="rx-muted">Loading saved prescription data…</p>}
  </section>;
  return <section className="rx-workspace rx-inline" aria-label="Prescription suggestions and draft">
    <div className="rx-section-top"><span className="rx-overline">CURRENT VISIT</span><div className="rx-inline-actions"><button type="button" className="rx-button" onClick={() => setDialog({ type: 'allergies' })}>Patient allergies</button><button type="button" className="rx-text" onClick={() => setDialog({ type: 'browse' })}><BookOpen size={14}/> Templates{activeCount ? ` (${activeCount})` : ''}</button></div></div>
    {error && <p className="rx-error rx-note" role="alert">{error}</p>}
    {message && <p className="rx-success" role="status">{message}</p>}
    <div className="rx-draft-summary rx-direct-editor">
      <div className="rx-section-label"><h3>Medicines & duration</h3><span className="rx-chip">Saved to visit</span></div>
      <TemplateAutocomplete query={templateQuery} onQueryChange={setTemplateQuery}
        onStart={() => setTemplateSearchStarted(true)} matches={confirmedSuggestions}
        loading={templateSearch.loading} error={templateSearch.error} onRetry={templateSearch.retry}
        onSelect={selectTemplate} onPreview={showPreview} selecting={selectingTemplate}/>
      {!searchReady && <p className="rx-amber">Templates remain available to browse. Patient factors need attention before similarity suggestions can be checked.</p>}
      <MedicationEditor rows={draft.medications} onChange={medications => saveDraft({ ...draft, medications }, false)} inlineTemplates={confirmedSuggestions} allergyItems={draftAllergies.items}/>
      <details className="rx-details" open={Boolean(draft.instructions || draft.followUp)}>
        <summary>Patient instructions & follow-up</summary>
        <div className="rx-stack">
          <Field label="Patient instructions" multiline value={draft.instructions} onChange={instructions => saveDraft({ ...draft, instructions }, false)}/>
          <Field label="Follow-up / investigations" multiline value={draft.followUp} onChange={followUp => saveDraft({ ...draft, followUp }, false)}/>
        </div>
      </details>
      <p className="rx-muted" role="status">Visit prescriptions stay in the visit draft. Save a clinician-reviewed regimen as a template for future suggestions.</p>
    </div>
    <div className="rx-inline-actions"><button type="button" className="rx-text" onClick={() => setDialog({ type: 'feedback' })}>Suggestion feedback</button></div>
    <p className="rx-score-caption">Patient similarity accounts for both closeness and available data. It is not treatment safety, accuracy or a calibrated probability.</p>
    {activeCount > 0 && <button type="button" className="rx-text rx-view-all" onClick={() => setDialog({ type: 'browse' })}>View all {activeCount} templates <ArrowRight size={13}/></button>}
    <details className="rx-factor-collapsible" aria-label="Review or add matching factors">
      <summary><span><strong>Review / add factors</strong><small>{populatedFactors.length} recorded · maternity card, profile and visit entries</small></span><span>{factors.maternity.loading ? 'Loading card…' : 'Optional'}</span></summary>
      <div className="rx-factor-review-body">
        <p className="rx-muted">Matching uses the latest values recorded on the maternity card, plus any visit-specific entries you add. Each value shows its source and date for review; missing values stay blank.</p>
        {factors.maternity.error && <p className="rx-amber">{factors.maternity.error}</p>}
        {factors.error && <p className="rx-error" role="alert">{factors.error}</p>}
        {populatedFactors.length ? <div className="rx-factor-review-list">{populatedFactors.map(definition => { const record = factors.records[definition.id]; return <div key={definition.id}><strong>{definition.label}</strong><span>{record.value} {record.unit || definition.unit || ''}</span><small>{record.source || 'Recorded factor'} · {factorDate(record.recordedAt)}</small></div>; })}</div> : <p className="rx-muted">No matching factors recorded yet. Add only the details relevant to this visit.</p>}
        <button type="button" className="rx-button" onClick={() => setDialog({ type: 'factors' })}>Review / add factors</button>
      </div>
    </details>
    <p className="rx-local">Draft and templates are stored with the clinician visit record. The draft is not sent to the patient until the clinician publishes it.</p>
    {dialog?.type === 'factors' && <Dialog title="Factors" subtitle="Review report values, fill missing details, or add your own reusable fields." onClose={close}><FactorsEditor factors={factors}/></Dialog>}
    {dialog?.type === 'allergies' && <AllergyEditor context={serverContext} appointmentId={appointmentId} onClose={close} onSaved={async () => { const updated = await fetchMedicationContext(appointmentId); setServerContext({ allergyReview: updated?.allergyReview || { status: 'not_assessed' }, allergies: updated?.allergies || [] }); }}/ >}
    {dialog?.type === 'browse' && <BrowseTemplates ranked={ranked} onClose={close} onPreview={showPreview} onEdit={value => setDialog({ type: 'template', value })} onArchive={archive} onCreate={() => setDialog({ type: 'template', value: blankTemplate() })}/>}
    {dialog?.type === 'template' && <TemplateEditor definitions={factors.definitions} key={dialog.value.id} initial={dialog.value} onClose={close} onSave={storeTemplate}/>}
    {dialog?.type === 'feedback' && <FeedbackHistory onClose={close}/>}
    {dialog?.type === 'preview' && <TemplatePreview template={dialog.value} eventId={dialog.eventId} onFeedback={recordFeedback} similarityMatch={dialog.similarityMatch} copyBlocked={Boolean(confirmedSuggestions.find(row => row.template.id === dialog.value.id)?.reviewOnly)} context={context} patientName={patient.name} onClose={close} onApply={applyTemplateSelection}/>}
  </section>;
}
