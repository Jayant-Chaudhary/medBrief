/**
 * Runs one action the server approved on an element the page reader found.
 * Before acting it finds the element again and checks it still has the label
 * it had when the page was read, so a page that changed in between is never
 * acted on blindly. Values are set the way React expects, so the page's own
 * handlers run exactly as if the user had typed.
 */
import { cleanLabel, nameOf } from './pageReader';

export class PageActionError extends Error {
  constructor(code) {
    super(code);
    this.code = code;
  }
}

/** Sets a field's value through the native setter and tells React it changed. */
function setValue(el, value) {
  const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
  el.dispatchEvent(new Event('input', { bubbles: true }));
  el.dispatchEvent(new Event('change', { bubbles: true }));
}

const isOn = (el) => (el.type === 'checkbox' || el.type === 'radio' ? el.checked : el.getAttribute('aria-checked') === 'true');

const escapeRef = (ref) => (typeof CSS !== 'undefined' && CSS?.escape ? CSS.escape(ref) : String(ref || '').replace(/["\\]/g, '\\$&'));

/**
 * @param {{ ref: string, op: 'click'|'type'|'append'|'replace'|'select'|'check'|'key'|'open_row', value?: string, find?: string, effect?: string, key?: string, patient?: string }} action
 * @param {string} expectedName - the label read with the page
 * @param {Document} [doc]
 */
export function runPageAction(action, expectedName, doc = document) {
  if (action.op === 'open_row') {
    let rows = [...doc.querySelectorAll('[data-assistant-row]')];
    if (!rows.length) {
      rows = [...doc.querySelectorAll('tbody[data-assistant-private] tr')];
    }
    const wanted = String(action.patient || action.value || action.name || '').trim().toLowerCase();
    const match = rows.find((r) => r.textContent.toLowerCase().includes(wanted));
    if (!match) throw new PageActionError('NOT_FOUND');
    const clickable = match.querySelector?.('button, a, [role="button"]') || match;
    clickable.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    clickable.click?.();
    return;
  }

  const el = doc.querySelector(`[data-assistant-ref="${escapeRef(action.ref)}"]`);
  if (!el || !el.isConnected) throw new PageActionError('GONE');
  if (expectedName && nameOf(el) !== expectedName) throw new PageActionError('CHANGED');
  if (el.disabled || el.getAttribute('aria-disabled') === 'true') throw new PageActionError('DISABLED');
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });

  switch (action.op) {
    case 'click':
      el.click();
      break;
    case 'type':
      el.focus();
      setValue(el, action.value);
      // Fields that save as they change commit when you leave them.
      if (action.effect === 'save') el.blur();
      break;
    case 'append': {
      el.focus();
      const current = el.value || '';
      setValue(el, current.trim() ? `${current.replace(/\s+$/, '')}\n${action.value}` : action.value);
      if (action.effect === 'save') el.blur();
      break;
    }
    case 'replace': {
      // Done here, on the field's own text, which never leaves the browser. The first match
      // is changed (ignoring case); if the phrase isn't there, nothing is changed.
      const current = el.value || '';
      const at = current.toLowerCase().indexOf(String(action.find).toLowerCase());
      if (!action.find || at < 0) throw new PageActionError('NOT_FOUND');
      el.focus();
      setValue(el, `${current.slice(0, at)}${action.value}${current.slice(at + action.find.length)}`);
      if (action.effect === 'save') el.blur();
      break;
    }
    case 'select': {
      const option = [...el.options].find((o) => cleanLabel(o.textContent) === action.value);
      if (!option) throw new PageActionError('NO_OPTION');
      setValue(el, option.value);
      break;
    }
    case 'check':
      if (!isOn(el)) el.click();
      break;
    case 'key': {
      el.focus();
      const key = action.key || 'Enter';
      const createKeyEvent = (type, dict) => (typeof KeyboardEvent !== 'undefined' ? new KeyboardEvent(type, dict) : { type, ...dict });
      el.dispatchEvent(createKeyEvent('keydown', { key, code: key === 'Enter' ? 'Enter' : key, bubbles: true, cancelable: true }));
      el.dispatchEvent(createKeyEvent('keyup', { key, code: key === 'Enter' ? 'Enter' : key, bubbles: true }));
      if (key === 'Enter' && el.form) {
        const createEvent = (type, dict) => (typeof Event !== 'undefined' ? new Event(type, dict) : { type, ...dict });
        el.form.dispatchEvent(createEvent('submit', { bubbles: true, cancelable: true }));
      }
      break;
    }
    default:
      throw new PageActionError('BAD_OP');
  }

  el.dataset.assistantFlash = 'on';
  setTimeout(() => delete el.dataset.assistantFlash, 2500);
}

/**
 * Executes an action and returns a safe result object:
 * { result: 'ok' | 'not_found' | 'disabled' | 'no_change' | 'refused', reason?: string }
 */
export function executeAction(action, doc = document) {
  try {
    runPageAction(action, action.name, doc);
    return { result: 'ok' };
  } catch (err) {
    if (err instanceof PageActionError) {
      if (err.code === 'GONE' || err.code === 'NOT_FOUND' || err.code === 'NO_OPTION') {
        return { result: 'not_found', reason: err.code };
      }
      if (err.code === 'DISABLED') {
        return { result: 'disabled', reason: 'Element is disabled' };
      }
      if (err.code === 'CHANGED') {
        return { result: 'no_change', reason: 'Element label changed' };
      }
      return { result: 'refused', reason: err.code };
    }
    return { result: 'refused', reason: err.message || 'Action failed' };
  }
}
