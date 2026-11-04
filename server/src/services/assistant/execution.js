const { digest } = require('./continuation');
const { findPage } = require('./pages.registry');
const canonical = s => String(s || '').toLowerCase().replace(/consultancy|consultation/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = s => canonical(s).split(' ').filter(w => w.length > 2 && !['the', 'please', 'open', 'show', 'write', 'add', 'with', 'into', 'then', 'and', 'check', 'tick', 'mark', 'done', 'set'].includes(w));
function matchingItem(checklist, action) {
  return checklist.findIndex(item => {
    if (item.done) return false;
    const text = canonical(item.text);
    // A malformed composite checklist item cannot be certified by one action.
    if (/\b(and|then|aur|phir)\b.*\b(open|go|write|type|add|tick|check|fill|save|send)\b/.test(text)) return false;
    if (action.op === 'return_record') return Boolean(action.recordId) && /\b(return|back)\b/.test(text);
    if (action.op === 'go') {
      const page = findPage('clinician', action.pageId || action.page);
      return /\b(open|go|show|view|kholo|return|back)\b/i.test(item.text) &&
        [page?.label, ...(page?.aliases || [])].filter(Boolean).some(s => text.includes(canonical(s)));
    }
    if (action.op === 'open_record') {
      const labels = {
        last_visit: ['last visit', 'previous visit', 'past visit'],
        next_visit: ['next visit', 'upcoming visit'],
        maternity: ['maternity', 'antenatal'],
        new_appointment: ['appointment', 'book', 'new visit', 'naya visit'],
      };
      return Boolean(action.recordId) && (labels[action.kind] || []).some(s => text.includes(s)) && !/\b(write|fill|weight|bp)\b/.test(text);
    }
    if (action.op === 'open_row') {
      const patWords = words(action.patient || action.name || action.value);
      const hasPat = patWords.length && patWords.every(w => text.includes(w));
      return hasPat && /\b(open|show|view|find|search|visit|patient)\b/.test(text) && !/\b(write|type|append|add|tick|check|notes|prescription)\b/.test(text);
    }
    const target = words(action.name || action.label || action.control || action.id || action.ref);
    const hasTarget = target.length && target.every(w => text.includes(w));
    if (['type', 'append', 'replace', 'fill', 'select'].includes(action.op)) {
      return /\b(write|add|append|type|replace|change|fill|set|notes|likho|record|bp|weight|date|time|appointment|schedule|book)\b/.test(text) &&
        (hasTarget || (action.value && text.includes(canonical(action.value))) || (action.control === 'scheduledAt' && /\b(time|date|tomorrow|today|kal|aaj|\d+)\b/.test(text))) && !/\b(open|go|find)\b/.test(text);
    }
    if (action.op === 'check') return hasTarget && /\b(tick|check|mark)\b/.test(text);
    if (['click','press'].includes(action.op)) return (hasTarget || (action.id === 'save_visit' && /\b(add|save)\b.*\bvisit\b/.test(text)) || (action.id === 'create_visit' && /\b(create|send|invite|book)\b/.test(text)) || ((action.id === 'open_audio_consult' || /record consultation/i.test(action.name || '')) && /\b(record|recording|audio)\b/.test(text))) && /\b(open|show|view|find|search|close|press|click|add|save|send|use|select|create|invite|check|read)\b/.test(text) && !/\b(write|type|append)\b/.test(text);
    return false;
  });
}
function pendingActions(reply, checklist, round, currentPath) {
  const pending = [];
  function add(action) {
    action.actionId = `${round}:${pending.length}`;
    const itemIndex = matchingItem(checklist, action);
    const { value, find } = action;
    const safe = Object.fromEntries(['actionId', 'op', 'ref', 'name', 'section', 'control', 'page', 'pageId', 'path', 'kind', 'recordId', 'field', 'hash'].filter(k => action[k] !== undefined).map(k => [k, action[k]]));
    pending.push({ ...safe, itemIndex, fingerprint: digest(JSON.stringify([currentPath, action.op, action.pageId || action.path || action.section, action.name || action.control || action.ref, value, find])) });
  }
  if (reply.type === 'navigate') add(reply);
  for (const step of reply.steps || []) {
    if (step.path || step.recordTarget) { step.op ||= 'go'; add(step); }
    for (const a of step.page?.actions || []) add(a);
    if (step.fill) {
      step.fill.actionIds = {};
      for (const [control, value] of Object.entries(step.fill.fields)) {
        const meta = step.fill.filled?.find(f => f.id === control);
        const a = { op: 'fill', control, value, page: step.fill.page, name: meta?.label || control, ...(meta?.field && { field: meta.field }), ...(meta?.hash && { hash: meta.hash }) };
        add(a); step.fill.actionIds[control] = a.actionId;
      }
    }
    if (step.press) { step.press.op = 'press'; add(step.press); }
  }
  for (const option of reply.options || []) {
    for (const step of option.steps || []) { step.op ||= 'open_record'; add(step); }
  }
  return pending;
}
function acceptResults(saved, results) {
  const seen = new Set();
  return results.flatMap(r => {
    const issued = saved?.pending?.find(a => a.actionId === r.actionId);
    if (!issued || seen.has(r.actionId)) return [];
    seen.add(r.actionId);
    return [{ ...issued, result: r.result }];
  });
}
function applyResults(checklist, results) {
  return checklist.map((item, index) => {
    const matched = results.filter(r => r.itemIndex === index);
    return item.done || !matched.length ? item : { ...item, done: matched.every(r => r.result === 'ok') };
  });
}
function stop(checklist, reason, source = 'agent') {
  return {
    type: 'unsupported', source, steps: [], checklist: checklist.map(c => c.done ? c : { ...c, reason }),
    message: checklist.map(c => c.done ? `✓ ${c.text}` : `Couldn't: ${c.text} because ${reason}`).join('\n') || `Couldn't complete this request because ${reason}`
  };
}
function boundProvider(provider, deadline, settings, clock = Date.now) {
  return {
    complete: async options => {
      const timeoutMs = Math.min(options.timeoutMs || settings.modelCallTimeoutMs, settings.modelCallTimeoutMs, deadline - clock());
      if (timeoutMs <= 0) throw Object.assign(new Error('REQUEST_TIMEOUT'), { code: 'REQUEST_TIMEOUT' });
      let timer;
      try {
        return await Promise.race([provider.complete({ ...options, timeoutMs }), new Promise((_, reject) => {
          timer = setTimeout(() => reject(Object.assign(new Error('MODEL_TIMEOUT'), { code: 'MODEL_TIMEOUT' })), timeoutMs);
        })]);
      } finally { clearTimeout(timer); }
    }
  };
}
module.exports = { matchingItem, pendingActions, acceptResults, applyResults, stop, boundProvider };
