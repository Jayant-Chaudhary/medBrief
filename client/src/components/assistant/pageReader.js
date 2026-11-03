/**
 * Reads the open page for the assistant (Phase 5): the labels of its buttons,
 * links, fields, dropdowns and checkboxes, never what is typed or shown in them.
 *
 * Each element gets a short ref (`data-assistant-ref="r12"`) so the server can
 * name it. Skipped: the assistant panel, hidden and inert elements,
 * password and file inputs, fields (not buttons) a page already lists for the assistant
 * (`data-assistant-id`, handled by the hand-written lists), and dropdowns inside
 * regions marked `data-assistant-private` (their choices can be patient names).
 * Inside private regions a control is named only by its explicit label, never by
 * its text, so rows of patient data are not read.
 *
 * Pages may add, without logic:
 *   data-assistant-private    rows of patient data
 *   data-assistant-effect     "save" | "send" | "never" | "free" where the label does not say it
 *   data-assistant-row        "Medicine 2": tells repeated rows apart
 *   data-assistant-section    a name for a region with no heading
 */

const CONTROLS = 'button, a[href], input, textarea, select, summary, [role="button"], [role="tab"], [role="checkbox"], [role="switch"], [role="menuitem"], [role="radio"], [role="option"]';
const MAX_ELEMENTS = 120;
const MAX_HEADINGS = 12;
const MAX_OPTIONS = 30;

const INPUT_KINDS = {
  text: 'text', search: 'search', email: 'email', tel: 'tel', url: 'text', number: 'number', date: 'date',
  'datetime-local': 'datetime', time: 'text', checkbox: 'checkbox', radio: 'radio', submit: 'button', button: 'button',
};
// Options of a listbox (ranked template results) are pressed like buttons.
const ROLE_KINDS = { button: 'button', tab: 'tab', checkbox: 'checkbox', switch: 'checkbox', menuitem: 'button', radio: 'radio', option: 'button' };

/** Collapses spaces and trims to a short label. */
export function cleanLabel(text, max = 80) {
  return String(text || '').replace(/\s+/g, ' ').trim().slice(0, max);
}

/** The kind the server understands, or null for elements the assistant does not use. */
export function kindOf(tag, type, role) {
  if (role && ROLE_KINDS[role]) return ROLE_KINDS[role];
  switch (tag) {
    case 'button': return 'button';
    case 'a': return 'link';
    case 'summary': return 'summary';
    case 'textarea': return 'textarea';
    case 'select': return 'select';
    case 'input': return INPUT_KINDS[(type || 'text').toLowerCase()] || null;
    default: return null;
  }
}

/** The element's own effect mark, or "free" for controls that only open or close something. */
export function effectOf({ mark, opensSomething, tag }) {
  if (mark) return mark;
  return opensSomething || tag === 'summary' ? 'free' : undefined;
}

/**
 * Visible text of a node, with its pieces kept apart ("Needs review" + "3" → "Needs review 3"),
 * leaving out the text of `except` (a label wrapping its own dropdown should not list the choices).
 */
function textOf(node, except = null) {
  if (!node) return '';
  const parts = [];
  const walker = node.ownerDocument.createTreeWalker(node, NodeFilter.SHOW_TEXT);
  for (let text = walker.nextNode(); text; text = walker.nextNode()) {
    if (!except || !except.contains(text)) parts.push(text.nodeValue);
  }
  return cleanLabel(parts.join(' '));
}

/** What a person would read as this control's name. */
export function nameOf(el) {
  const explicit = el.getAttribute('aria-label') || el.dataset.assistantLabel;
  if (explicit) return cleanLabel(explicit);
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    const text = cleanLabel(labelledBy.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent || '').join(' '));
    if (text) return text;
  }
  const labelText = textOf(el.labels?.[0], el);
  if (labelText) return labelText;
  const tag = el.tagName.toLowerCase();
  const isPrivate = Boolean(el.closest('[data-assistant-private]'));
  if (!isPrivate && (tag === 'button' || tag === 'a' || tag === 'summary' || el.getAttribute('role'))) {
    const text = textOf(el);
    if (text) return text;
  }
  return cleanLabel(el.getAttribute('placeholder') || el.getAttribute('title') || '');
}

function sectionOf(el) {
  const marked = el.closest('[data-assistant-section]');
  if (marked) return cleanLabel(marked.dataset.assistantSection, 60);
  const box = el.closest('[role="dialog"], details, fieldset, section, form');
  if (!box) return '';
  const heading = box.getAttribute('aria-label') || textOf(box.querySelector('h1, h2, h3, h4, legend, summary'));
  return cleanLabel(heading, 60);
}

function isShown(el) {
  if (el.closest('[inert], [aria-hidden="true"], [hidden]')) return false;
  const style = el.ownerDocument.defaultView.getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return false;
  return el.getClientRects().length > 0;
}

// Disabled controls are listed (marked) because many enable once a field is filled,
// like "Add" next to a text box; whether they are enabled is checked again just before acting.
function skip(el) {
  if (el.closest('[data-assistant-panel]')) return true;
  // Fields a hand-written list covers keep that path (its own value checks); buttons are read
  // either way, since pressing one runs the page's own click ("Consultation notes", "End visit").
  if (['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName) && el.closest('[data-assistant-id]')) return true;
  if (el.tagName === 'INPUT' && ['hidden', 'password', 'file', 'image', 'reset'].includes(el.type)) return true;
  return !isShown(el);
}

/** A modal dialog that is open takes the whole page (what is behind it cannot be used). */
function topDialog(doc) {
  const open = [...doc.querySelectorAll('[role="dialog"][aria-modal="true"]')].filter((d) => !d.closest('[data-assistant-panel]') && isShown(d));
  return open[open.length - 1] || null;
}

/**
 * @returns {{ page: { title: string, headings: string[], elements: object[] }, names: Map<string, string> }}
 *   `names` remembers each ref's label, so an action is refused if the element changed before it runs.
 */
export function readPage(doc = document) {
  doc.querySelectorAll('[data-assistant-ref]').forEach((node) => node.removeAttribute('data-assistant-ref'));
  const dialog = topDialog(doc);
  const root = dialog || doc.body;
  const elements = [];
  const names = new Map();
  // With a panel or dialog open, the menu links behind it still lead to other pages.
  const menu = dialog ? [...doc.querySelectorAll('nav a[href]')].filter((link) => !dialog.contains(link)) : [];

  for (const el of [...root.querySelectorAll(CONTROLS), ...menu]) {
    if (elements.length >= MAX_ELEMENTS) break;
    if (skip(el)) continue;
    const tag = el.tagName.toLowerCase();
    const kind = kindOf(tag, el.getAttribute('type'), el.getAttribute('role'));
    if (!kind) continue;
    if (kind === 'select' && el.closest('[data-assistant-private]')) continue;
    const name = nameOf(el);
    if (!name) continue;

    const ref = `r${elements.length + 1}`;
    el.setAttribute('data-assistant-ref', ref);
    names.set(ref, name);
    const row = el.closest('[data-assistant-row]')?.dataset.assistantRow;
    const section = menu.includes(el) ? 'Menu' : [sectionOf(el), cleanLabel(row, 40)].filter(Boolean).join(' · ');
    const effect = effectOf({
      mark: el.closest('[data-assistant-effect]')?.dataset.assistantEffect,
      opensSomething: el.hasAttribute('aria-haspopup') || el.hasAttribute('aria-expanded'),
      tag,
    });
    const options = kind === 'select'
      ? [...el.options].map((o) => cleanLabel(o.textContent)).filter(Boolean).slice(0, MAX_OPTIONS)
      : null;
    elements.push({
      ref, kind, name,
      ...(section && { section }),
      ...(options && { options }),
      ...(effect && { effect }),
      ...(el.required && { required: true }),
      ...((el.disabled || el.getAttribute('aria-disabled') === 'true') && { disabled: true }),
    });
  }

  const headings = [...root.querySelectorAll('h1, h2, h3')]
    .filter((h) => !h.closest('[data-assistant-private], [data-assistant-panel]') && isShown(h))
    .map((h) => textOf(h))
    .filter(Boolean)
    .slice(0, MAX_HEADINGS);
  return { page: { title: cleanLabel(doc.title, 160), headings, elements }, names };
}
