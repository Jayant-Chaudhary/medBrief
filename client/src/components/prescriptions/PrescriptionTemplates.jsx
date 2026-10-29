import { useEffect, useMemo, useRef, useState, useId } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Search, X, Copy, Archive, Check, ArrowRight, BookOpen, Pencil, ChevronRight, FileText, SlidersHorizontal } from 'lucide-react';
import { useAuthContext } from '../../context/AuthContext.jsx';
import { blankDraft, blankMedication, blankTemplate, templateFromDraft, evaluateTemplate, applyTemplate, storageKeys, readLocal, validDraft, validLibrary, buildPatientContext, rankTemplates, autoTemplateId, capturePrescriptionTemplate } from './templateModel.js';
import { usePrescriptionFactors, FactorsEditor, FactorRuleEditor } from './FactorsEditor.jsx';
import { contextWithFactors, usableFactor } from './factorModel.js';
import { selectGhostSuggestion, acceptGhostItem, emptyMedicationRow, handleGhostKey } from './similarityModel.js';
import { GhostSuggestion } from './GhostSuggestion.jsx';
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
function Field({ label, value, onChange, multiline = false, ...props }) {
  const Component = multiline ? 'textarea' : 'input';
  return <label className="rx-field"><span>{label}</span><Component {...props} value={value ?? ''} onChange={event => onChange(event.target.value)} rows={multiline ? 3 : undefined}/></label>;
}
const medicationSummary = row => [row.strength, row.dose, row.route, row.frequency, row.duration].filter(Boolean).join(' · ');
const typeLabel = row => ({ injection: 'Injection', vaccination: 'Vaccination' }[row.kind] || 'Medicine');
function MedicationEditor({ rows, onChange, selectedIds, ghostSuggestion, onAcceptGhost, onDismissGhost }) {
  const ghostTarget = rows.find(emptyMedicationRow)?.id;
  function update(id, key, value) { onChange(rows.map(row => row.id === id ? { ...row, [key]: value } : row)); }
  return <div className="rx-stack">
    {rows.map((row, index) => <fieldset className="rx-medication" key={row.id}>
      <legend>{typeLabel(row)} {index + 1}</legend>
      <div className="rx-med-head">
        <span className="rx-muted">{row.source ? `From ${row.source.name} · v${row.source.version}` : 'Prescription item'}</span>
        <button type="button" className="rx-text" onClick={() => onChange(rows.filter(item => item.id !== row.id))} aria-label={`Remove item ${index + 1}`}>Remove</button>
      </div>
      <Field label="Name" value={row.name} onChange={value => update(row.id, 'name', value)} placeholder={ghostSuggestion && ghostTarget === row.id ? ghostSuggestion.medication.name + '  [Tab]' : 'Medicine, injection or vaccine'}
        aria-description={ghostSuggestion && ghostTarget === row.id ? 'Suggested saved medicine. Tab accepts all displayed item details. Escape dismisses.' : undefined}
        onKeyDown={event => { if (ghostTarget === row.id) handleGhostKey(event, row, ghostSuggestion, onAcceptGhost, onDismissGhost); }} required={!selectedIds || selectedIds.includes(row.id)}/>
      <div className="rx-fields rx-three">
        <Field label="Dose" value={row.dose} onChange={value => update(row.id, 'dose', value)}/>
        <Field label="Frequency" value={row.frequency} onChange={value => update(row.id, 'frequency', value)}/>
        <Field label="Duration" value={row.duration} onChange={value => update(row.id, 'duration', value)}/>
      </div>
      <details className="rx-details"><summary>Strength, route & instructions</summary>
        <div className="rx-fields">
          <Field label="Strength" value={row.strength} onChange={value => update(row.id, 'strength', value)}/>
          <Field label="Route" value={row.route} onChange={value => update(row.id, 'route', value)}/>
          <label className="rx-field"><span>Item type</span><select value={row.kind || 'medicine'} onChange={event => update(row.id, 'kind', event.target.value)}><option value="medicine">Medicine</option><option value="injection">Injection</option><option value="vaccination">Vaccination</option></select></label>
          <Field label="Instructions" multiline value={row.instructions} onChange={value => update(row.id, 'instructions', value)}/>
        </div>
      </details>
    </fieldset>)}
    <button type="button" className="rx-button" onClick={() => onChange([...rows, blankMedication()])}><Plus size={15}/> Add medicine</button>
  </div>;
}
function MatchingRules({ value, setValue, definitions }) {
  const change = key => next => setValue({ ...value, [key]: next });
  return <><FactorRuleEditor rules={value.factorRules || []} definitions={definitions} onChange={factorRules => setValue({ ...value, factorRules })}/><details className="rx-details"><summary>General criteria / existing tag rules</summary><div className="rx-fields">
    <Field label="Consultation purpose" value={value.purpose} onChange={change('purpose')} placeholder="Optional"/>
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
  function submit(event) {
    event.preventDefault();
    if (!value.name.trim()) { setError('Enter a template name.'); return; }
    if (value.minAge !== '' && value.maxAge !== '' && +value.minAge > +value.maxAge) { setError('Check the age range.'); return; }
    const result = { ...value, name: value.name.trim(), medications: value.medications.filter(row => selected.includes(row.id)), instructions: instructions ? value.instructions.trim() : '', followUp: followUp ? value.followUp.trim() : '' };
    if (!result.medications.length && !result.instructions && !result.followUp) { setError('Select at least one reusable item.'); return; }
    if (onSave(result)) onClose();
    else setError('Could not save this template. Keep the dialog open and check browser storage.');
  }
  return <Dialog title={initial.name ? 'Edit template' : 'Save for reuse'} subtitle="Set matching rules once; future visits reuse them." onClose={onClose}>
    <form className="rx-stack" onSubmit={submit}>
      <Field label="Template name" required maxLength={100} value={value.name} onChange={name => setValue({ ...value, name })} placeholder="A recognizable name"/>
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
      <div className="rx-footer"><span className="rx-muted">Only me · Local library</span><button type="button" className="rx-button" onClick={onClose}>Cancel</button><button className="rx-button rx-primary" type="submit">Save template</button></div>
    </form>
  </Dialog>;
}
function MatchScore({ match }) {
  return <div className={`rx-score ${match.conflicts.length ? 'rx-score-conflict' : ''}`}>
    <strong>{match.score === null ? '—' : `${match.score}%`}</strong><span>{match.score === null ? 'No comparison' : match.method === 'gower' ? 'similarity*' : 'rule match'}</span>
  </div>;
}
function MatchDetails({ match }) {
  const statistical = match.method === 'gower';
  return <div className="rx-match">
    <div className="rx-match-head"><MatchScore match={match}/><p>{statistical ? `${match.compared}/${match.featureCount} factors compared` : `${match.matched.length}/${match.total} rules matched`}<br/>{match.conflicts.length} rule conflicts</p></div>
    {statistical ? <>
      <p className="rx-muted">*Supported similarity = observed Gower similarity ({match.rawSimilarity === null ? 'unknown' : Math.round(match.rawSimilarity * 100) + '%'}) ? data coverage ({Math.round(match.coverage * 100)}%). Numeric ranges come from completed reference cases, not this patient. This is not a safety probability.</p>
      <details className="rx-details"><summary>Factor-by-factor comparison</summary>{match.similarityDetails.map(detail => <div className="rx-check-row" key={detail.factorId}><span>{detail.label}<small className="rx-comparison-values">Patient: {detail.actual ?? 'unknown'} ? Reference: {detail.expected ?? 'unknown'} {detail.unit}</small>{(detail.patientDate || detail.referenceDate) && <small className="rx-comparison-values">Patient date: {detail.patientDate || 'not supplied'} / Reference date: {detail.referenceDate || 'not supplied'}</small>}{detail.reason && <small className="rx-comparison-values">{detail.reason}</small>}</span><span>{detail.similarity === null ? 'Unknown' : Math.round(detail.similarity * 100) + '%'}</span></div>)}</details>
    </> : <p className="rx-muted">This template defines rules rather than a recorded numeric/categorical case. Its percentage describes rule compatibility, not statistical similarity.</p>}
    <details className="rx-details"><summary>Required criteria and exclusions</summary>{match.checks.map((check, index) => <div className="rx-check-row" key={index}><span>{check.label}</span><span className={check.status === 'conflict' ? 'rx-error' : check.status === 'unknown' ? 'rx-amber' : ''}>{({ matched: 'Matched', unknown: 'Unknown', conflict: 'Conflict', different: 'Different' })[check.status]}</span></div>)}</details>
  </div>;
}
function TemplatePreview({ template, context, onClose, onApply, patientName, similarityMatch }) {
  const [selected, setSelected] = useState(template.medications.map(row => row.id));
  const [instructions, setInstructions] = useState(Boolean(template.instructions));
  const [followUp, setFollowUp] = useState(Boolean(template.followUp));
  const result = similarityMatch || evaluateTemplate(template, context);
  const [applyError, setApplyError] = useState('');
  return <Dialog title={template.name} subtitle={`For ${patientName} · Template version ${template.version}`} onClose={onClose}>
    <div className="rx-stack">
      <MatchDetails match={result}/>
      {result.conflicts.length > 0 && <p className="rx-error">A recorded factor conflicts with this template. Adding is disabled.</p>}
      {result.missing.length > 0 && <p className="rx-amber">Some criteria are unknown. Review the patient record before using these items.</p>}
      {template.autoCapture && template.autoCapture.stage !== 'visit-completed' && <p className="rx-muted">This visit is still in progress. Its reusable copy becomes available after the visit ends.</p>}
      <h3>Select items to add</h3>
      {template.medications.map(row => <label className="rx-preview-item" key={row.id}><input type="checkbox" checked={selected.includes(row.id)} onChange={event => setSelected(event.target.checked ? [...selected, row.id] : selected.filter(id => id !== row.id))}/><span><span className="rx-overline">{typeLabel(row)}</span><strong>{row.name}</strong><span className="rx-med-summary">{medicationSummary(row) || 'Details to complete'}</span><span className="rx-preserve">{row.instructions}</span></span></label>)}
      {template.instructions && <label className="rx-preview-item"><input type="checkbox" checked={instructions} onChange={event => setInstructions(event.target.checked)}/><span><strong>Instructions</strong><span className="rx-preserve">{template.instructions}</span></span></label>}
      {template.followUp && <label className="rx-preview-item"><input type="checkbox" checked={followUp} onChange={event => setFollowUp(event.target.checked)}/><span><strong>Follow-up / investigations</strong><span className="rx-preserve">{template.followUp}</span></span></label>}
      {applyError && <p role="alert" className="rx-error">{applyError}</p>}
      <div className="rx-footer"><button type="button" className="rx-button" onClick={onClose}>Back</button><button type="button" className="rx-button rx-primary" disabled={result.conflicts.length > 0 || template.archived || (template.autoCapture && template.autoCapture.stage !== 'visit-completed') || (!selected.length && !instructions && !followUp)} onClick={() => { if (onApply(template, selected, instructions, followUp)) onClose(); else setApplyError('The draft could not be saved to browser storage. Your selections remain open.'); }}>Add to draft <ArrowRight size={15}/></button></div>
    </div>
  </Dialog>;
}
function TemplateOption({ template, match, onPreview }) {
  return <article className="rx-option">
    <MatchScore match={match}/>
    <div className="rx-option-content"><h4>{template.name}</h4><p>{template.medications.length} items{template.followUp ? ' · Follow-up' : ''}</p><span className={match.conflicts.length ? 'rx-error' : match.missing.length ? 'rx-amber' : 'rx-muted'}>{match.method === 'gower' ? `${match.compared}/${match.featureCount} compared / ${Math.round(match.coverage * 100)}% coverage${match.conflicts.length ? ' / Conflict' : ''}` : (match.total ? `${match.matched.length}/${match.total} rules matched` : 'No matching rules')}</span></div>
    <button type="button" className="rx-button rx-review" onClick={() => onPreview(template)}>Review <ChevronRight size={14}/></button>
  </article>;
}
function BrowseTemplates({ ranked, onClose, onPreview, onEdit, onArchive, onCreate }) {
  const [query, setQuery] = useState('');
  const [archived, setArchived] = useState(false);
  const visible = ranked.filter(({ template }) => Boolean(template.archived) === archived && `${template.name} ${template.required} ${template.purpose}`.toLowerCase().includes(query.toLowerCase()));
  return <Dialog title="Your templates" subtitle="Browse or manage without leaving this consultation." onClose={onClose}>
    <div className="rx-stack">
      <div className="rx-browse-tools"><label className="rx-search"><Search size={15}/><input aria-label="Search templates" value={query} placeholder="Search templates…" onChange={event => setQuery(event.target.value)}/></label><button className="rx-button" type="button" onClick={onCreate}><Plus size={15}/> Create</button></div>
      <label className="rx-check"><input type="checkbox" checked={archived} onChange={event => setArchived(event.target.checked)}/> Show archived</label>
      {visible.map(({ template, match }) => <div className="rx-browse-card" key={template.id}><TemplateOption template={template} match={match} onPreview={onPreview}/><div className="rx-card-actions"><span className="rx-muted">v{template.version}{template.autoCapture ? (template.autoCapture.stage === 'visit-completed' ? ' / Auto-saved' : ' / Visit in progress') : ' / Only me'}</span><button type="button" className="rx-text" onClick={() => onEdit(template)}><Pencil size={13}/> Edit</button><button type="button" className="rx-text" onClick={() => onEdit({ ...structuredClone(template), id: crypto.randomUUID(), name: template.name + ' (copy)', version: 1, archived: false, autoCapture: undefined })}><Copy size={13}/> Duplicate</button><button type="button" className="rx-text" onClick={() => onArchive(template)}><Archive size={13}/>{template.archived ? 'Restore' : 'Archive'}</button></div></div>)}
      {!visible.length && <p className="rx-muted">{query ? 'No templates match this search.' : archived ? 'No archived templates.' : 'No templates yet. Write a prescription in this visit to save one automatically.'}</p>}
    </div>
  </Dialog>;
}

export function PrescriptionTemplates({ patient, appointment, appointmentId, reports = [] }) {
  const { user } = useAuthContext();
  if (!user?.id) return null;
  if (!patient?.id || !appointmentId) return <p className="rx-muted">Select a patient visit to open its prescription.</p>;
  return <Workspace key={`${user.id}:${patient.id}:${appointmentId}`} ownerId={user.id} patient={patient} appointment={appointment} appointmentId={appointmentId} reports={reports}/>;
}
function Workspace({ ownerId, patient, appointment, appointmentId, reports }) {
  const keys = storageKeys(ownerId, patient.id, appointmentId);
  const [libraryRead] = useState(() => readLocal(keys.library, [], validLibrary));
  const [draftRead] = useState(() => readLocal(keys.draft, blankDraft(), validDraft));
  const [templates, setTemplates] = useState(libraryRead.value);
  const [draft, setDraft] = useState(draftRead.value);
  const factors = usePrescriptionFactors({ ownerId, patient, appointment, appointmentId, reports });
  const context = useMemo(() => contextWithFactors(buildPatientContext(patient, appointment), factors.definitions, factors.records), [patient, appointment, factors.definitions, factors.records]);
  const activeFactors = factors.definitions.filter(definition => definition.enabled);
  const populatedFactors = activeFactors.filter(definition => usableFactor(definition, factors.records[definition.id]));
  const [dialog, setDialog] = useState(null);
  const [message, setMessage] = useState('');
  const [dismissedGhostKey, setDismissedGhostKey] = useState('');
  const [error, setError] = useState(libraryRead.error || draftRead.error);
  const [libraryBlocked, setLibraryBlocked] = useState(Boolean(libraryRead.error));
  const [draftBlocked, setDraftBlocked] = useState(Boolean(draftRead.error));
  const [autoStatus, setAutoStatus] = useState('Prescriptions save for reuse automatically');
  const autoCaptureRef = useRef(null);
  const templatesRef = useRef(templates);
  templatesRef.current = templates;
  const completed = appointment?.status === 'completed' || patient.visitStatus === 'completed';

  autoCaptureRef.current = (publish = true) => {
    if (libraryBlocked || draftBlocked || factors.error || factors.maternity.loading || factors.maternity.error) return;
    const current = templatesRef.current;
    const id = autoTemplateId(appointmentId);
    const previous = current.find(item => item.id === id);
    const captured = capturePrescriptionTemplate(previous, draft, context, appointmentId, completed);
    if (!captured || captured === previous) {
      if (publish && captured) setAutoStatus(completed ? 'Saved automatically for reuse' : 'Auto-saved; available for suggestions after the visit ends');
      return;
    }
    const next = previous ? current.map(item => item.id === id ? captured : item) : [captured, ...current];
    try {
      localStorage.setItem(keys.library, JSON.stringify(next));
      templatesRef.current = next;
      if (publish) {
        setTemplates(next);
        setAutoStatus(completed ? 'Saved automatically for reuse' : 'Auto-saved; available for suggestions after the visit ends');
      }
    } catch {
      if (publish) { setAutoStatus('Automatic template save failed'); setError('Could not save the reusable copy. Keep this page open and check browser storage.'); }
    }
  };
  useEffect(() => {
    if (factors.maternity.loading) setAutoStatus('Waiting for maternity card values...');
    else if (factors.maternity.error) setAutoStatus('Reusable copy paused while the maternity card is unavailable');
    else if (draft.medications.some(row => row.name.trim()) && !libraryBlocked && !draftBlocked && !factors.error) setAutoStatus('Saving reusable copy...');
    const timer = setTimeout(() => autoCaptureRef.current?.(), 800);
    return () => clearTimeout(timer);
  }, [draft, context, completed, libraryBlocked, draftBlocked, factors.error, factors.maternity.loading, factors.maternity.error]);
  useEffect(() => {
    const flush = () => autoCaptureRef.current?.(false);
    window.addEventListener('pagehide', flush);
    return () => { window.removeEventListener('pagehide', flush); flush(); };
  }, []);
  useEffect(() => {
    const listener = event => {
      if (event.key === keys.library || event.key === null) { setLibraryBlocked(true); setError('Templates changed in another tab. Reload before editing the library.'); }
      if (event.key === keys.draft || event.key === null) { setDraftBlocked(true); setError('The draft changed in another tab. Reload before saving further changes.'); }
    };
    window.addEventListener('storage', listener);
    return () => window.removeEventListener('storage', listener);
  }, [keys.library, keys.draft]);
  function write(key, value, blocked) {
    if (blocked) { setError('Writing is paused to preserve saved data. Reload after resolving the saved-data issue.'); return false; }
    try { localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { setError('Could not save in this browser. Keep this tab open and copy your draft before leaving.'); return false; }
  }
  function saveDraft(next, announce = true) {
    // Keep edits in memory even if browser storage fails.
    setDraft(next);
    const saved = write(keys.draft, next, draftBlocked);
    if (saved && announce) setMessage('Draft kept in this browser.');
    if (saved && !announce) setMessage('');
    return saved;
  }
  function storeTemplate(value) {
    const current = templates.find(row => row.id === value.id);
    const clean = templateFromDraft(value);
    const row = { ...value, ...(value.autoCapture ? { autoCapture: { ...value.autoCapture, customized: true } } : {}), medications: clean.medications, version: current ? current.version + 1 : 1, updatedAt: new Date().toISOString() };
    const next = current ? templates.map(item => item.id === row.id ? row : item) : [row, ...templates];
    if (!write(keys.library, next, libraryBlocked)) return false;
    setTemplates(next); setMessage('Template saved for reuse.'); return true;
  }
  function archive(template) {
    const next = templates.map(row => row.id === template.id ? { ...row, archived: !row.archived, updatedAt: new Date().toISOString() } : row);
    if (write(keys.library, next, libraryBlocked)) setTemplates(next);
  }
  const ranked = useMemo(() => rankTemplates(templates, context, factors.definitions, { excludeTemplateIds: [autoTemplateId(appointmentId)] }), [templates, context, factors.definitions, appointmentId]);
  const ghostChoice = selectGhostSuggestion(ranked, draft);
  const ghostReady = !libraryBlocked && !draftBlocked && !factors.error && !factors.maternity.loading && !factors.maternity.error;
  const ghostSuggestion = ghostReady && ghostChoice.suggestion?.key !== dismissedGhostKey ? ghostChoice.suggestion : null;
  const dismissGhost = () => setDismissedGhostKey(ghostSuggestion?.key || '');
  const acceptGhost = () => {
    if (!ghostReady || !ghostSuggestion) return;
    const latest = selectGhostSuggestion(ranked, draft).suggestion;
    if (!latest || latest.key !== ghostSuggestion.key) return;
    if (saveDraft(acceptGhostItem(draft, latest), false)) setMessage('Saved item added from the best recorded match. Review its dose and duration.');
  };
  const suggestions = ranked.filter(({ match, template }) => !template.archived && template.id !== autoTemplateId(appointmentId) && match.candidate).slice(0, 3);
  const activeCount = templates.filter(template => !template.archived).length;
  const reusableCount = templates.filter(template => !template.archived && template.id !== autoTemplateId(appointmentId) && (!template.autoCapture || template.autoCapture.stage === 'visit-completed')).length;
  const close = () => setDialog(null);
  const showPreview = template => setDialog({ type: 'preview', value: template });
  return <section className="rx-workspace rx-inline" aria-label="Prescription suggestions and draft">
    <div className="rx-section-top"><span className="rx-overline">CURRENT VISIT</span><button type="button" className="rx-text" onClick={() => setDialog({ type: 'browse' })}><BookOpen size={14}/> Templates{activeCount ? ` (${activeCount})` : ''}</button></div>
    <div className="rx-factors-area" aria-label="Factors">
      <div className="rx-section-label"><div><h3>Factors</h3><p className="rx-muted">{populatedFactors.length} available / {activeFactors.length} fields</p></div><button type="button" className="rx-button" onClick={() => setDialog({ type: 'factors' })}>Edit / add factors</button></div>
      <div className="rx-factor-chips">{populatedFactors.slice(0, 4).map(definition => <span key={definition.id}>{definition.label}: {factors.records[definition.id].value} {definition.unit}</span>)}</div>
      <p className="rx-muted">Shared report values are reused when available. Missing details stay unknown.</p>
      {factors.maternity.loading && <p className="rx-muted">Loading maternity card values...</p>}
      {factors.maternity.error && <p className="rx-amber">{factors.maternity.error}</p>}
      {factors.error && <p className="rx-error" role="alert">{factors.error}</p>}
    </div>
    {error && <p className="rx-error rx-note" role="alert">{error}</p>}
    {message && <p className="rx-success" role="status">{message}</p>}
    <div className="rx-draft-summary rx-direct-editor">
      <div className="rx-section-label"><h3>Medicines & duration</h3><span className="rx-chip">Local draft</span></div>
      <GhostSuggestion suggestion={ghostSuggestion} hasEmptyRow={draft.medications.some(emptyMedicationRow)} onAccept={acceptGhost} onDismiss={dismissGhost} onReview={() => showPreview(ghostSuggestion.template)}/>
      <MedicationEditor rows={draft.medications} onChange={medications => saveDraft({ ...draft, medications }, false)} ghostSuggestion={ghostSuggestion} onAcceptGhost={acceptGhost} onDismissGhost={dismissGhost}/>
      <details className="rx-details" open={Boolean(draft.instructions || draft.followUp)}>
        <summary>Patient instructions & follow-up</summary>
        <div className="rx-stack">
          <Field label="Patient instructions" multiline value={draft.instructions} onChange={instructions => saveDraft({ ...draft, instructions }, false)}/>
          <Field label="Follow-up / investigations" multiline value={draft.followUp} onChange={followUp => saveDraft({ ...draft, followUp }, false)}/>
        </div>
      </details>
      <p className="rx-muted" role="status">{autoStatus}. General notes stay with this patient.</p>
    </div>
    <div className="rx-section-label"><h3>Options for this patient</h3>{suggestions.length > 1 && <span className="rx-muted">Compare {suggestions.length} options</span>}</div>
    {suggestions.length > 0 ? <div className="rx-options">{suggestions.map(({ template, match }) => <TemplateOption key={template.id} template={template} match={match} onPreview={showPreview}/>)}</div> : <div className="rx-quiet-empty"><FileText size={22}/><div><strong>{reusableCount ? 'More patient information needed' : 'No previous treatment options yet'}</strong><p>{reusableCount ? 'No recorded criteria match. You can still browse your templates.' : 'Prescriptions save automatically and become options for other visits after the visit ends.'}</p></div></div>}
    <p className="rx-score-caption">Similarity* accounts for both closeness and available data. It is not treatment safety or a calibrated probability.</p>
    {suggestions.length > 0 && !ghostSuggestion && ghostChoice.reason && <p className="rx-score-caption">{ghostChoice.reason}</p>}
    {activeCount > 0 && <button type="button" className="rx-text rx-view-all" onClick={() => setDialog({ type: 'browse' })}>View all {activeCount} templates <ArrowRight size={13}/></button>}
    <p className="rx-local">Local to this browser. Not sent to the patient or included when ending the visit.</p>
    {dialog?.type === 'factors' && <Dialog title="Factors" subtitle="Review report values, fill missing details, or add your own reusable fields." onClose={close}><FactorsEditor factors={factors}/></Dialog>}
    {dialog?.type === 'browse' && <BrowseTemplates ranked={ranked} onClose={close} onPreview={showPreview} onEdit={value => setDialog({ type: 'template', value })} onArchive={archive} onCreate={() => setDialog({ type: 'template', value: blankTemplate() })}/>}
    {dialog?.type === 'template' && <TemplateEditor definitions={factors.definitions} key={dialog.value.id} initial={dialog.value} onClose={close} onSave={storeTemplate}/>}
    {dialog?.type === 'preview' && <TemplatePreview template={dialog.value} similarityMatch={ranked.find(item => item.template.id === dialog.value.id)?.match} context={context} patientName={patient.name} onClose={close} onApply={(template, ids, instructions, followUp) => {
      const result = applyTemplate(draft, template, ids, instructions, followUp);
      if (!saveDraft(result.draft)) return false;
      setMessage(`Selected items added to your draft.${result.skipped ? ` ${result.skipped} duplicate item(s) skipped; review existing entries.` : ''}`);
      return true;
    }}/>}
  </section>;
}
