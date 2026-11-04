import { useState } from 'react';
import {
  Users,
  ChevronDown,
  AlertCircle,
  HelpCircle,
  CheckCircle2,
  Calendar,
  Baby,
  Activity,
  Sparkles,
  ArrowRight,
  TrendingUp,
} from 'lucide-react';
import { Chip } from '../common/Chip.jsx';

/**
 * Moment 1: Pre-Consultation Cohort Triage & Similar Cases Card.
 *
 * Renders:
 * 1. Top similar historical pregnancy episodes based on gestational age, G/P baseline,
 *    and pre-visit symptoms.
 * 2. Unchecked Clinical Factors Banner (alerting clinician to investigations present
 *    in similar cases but not yet recorded for this patient).
 * 3. Historical Trajectory & Recorded Delivery Outcomes.
 *
 * Safety Notice:
 * - Flags and prioritises; NEVER diagnoses. Strictly descriptive cohort reference.
 */
export function SimilarCasesTriageCard({
  similarityData,
  loading = false,
  error = null,
  onRefresh,
}) {
  const [open, setOpen] = useState(true);
  const [selectedCaseIdx, setSelectedCaseIdx] = useState(0);

  if (loading) {
    return (
      <section className="card shrink-0 p-5 border border-line bg-surface animate-pulse">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-subcanvas" />
          <div className="space-y-1.5 flex-1">
            <div className="h-4 w-48 rounded bg-subcanvas" />
            <div className="h-3 w-72 rounded bg-subcanvas" />
          </div>
        </div>
      </section>
    );
  }

  if (error || !similarityData?.topMatches) {
    return null;
  }

  const { topMatches = [], uncheckedFactorsInQuery = [], cohortSummary } = similarityData;
  const topMatch = topMatches[selectedCaseIdx] || topMatches[0];

  return (
    <section className="card shrink-0 overflow-hidden border border-line bg-surface">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-subcanvas/40">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="flex items-center gap-3 text-left focus:outline-none flex-1"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200 ${
              open ? '' : '-rotate-90'
            }`}
          />
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-cypress" />
            <h2 className="font-display text-head-sm text-ink">
              Similar Historical Cases & Outcomes
            </h2>
          </div>
          <span className="hidden sm:inline-flex rounded-full bg-cypress/10 px-2.5 py-0.5 text-label-xs font-semibold text-cypress">
            {topMatches.length} comparable mothers
          </span>
        </button>

        <div className="flex items-center gap-2">
          {similarityData.rankingMeta?.gestationalWindowWeeksUsed && (
            <span className="text-body-xs text-ink-3 hidden md:inline">
              Window: ±{similarityData.rankingMeta.gestationalWindowWeeksUsed} weeks
            </span>
          )}
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="text-label-xs text-ink-2 hover:text-cypress px-2 py-1 rounded hover:bg-subcanvas"
            >
              Recalculate
            </button>
          )}
        </div>
      </div>

      {/* ── Collapsible Body ────────────────────────────────────────────── */}
      {open && (
        <div className="space-y-4 border-t border-line px-5 py-4">
          {/* Unchecked Factors in Current Visit Alert */}
          {uncheckedFactorsInQuery.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                <div className="space-y-1">
                  <p className="text-label-md font-semibold text-amber-900">
                    Unchecked Factors in Current Visit
                  </p>
                  <p className="text-body-sm text-amber-800">
                    The following investigations were recorded in similar historical cases but
                    are currently unrecorded in this visit:
                  </p>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {uncheckedFactorsInQuery.slice(0, 5).map((u) => (
                      <span
                        key={u.featureKey}
                        className="inline-flex items-center gap-1 rounded-md bg-amber-100/90 px-2 py-0.5 text-label-xs font-medium text-amber-900 border border-amber-200"
                      >
                        <HelpCircle className="h-3 w-3 text-amber-700" />
                        {u.label}
                        {u.presentInTopKCount > 1 && (
                          <span className="text-amber-700 font-normal">
                            ({u.presentInTopKCount}/{topMatches.length} cases)
                          </span>
                        )}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Top Cases Tabs / Pill Selector */}
          <div>
            <div className="flex items-center justify-between pb-2">
              <span className="text-label-xs font-semibold text-ink-3 uppercase tracking-wider">
                Ranked Historical Matches
              </span>
              <span className="text-body-xs text-ink-3">
                Select a case to inspect clinical trajectory
              </span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {topMatches.map((m, idx) => {
                const isSelected = idx === selectedCaseIdx;
                return (
                  <button
                    key={m.episodeId || idx}
                    type="button"
                    onClick={() => setSelectedCaseIdx(idx)}
                    className={`rounded-xl p-3 text-left transition-all border ${
                      isSelected
                        ? 'border-cypress bg-cypress/5 shadow-sm ring-1 ring-cypress'
                        : 'border-line bg-subcanvas/60 hover:bg-subcanvas hover:border-line-strong'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-label-sm font-semibold text-ink truncate max-w-[130px]">
                        {m.caseLabel.split('(')[0] || `Case #${idx + 1}`}
                      </span>
                      <Chip
                        status={
                          m.similarityPercent >= 80
                            ? 'optimal'
                            : m.similarityPercent >= 60
                            ? 'watch'
                            : 'neutral'
                        }
                      >
                        {m.similarityPercent}% Match
                      </Chip>
                    </div>
                    <div className="mt-1.5 text-body-xs text-ink-2 line-clamp-1">
                      {m.matchedFactors.length} matched factors
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Active Selected Case Details */}
          {topMatch && (
            <div className="rounded-xl border border-line bg-subcanvas/40 p-4 space-y-3.5">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border-b border-line pb-3">
                <div>
                  <h3 className="text-label-md font-semibold text-ink">
                    {topMatch.caseLabel}
                  </h3>
                  <p className="text-body-xs text-ink-3">
                    Similarity Score: {topMatch.similarityPercent}% (Structured:{' '}
                    {Math.round((topMatch.subScores.structuredShrunk ?? 0) * 100)}%, Symptoms:{' '}
                    {Math.round((topMatch.subScores.symptomShrunk ?? 0) * 100)}%)
                  </p>
                </div>
                {topMatch.clinicalProgression?.deliveryOutcome && (
                  <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-50 px-2.5 py-1 text-label-xs font-semibold text-emerald-800 border border-emerald-200">
                    <Baby className="h-3.5 w-3.5 text-emerald-600" />
                    Delivered at {topMatch.clinicalProgression.deliveryOutcome.deliveredAtWeeks}w
                  </span>
                )}
              </div>

              {/* Matched Factors Pills */}
              <div>
                <span className="text-label-xs font-semibold text-ink-3 uppercase tracking-wider block mb-1.5">
                  Key Matched Clinical Factors
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {topMatch.matchedFactors.slice(0, 8).map((f, i) => (
                    <span
                      key={i}
                      className="inline-flex items-center gap-1 rounded-md bg-surface px-2 py-1 text-label-xs text-ink border border-line"
                    >
                      <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                      <span className="font-medium">{f.label}:</span>
                      <span className="text-ink-2">
                        {f.queryValue} ≈ {f.referenceValue}
                      </span>
                    </span>
                  ))}
                </div>
              </div>

              {/* Longitudinal Progression */}
              {topMatch.clinicalProgression?.progressionSummary && (
                <div className="rounded-lg bg-surface p-3 border border-line">
                  <div className="flex items-center gap-1.5 text-label-sm font-semibold text-ink mb-1">
                    <TrendingUp className="h-3.5 w-3.5 text-cypress" />
                    <span>Clinical Progression Observed</span>
                  </div>
                  <p className="text-body-sm text-ink-2 leading-relaxed">
                    {topMatch.clinicalProgression.progressionSummary}
                  </p>
                </div>
              )}

              {/* Recorded Interventions & Delivery */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                {topMatch.clinicalProgression?.interventionsRecorded?.length > 0 && (
                  <div className="space-y-1">
                    <span className="text-label-xs font-semibold text-ink-3 uppercase tracking-wider">
                      Recorded Interventions
                    </span>
                    <ul className="list-disc list-inside space-y-0.5 text-body-xs text-ink-2">
                      {topMatch.clinicalProgression.interventionsRecorded.slice(0, 3).map((item, idx) => (
                        <li key={idx} className="line-clamp-1">{item}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {topMatch.clinicalProgression?.deliveryOutcome && (
                  <div className="space-y-1">
                    <span className="text-label-xs font-semibold text-ink-3 uppercase tracking-wider">
                      Recorded Delivery Outcome
                    </span>
                    <p className="text-body-xs text-ink-2">
                      <span className="font-medium text-ink">
                        {topMatch.clinicalProgression.deliveryOutcome.deliveryType}
                      </span>{' '}
                      at {topMatch.clinicalProgression.deliveryOutcome.deliveredAtWeeks}w. Baby weight:{' '}
                      {topMatch.clinicalProgression.deliveryOutcome.babyWeightKg} kg, APGAR{' '}
                      {topMatch.clinicalProgression.deliveryOutcome.apgar1Min}/
                      {topMatch.clinicalProgression.deliveryOutcome.apgar5Min}.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Safety Disclaimer Footer */}
          <p className="text-[11px] text-ink-3 italic pt-1">
            Clinical decision support only. Identifies historical patient trajectories for pattern recognition;
            never provides an automated medical diagnosis or replaces clinician assessment.
          </p>
        </div>
      )}
    </section>
  );
}
