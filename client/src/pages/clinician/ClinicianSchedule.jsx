import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { addDays, format, isSameDay, startOfDay } from 'date-fns';
import {
  Calendar,
  Clock,
  Plus,
  ChevronLeft,
  ChevronRight,
  User,
  Heart,
  Stethoscope,
  CalendarCheck2,
} from 'lucide-react';
import { Sidebar } from '../../components/layout/Sidebar.jsx';
import { Avatar } from '../../components/common/Avatar.jsx';
import { Spinner } from '../../components/common/Spinner.jsx';
import { fetchPatients } from '../../services/clinicianService.js';

/** At least two weeks are always shown, so an empty diary still reads as a calendar. */
const MIN_DAYS = 14;

const STATUS_CONFIG = {
  invited: {
    label: 'Invite pending',
    badgeClass: 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/50 dark:bg-amber-950/40 dark:text-amber-300',
    dotClass: 'bg-amber-500',
  },
  active: {
    label: 'Scheduled',
    badgeClass: 'border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900/50 dark:bg-sky-950/40 dark:text-sky-300',
    dotClass: 'bg-sky-500',
  },
  checked_in: {
    label: 'Checked in',
    badgeClass: 'border-emerald-200 bg-emerald-50 text-emerald-800 font-bold dark:border-emerald-900/50 dark:bg-emerald-950/40 dark:text-emerald-300',
    dotClass: 'bg-emerald-500 animate-pulse',
  },
  completed: {
    label: 'Completed',
    badgeClass: 'border-slate-200 bg-slate-100 text-slate-700 dark:border-line dark:bg-subcanvas dark:text-ink-2',
    dotClass: 'bg-slate-400',
  },
  cancelled: {
    label: 'Cancelled',
    badgeClass: 'border-rose-200 bg-rose-50 text-rose-700 line-through dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300',
    dotClass: 'bg-rose-400',
  },
};

/**
 * Upcoming appointments as a calendar: a scrollable strip of days across the
 * top, each with its count, and the chosen day's appointments below.
 */
export function ClinicianSchedule() {
  const [collapsed, setCollapsed] = useState(false);
  const [appointments, setAppointments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [selectedDay, setSelectedDay] = useState(() => startOfDay(new Date()));
  const stripRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    fetchPatients()
      .then(setAppointments)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  // Fixed for the life of the page, so the memos below have a stable input.
  const today = useMemo(() => startOfDay(new Date()), []);

  const upcoming = useMemo(
    () =>
      appointments
        .filter((a) => a.scheduledAt && new Date(a.scheduledAt) >= today)
        .sort((a, b) => new Date(a.scheduledAt) - new Date(b.scheduledAt)),
    [appointments, today]
  );

  /** Today through the last booked day (or two weeks, whichever is later). */
  const days = useMemo(() => {
    const last = upcoming.at(-1);
    const span = last ? Math.round((startOfDay(new Date(last.scheduledAt)) - today) / 86_400_000) + 1 : 0;
    return Array.from({ length: Math.max(MIN_DAYS, span) }, (_, i) => addDays(today, i));
  }, [upcoming, today]);

  const countFor = (day) =>
    upcoming.filter((a) => a.status !== 'cancelled' && isSameDay(new Date(a.scheduledAt), day)).length;

  const dayAppointments = upcoming.filter((a) => isSameDay(new Date(a.scheduledAt), selectedDay));

  const todayCount = useMemo(
    () => upcoming.filter((a) => a.status !== 'cancelled' && isSameDay(new Date(a.scheduledAt), today)).length,
    [upcoming, today]
  );

  const next7DaysCount = useMemo(
    () =>
      upcoming.filter(
        (a) => a.status !== 'cancelled' && new Date(a.scheduledAt) <= addDays(today, 7)
      ).length,
    [upcoming, today]
  );

  const checkedInCount = useMemo(
    () => upcoming.filter((a) => a.status === 'checked_in').length,
    [upcoming]
  );

  function scrollStrip(direction) {
    stripRef.current?.scrollBy({ left: direction * 320, behavior: 'smooth' });
  }

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden px-6 py-5">
        {/* Header */}
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/50 dark:text-indigo-300 dark:border-indigo-800/60">
                <Calendar size={18} />
              </span>
              <h1 className="font-display text-head-lg text-ink">Clinical Schedule</h1>
            </div>
            <p className="mt-1 text-body-md text-ink-2">
              {upcoming.length === 0
                ? 'No upcoming appointments scheduled.'
                : `${upcoming.filter((a) => a.status !== 'cancelled').length} upcoming clinical appointments booked`}
            </p>
          </div>
          <Link
            to="/clinician/appointments/new"
            className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl bg-cypress text-surface hover:bg-cypress-deep shadow-sm transition"
          >
            <Plus size={16} /> Schedule Visit
          </Link>
        </header>

        {loading ? (
          <div className="flex flex-1 items-center justify-center gap-3 text-ink-3">
            <Spinner /> Loading schedule…
          </div>
        ) : error ? (
          <div className="card p-8 text-center text-body-md text-terracotta">{error.message}</div>
        ) : (
          <>
            {/* Clinical Stats Banner */}
            <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-xl border border-line bg-surface p-3.5 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-ink-soft">Today's Visits</span>
                  <p className="mt-1 font-display text-2xl font-bold text-ink tabular-nums">{todayCount}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-subcanvas text-ink-2 flex items-center justify-center border border-line">
                  <Clock size={18} />
                </div>
              </div>
              <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 dark:border-indigo-900/40 dark:bg-indigo-950/30 p-3.5 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700 dark:text-indigo-400">Next 7 Days</span>
                  <p className="mt-1 font-display text-2xl font-bold text-indigo-800 dark:text-indigo-200 tabular-nums">{next7DaysCount}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 flex items-center justify-center border border-indigo-200 dark:border-indigo-800/60">
                  <CalendarCheck2 size={18} />
                </div>
              </div>
              <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 dark:border-emerald-900/40 dark:bg-emerald-950/30 p-3.5 shadow-2xs flex items-center justify-between">
                <div>
                  <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-400">Checked In / Waiting</span>
                  <p className="mt-1 font-display text-2xl font-bold text-emerald-800 dark:text-emerald-200 tabular-nums">{checkedInCount}</p>
                </div>
                <div className="w-10 h-10 rounded-xl bg-emerald-100 dark:bg-emerald-900/50 text-emerald-700 dark:text-emerald-300 flex items-center justify-center border border-emerald-200 dark:border-emerald-800/60">
                  <User size={18} />
                </div>
              </div>
            </div>

            {/* Calendar Day Strip */}
            <div className="card mb-4 flex items-center gap-2 p-2.5">
              <button
                type="button"
                onClick={() => scrollStrip(-1)}
                aria-label="Earlier days"
                className="shrink-0 rounded-lg p-2 text-ink-3 hover:bg-subcanvas hover:text-ink transition"
              >
                <ChevronLeft size={18} />
              </button>

              <div ref={stripRef} className="flex min-w-0 flex-1 gap-2 overflow-x-auto scroll-smooth py-1">
                {days.map((day) => {
                  const count = countFor(day);
                  const active = isSameDay(day, selectedDay);
                  const isCurrentDay = isSameDay(day, today);

                  return (
                    <button
                      key={day.toISOString()}
                      type="button"
                      onClick={() => setSelectedDay(day)}
                      aria-pressed={active}
                      className={`flex w-[82px] shrink-0 flex-col items-center rounded-xl border px-2 py-2.5 transition-all shadow-2xs ${
                        active
                          ? 'border-indigo-600 bg-gradient-to-b from-indigo-600 to-indigo-700 text-white shadow-md ring-2 ring-indigo-200 scale-102'
                          : 'border-line bg-surface text-ink hover:border-slate-300 hover:bg-subcanvas/70'
                      }`}
                    >
                      <span
                        className={`text-[10px] font-bold uppercase tracking-wider ${
                          active ? 'text-indigo-100' : isCurrentDay ? 'text-indigo-600 font-extrabold' : 'text-ink-3'
                        }`}
                      >
                        {isCurrentDay ? 'Today' : format(day, 'EEE')}
                      </span>
                      <span className="font-display text-lg font-bold tabular leading-tight my-0.5">
                        {format(day, 'd')}
                      </span>
                      <span className={`text-[11px] font-medium ${active ? 'text-indigo-200' : 'text-ink-3'}`}>
                        {format(day, 'MMM')}
                      </span>
                      <span
                        className={`mt-1.5 min-w-[20px] rounded-full px-1.5 py-0.2 text-[10.5px] font-bold tabular transition ${
                          active
                            ? 'bg-white text-indigo-700 shadow-2xs'
                            : count > 0
                            ? 'bg-indigo-50 text-indigo-700 border border-indigo-200 dark:bg-indigo-950/60 dark:text-indigo-300 dark:border-indigo-800/60'
                            : 'opacity-0'
                        }`}
                      >
                        {count}
                      </span>
                    </button>
                  );
                })}
              </div>

              <button
                type="button"
                onClick={() => scrollStrip(1)}
                aria-label="Later days"
                className="shrink-0 rounded-lg p-2 text-ink-3 hover:bg-subcanvas hover:text-ink transition"
              >
                <ChevronRight size={18} />
              </button>
            </div>

            {/* The chosen day appointments */}
            <section className="card min-h-0 flex-1 overflow-hidden flex flex-col">
              <div className="flex flex-wrap items-center justify-between border-b border-line px-5 py-3.5 bg-surface">
                <div className="flex items-center gap-2.5">
                  <h2 className="font-display text-head-sm text-ink">
                    {format(selectedDay, 'EEEE, MMMM d, yyyy')}
                  </h2>
                  <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-semibold bg-subcanvas text-ink-2 border border-line">
                    {dayAppointments.length} {dayAppointments.length === 1 ? 'visit' : 'visits'}
                  </span>
                </div>
                {!isSameDay(selectedDay, today) && (
                  <button
                    type="button"
                    onClick={() => setSelectedDay(today)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-indigo-600 hover:text-indigo-700 bg-indigo-50 hover:bg-indigo-100 border border-indigo-200 dark:text-indigo-300 dark:bg-indigo-950/50 dark:hover:bg-indigo-900/50 dark:border-indigo-800/60 px-2.5 py-1 rounded-lg transition"
                  >
                    <Calendar size={12} /> Jump to Today
                  </button>
                )}
              </div>

              <div className="flex-1 overflow-y-auto">
                {dayAppointments.length === 0 ? (
                  <div className="py-16 text-center">
                    <Calendar size={32} className="mx-auto text-ink-3/40" />
                    <p className="mt-2 text-sm font-semibold text-ink">No appointments scheduled for this day</p>
                    <p className="mt-1 text-xs text-ink-3 max-w-xs mx-auto">
                      Use the button below to book a consultation on {format(selectedDay, 'MMMM d')}.
                    </p>
                    <Link
                      to="/clinician/appointments/new"
                      className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cypress text-surface hover:bg-cypress-deep transition"
                    >
                      <Plus size={13} /> Book Visit for this Day
                    </Link>
                  </div>
                ) : (
                  <ul className="divide-y divide-line">
                    {dayAppointments.map((appointment) => {
                      const cfg = STATUS_CONFIG[appointment.status] ?? STATUS_CONFIG.active;
                      const openable = !appointment.isPending && appointment.status !== 'cancelled';

                      return (
                        <li key={appointment.appointmentId} className="hover:bg-subcanvas/30 transition-colors">
                          <div className="flex flex-wrap items-center justify-between gap-4 px-5 py-3.5">
                            {/* Time & Patient Info */}
                            <div className="flex items-center gap-4 min-w-0 flex-1">
                              {/* Time Pill */}
                              <div className="flex items-center gap-1.5 rounded-lg border border-line bg-subcanvas px-2.5 py-1 text-xs font-bold tabular text-ink shrink-0">
                                <Clock size={12} className="text-indigo-600" />
                                {format(new Date(appointment.scheduledAt), 'h:mm a')}
                              </div>

                              <Avatar name={appointment.name || '?'} size="sm" />

                              <div className="min-w-0 flex-1">
                                <span className="block truncate text-sm font-bold text-ink">{appointment.name}</span>
                                {appointment.email && (
                                  <span className="block truncate text-xs text-ink-3">{appointment.email}</span>
                                )}
                              </div>
                            </div>

                            {/* Status badge & Actions */}
                            <div className="flex items-center gap-2.5 shrink-0">
                              <span
                                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-semibold border ${cfg.badgeClass}`}
                              >
                                <span className={`w-1.5 h-1.5 rounded-full ${cfg.dotClass}`} />
                                {cfg.label}
                              </span>

                              {/* Maternity Card Direct Link */}
                              {appointment.id && (
                                <Link
                                  to={`/clinician/maternity?patientId=${appointment.id}&patientName=${encodeURIComponent(appointment.name || '')}`}
                                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/60 text-rose-700 hover:bg-rose-100 dark:border-rose-900/50 dark:bg-rose-950/40 dark:text-rose-300 dark:hover:bg-rose-900/40 px-2.5 py-1 text-xs font-semibold transition shadow-2xs"
                                  title="Open Maternal Health Record Card"
                                >
                                  <Heart size={12} className="fill-rose-500/20 text-rose-600" /> Maternity
                                </Link>
                              )}

                              {/* Primary Consultation Button */}
                              {openable && (
                                <button
                                  type="button"
                                  onClick={() => navigate(`/clinician?appointment=${appointment.appointmentId}`)}
                                  className="inline-flex items-center gap-1.5 rounded-lg bg-cypress px-3 py-1 text-xs font-semibold text-surface hover:bg-cypress-deep transition shadow-2xs"
                                >
                                  <Stethoscope size={13} /> Open Visit
                                </button>
                              )}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

export default ClinicianSchedule;
