const normalize = value => String(value ?? '').trim().toLocaleLowerCase();

export function inlineCompletion(value, suggestion) {
  const typed = String(value ?? '');
  const saved = String(suggestion ?? '');
  if (!saved || !saved.toLocaleLowerCase().startsWith(typed.toLocaleLowerCase()) || typed.length >= saved.length) return '';
  return saved.slice(typed.length);
}

// Saved text completion, not a generated regimen. Use the first matching item in score order.
export function medicineCompletion(ranked, row, rows) {
  const name = normalize(row.name);
  const used = new Set(rows.filter(item => item.id !== row.id).map(item => normalize(item.name)).filter(Boolean));
  for (const { template, match, reviewOnly } of ranked) {
    if (reviewOnly || match.conflicts.length || template.archived || template.status !== 'active') continue;
    if (row.source?.id && row.source.id !== template.id) continue;
    const medication = template.medications.find(item => normalize(item.name) &&
      normalize(item.name).startsWith(name) && !used.has(normalize(item.name)));
    if (medication) return { template, medication };
  }
  return null;
}

export function handleInlineGhostKey(event, { suffix, atEnd, composing }, { accept, dismiss }) {
  if (!suffix || !atEnd || composing || event.isComposing || event.nativeEvent?.isComposing || event.defaultPrevented ||
    event.ctrlKey || event.altKey || event.metaKey) return false;
  if (event.key === 'Tab' && !event.shiftKey) { event.preventDefault(); accept(); return true; }
  if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); dismiss(); return true; }
  return false;
}
