import { useState } from 'react';
import {
  Sparkles,
  ChevronDown,
  RefreshCw,
  AlertTriangle,
  Brain,
  Activity,
  Pill,
  HelpCircle,
  FileText,
  ShieldAlert,
} from 'lucide-react';
import { Chip } from '../common/Chip.jsx';
import { formatDate } from '../../utils/format.js';

/**
 * 30-second AI Pre-Visit Clinical Brief for obstetricians and clinicians.
 * Synthesizes the patient's 28-day check-in history, vitals trajectory,
 * mental well-being screening, and specific questions for the visit.
 */
export function PreVisitAiBriefCard({ summary, onGenerate, isGenerating = false }) {
  const [open, setOpen] = useState(true);

  if (!summary) {
    return (
      <section className="card shrink-0 p-5 border border-line bg-surface">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cypress/10 text-cypress">
              <Sparkles className="h-5 w-5" />
            </div>
            <div>
              <h2 className="font-display text-head-sm text-ink">AI Pre-Visit Clinical Brief</h2>
              <p className="mt-0.5 text-body-sm text-ink-2">
                Synthesize the patient's interval check-ins, mental status, and vitals into a 30-second brief.
              </p>
            </div>
          </div>
          {onGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              className="flex shrink-0 items-center justify-center gap-2 rounded-xl bg-cypress px-4 py-2.5 text-label-md text-white transition-colors hover:bg-cypress-deep disabled:opacity-50"
            >
              {isGenerating ? (
                <>
                  <RefreshCw className="h-4 w-4 animate-spin" />
                  <span>Synthesizing...</span>
                </>
              ) : (
                <>
                  <Sparkles className="h-4 w-4" />
                  <span>Generate Pre-Visit Brief</span>
                </>
              )}
            </button>
          )}
        </div>
      </section>
    );
  }

  const isUrgent = summary.clinical_risk_level === 'urgent';
  const isModerate = summary.clinical_risk_level === 'moderate' || summary.clinical_risk_level === 'high';

  const redFlags = Array.isArray(summary.red_flags) ? summary.red_flags : [];
  const topQuestions = Array.isArray(summary.patient_top_questions) ? summary.patient_top_questions : [];
  const generatedTime = summary.generated_at || summary.updated_at || summary.created_at;

  return (
    <section className="card shrink-0 overflow-hidden border border-line bg-surface">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <div className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-subcanvas/40">
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          className="flex items-center gap-3 text-left focus:outline-none"
        >
          <ChevronDown
            className={`h-4 w-4 shrink-0 text-ink-3 transition-transform duration-200 ${
              open ? '' : '-rotate-90'
            }`}
          />
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-cypress" />
            <h2 className="font-display text-head-sm text-ink">Pre-Visit Clinical Brief</h2>
          </div>
        </button>

        {isUrgent ? (
          <Chip status="elevated" withDot>
            Urgent Priority
          </Chip>
        ) : isModerate ? (
          <Chip status="watch" withDot>
            Priority Watch
          </Chip>
        ) : (
          <Chip status="optimal" withDot>
            Routine Baseline
          </Chip>
        )}

        <div className="ml-auto flex items-center gap-3">
          {summary.interval_description && (
            <span className="hidden rounded-md bg-subcanvas px-2.5 py-1 text-label-xs font-medium text-ink-2 md:inline border border-line">
              Interval: {summary.interval_description}
            </span>
          )}
          {generatedTime && (
            <span className="hidden text-body-sm text-ink-3 lg:inline">
              Synthesized {formatDate(generatedTime)}
            </span>
          )}

          {onGenerate && (
            <button
              type="button"
              onClick={onGenerate}
              disabled={isGenerating}
              title="Refresh AI brief"
              className="flex items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1 text-label-sm text-ink-2 hover:bg-subcanvas hover:text-ink disabled:opacity-50"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${isGenerating ? 'animate-spin' : ''}`} />
              <span className="hidden sm:inline">Refresh</span>
            </button>
          )}
        </div>
      </div>

      {/* ── Collapsible Body ────────────────────────────────────────────── */}
      {open && (
        <div className="space-y-4 border-t border-line px-5 py-4">
          {/* Urgent Red Flags Banner */}
          {redFlags.length > 0 && (
            <div className="rounded-xl border border-terracotta-border bg-terracotta-surface p-4">
              <div className="flex items-center gap-2 text-label-md font-semibold text-terracotta">
                <AlertTriangle className="h-4 w-4" />
                <span>Priority Obstetric Alerts ({redFlags.length})</span>
              </div>
              <ul className="mt-2 list-inside list-disc space-y-1 text-body-sm text-terracotta-deep">
                {redFlags.map((flag, idx) => (
                  <li key={idx}>
                    {typeof flag === 'string' ? flag : (flag?.text || flag?.flag || JSON.stringify(flag))}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* 3 Pillars Grid */}
          <div className="grid gap-3 sm:grid-cols-3">
            {/* Physical Trajectory */}
            <div className="rounded-xl border border-line bg-subcanvas p-3.5">
              <div className="flex items-center gap-2 text-label-sm font-semibold text-ink-2 uppercase tracking-wide">
                <Activity className="h-4 w-4 text-cypress" />
                <span>Physical Sensations</span>
              </div>
              <p className="mt-2 text-body-sm text-ink leading-relaxed">
                {typeof summary.physical_symptom_trajectory === 'string'
                  ? summary.physical_symptom_trajectory
                  : (JSON.stringify(summary.physical_symptom_trajectory) || 'Expected gestational progress with no acute symptoms.')}
              </p>
            </div>

            {/* Mental Well-Being */}
            <div className="rounded-xl border border-line bg-subcanvas p-3.5">
              <div className="flex items-center gap-2 text-label-sm font-semibold text-ink-2 uppercase tracking-wide">
                <Brain className="h-4 w-4 text-purple-600" />
                <span>Emotional Well-Being</span>
              </div>
              <p className="mt-2 text-body-sm text-ink leading-relaxed">
                {typeof summary.mental_health_assessment === 'string'
                  ? summary.mental_health_assessment
                  : (JSON.stringify(summary.mental_health_assessment) || 'Stable mood and sleep patterns reported.')}
              </p>
            </div>

            {/* Medication & Routine */}
            <div className="rounded-xl border border-line bg-subcanvas p-3.5">
              <div className="flex items-center gap-2 text-label-sm font-semibold text-ink-2 uppercase tracking-wide">
                <Pill className="h-4 w-4 text-blue-600" />
                <span>Daily Routine & Meds</span>
              </div>
              <p className="mt-2 text-body-sm text-ink leading-relaxed">
                {typeof summary.medication_compliance === 'string'
                  ? summary.medication_compliance
                  : (JSON.stringify(summary.medication_compliance) || 'Prenatal vitamins reported regular.')}
              </p>
            </div>
          </div>

          {/* Patient Top Questions */}
          {topQuestions.length > 0 && (
            <div className="rounded-xl border border-amber-200 bg-amber-50/70 dark:border-amber-800/40 dark:bg-amber-950/30 p-3.5">
              <div className="flex items-center gap-2 text-label-sm font-semibold text-amber-900 dark:text-amber-300 uppercase tracking-wide">
                <HelpCircle className="h-4 w-4 text-amber-700 dark:text-amber-400" />
                <span>Patient's Agenda for Today</span>
              </div>
              <ul className="mt-2 space-y-1 text-body-sm text-amber-950 dark:text-amber-200">
                {topQuestions.map((q, idx) => (
                  <li key={idx} className="flex items-start gap-2">
                    <span className="font-semibold text-amber-700 dark:text-amber-400">"</span>
                    <span className="italic">{typeof q === 'string' ? q : (q?.question || q?.text || JSON.stringify(q))}</span>
                    <span className="font-semibold text-amber-700 dark:text-amber-400">"</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Suggested Doctor Talking Points */}
          {summary.doctor_talking_points && (
            <div className="rounded-xl border border-cypress/20 bg-cypress/5 dark:bg-cypress/10 p-3.5">
              <div className="flex items-center gap-2 text-label-sm font-semibold text-cypress-deep dark:text-cypress uppercase tracking-wide">
                <FileText className="h-4 w-4 text-cypress" />
                <span>Suggested Clinical Focus</span>
              </div>
              <div className="mt-1.5 text-body-sm text-ink leading-relaxed">
                {Array.isArray(summary.doctor_talking_points) ? (
                  <ul className="list-inside list-disc space-y-1">
                    {summary.doctor_talking_points.map((pt, idx) => (
                      <li key={idx}>{typeof pt === 'string' ? pt : JSON.stringify(pt)}</li>
                    ))}
                  </ul>
                ) : (
                  <p>{String(summary.doctor_talking_points)}</p>
                )}
              </div>
            </div>
          )}

          {/* Clinical Disclaimer */}
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <ShieldAlert className="h-3 w-3 shrink-0" />
            <span>Clinical decision support only · Synthesizes patient-reported inputs · Flags and prioritises, never diagnoses.</span>
          </div>
        </div>
      )}
    </section>
  );
}

export default PreVisitAiBriefCard;
