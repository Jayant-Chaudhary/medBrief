const { digest } = require('./continuation');
const { findPage, pagesFor } = require('./pages.registry');
const { matchIntent } = require('./intentRules');
const { formFor } = require('./controls.registry');
const canonical = s => String(s || '').toLowerCase().replace(/consultancy|consultation/g, '').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const words = s => canonical(s).split(' ').filter(w => (w.length > 2 || ['bp','hb'].includes(w)) && !['the', 'please', 'open', 'show', 'write', 'add', 'with', 'into', 'then', 'and', 'check', 'tick', 'mark', 'done', 'set'].includes(w));
function initializeChecklist(checklist) {
  checklist.forEach((item, index) => { item.id ||= `task-${index}-${digest(item.text).slice(0, 12)}`; });
  return checklist;
}
function requestedLabelMatches(text, label) {
  // The requested control name may be contained in a longer actual label,
  // e.g. a template name plus its existing strength/section description.
  const match = String(text || '').match(/^(?:please\s+)?(?:open|show|view|press|click|add|use|select|tick|check|mark)\s+(?:the\s+)?(.+)$/i);
  if (!match) return false;
  const target = canonical(match[1].replace(/\s+(?:as\s+done|as\s+well|please)$/i, ''));
  return target && ` ${canonical(label)} `.includes(` ${target} `);
}
function matchingItem(checklist, action) {
  return checklist.findIndex(item => {
    if (item.done) return false;
    const evidence = evidenceTarget(action);
    if (evidence && item.required?.some(target => (item.alternatives?.[target] || [target]).includes(evidence))) return true;
    const text = canonical(item.text);
    // A malformed composite checklist item cannot be certified by one action.
    if (/\b(and|then|aur|phir)\b.*\b(open|go|write|type|add|tick|check|fill|save|send)\b/.test(text)) return false;
    const searchValue = action.state?.assistantQuery || (['type','fill'].includes(action.op) && (action.control === 'patients.query' || (action.page === 'patients' && action.control === 'query') || action.kind === 'search' || /search/i.test(action.name || '')) ? action.value : '');
    if (searchValue && /\b(find|search|look up|dhundo)\b/.test(text)) {
      const nameWords = canonical(searchValue).split(' ').filter(Boolean);
      return nameWords.length > 0 && nameWords.every(w => text.split(' ').includes(w));
    }
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
    const hasTarget = (target.length && target.every(w => text.includes(w))) || requestedLabelMatches(item.text, action.name || action.label);
    if (['type', 'append', 'replace', 'fill', 'select'].includes(action.op)) {
      return /\b(write|add|append|type|replace|change|fill|set|notes|likho|record|bp|weight|date|time|appointment|schedule|book)\b/.test(text) &&
        (hasTarget || (action.value && text.includes(canonical(action.value))) || (action.control === 'scheduledAt' && /\b(time|date|tomorrow|today|kal|aaj|\d+)\b/.test(text))) && !/\b(open|go|find)\b/.test(text);
    }
    if (action.op === 'check') return hasTarget && /\b(tick|check|mark)\b/.test(text);
    if (['click','press'].includes(action.op)) return (hasTarget || (action.id === 'save_visit' && /\b(add|save)\b.*\bvisit\b/.test(text)) || (action.id === 'create_visit' && /\b(create|send|invite|book)\b/.test(text)) || ((action.id === 'open_audio_consult' || /record consultation/i.test(action.name || '')) && /\b(record|recording|audio)\b/.test(text))) && /\b(open|show|view|find|search|close|press|click|add|save|send|use|select|create|invite|check|read)\b/.test(text) && !/\b(write|type|append)\b/.test(text);
    return false;
  });
}
function pendingActions(reply, checklist, round, currentPath, record = null, snapshot = null, message = '') {
  prepareRequirements(checklist, currentPath, record, snapshot, message);
  const pending = [];
  function add(action) {
    action.actionId = `${round}:${pending.length}`;
    const itemIndex = matchingItem(checklist, action);
    const { value, find } = action;
    const replay = replayKey(action, currentPath, record);
    const safe = Object.fromEntries(['actionId', 'op', 'ref', 'name', 'section', 'control', 'page', 'pageId', 'path', 'kind', 'recordId', 'field', 'hash'].filter(k => action[k] !== undefined).map(k => [k, action[k]]));
    pending.push({ ...safe, replay, itemIndex, taskId: checklist[itemIndex]?.id, evidence: evidenceTarget(action), fingerprint: digest(JSON.stringify([currentPath, action.op, action.pageId || action.path || action.section, action.name || action.control || action.ref, value, find])) });
  }
  if (reply.type === 'navigate') add(reply);
  for (const step of reply.steps || []) {
    if (step.path || step.recordTarget) { step.op ||= 'go'; add(step); }
    for (const a of step.page?.actions || []) add(a);
    if (step.fill) {
      step.fill.actionIds = {};
      for (const [control, value] of Object.entries(step.fill.fields)) {
        const meta = step.fill.filled?.find(f => f.id === control);
        const a = { op: 'fill', control, value, page: step.fill.page, context: step.fill.context, name: meta?.label || control, ...(meta?.field && { field: meta.field }), ...(meta?.hash && { hash: meta.hash }) };
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
    if (item.requirementError) return { ...item, done: false };
    const matched = results.filter(r => r.taskId ? r.taskId === item.id : r.itemIndex === index);
    if (item.done || !matched.length) return item;
    if (item.required?.length) {
      const completed = new Set(item.completed || []);
      for (const result of matched) {
        if (result.result === 'ok' && result.evidence) completed.add(result.evidence);
        else if (result.evidence) completed.delete(result.evidence);
      }
      return { ...item, completed: [...completed], done: item.required.every(target => (item.alternatives?.[target] || [target]).some(candidate => completed.has(candidate))) };
    }
    return { ...item, done: matched.every(r => r.result === 'ok') };
  });
}

function evidenceTarget(action) {
  if (action.op === 'fill') return `${action.page}:${action.control}`;
  if (['type','append','replace','select','check'].includes(action.op)) return `element:${canonical(action.section)}:${canonical(action.name)}`;
  return null;
}

function containsPhrase(text, phrase) {
  const normalized = canonical(phrase);
  return normalized && ` ${canonical(text)} `.includes(` ${normalized} `);
}

// Quoted field values are not instructions. Preserve offsets when identifying
// boundaries, and leave possessive apostrophes in patient references intact.
function instructionText(text) {
  return String(text).replace(/"[^"]*"|“[^”]*”|(?<![\p{L}\p{N}])'[^']*'(?![\p{L}\p{N}])|‘[^’]*’/gu, quoted => ' '.repeat(quoted.length));
}

function requirementSources(message) {
  const text = String(message);
  const instructions = instructionText(text);
  const boundaries = /(?:\b(?:then|and(?:\s+then)?|aur|phir|afterwards|finally)\s+|[,.;\n]\s*)(?=(?:open|go|find|show|view|return|append|write|fill|set|enter|book|prepare|schedule|add|update|change|tick|check|mark)\b)/gi;
  const sources = [];
  let start = 0;
  for (const match of instructions.matchAll(boundaries)) {
    sources.push(text.slice(start, match.index));
    start = match.index + match[0].length;
  }
  sources.push(text.slice(start));
  return sources.map(source => source.trim()).filter(Boolean);
}

function fieldsBelongHere(text, page) {
  const instruction = instructionText(text);
  // A page name such as "schedule" is not a request to fill that page.
  if (matchIntent(instruction, pagesFor('clinician'))?.kind === 'open') return false;
  // A future booking date belongs to the appointment form, even when Schedule
  // is currently open. Never attach its date to Schedule's date filter.
  if (page !== 'new_appointment' && /\b(?:new\s+(?:appointment|visit)|book(?:ing)?(?:\s+(?:an?|the))?\s+(?:appointment|visit))\b/i.test(instruction)) return false;
  return /\b(write|append|fill|set|enter|add|prepare|record|change|update|book|schedule|bp|hb|weight)\b/i.test(instruction);
}

// Requirements come from the request and real controls, independently of which
// fields the navigator happens to propose. Only ids are retained as evidence.
function prepareRequirements(checklist, path, record, snapshot, message = '') {
  initializeChecklist(checklist);
  const page = require('./pages.registry').pageAt('clinician', path);
  const form = page && formFor('clinician', page);
  for (const item of checklist) {
    if (item.done || !fieldsBelongHere(item.text, page)) continue;
    // A request for consultation notes is not a request for the maternity
    // card's advice field just because that unrelated page is currently open.
    if (page === 'maternity' && /\b(notes?|instructions?|counsel\w*|advice)\b/i.test(item.text) && !/\b(maternity|antenatal|baseline|lab|scan|delivery|vaccine|visit advice)\b/i.test(item.text)) continue;
    if (page === 'new_appointment' && /\b(notes?|instructions?|counsel\w*|advice)\b/i.test(item.text) && !/\b(question|appointment|pre.visit)\b/i.test(item.text)) continue;
    const required = new Set(item.required || []);
    const groups = new Map();
    for (const control of form?.controls || []) {
      // Search is satisfied by its actual named-search result, not by clinical
      // form requirements copied from another instruction in the same request.
      if (page === 'patients' && control.id === 'query') continue;
      const section = control.id.split('.')[0];
      if (/\b(baseline|delivery|lab|scan|vaccine)\b/i.test(item.text) && control.id.includes('.') && !containsPhrase(item.text, section) && section !== 'patient') continue;
      const suffix = control.id.split('.').at(-1).replace(/([a-z])([A-Z])/g, '$1 $2');
      const aliases = [...(control.aliases || []), control.label.replace(/\([^)]*\)/g, '').trim(), suffix];
      const mentioned = aliases.some(alias => containsPhrase(item.text, alias)) ||
        (control.id === 'scheduledAt' && /\b(tomorrow|today|kal|aaj|date|time|am|pm)\b/i.test(item.text)) ||
        (control.id === 'patientEmail' && /[^\s@]+@[^\s@]+/.test(item.text)) ||
        (control.id === 'patientFullName' && /\bnew patient\b/i.test(item.text));
      if (mentioned) {
        const key = control.id.split('.').at(-1);
        const targets = groups.get(key) || [];
        targets.push(`${page}:${control.id}`);
        groups.set(key, targets);
      }
    }
    // Hb/weight/date may occur in more than one form section. Without an
    // explicit section, evidence from one matching field satisfies that field
    // requirement; it must not require writing into every section.
    for (const targets of groups.values()) {
      required.add(targets[0]);
      item.alternatives = { ...(item.alternatives || {}), [targets[0]]: targets };
    }
    for (const element of snapshot?.elements || []) {
      if (element.kind === 'search' || /search/i.test(element.name || '')) continue;
      if (element.private || !['text','textarea','number','email','date','datetime','select','search'].includes(element.kind)) continue;
      if (containsPhrase(item.text, element.name)) required.add(evidenceTarget({ ...element, op: 'type' }));
    }
    if (required.size) {
      item.required = [...required];
      item.completed ||= [];
    }
  }
  // Catch a field omitted from the model's checklist as well as from its
  // proposed actions. Derive the missing requirements from the original words.
  if (message && checklist.length) {
    // These are requirement sources only, not separately executed requests.
    // Keep values together but don't borrow fields from a different task/page.
    const sources = requirementSources(message);
    const requested = sources.map(text => ({ text, done: false }));
    prepareRequirements(requested, path, record, snapshot);
    for (const requirement of requested) for (const target of requirement.required || []) {
      const choices = requirement.alternatives?.[target] || [target];
      const covered = checklist.some(item => (item.required || []).some(existing =>
        (item.alternatives?.[existing] || [existing]).some(choice => choices.includes(choice))));
      if (covered) continue;
      let recipient = checklist.find(item => !item.done && fieldsBelongHere(item.text, page)) ||
        checklist.find(item => fieldsBelongHere(item.text, page));
      // Recover an entirely omitted form instruction as its own task. Never
      // silently discard it or attach it to an unrelated navigation item.
      if (!recipient) {
        if (checklist.length >= 8) {
          const item = checklist.find(entry => !entry.done) || checklist.at(-1);
          item.done = false;
          item.requirementError = 'the checklist omitted a requested form task';
          continue;
        }
        recipient = { text: requirement.text.trim().slice(0, 160), done: false };
        checklist.push(recipient);
        initializeChecklist(checklist);
      }
      recipient.done = false;
      recipient.required = [...(recipient.required || []), target];
      recipient.completed ||= [];
      recipient.alternatives = { ...(recipient.alternatives || {}), [target]: choices };
    }
  }
}
function stop(checklist, reason, source = 'agent') {
  const reasonFor = (c, i) => typeof reason === 'object' ? (reason[i] || 'not reached') : reason;
  return {
    type: 'unsupported', source, steps: [], checklist: checklist.map((c,i) => c.done ? c : { ...c, reason: reasonFor(c,i) }),
    message: checklist.map((c,i) => c.done ? `✓ ${c.text}` : `Couldn't: ${c.text} because ${reasonFor(c,i)}`).join('\n') || `Couldn't complete this request because ${reason}`
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
function replayKey(a, path, record = null) {
  const searchValue = a.state?.assistantQuery ||
    ((a.page === 'patients' && a.control === 'query') || a.kind === 'search' ? a.value : null);
  if (searchValue && (a.path === '/clinician/patients' || path === '/clinician/patients')) return digest(JSON.stringify(['patients-search', canonical(searchValue)]));
  return digest(JSON.stringify([path, record?.kind || null, record?.id || null, record?.patientId || null, a.context?.patientId || null, a.op, a.control || a.name || a.ref || a.pageId || a.path, a.section || '', a.value, a.find, a.state?.assistantQuery]));
}
module.exports = { replayKey, matchingItem, pendingActions, acceptResults, applyResults, stop, boundProvider, evidenceTarget, prepareRequirements, initializeChecklist, requirementSources };
