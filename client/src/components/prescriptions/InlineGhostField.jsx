import { useId, useRef, useState } from 'react';
import { handleInlineGhostKey, inlineCompletion } from './inlineGhostModel.js';

export function InlineGhostField({ label, value = '', suggestedValue = '', onChange, onAccept, ...props }) {
  const id = useId();
  const ref = useRef(null);
  const [atEnd, setAtEnd] = useState(true);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState('');
  const [scrollLeft, setScrollLeft] = useState(0);
  const suggestionKey = JSON.stringify([value, suggestedValue]);
  const suffix = atEnd && !composing && dismissed !== suggestionKey ? inlineCompletion(value, suggestedValue) : '';
  return <label className="rx-field" htmlFor={id}><span>{label}</span>
    <span className="rx-inline-ghost-field">
      {suffix && <span className="rx-inline-ghost-text" aria-hidden="true"><span style={{ transform: `translateX(-${scrollLeft}px)` }}><span className="rx-inline-ghost-prefix">{value}</span>{suffix}</span></span>}
      <input {...props} id={id} ref={ref} value={value} placeholder={suffix ? '' : props.placeholder}
        aria-describedby={suffix ? `${id}-hint` : undefined} autoComplete="off" spellCheck={false}
        onChange={event => { setAtEnd(event.target.selectionStart === event.target.value.length && event.target.selectionEnd === event.target.value.length); onChange(event.target.value); }}
        onSelect={event => setAtEnd(event.currentTarget.selectionStart === String(value).length && event.currentTarget.selectionEnd === String(value).length)}
        onScroll={event => setScrollLeft(event.currentTarget.scrollLeft)}
        onCompositionStart={() => setComposing(true)} onCompositionEnd={() => setComposing(false)}
        onKeyDown={event => handleInlineGhostKey(event, { suffix, composing,
          atEnd: ref.current?.selectionStart === String(value).length && ref.current?.selectionEnd === String(value).length }, {
          accept: () => (onAccept || onChange)(String(value) + suffix), dismiss: () => setDismissed(suggestionKey),
        })}/>
    </span>
    {suffix && <span id={`${id}-hint`} className="rx-inline-ghost-hint">Tab accepts saved text · Esc dismisses</span>}
  </label>;
}
