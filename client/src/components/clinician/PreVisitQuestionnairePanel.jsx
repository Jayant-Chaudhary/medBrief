import { useState } from 'react';
import { Icon } from '../common/Icon.jsx';
import { Chip } from '../common/Chip.jsx';
import { countRedFlags, isRedFlag } from '../../utils/clinical.js';
import { formatDate } from '../../utils/format.js';

/**
 * Pre-visit questionnaire answers, collapsible to a single summary line.
 * Red-flag "Yes" answers are surfaced first and tinted terracotta so the
 * clinician reads risk before reading the rest.
 */
export function PreVisitQuestionnairePanel({ questionnaire }) {
  const answers = questionnaire?.answers ?? [];
  const flagged = countRedFlags(answers);

  // Progressive disclosure: Red flags stay open for safety. Normal answers fold to a compact 1-line verification card.
  const [open, setOpen] = useState(() => flagged > 0);

  // Red flags first, then everything else in original order.
  const ordered = [...answers].sort((a, b) => Number(isRedFlag(b)) - Number(isRedFlag(a)));

  return (
    <section className="card shrink-0 overflow-hidden border border-slate-200/90 shadow-sm bg-white" data-assistant-private="">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-5 py-3 text-left transition-colors hover:bg-slate-50"
      >
        <div className="flex items-center gap-3">
          <Icon
            name="chevronDown"
            size={18}
            className={`shrink-0 text-slate-400 transition-transform duration-200 ${open ? '' : '-rotate-90'}`}
          />
          <h2 className="font-display text-head-sm font-semibold text-ink">Pre-Visit Questionnaire</h2>

          {flagged > 0 ? (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-rose-300 bg-rose-50 px-3 py-0.5 text-xs font-bold text-rose-700">
              <span className="h-2 w-2 rounded-full bg-rose-500 animate-pulse" />
              {flagged} red flag{flagged > 1 ? 's' : ''} reported
            </span>
          ) : (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-300 bg-emerald-50 px-3 py-0.5 text-xs font-semibold text-emerald-800">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Verified · No red flags
            </span>
          )}
        </div>

        <div className="flex items-center gap-2 text-body-sm text-slate-500">
          <span className="hidden sm:inline">
            {open ? `Submitted ${formatDate(questionnaire?.submittedAt)}` : 'Click to inspect answers'}
          </span>
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600">
            {answers.length} answers
          </span>
        </div>
      </button>

      {open && (
        // Capped and scrolled on its own, so a long questionnaire never
        // squeezes the work columns below it off the screen.
        <div className="grid gap-3 border-t border-slate-200 px-5 py-4 sm:grid-cols-2 xl:grid-cols-3">
          {ordered.map((answer) => {
            const flag = isRedFlag(answer);
            return (
              <article
                key={answer.id}
                className={`rounded-xl border p-3.5 transition-all ${
                  flag
                    ? 'border-rose-200 bg-rose-50/70 shadow-xs'
                    : 'border-slate-200 bg-slate-50/60'
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <h3
                    className={`font-display text-label-md font-semibold uppercase tracking-wide ${
                      flag ? 'text-rose-900' : 'text-slate-700'
                    }`}
                  >
                    {answer.shortLabel}
                  </h3>
                  {answer.responseType !== 'text' && (
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-bold uppercase tracking-wider ${
                        flag ? 'bg-rose-600 text-white shadow-xs' : 'bg-slate-200 text-slate-700'
                      }`}
                    >
                      {answer.answer ? 'Yes' : 'No'}
                    </span>
                  )}
                </div>
                {answer.responseType === 'text' && (
                  <p className="mt-1.5 whitespace-pre-wrap text-body-md text-ink">{answer.answerText}</p>
                )}
                {answer.detail && (
                  <p className={`mt-1.5 text-body-sm ${flag ? 'text-terracotta-deep' : 'text-ink-2'}`}>
                    {answer.detail}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}

export default PreVisitQuestionnairePanel;
