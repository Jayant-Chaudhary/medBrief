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
  onLoadDemo,
  onResetPatient,
  syntheticAllowed = true,
}) {
  const [open, setOpen] = useState(true);
  const [selectedCaseIdx, setSelectedCaseIdx] = useState(0);

  if (similarityData?.enabled === false) {
    return null;
  }

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

  if (error) {
    return (
      <section className="card shrink-0 p-5 border border-amber-200 bg-surface">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-cypress" />
            <h2 className="font-display text-head-sm text-ink">
              Similar Historical Cases & Outcomes
            </h2>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="text-label-xs text-cypress font-medium px-2.5 py-1 rounded-lg border border-cypress/30 hover:bg-cypress/10 transition-colors"
            >
              Retry Calculation
            </button>
          )}
        </div>
        <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 flex items-start gap-2.5">
          <AlertCircle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
          <div>
            <p className="text-label-md font-semibold text-amber-900">
              Could Not Evaluate Similar Cases
            </p>
            <p className="text-body-sm text-amber-800 mt-0.5">{error}</p>
          </div>
        </div>
      </section>
    );
  }

  if (!similarityData) {
    return (
      <section className="card shrink-0 p-5 border border-line bg-surface">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Users className="h-4 w-4 text-cypress" />
            <h2 className="font-display text-head-sm text-ink">
              Similar Historical Cases & Outcomes
            </h2>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              className="text-label-xs text-cypress font-medium px-2.5 py-1 rounded-lg border border-cypress/30 hover:bg-cypress/10 transition-colors"
            >
              Evaluate Cohort
            </button>
          )}
        </div>
        <p className="text-body-sm text-ink-3 mt-2">
          Compares this patient against historical pregnancy trajectories based on gestational age, vitals, and lab observations.
        </p>
      </section>
    );
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
          <span className="rounded-full bg-slate-100 border border-slate-300 px-2.5 py-0.5 text-[11px] font-semibold text-slate-700">
            Synthetic example cases
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
          {/* Synthetic Provenance Disclaimer */}
          <div className="rounded-lg bg-slate-50 border border-slate-200 p-2.5 text-xs text-slate-600 flex items-center justify-between">
            <span className="font-medium text-slate-700">
              Synthetic example cases — Measurements, outcomes, and interventions are simulated.
            </span>
            <span className="text-[11px] text-slate-500">Decision-support reference</span>
          </div>

          {/* Demo Scenario Active Notice */}
          {similarityData.isDemoSample && (
            <div className="rounded-xl border border-indigo-200 bg-indigo-50/80 p-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-indigo-600 shrink-0" />
                <span className="text-label-sm font-semibold text-indigo-950">
                  Demo Test Scenario Active (Simulated Maternal Query)
                </span>
              </div>
              {onResetPatient && (
                <button
                  type="button"
                  onClick={onResetPatient}
                  className="text-label-xs text-indigo-700 font-semibold px-2.5 py-1 rounded-md bg-white border border-indigo-200 hover:bg-indigo-100 transition-colors shadow-2xs"
                >
                  Reset to Actual Patient
                </button>
              )}
            </div>
          )}

          {/* Insufficient Observations Alert */}
          {(similarityData.insufficientData || topMatches.length === 0) && !similarityData.isDemoSample && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3.5 space-y-3">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="h-4 w-4 text-amber-700 mt-0.5 shrink-0" />
                <div>
                  <p className="text-label-md font-semibold text-amber-900">
                    Insufficient Observations for Cohort Matching
                  </p>
                  <p className="text-body-sm text-amber-800 mt-1">
                    Similarity matching compares clinical vitals (blood pressure), gestational age, and lab tests against historical outcomes. This patient record has no clinical measurements recorded yet.
                  </p>
                  {similarityData.missingFactors?.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      <span className="text-[11px] font-medium text-amber-700 self-center mr-1">Missing factors:</span>
                      {similarityData.missingFactors.map((f) => (
                        <span key={f} className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-900 border border-amber-200">
                          {f.replace('_', ' ')}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {onLoadDemo && syntheticAllowed && (
                <div className="border-t border-amber-200/80 pt-2.5">
                  <span className="text-label-xs font-semibold text-amber-950 block mb-1.5">
                    Test the Similarity Model using a sample clinical query:
                  </span>
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => onLoadDemo('elevatedBpAndHeadacheScenario')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-950 text-xs font-semibold hover:bg-amber-100 transition-all shadow-2xs"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-700" />
                      Test Scenario 1: Rising BP + Headache (28w G2P1)
                    </button>
                    <button
                      type="button"
                      onClick={() => onLoadDemo('anemiaAndFatigueScenario')}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-white border border-amber-300 text-amber-950 text-xs font-semibold hover:bg-amber-100 transition-all shadow-2xs"
                    >
                      <Sparkles className="h-3.5 w-3.5 text-amber-700" />
                      Test Scenario 2: Maternal Anemia Hb 8.9 (26w G2P1)
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

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
          {topMatches.length > 0 && (
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
          )}

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
