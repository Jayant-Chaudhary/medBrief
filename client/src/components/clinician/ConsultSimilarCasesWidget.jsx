import { useState } from 'react';
import { Users, ChevronDown, CheckCircle2, TrendingUp, Sparkles } from 'lucide-react';
import { Chip } from '../common/Chip.jsx';

/**
 * Moment 2: Post-Consultation Similar Cases Widget.
 *
 * Appears inside the Consultation Slide-Over / ConsultancyNotes view.
 * Refreshes similarity incorporating both the pre-visit data and what was
 * spoken/documented during the consultation.
 */
export function ConsultSimilarCasesWidget({ similarityData, loading = false }) {
  const [open, setOpen] = useState(false);

  if (loading) {
    return (
      <div className="rounded-xl border border-line bg-subcanvas/40 p-3 animate-pulse">
        <div className="h-4 w-40 bg-subcanvas rounded" />
      </div>
    );
  }

  const topMatches = similarityData?.topMatches || [];
  if (topMatches.length === 0) return null;

  const topMatch = topMatches[0];

  return (
    <div className="rounded-xl border border-line bg-surface p-3.5 shadow-sm space-y-2.5">
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="flex items-center gap-2 text-left focus:outline-none flex-1"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200 ${
              open ? '' : '-rotate-90'
            }`}
          />
          <div className="flex items-center gap-1.5">
            <Users className="h-4 w-4 text-cypress" />
            <span className="text-label-sm font-semibold text-ink">
              Top Comparable Case ({topMatch.similarityPercent}% Match)
            </span>
          </div>
        </button>
        <div className="flex items-center gap-1.5">
          <span className="rounded-full bg-slate-100 border border-slate-300 px-2 py-0.5 text-[10px] font-semibold text-slate-700">
            Synthetic example cases
          </span>
          <Chip status="optimal">{topMatches.length} Similar Cases</Chip>
        </div>
      </div>

      <div className="text-body-xs text-ink-2 pl-6">
        <span className="font-medium text-ink">{topMatch.caseLabel}</span>
      </div>

      {open && (
        <div className="space-y-3 pt-2 pl-6 border-t border-line mt-2">
          <div className="rounded-lg bg-subcanvas/70 border border-line p-2 text-label-xs text-ink-3">
            Synthetic example cases — Measurements, outcomes, and interventions are simulated.
          </div>
          {/* Matched Factors */}
          <div>
            <span className="text-label-xs font-semibold text-ink-3 uppercase tracking-wider block mb-1">
              Key Shared Factors
            </span>
            <div className="flex flex-wrap gap-1">
              {topMatch.matchedFactors.slice(0, 6).map((f, i) => (
                <span
                  key={i}
                  className="inline-flex items-center gap-1 rounded bg-subcanvas px-2 py-0.5 text-label-xs text-ink-2 border border-line"
                >
                  <CheckCircle2 className="h-3 w-3 text-emerald-600 shrink-0" />
                  <span>{f.label}: {f.queryValue}</span>
                </span>
              ))}
            </div>
          </div>

          {/* Observed Clinical Progression */}
          {topMatch.clinicalProgression?.progressionSummary && (
            <div className="rounded-lg bg-subcanvas p-2.5 border border-line">
              <span className="text-label-xs font-semibold text-ink block mb-0.5 flex items-center gap-1">
                <TrendingUp className="h-3 w-3 text-cypress" />
                Historical Trajectory:
              </span>
              <p className="text-body-xs text-ink-2 leading-relaxed">
                {topMatch.clinicalProgression.progressionSummary}
              </p>
            </div>
          )}

          {/* Delivery Outcome */}
          {topMatch.clinicalProgression?.deliveryOutcome && (
            <div className="text-body-xs text-ink-3 italic">
              Delivery at {topMatch.clinicalProgression.deliveryOutcome.deliveredAtWeeks}w via{' '}
              {topMatch.clinicalProgression.deliveryOutcome.deliveryType} (Baby weight:{' '}
              {topMatch.clinicalProgression.deliveryOutcome.babyWeightKg} kg, APGAR{' '}
              {topMatch.clinicalProgression.deliveryOutcome.apgar1Min}/
              {topMatch.clinicalProgression.deliveryOutcome.apgar5Min})
            </div>
          )}
        </div>
      )}
    </div>
  );
}
