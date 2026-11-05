const { digest } = require('./continuation');
const valueHash = value => digest(String(value).trim().replace(/\s+/g, ' '));
function identify(action, context) {
  return digest(JSON.stringify([context.record?.kind || context.path, context.record?.id || '', action.section || '', action.name || action.control, action.kind || '']));
}
function guard(actions, written, context) {
  const accepted = [], refused = [], batch = [...written];
  for (const action of actions) {
    if (!['type','append','replace','fill'].includes(action.op) || action.value === undefined) { accepted.push(action); continue; }
    const field = identify(action, context), hash = valueHash(action.value);
    if (batch.some(w => w.field === field && w.hash === hash)) {
      refused.push({ name: action.name || action.control, reason: 'already written' });
      continue;
    }
    batch.push({ field, hash });
    accepted.push({ ...action, field, hash });
  }
  return { actions: accepted, refused };
}
module.exports = { guard, identify, valueHash };
