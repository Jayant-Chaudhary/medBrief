/**
 * Pure helpers for tab-scoped assistant memory in AssistantDock (Slice 5).
 * Kept in React state only — never in localStorage or server storage.
 */

export const MEMORY_ITEMS = Number(import.meta.env?.VITE_ASSISTANT_MEMORY_ITEMS) || 10;
export const MEMORY_MAX_AGE_MIN = Number(import.meta.env?.VITE_ASSISTANT_MEMORY_MAX_AGE_MIN) || 120;

export function pruneMemory(entries = [], { now = Date.now(), maxItems = MEMORY_ITEMS, maxAgeMin = MEMORY_MAX_AGE_MIN } = {}) {
  if (!Array.isArray(entries)) return [];
  const maxAgeMs = maxAgeMin * 60 * 1000;
  return entries
    .filter((entry) => entry && typeof entry === 'object' && (!entry.at || now - entry.at <= maxAgeMs))
    .slice(-maxItems);
}

export function buildMemoryEntry({ message, patient = null, record = null, page = null, checklist = [], now = Date.now() }) {
  const cleanMessage = String(message || '').trim().slice(0, 600);
  if (!cleanMessage) return null;
  return {
    message: cleanMessage,
    patient: patient && (patient.id || patient.name)
      ? {
          ...(patient.id && { id: String(patient.id).slice(0, 100) }),
          ...(patient.name && { name: String(patient.name).slice(0, 120) }),
        }
      : null,
    record: record && record.kind && record.id
      ? { kind: record.kind, id: String(record.id).slice(0, 100) }
      : null,
    page: page ? String(page).slice(0, 80) : null,
    checklist: Array.isArray(checklist)
      ? checklist.slice(0, 8).map((c) => ({
          text: String(c?.text || c?.item || '').trim().slice(0, 160),
          done: Boolean(c?.done),
          ...(c?.reason && { reason: String(c.reason).trim().slice(0, 160) }),
        })).filter((c) => c.text)
      : [],
    at: now,
  };
}

export function appendMemory(entries = [], newEntry, options = {}) {
  const pruned = pruneMemory(entries, options);
  if (!newEntry) return pruned;
  return pruneMemory([...pruned, newEntry], options);
}
