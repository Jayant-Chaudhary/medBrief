import { useState, useEffect } from 'react';
import {
  Watch,
  ChevronDown,
  Activity,
  Heart,
  Moon,
  AlertTriangle,
  TrendingDown,
  TrendingUp,
  ShieldAlert,
  ExternalLink,
  X,
  Copy,
  Check,
  Calendar,
} from 'lucide-react';
import { Chip } from '../common/Chip.jsx';

/**
 * Formats YYYY-MM-DD into a readable clinician label with Today/Yesterday hints.
 */
function formatDateLabel(dateStr) {
  if (!dateStr) return '--';
  try {
    const [year, month, day] = dateStr.split('-').map(Number);
    const d = new Date(year, month - 1, day);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();

    const formatted = d.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      weekday: 'short',
    });
    if (isToday) return `${formatted} (Today)`;
    if (isYesterday) return `${formatted} (Yesterday)`;
    return formatted;
  } catch {
    return dateStr;
  }
}

/**
 * Displays genuine physical activity and wearable data synced via Health Connect.
 * Front Card: Executive glanceable summary (Yesterday, Today, 7-day trend, vitals baseline).
 * Modal: Detailed day-by-day interactive activity timeline and clinical trajectory breakdown.
 * Flags and prioritises; never diagnoses.
 */
export function WearableMetricsCard({ trajectory }) {
  const [open, setOpen] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [copied, setCopied] = useState(false);

  // Close modal on Escape key press
  useEffect(() => {
    function handleKeyDown(e) {
      if (e.key === 'Escape') {
        setShowModal(false);
      }
    }
    if (showModal) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [showModal]);

  if (!trajectory || !trajectory.hasData) {
    return (
      <section className="card shrink-0 p-4 border border-line bg-surface">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-cypress/10 text-cypress">
              <Watch className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="font-display text-head-sm text-ink">Physical Activity & Wearables</h3>
              <p className="text-body-xs text-ink-3">No Health Connect wearable data synced for this patient interval.</p>
            </div>
          </div>
          <Chip status="normal">No Sync</Chip>
        </div>
      </section>
    );
  }

  const {
    avgRecentSteps,
    avgPriorSteps,
    stepsTrendPercent,
    avgRestingHr,
    peakRestingHr,
    avgSleepHours,
    latestBp,
    latestWeight,
    flags = [],
    mobilityAlert,
    tachycardiaAlert,
    sleepDeficitAlert,
    bpAlert,
    dailyMetrics = [],
    daysTracked = dailyMetrics.length,
  } = trajectory;

  const hasUrgentAlert = bpAlert || (peakRestingHr && peakRestingHr >= 115);
  const hasModerateAlert = tachycardiaAlert || mobilityAlert || sleepDeficitAlert;

  // Sort metrics descending by date (most recent first)
  const sortedMetrics = [...dailyMetrics].sort((a, b) => {
    const dateA = a.metric_date || a.metricDate || '';
    const dateB = b.metric_date || b.metricDate || '';
    return dateB.localeCompare(dateA);
  });

  const todayStr = new Date().toISOString().substring(0, 10);
  const yesterdayDate = new Date();
  yesterdayDate.setDate(yesterdayDate.getDate() - 1);
  const yesterdayStr = yesterdayDate.toISOString().substring(0, 10);

  const todayMetric = sortedMetrics.find((m) => (m.metric_date || m.metricDate) === todayStr);
  const yesterdayMetric = sortedMetrics.find((m) => (m.metric_date || m.metricDate) === yesterdayStr);
  const mostRecentMetric = sortedMetrics[0];

  const maxStepsInPeriod = Math.max(...sortedMetrics.map((m) => m.steps || 0), 10000);

  const handleCopySummary = () => {
    const lines = [
      'MedBrief Wearable Telemetry Summary (Health Connect)',
      `• Days Tracked: ${daysTracked} days`,
      avgRecentSteps != null
        ? `• 7-Day Mobility: ${avgRecentSteps.toLocaleString()} steps/day avg (${
            stepsTrendPercent != null ? `${stepsTrendPercent > 0 ? '+' : ''}${stepsTrendPercent}% vs prior` : ''
          })`
        : null,
      yesterdayMetric?.steps != null ? `• Yesterday's Steps: ${yesterdayMetric.steps.toLocaleString()}` : null,
      todayMetric?.steps != null ? `• Today's Steps (in progress): ${todayMetric.steps.toLocaleString()}` : null,
      avgRestingHr != null
        ? `• Resting Pulse: ${avgRestingHr} bpm avg (Peak: ${peakRestingHr ?? '--'} bpm)`
        : null,
      avgSleepHours != null ? `• Sleep: ${avgSleepHours} hrs/night avg` : null,
      latestBp ? `• Wearable BP: ${latestBp.systolic}/${latestBp.diastolic} mmHg` : null,
      latestWeight != null ? `• Logged Weight: ${latestWeight} kg` : null,
      flags.length > 0 ? `• Clinical Observations: ${flags.join('; ')}` : null,
      'Note: Observational adjunct; flags and prioritises, never diagnoses.',
    ]
      .filter(Boolean)
      .join('\n');

    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(lines);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <>
      <section className="card shrink-0 overflow-hidden border border-line bg-surface shadow-xs">
        {/* ── Card Header ─────────────────────────────────────────────────── */}
        <div className="flex items-center justify-between px-5 py-3 transition-colors hover:bg-subcanvas/40">
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
              <Watch className="h-4 w-4 text-cypress" />
              <h3 className="font-display text-head-sm text-ink">Physical Activity & Wearables</h3>
            </div>
          </button>

          <div className="flex items-center gap-2">
            {hasUrgentAlert ? (
              <Chip status="elevated" withDot>
                Vitals Alert
              </Chip>
            ) : hasModerateAlert ? (
              <Chip status="watch" withDot>
                Watch Flag
              </Chip>
            ) : (
              <Chip status="normal" withDot>
                Synced
              </Chip>
            )}
            <span className="hidden sm:inline-flex text-[11px] font-medium text-cypress bg-cypress/10 px-2 py-0.5 rounded-md">
              Health Connect Verified
            </span>
          </div>
        </div>

        {/* ── Front Card Content ────────────────────────────────────────── */}
        {open && (
          <div className="space-y-4 border-t border-line px-5 py-4">
            {/* 3 Glanceable Metric Tiles (Recency, Trajectory, Vitals) */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              {/* Tile 1: Recent Activity (Yesterday & Today) */}
              <div className="rounded-xl border border-line bg-subcanvas/50 p-3.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-body-xs font-semibold text-ink-2">Recent Activity</span>
                    <Activity className="h-4 w-4 text-cypress" />
                  </div>
                  <div className="mt-2">
                    {yesterdayMetric?.steps != null ? (
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-display text-head-md text-ink">
                            {yesterdayMetric.steps.toLocaleString()}
                          </span>
                          <span className="text-body-xs text-ink-3">steps</span>
                        </div>
                        <p className="text-[11px] font-medium text-ink-2 mt-0.5">
                          Yesterday <span className="text-ink-3 font-normal">(full day)</span>
                        </p>
                      </div>
                    ) : mostRecentMetric?.steps != null ? (
                      <div>
                        <div className="flex items-baseline gap-1.5">
                          <span className="font-display text-head-md text-ink">
                            {mostRecentMetric.steps.toLocaleString()}
                          </span>
                          <span className="text-body-xs text-ink-3">steps</span>
                        </div>
                        <p className="text-[11px] font-medium text-ink-2 mt-0.5">
                          {formatDateLabel(mostRecentMetric.metric_date || mostRecentMetric.metricDate)}
                        </p>
                      </div>
                    ) : (
                      <div>
                        <span className="font-display text-head-md text-ink">
                          {avgRecentSteps != null ? avgRecentSteps.toLocaleString() : '--'}
                        </span>
                        <p className="text-[11px] text-ink-3 mt-0.5">7-day daily average</p>
                      </div>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-line/60 flex items-center justify-between text-[11px]">
                  <span className="text-ink-3">Today so far:</span>
                  <span className="font-semibold text-ink">
                    {todayMetric?.steps != null ? `${todayMetric.steps.toLocaleString()} steps` : 'Sync pending'}
                  </span>
                </div>
              </div>

              {/* Tile 2: 7-Day Trajectory & Mobility Direction */}
              <div className="rounded-xl border border-line bg-subcanvas/50 p-3.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-body-xs font-semibold text-ink-2">Mobility Trajectory</span>
                    {stepsTrendPercent != null && stepsTrendPercent < 0 ? (
                      <TrendingDown className={`h-4 w-4 ${mobilityAlert ? 'text-red-500' : 'text-amber-500'}`} />
                    ) : (
                      <TrendingUp className="h-4 w-4 text-cypress" />
                    )}
                  </div>
                  <div className="mt-2 flex items-baseline gap-2">
                    <span
                      className={`font-display text-head-md ${
                        mobilityAlert ? 'text-red-600 font-bold' : 'text-ink'
                      }`}
                    >
                      {stepsTrendPercent != null
                        ? `${stepsTrendPercent > 0 ? '+' : ''}${stepsTrendPercent}%`
                        : '--'}
                    </span>
                    <span className="text-body-xs text-ink-3">vs prior week</span>
                  </div>
                  <div className="mt-1">
                    {mobilityAlert ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
                        <AlertTriangle className="h-3 w-3" /> Marked Mobility Drop
                      </span>
                    ) : stepsTrendPercent != null && Math.abs(stepsTrendPercent) <= 15 ? (
                      <span className="text-[11px] text-cypress font-medium">Consistent Baseline</span>
                    ) : (
                      <span className="text-[11px] text-ink-3">7d avg: {avgRecentSteps?.toLocaleString() ?? '--'}/day</span>
                    )}
                  </div>
                </div>

                <div className="mt-2.5 pt-2 border-t border-line/60 flex items-center justify-between text-[11px]">
                  <span className="text-ink-3">Prior week base:</span>
                  <span className="text-ink-2 font-medium">
                    {avgPriorSteps != null ? `${avgPriorSteps.toLocaleString()}/day` : '--'}
                  </span>
                </div>
              </div>

              {/* Tile 3: Wearable Vitals Baseline */}
              <div className="rounded-xl border border-line bg-subcanvas/50 p-3.5 flex flex-col justify-between">
                <div>
                  <div className="flex items-center justify-between">
                    <span className="text-body-xs font-semibold text-ink-2">Wearable Vitals</span>
                    <Heart className={`h-4 w-4 ${tachycardiaAlert ? 'text-red-500' : 'text-cypress'}`} />
                  </div>
                  <div className="mt-2 space-y-1">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12px] text-ink-3">Resting Pulse</span>
                      <span className={`text-label-md font-semibold ${tachycardiaAlert ? 'text-red-600' : 'text-ink'}`}>
                        {avgRestingHr != null ? `${avgRestingHr} bpm` : '--'}
                      </span>
                    </div>
                    <div className="flex items-baseline justify-between">
                      <span className="text-[12px] text-ink-3">Sleep Avg</span>
                      <span className={`text-label-md font-semibold ${sleepDeficitAlert ? 'text-amber-600' : 'text-ink'}`}>
                        {avgSleepHours != null ? `${avgSleepHours} hrs` : '--'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="mt-2 pt-2 border-t border-line/60 flex items-center justify-between text-[11px]">
                  <span className="text-ink-3">Peak Pulse:</span>
                  <span className={peakRestingHr && peakRestingHr >= 100 ? 'text-red-600 font-bold' : 'text-ink-2 font-medium'}>
                    {peakRestingHr != null ? `${peakRestingHr} bpm ${tachycardiaAlert ? '(Elevated)' : ''}` : '--'}
                  </span>
                </div>
              </div>
            </div>

            {/* Secondary Vitals (Wearable BP / Weight) */}
            {(latestBp || latestWeight != null) && (
              <div className="flex flex-wrap items-center gap-2 pt-0.5">
                {latestBp && (
                  <div
                    className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-label-sm ${
                      bpAlert ? 'border-red-200 bg-red-50 text-red-700' : 'border-line bg-subcanvas text-ink-2'
                    }`}
                  >
                    <Activity className="h-3.5 w-3.5 text-ink-3" />
                    <span>
                      Wearable BP: <strong>{latestBp.systolic}/{latestBp.diastolic} mmHg</strong>
                    </span>
                    {bpAlert && <span className="font-bold text-red-600 ml-1">(! High)</span>}
                  </div>
                )}
                {latestWeight != null && (
                  <div className="flex items-center gap-1.5 rounded-lg border border-line bg-subcanvas px-2.5 py-1 text-label-sm text-ink-2">
                    <span>
                      Logged Weight: <strong>{latestWeight} kg</strong>
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Alert Flags Callout */}
            {flags.length > 0 && (
              <div className="rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-body-sm text-amber-900">
                <div className="flex items-center gap-2 font-medium text-amber-800">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600" />
                  <span>Wearable Observations Requiring Clinical Attention</span>
                </div>
                <ul className="mt-1.5 list-inside list-disc space-y-1 text-label-sm text-amber-800">
                  {flags.map((flag, idx) => (
                    <li key={idx}>{flag}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* ── Action Trigger to Open Modal ────────────────────────────── */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowModal(true)}
                className="inline-flex items-center gap-2 rounded-xl bg-cypress/10 hover:bg-cypress/20 text-cypress px-3.5 py-2 text-label-sm font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-cypress/40 cursor-pointer"
              >
                <Calendar className="h-4 w-4" />
                <span>Inspect Full Activity & Telemetry Log ({daysTracked} days)</span>
                <ExternalLink className="h-3.5 w-3.5 ml-0.5" />
              </button>

              <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0 text-ink-3" />
                <span>Observational adjunct; flags and prioritises, never diagnoses.</span>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ── Detailed Activity Modal Dialog ─────────────────────────────── */}
      {showModal && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="wearable-modal-title"
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-ink/50 backdrop-blur-xs animate-in fade-in duration-200"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowModal(false);
          }}
        >
          <div className="relative flex flex-col w-full max-w-3xl max-h-[90vh] rounded-2xl bg-surface border border-line shadow-xl overflow-hidden animate-in zoom-in-95 duration-150">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-line bg-subcanvas/50">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cypress text-white shadow-xs">
                  <Watch className="h-5 w-5" />
                </div>
                <div>
                  <h2 id="wearable-modal-title" className="font-display text-head-sm text-ink">
                    Wearable Activity & Biometrics Log
                  </h2>
                  <p className="text-body-xs text-ink-3">
                    Android Health Connect • {daysTracked} days of continuous sensor telemetry
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleCopySummary}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-surface text-ink-2 hover:text-ink hover:bg-subcanvas text-label-sm font-medium transition-colors"
                  title="Copy telemetry summary to clipboard for notes"
                >
                  {copied ? <Check className="h-3.5 w-3.5 text-cypress" /> : <Copy className="h-3.5 w-3.5" />}
                  <span>{copied ? 'Copied!' : 'Copy Summary'}</span>
                </button>

                <button
                  type="button"
                  onClick={() => setShowModal(false)}
                  className="p-1.5 rounded-lg text-ink-3 hover:text-ink hover:bg-subcanvas transition-colors focus:outline-none"
                  aria-label="Close modal"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {/* Modal Body (Scrollable) */}
            <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
              {/* Trajectory Comparison Overview Banner */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 rounded-xl border border-line bg-subcanvas/40 p-4">
                <div>
                  <span className="text-[11px] font-medium text-ink-3 uppercase tracking-wide">
                    Recent 7d Avg
                  </span>
                  <div className="font-display text-head-sm text-ink mt-0.5">
                    {avgRecentSteps != null ? `${avgRecentSteps.toLocaleString()} steps` : '--'}
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-ink-3 uppercase tracking-wide">
                    Prior 7d Baseline
                  </span>
                  <div className="font-display text-head-sm text-ink-2 mt-0.5">
                    {avgPriorSteps != null ? `${avgPriorSteps.toLocaleString()} steps` : '--'}
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-ink-3 uppercase tracking-wide">
                    Trajectory Change
                  </span>
                  <div
                    className={`font-display text-head-sm mt-0.5 ${
                      mobilityAlert ? 'text-red-600 font-bold' : 'text-ink'
                    }`}
                  >
                    {stepsTrendPercent != null
                      ? `${stepsTrendPercent > 0 ? '+' : ''}${stepsTrendPercent}%`
                      : '--'}
                  </div>
                </div>

                <div>
                  <span className="text-[11px] font-medium text-ink-3 uppercase tracking-wide">
                    Resting Pulse
                  </span>
                  <div className="font-display text-head-sm text-ink mt-0.5">
                    {avgRestingHr != null ? `${avgRestingHr} bpm` : '--'}
                  </div>
                </div>
              </div>

              {/* Day-by-Day Detailed Activity Table */}
              <div>
                <div className="flex items-center justify-between mb-2.5">
                  <h3 className="font-display text-head-xs text-ink">Day-by-Day Activity & Vitals</h3>
                  <span className="text-[11px] text-ink-3">Daily deduplicated records via Health Connect</span>
                </div>

                <div className="border border-line rounded-xl overflow-hidden bg-surface">
                  <table className="w-full text-left text-body-xs border-collapse">
                    <thead>
                      <tr className="border-b border-line bg-subcanvas/80 text-ink-2 font-semibold">
                        <th className="py-2.5 px-3.5">Date</th>
                        <th className="py-2.5 px-3.5">Steps & Volume</th>
                        <th className="py-2.5 px-3.5">Resting HR</th>
                        <th className="py-2.5 px-3.5">Sleep</th>
                        <th className="py-2.5 px-3.5">Vitals / Weight</th>
                        <th className="py-2.5 px-3.5 text-right">Source</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line/60">
                      {sortedMetrics.map((m, idx) => {
                        const dateStr = m.metric_date || m.metricDate;
                        const dateLabel = formatDateLabel(dateStr);
                        const steps = m.steps;
                        const barPct = steps != null ? Math.min(100, Math.round((steps / maxStepsInPeriod) * 100)) : 0;
                        const rhr = m.resting_heart_rate ?? m.restingHeartRate;
                        const isRhrHigh = rhr != null && rhr >= 100;
                        const sleepMins = m.sleep_minutes ?? m.sleepMinutes;
                        const sleepHrs = sleepMins != null ? (sleepMins / 60).toFixed(1) : null;
                        const bpSys = m.blood_pressure_systolic ?? m.bloodPressureSystolic;
                        const bpDia = m.blood_pressure_diastolic ?? m.bloodPressureDiastolic;
                        const weight = m.weight_kg ?? m.weightKg;

                        return (
                          <tr key={m.id || dateStr || idx} className="hover:bg-subcanvas/40 transition-colors">
                            {/* Date */}
                            <td className="py-3 px-3.5 font-medium text-ink whitespace-nowrap">
                              {dateLabel}
                            </td>

                            {/* Steps with Visual Bar */}
                            <td className="py-3 px-3.5">
                              {steps != null ? (
                                <div className="space-y-1">
                                  <span className="font-semibold text-ink text-label-md">
                                    {steps.toLocaleString()}
                                  </span>
                                  <div className="h-1.5 w-28 bg-line/60 rounded-full overflow-hidden">
                                    <div
                                      className="h-full bg-cypress rounded-full transition-all"
                                      style={{ width: `${barPct}%` }}
                                    />
                                  </div>
                                </div>
                              ) : (
                                <span className="text-ink-3">--</span>
                              )}
                            </td>

                            {/* Resting HR */}
                            <td className="py-3 px-3.5">
                              {rhr != null ? (
                                <span
                                  className={`inline-flex items-center gap-1 font-medium ${
                                    isRhrHigh ? 'text-red-600 font-bold bg-red-50 px-1.5 py-0.5 rounded' : 'text-ink-2'
                                  }`}
                                >
                                  <Heart className="h-3 w-3 shrink-0" />
                                  {rhr} bpm
                                </span>
                              ) : (
                                <span className="text-ink-3">--</span>
                              )}
                            </td>

                            {/* Sleep */}
                            <td className="py-3 px-3.5">
                              {sleepHrs != null ? (
                                <span className="text-ink-2">
                                  {sleepHrs} <span className="text-ink-3 text-[11px]">hrs</span>
                                </span>
                              ) : (
                                <span className="text-ink-3">--</span>
                              )}
                            </td>

                            {/* Vitals / Weight */}
                            <td className="py-3 px-3.5">
                              {bpSys && bpDia ? (
                                <div className="text-[11px] font-medium text-ink">
                                  BP: {bpSys}/{bpDia} mmHg
                                </div>
                              ) : weight != null ? (
                                <div className="text-[11px] text-ink-2">
                                  {weight} kg
                                </div>
                              ) : (
                                <span className="text-ink-3">--</span>
                              )}
                            </td>

                            {/* Source */}
                            <td className="py-3 px-3.5 text-right whitespace-nowrap">
                              <span className="inline-flex text-[10px] font-medium text-ink-3 bg-subcanvas px-2 py-0.5 rounded border border-line">
                                Health Connect
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Consultation Prep Guidance Box */}
              <div className="rounded-xl border border-cypress/30 bg-cypress/5 p-4 text-body-xs text-ink-2">
                <div className="flex items-center gap-2 font-semibold text-cypress">
                  <Activity className="h-4 w-4" />
                  <span>Clinical Prep Notes for Consultation</span>
                </div>
                <p className="mt-1 text-ink-3 leading-relaxed">
                  Compare recent step volume and resting pulse shifts against patient-reported symptoms (e.g. pelvic girdle pain, dyspnea, edema, or fatigue). Health Connect telemetry flags patterns and prioritises observations; it does not constitute a diagnostic conclusion.
                </p>
              </div>
            </div>

            {/* Modal Footer */}
            <div className="flex items-center justify-between px-6 py-3.5 border-t border-line bg-subcanvas/30">
              <span className="text-[11px] text-ink-3 flex items-center gap-1.5">
                <ShieldAlert className="h-3.5 w-3.5 shrink-0" />
                Observational adjunct. Flags and prioritises, never diagnoses.
              </span>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                className="px-4 py-1.5 rounded-xl bg-cypress text-white text-label-sm font-semibold hover:bg-cypress/90 transition-colors focus:outline-none"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default WearableMetricsCard;
