import { useEffect, useId, useRef, useState } from 'react';
import { Search } from 'lucide-react';
import { handleTemplateSearchKey, templateMatchLabel, templateNameCompletion } from './templateSearchModel.js';
import { TEMPLATE_SEARCH_CONFIG } from './prescriptionConfig.js';

export function TemplateAutocomplete({ query, onQueryChange, onStart, matches, loading, error, onRetry, onSelect, onPreview, disabled, allowGhost = true, selecting = false }) {
  const id = useId();
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [dismissed, setDismissed] = useState(false);
  const [composing, setComposing] = useState(false);
  const [atEnd, setAtEnd] = useState(true);
  const active = matches[activeIndex];
  const completion = allowGhost && open && !dismissed && !composing && atEnd && activeIndex === 0
    ? templateNameCompletion(matches, query) : '';

  useEffect(() => { setActiveIndex(0); }, [matches]);
  useEffect(() => {
    if (open && active) document.getElementById(`${id}-${active.template.id}`)?.scrollIntoView?.({ block: 'nearest' });
  }, [active, id, open]);

  function start() { setOpen(true); onStart(); }
  function select(template) { setOpen(false); setDismissed(true); (onSelect || onPreview)(template); }
  function completeName() {
    onQueryChange(query + completion); setDismissed(true);
  }
  function keyDown(event) {
    handleTemplateSearchKey(event, { open, active, loading, composing, completion, count: matches.length,
      atEnd: inputRef.current?.selectionStart === query.length && inputRef.current?.selectionEnd === query.length }, {
      open: start, move: delta => setActiveIndex(index => (index + delta + matches.length) % matches.length),
      dismiss: () => { setOpen(false); setDismissed(true); }, complete: completeName, preview: select,
    });
  }

  return <div className="rx-autocomplete" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }}>
    <label className="rx-field" htmlFor={id}>Use a template</label>
    <div className="rx-autocomplete-input">
      <Search size={16} aria-hidden="true"/>
      <div className="rx-completion-wrap">
        {completion && <div className="rx-completion" aria-hidden="true"><span>{query}</span>{completion}</div>}
        <input ref={inputRef} id={id} role="combobox" aria-autocomplete="both" aria-expanded={open}
          aria-controls={`${id}-results`} aria-activedescendant={open && active ? `${id}-${active.template.id}` : undefined}
          aria-describedby={`${id}-help`} autoComplete="off" spellCheck={false} disabled={disabled}
          placeholder={completion ? '' : 'Search template, tag or medicine…'} value={query}
          // For the assistant: opening the list only shows templates (best patient match first).
          data-assistant-label="Search templates (best match first)" data-assistant-effect="free"
          onFocus={start} onClick={start} onKeyDown={keyDown}
          onSelect={event => setAtEnd(event.currentTarget.selectionStart === query.length && event.currentTarget.selectionEnd === query.length)}
          onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
          onChange={event => { onQueryChange(event.target.value); setActiveIndex(0); setDismissed(false);
            setAtEnd(event.target.selectionStart === event.target.value.length && event.target.selectionEnd === event.target.value.length); start(); }}/>
      </div>
      {query && <button type="button" className="rx-text" aria-label="Clear template search" onClick={() => {
        onQueryChange(''); setDismissed(false); inputRef.current?.focus(); start();
      }}>Clear</button>}
    </div>
    <p id={`${id}-help`} className="rx-muted">Best patient match first. Click or Enter to fill medicines, dose and frequency{completion ? ' · Tab completes the name' : ''} · Esc closes.</p>
    <p className="rx-muted">Selecting another template replaces the previous template’s medicines. Grey text in medicine fields is a saved suggestion; Tab accepts it.</p>
    {onPreview && matches[0] && <button type="button" className="rx-text" onClick={() => onPreview(matches[0].template)}>Review top template details</button>}
    <div role="status" className="rx-muted">{selecting ? 'Saving template selection…' : open ? `${matches.length}${matches.length === TEMPLATE_SEARCH_CONFIG.maxResults ? ' top' : ''} template(s)${loading ? ' · Checking visit eligibility…' : ''}` : ''}</div>
    {error && <div role="alert" className="rx-error">{error} <button type="button" className="rx-text" onClick={onRetry}>Retry</button></div>}
    <div id={`${id}-results`} role="listbox" aria-label="Templates ranked by patient similarity" hidden={!open} aria-busy={loading}>
      {matches.map(({ template, match, reviewOnly }, index) => <div key={template.id}
        id={`${id}-${template.id}`} role="option" aria-selected={index === activeIndex}
        // The list is ranked by patient similarity, so the first is the best match.
        data-assistant-label={index === 0 ? `Best matching template: ${template.name}` : `Template: ${template.name}`}
        className="rx-autocomplete-option" onMouseEnter={() => setActiveIndex(index)}
        onMouseDown={event => event.preventDefault()} onClick={() => select(template)}>
        <div className="rx-autocomplete-title"><strong>{template.name}</strong><span>{templateMatchLabel(match)}</span></div>
        <span className="rx-med-summary">{template.medications.map(item => item.name).join(' · ')}</span>
        <small>{match.method === 'gower' ? `${match.compared}/${match.featureCount} factors compared · ${Math.round(match.coverage * 100)}% coverage` : `${match.matched.length}/${match.total} configured rules matched`}{match.missing.length > 0 ? ' · Missing information—review' : ''}</small>
        {(reviewOnly || match.conflicts.length > 0) && <small className="rx-amber">Applicability conflict · Review only</small>}
      </div>)}
      {!matches.length && <p className="rx-muted rx-search-empty">No saved templates match this text. Try another name or medicine, or clear the search to see all templates.</p>}
    </div>
    {completion && <button type="button" className="rx-text" onMouseDown={event => event.preventDefault()} onClick={completeName}>Complete “{matches[0].template.name}”</button>}
  </div>;
}
