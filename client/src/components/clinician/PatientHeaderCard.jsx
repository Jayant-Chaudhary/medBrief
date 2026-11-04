import { Phone, Mail, Droplets, Calendar, Sparkles } from 'lucide-react';
import { Avatar } from '../common/Avatar.jsx';
import { formatHeaderDate } from '../../utils/format.js';

const STATUS_CONFIG = {
  invited: { label: 'Invite pending', style: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300' },
  active: { label: 'Scheduled', style: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-800/60 dark:bg-sky-950/40 dark:text-sky-300' },
  checked_in: { label: 'Checked in', style: 'border-emerald-300 bg-emerald-50 text-emerald-800 font-semibold dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300' },
  completed: { label: 'Completed', style: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-line dark:bg-subcanvas dark:text-ink-2' },
  cancelled: { label: 'Cancelled', style: 'border-rose-200 bg-rose-50 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/40 dark:text-rose-300' },
};

/**
 * Who the clinician is looking at, and which visit. Only facts on file are
 * shown — a detail the patient has not filled in is left out, not faked.
 */
export function PatientHeaderCard({ patient }) {
  if (!patient) return null;

  const status = STATUS_CONFIG[patient.visitStatus] ?? {
    label: patient.visitStatus,
    style: 'border-line bg-subcanvas text-ink-2',
  };

  return (
    <section className="card flex flex-wrap items-center gap-x-6 gap-y-4 px-6 py-4">
      <div className="relative">
        <Avatar
          name={patient.name}
          size="lg"
          className="bg-gradient-to-br from-indigo-600 via-primary to-primary-deep text-white shadow-md ring-4 ring-indigo-50 dark:ring-line text-lg font-bold"
        />
        {patient.visitStatus === 'checked_in' && (
          <span className="absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-surface bg-emerald-500" />
        )}
      </div>

      <div className="min-w-[240px] flex-1">
        <div className="flex flex-wrap items-center gap-3">
          <h1 className="font-display text-head-lg font-bold text-ink">{patient.name}</h1>
          {patient.visitStatus && (
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium ${status.style}`}>
              {status.label}
            </span>
          )}
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          {patient.age != null && (
            <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50 px-2.5 py-0.5 text-xs font-semibold text-blue-800 dark:border-blue-900/50 dark:bg-blue-950/40 dark:text-blue-300">
              {patient.age} yrs
            </span>
          )}

          {patient.bloodType && (
            <span className="inline-flex items-center gap-1 rounded-full border border-rose-200/80 bg-rose-50 px-2.5 py-0.5 text-xs font-bold text-rose-800 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300">
              <Droplets className="h-3 w-3 text-rose-600 dark:text-rose-400" />
              <span>{patient.bloodType}</span>
            </span>
          )}

          {patient.phone && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-subcanvas px-2.5 py-0.5 text-xs text-ink-2">
              <Phone className="h-3 w-3 text-ink-3" />
              <span className="tabular">{patient.phone}</span>
            </span>
          )}

          {patient.email && (
            <span className="hidden sm:inline-flex items-center gap-1.5 rounded-full border border-line bg-subcanvas px-2.5 py-0.5 text-xs text-ink-2">
              <Mail className="h-3 w-3 text-ink-3" />
              <span className="truncate max-w-[200px]">{patient.email}</span>
            </span>
          )}
        </div>
      </div>

      {patient.visitAt && (
        <dl className="shrink-0 rounded-xl border border-indigo-100 bg-gradient-to-br from-indigo-50/70 via-white to-slate-50 dark:border-indigo-900/40 dark:from-indigo-950/40 dark:via-surface dark:to-surface px-4 py-2.5 shadow-xs">
          <dt className="flex items-center gap-1.5 text-label-sm font-semibold uppercase tracking-wider text-indigo-900/70 dark:text-indigo-300">
            <Calendar className="h-3 w-3 text-indigo-600 dark:text-indigo-400" />
            <span>This visit</span>
          </dt>
          <dd className="mt-0.5 font-display text-label-lg font-bold text-indigo-950 dark:text-indigo-100 tabular">
            {formatHeaderDate(patient.visitAt)}
          </dd>
        </dl>
      )}
    </section>
  );
}

export default PatientHeaderCard;
