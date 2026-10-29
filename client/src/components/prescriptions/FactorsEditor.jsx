import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Search, Settings2 } from 'lucide-react';
import { fetchMaternityCard } from '../../services/clinicianService.js';
import { mergeFactorDefinitions } from './maternityFactors.js';
import { readLocal } from './templateModel.js';
import { DEFAULT_FACTORS, FACTOR_GROUPS, FACTOR_SOURCES, validDefinitions, validFactorValues, resolveFactorValues, usableFactor } from './factorModel.js';

export function usePrescriptionFactors({ ownerId, patient, appointment, appointmentId, reports }) {
  const catalogKey = `medbrief.rx.factor-definitions.v1.${encodeURIComponent(ownerId)}`;
  const valuesKey = `medbrief.rx.factor-values.v1.${encodeURIComponent(ownerId)}.${encodeURIComponent(patient.id)}.${encodeURIComponent(appointmentId)}`;
  const [catalogRead] = useState(() => readLocal(catalogKey, DEFAULT_FACTORS, validDefinitions));
  const [valuesRead] = useState(() => readLocal(valuesKey, {}, validFactorValues));
  const [definitions, setDefinitions] = useState(() => mergeFactorDefinitions(catalogRead.value, DEFAULT_FACTORS));
  const [overrides, setOverrides] = useState(valuesRead.value);
  const [catalogBlocked, setCatalogBlocked] = useState(Boolean(catalogRead.error));
  const [valuesBlocked, setValuesBlocked] = useState(Boolean(valuesRead.error));
  const [error, setError] = useState(catalogRead.error || valuesRead.error);
  const [maternity, setMaternity] = useState({ card: null, loading: true, error: '' });
  const loadSequence = useRef(0);
  const refreshMaternity = useCallback(async () => {
    const sequence = ++loadSequence.current;
    setMaternity(current => ({ ...current, loading: true, error: '' }));
    try {
      const card = await fetchMaternityCard(patient.id);
      if (sequence !== loadSequence.current) return;
      if (card?.patient?.id !== patient.id) throw new Error('The returned maternity card does not match this patient.');
      setMaternity({ card, loading: false, error: '' });
    } catch {
      if (sequence === loadSequence.current) setMaternity({ card: null, loading: false, error: 'Maternity card unavailable. Report/profile values are still shown; retry to load the saved card.' });
    }
  }, [patient.id, ownerId]);
  useEffect(() => {
    refreshMaternity();
    window.addEventListener('focus', refreshMaternity);
    return () => { ++loadSequence.current; window.removeEventListener('focus', refreshMaternity); };
  }, [refreshMaternity]);
  const records = useMemo(() => resolveFactorValues(definitions, patient, appointment, reports, overrides, maternity.card), [definitions, patient, appointment, reports, overrides, maternity.card]);
  useEffect(() => {
    function changed(event) {
      if (event.key === catalogKey || event.key === valuesKey || event.key === null) {
        if (event.key !== valuesKey) setCatalogBlocked(true);
        if (event.key !== catalogKey) setValuesBlocked(true);
        setError('Factors changed in another tab. Reload before editing to avoid overwriting them.');
      }
    }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, [catalogKey, valuesKey]);
  function persist(key, value, blocked) {
    if (blocked) { setError('Factor saving is paused to preserve existing data. Reload before making changes.'); return false; }
    try { localStorage.setItem(key, JSON.stringify(value)); setError(''); return true; }
    catch { setError('Could not save factors in this browser. Keep the page open and copy changes before leaving.'); return false; }
  }
  function saveDefinition(definition) {
    const duplicate = definitions.some(item => item.id !== definition.id && item.label.trim().toLowerCase() === definition.label.trim().toLowerCase());
    if (duplicate) { setError('A factor with that name already exists.'); return false; }
    const next = definitions.some(item => item.id === definition.id) ? definitions.map(item => item.id === definition.id ? definition : item) : [...definitions, definition];
    if (!persist(catalogKey, next, catalogBlocked)) return false;
    setDefinitions(next); return true;
  }
  function saveValue(definition, value, reset = false) {
    const next = { ...overrides };
    if (reset) delete next[definition.id];
    else next[definition.id] = { value, unit: definition.unit, recordedAt: new Date().toISOString(), sourceRecordedAt: records[definition.id]?.sourceRecordedAt || records[definition.id]?.recordedAt || '', reportId: records[definition.id]?.reportId || '', metricId: records[definition.id]?.metricId || '' };
    // Retain edits in memory on storage failure, but display a visible save error.
    setOverrides(next);
    return persist(valuesKey, next, valuesBlocked);
  }
  return { definitions, records, overrides, saveDefinition, saveValue, error, maternity, refreshMaternity };
}
const formatDate = value => value && Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleDateString() : 'Date not supplied';
function DefinitionEditor({ initial, onSave, onCancel }) {
  const [value, setValue] = useState(initial || { id: 'custom-' + crypto.randomUUID(), label: '', type: 'text', options: ['Yes', 'No'], unit: '', group: 'Custom factors', enabled: true, custom: true });
  const [optionsText, setOptionsText] = useState((value.options || []).join(', '));
  const [error, setError] = useState('');
  return <form className="rx-stack rx-definition-editor" onSubmit={event => {
    event.preventDefault();
    const options = [...new Set(optionsText.split(',').map(item => item.trim()).filter(Boolean))];
    const label = value.label.trim();
    if (!label) { setError('Enter a factor name.'); return; }
    if (value.type === 'select' && options.length < 2) { setError('Provide at least two choices. Unknown is provided separately.'); return; }
    if (onSave({ ...value, label, unit: value.unit.trim(), options })) onCancel();
    else setError('Could not save this definition. Check the factor save message above.');
  }}>
    <h3>{initial ? 'Edit factor definition' : 'Add a reusable factor'}</h3>
    <label className="rx-field"><span>Factor name</span><input autoFocus required maxLength={100} value={value.label} onChange={event => setValue({ ...value, label: event.target.value })}/></label>
    <div className="rx-fields">
      <label className="rx-field"><span>Answer type</span><select disabled={Boolean(initial)} value={value.type} onChange={event => setValue({ ...value, type: event.target.value })}><option value="text">Text</option><option value="number">Number</option><option value="select">Choice / Yes–No</option><option value="date">Date</option><option value="datetime-local">Date and time</option></select></label>
      {value.type === 'number' && <label className="rx-field"><span>Unit</span><input disabled={Boolean(initial)} value={value.unit} onChange={event => setValue({ ...value, unit: event.target.value })} placeholder="e.g. kg"/></label>}
    </div>
    {value.type === 'select' && <label className="rx-field"><span>Choices (comma separated)</span><input disabled={Boolean(initial)} value={optionsText} onChange={event => setOptionsText(event.target.value)}/></label>}
    <p className="rx-muted">The field is added to your Factors list in future visits. Patient answers are stored separately. Existing field types and units are fixed so saved values are not reinterpreted.</p>
    {error && <p className="rx-error" role="alert">{error}</p>}
    <div className="rx-footer"><button type="button" className="rx-button" onClick={onCancel}>Cancel</button><button type="submit" className="rx-button rx-primary">Save factor</button></div>
  </form>;
}
export function FactorsEditor({ factors }) {
  const [tab, setTab] = useState('values');
  const [group, setGroup] = useState(FACTOR_GROUPS[0]);
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(null);
  const definitions = factors.definitions.filter(item => (tab === 'manage' || item.enabled) && (!query ? item.group === group : item.label.toLowerCase().includes(query.toLowerCase())));
  return <div className="rx-stack">
    <div className="rx-factor-toolbar">
      <div className="rx-factor-tabs" role="group" aria-label="Factors view"><button type="button" aria-pressed={tab === 'values'} onClick={() => { setTab('values'); setEditing(null); }}>Patient values</button><button type="button" aria-pressed={tab === 'manage'} onClick={() => { setTab('manage'); setEditing(null); }}><Settings2 size={13}/> Edit factor list</button></div>
      <button type="button" className="rx-button" onClick={() => { setTab('manage'); setEditing({ creating: true }); }}><Plus size={14}/> Add factor</button>
    </div>
    {factors.error && <p className="rx-error rx-note" role="alert">{factors.error}</p>}
    {editing ? <DefinitionEditor key={editing.id || 'new'} initial={editing.creating ? null : editing} onCancel={() => setEditing(null)} onSave={definition => { const saved = factors.saveDefinition(definition); if (saved) { setGroup(definition.group); setQuery(''); setTab('values'); } return saved; }}/> : <>
      <p className="rx-muted">A focused starter list for pregnancy care. Relevance depends on the prescription; these fields are not all mandatory. Blank means unknown, not normal or absent.</p>
      <label className="rx-search"><Search size={14}/><input aria-label="Search factors" placeholder="Find a factor…" value={query} onChange={event => setQuery(event.target.value)}/></label>
      <div className="rx-factor-groups" role="group" aria-label="Factor category">{FACTOR_GROUPS.map(item => <button type="button" key={item} aria-pressed={group === item} onClick={() => { setGroup(item); setQuery(''); }}>{item}</button>)}</div>
      {definitions.map(definition => {
        const record = factors.records[definition.id];
        const source = FACTOR_SOURCES[definition.reference];
        const usable = usableFactor(definition, record);
        return <div className="rx-factor-row" key={definition.id}>
          {tab === 'manage' ? <>
            <div className="rx-section-label"><strong>{definition.label}</strong><label className="rx-check"><input type="checkbox" checked={definition.enabled} onChange={event => factors.saveDefinition({ ...definition, enabled: event.target.checked })}/> Show in prescription</label></div>
            <div className="rx-section-label"><span className="rx-muted">{definition.type}{definition.unit ? ' · ' + definition.unit : ''}{definition.custom ? ' · Custom' : ' · Starter field'}</span><button type="button" className="rx-text" onClick={() => setEditing(definition)}>Rename</button></div>
          </> : <>
            <label className="rx-field"><span>{definition.label}{definition.unit ? ` (${definition.unit})` : ''}</span>
              {definition.type === 'select' ? <select value={record?.value || ''} onChange={event => factors.saveValue(definition, event.target.value)}><option value="">Unknown / not recorded</option>{record?.value && !definition.options.includes(record.value) && <option value={record.value}>{record.value} — review value</option>}{definition.options.map(option => <option key={option}>{option}</option>)}</select> : ['number','date','datetime-local'].includes(definition.type) ? <input type={definition.type} step={definition.type === 'number' ? 'any' : undefined} value={definition.type === 'number' ? (record?.value && Number.isFinite(Number(record.value)) ? record.value : '') : record?.value || ''} onChange={event => factors.saveValue(definition, event.target.value)} placeholder="Unknown"/> : <textarea rows={2} value={record?.value || ''} onChange={event => factors.saveValue(definition, event.target.value)} placeholder="Unknown / not recorded"/>}
            </label>
            <div className="rx-factor-meta"><span>{record ? `${record.source} · ${formatDate(record.recordedAt)}` : definition.metrics ? 'Can use shared reports when present' : 'Doctor / patient record needed'}</span>{Object.hasOwn(factors.overrides, definition.id) && <button type="button" className="rx-text" onClick={() => factors.saveValue(definition, '', true)}>Use record value</button>}</div>
            {record?.sourceRecordedAt && record.source === 'Doctor entry' && <p className="rx-muted">Original source date: {formatDate(record.sourceRecordedAt)}</p>}
            {record?.printedValue && <p className="rx-muted">Printed result: {record.printedValue}{record.unit ? ' ' + record.unit : ''}</p>}
            {record && !usable && record.value && <div className="rx-amber rx-factor-review">{record.needsReview ? 'OCR result needs review before matching.' : 'Check the value and unit before matching.'} {record.unit && record.unit !== definition.unit && <span>Source unit: {record.unit}. Enter a verified value in {definition.unit || 'the expected format'}.</span>}{record.needsReview && (definition.type !== 'number' || Number.isFinite(Number(record.value))) && (!definition.unit || record.unit === definition.unit) && <button type="button" className="rx-text" onClick={() => factors.saveValue(definition, record.value)}>Confirm this value</button>}</div>}
          </>}
          {source && <a className="rx-factor-reference" href={source.url} target="_blank" rel="noreferrer">{source.title}</a>}
        </div>;
      })}
      {!definitions.length && <p className="rx-muted">No factors here yet. Use Add factor to define another field.</p>}
    </>}
  </div>;
}
/** Rules use stable IDs, not free-text diagnosis guesses or automatically chosen cutoffs. */
export function FactorRuleEditor({ rules = [], definitions, onChange }) {
  const active = definitions.filter(item => item.enabled);
  const update = (index, patch) => onChange(rules.map((rule, i) => i === index ? { ...rule, ...patch } : rule));
  return <div className="rx-stack">
    {rules.map((rule, index) => {
      const definition = definitions.find(item => item.id === rule.factorId);
      return <div className="rx-factor-rule" key={index}>
        <label className="rx-field"><span>Factor</span><select value={rule.factorId} onChange={event => { const next = definitions.find(item => item.id === event.target.value); update(index, { factorId: next.id, label: next.label, unit: next.unit, operator: 'equals', value: '' }); }}>{active.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}{definition && !definition.enabled && <option value={definition.id}>{definition.label} (hidden)</option>}{!definition && <option value={rule.factorId}>{rule.label} (unavailable)</option>}</select></label>
        <div className="rx-fields"><label className="rx-field"><span>Comparison</span><select value={rule.operator} onChange={event => update(index, { operator: event.target.value })}><option value="equals">Equals</option>{definition?.type === 'number' && <><option value="min">At least</option><option value="max">At most</option></>}</select></label>
          <label className="rx-field"><span>Value{definition?.unit ? ` (${definition.unit})` : ''}</span>{definition?.type === 'select' ? <select required value={rule.value} onChange={event => update(index, { value: event.target.value })}><option value="">Choose value</option>{definition.options.map(option => <option key={option}>{option}</option>)}</select> : <input required type={definition?.type === 'number' ? 'number' : 'text'} step="any" value={rule.value} onChange={event => update(index, { value: event.target.value })}/>}</label>
        </div>
        <button type="button" className="rx-text" onClick={() => onChange(rules.filter((_, i) => i !== index))}>Remove rule</button>
      </div>;
    })}
    <button type="button" className="rx-button" disabled={!active.length} onClick={() => { const first = active[0]; onChange([...rules, { factorId: first.id, label: first.label, unit: first.unit, operator: 'equals', value: '' }]); }}><Plus size={13}/> Add factor rule</button>
    <p className="rx-muted">Choose clinical comparison values yourself. Adding a field does not automatically make it a prescribing rule.</p>
  </div>;
}
