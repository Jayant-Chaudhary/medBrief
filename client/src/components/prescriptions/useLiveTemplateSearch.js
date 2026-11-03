import { useEffect, useMemo, useState } from 'react';
import { evaluateMedicationSuggestions, saveDisplayedMedicationCandidates } from '../../services/medicationDecisionService.js';
import { TEMPLATE_SEARCH_CONFIG } from './prescriptionConfig.js';
import { filterTemplateMatches, runTemplateSearch } from './templateSearchModel.js';

export function useLiveTemplateSearch({ appointmentId, ranked, context, query, enabled }) {
  const [state, setState] = useState(null);
  const [retryToken, setRetryToken] = useState(0);
  const localMatches = useMemo(() => filterTemplateMatches(ranked, query).slice(0, TEMPLATE_SEARCH_CONFIG.maxResults), [ranked, query]);
  const input = useMemo(() => ({ appointmentId, ranked, context, query, enabled, retryToken }),
    [appointmentId, ranked, context, query, enabled, retryToken]);

  useEffect(() => {
    if (!enabled) return undefined;
    let active = true;
    const timer = setTimeout(async () => {
      try {
        const factorSnapshot = Object.fromEntries(Object.entries(context.factorRecords || {})
          .filter(([, record]) => ['number', 'select'].includes(record.type) && record.autoReuse !== false &&
            !record.needsReview && !record.stale && record.confirmed !== false)
          .map(([id, record]) => [id, { type: record.type, value: record.value ?? null, unit: record.unit || '',
            label: record.label || id, recordedAt: record.recordedAt || '', source: record.source || '', confirmed: true }]));
        const result = await runTemplateSearch({ ranked, query, factorSnapshot,
          evaluate: payload => evaluateMedicationSuggestions(appointmentId, payload),
          recordDisplayed: (eventId, rows) => saveDisplayedMedicationCandidates(appointmentId, eventId, rows),
          isCurrent: () => active,
        });
        if (active && result) setState({ input, ...result, error: '' });
      } catch {
        if (active) setState({ input, matches: [], event: null,
          error: 'Templates are available for review, but visit eligibility and decision tracking could not be checked. Retry to reconnect.' });
      }
    }, TEMPLATE_SEARCH_CONFIG.debounceMs);
    return () => { active = false; clearTimeout(timer); };
  }, [input, appointmentId, ranked, context, query, enabled]);

  // Browse immediately using current local data. Network delays/failures must not hide the library.
  // Only the matching evaluation can supply feedback eligibility; discard older evaluation metadata.
  const current = enabled && state?.input === input;
  return {
    matches: current && !state.error ? state.matches : localMatches, event: current ? state.event : null,
    error: current ? state.error : '', loading: enabled && !current,
    retry: () => setRetryToken(value => value + 1),
  };
}
