import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Users, Calendar, Stethoscope, Search, Plus, Heart, X, ChevronRight, Phone, Mail, Clock } from 'lucide-react';
import { Sidebar } from '../../components/layout/Sidebar.jsx';
import { Avatar } from '../../components/common/Avatar.jsx';
import { Spinner } from '../../components/common/Spinner.jsx';
import { fetchMyPatients } from '../../services/clinicianService.js';
import { formatDate } from '../../utils/format.js';

/** Everyone who has accepted a visit with this clinician. */
export function ClinicianPatients() {
  const [collapsed, setCollapsed] = useState(false);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');
  const [filterTab, setFilterTab] = useState('all'); // 'all', 'upcoming', 'past'

  useEffect(() => {
    fetchMyPatients()
      .then(setPatients)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const upcomingCount = useMemo(() => patients.filter((p) => Boolean(p.nextVisit)).length, [patients]);
  const pastOnlyCount = useMemo(() => patients.filter((p) => !p.nextVisit && Boolean(p.lastVisit)).length, [patients]);
  const totalVisitsCount = useMemo(() => patients.reduce((acc, p) => acc + (p.visitCount || 0), 0), [patients]);

  const shown = useMemo(() => {
    let list = patients;
    if (filterTab === 'upcoming') {
      list = list.filter((p) => Boolean(p.nextVisit));
    } else if (filterTab === 'past') {
      list = list.filter((p) => !p.nextVisit && Boolean(p.lastVisit));
    }

    const needle = query.trim().toLowerCase();
    if (!needle) return list;
    return list.filter((p) => `${p.fullName ?? ''} ${p.email ?? ''} ${p.phone ?? ''}`.toLowerCase().includes(needle));
  }, [patients, filterTab, query]);

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden px-6 py-5">
        {/* Header */}
        <header className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-50 text-emerald-700 border border-emerald-200">
                <Users size={18} />
              </span>
              <h1 className="font-display text-head-lg text-ink">Patient Directory</h1>
            </div>
            <p className="mt-1 text-body-md text-ink-2">
              All patients registered and scheduled for clinical consultations under your care.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              to="/clinician/appointments/new"
              className="inline-flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-xl bg-cypress text-surface hover:bg-cypress-deep shadow-sm transition"
            >
              <Plus size={16} /> New Visit
            </Link>
          </div>
        </header>

        {/* Clinical Stats Banner */}
        <div className="mb-5 grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-2xs flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">Registered Patients</span>
              <p className="mt-1 font-display text-2xl font-bold text-slate-800 tabular-nums">{patients.length}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-slate-50 text-slate-600 flex items-center justify-center border border-slate-200">
              <Users size={18} />
            </div>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/50 p-3.5 shadow-2xs flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-emerald-700">Upcoming Consultations</span>
              <p className="mt-1 font-display text-2xl font-bold text-emerald-800 tabular-nums">{upcomingCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-emerald-100 text-emerald-700 flex items-center justify-center border border-emerald-200">
              <Calendar size={18} />
            </div>
          </div>
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/50 p-3.5 shadow-2xs flex items-center justify-between">
            <div>
              <span className="text-[11px] font-semibold uppercase tracking-wider text-indigo-700">Total Visits Conducted</span>
              <p className="mt-1 font-display text-2xl font-bold text-indigo-800 tabular-nums">{totalVisitsCount}</p>
            </div>
            <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-700 flex items-center justify-center border border-indigo-200">
              <Stethoscope size={18} />
            </div>
          </div>
        </div>

        {/* Directory Controls and Patient List */}
        <section className="card min-h-0 flex-1 overflow-hidden flex flex-col">
          {/* Filter tabs and search */}
          <div className="p-3.5 border-b border-line flex flex-wrap items-center justify-between gap-3 bg-surface">
            {/* Filter Pills */}
            <div className="flex flex-wrap items-center gap-1.5">
              {[
                { id: 'all', label: 'All Patients', count: patients.length },
                { id: 'upcoming', label: 'Upcoming Visits', count: upcomingCount },
                { id: 'past', label: 'Past Visits Only', count: pastOnlyCount },
              ].map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setFilterTab(tab.id)}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                    filterTab === tab.id
                      ? 'bg-cypress text-surface shadow-2xs'
                      : 'bg-subcanvas text-ink-2 hover:bg-line/40'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span
                    className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                      filterTab === tab.id ? 'bg-cypress-deep text-surface' : 'bg-line text-ink-2'
                    }`}
                  >
                    {tab.count}
                  </span>
                </button>
              ))}
            </div>

            {/* Search Input */}
            <div className="relative min-w-[240px] flex-1 sm:max-w-xs">
              <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search patient, email, phone…"
                aria-label="Search patients"
                className="w-full rounded-lg border border-line bg-subcanvas/50 py-1.5 pl-8 pr-7 text-xs text-ink placeholder-ink-3 focus:bg-surface focus:border-cypress focus:outline-none transition"
              />
              {query && (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-3 hover:text-ink text-xs font-bold"
                >
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          {/* Table Container */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center gap-3 py-20 text-ink-3">
                <Spinner /> Loading patients…
              </div>
            ) : error ? (
              <p className="p-8 text-center text-body-md text-terracotta">{error.message}</p>
            ) : shown.length === 0 ? (
              <div className="py-16 text-center">
                <Users size={32} className="mx-auto text-ink-3/40" />
                <p className="mt-2 text-sm font-semibold text-ink">
                  {patients.length === 0
                    ? 'No registered patients yet'
                    : query
                    ? 'No patients match this query'
                    : 'No patients in this category'}
                </p>
                <p className="mt-1 text-xs text-ink-3 max-w-sm mx-auto">
                  Patients appear here once they accept a consultation invite or record a visit.
                </p>
                <Link
                  to="/clinician/appointments/new"
                  className="mt-4 inline-flex items-center gap-1.5 px-3.5 py-1.5 text-xs font-semibold rounded-lg bg-cypress text-surface hover:bg-cypress-deep transition"
                >
                  <Plus size={13} /> Schedule New Visit
                </Link>
              </div>
            ) : (
              <table className="w-full border-collapse text-left">
                <thead>
                  <tr className="border-b border-line bg-subcanvas/40 text-[11px] font-semibold uppercase tracking-wider text-ink-3">
                    <th scope="col" className="px-5 py-3">Patient Profile</th>
                    <th scope="col" className="px-3 py-3">Last Visit</th>
                    <th scope="col" className="px-3 py-3">Next Visit</th>
                    <th scope="col" className="px-3 py-3 tabular">Total Visits</th>
                    <th scope="col" className="px-5 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {shown.map((patient) => {
                    const latest = patient.nextVisit ?? patient.lastVisit;
                    return (
                      <tr key={patient.id} className="hover:bg-subcanvas/30 transition-colors">
                        <td className="px-5 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="relative">
                              <Avatar name={patient.fullName || patient.email || '?'} size="sm" />
                            </div>
                            <div className="min-w-0">
                              <p className="truncate text-sm font-bold text-ink">{patient.fullName || 'Unnamed patient'}</p>
                              <div className="flex flex-wrap items-center gap-2 mt-0.5 text-xs text-ink-3">
                                {patient.email && (
                                  <span className="inline-flex items-center gap-1">
                                    <Mail size={11} className="text-ink-3/70" /> {patient.email}
                                  </span>
                                )}
                                {patient.phone && (
                                  <span className="inline-flex items-center gap-1">
                                    <Phone size={11} className="text-ink-3/70" /> {patient.phone}
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-3.5 text-xs text-ink-2">
                          {patient.lastVisit ? (
                            <span className="font-medium text-ink">{formatDate(patient.lastVisit.scheduledAt)}</span>
                          ) : (
                            <span className="text-ink-3">—</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-xs">
                          {patient.nextVisit ? (
                            <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                              <Clock size={11} /> {formatDate(patient.nextVisit.scheduledAt)}
                            </span>
                          ) : (
                            <span className="text-ink-3 text-xs">None scheduled</span>
                          )}
                        </td>
                        <td className="px-3 py-3.5 text-xs tabular font-medium text-ink-2">
                          <span className="inline-flex items-center px-2 py-0.5 rounded-md bg-subcanvas text-ink-2 border border-line text-[11px]">
                            {patient.visitCount} {patient.visitCount === 1 ? 'visit' : 'visits'}
                          </span>
                        </td>
                        <td className="px-5 py-3.5">
                          <div className="flex items-center justify-end gap-2">
                            {/* Direct Maternity Card Link */}
                            <Link
                              to={`/clinician/maternity?patientId=${patient.id}&patientName=${encodeURIComponent(patient.fullName || '')}`}
                              className="inline-flex items-center gap-1 rounded-lg border border-rose-200 bg-rose-50/60 px-2.5 py-1 text-xs font-semibold text-rose-700 hover:bg-rose-100 transition shadow-2xs"
                              title="Open Maternal Health Record Card"
                            >
                              <Heart size={12} className="fill-rose-500/20 text-rose-600" /> Maternity Card
                            </Link>
                            {latest && (
                              <Link
                                to={`/clinician?appointment=${latest.appointmentId}`}
                                className="inline-flex items-center gap-1 rounded-lg border border-line bg-surface px-2.5 py-1 text-xs font-semibold text-cypress hover:bg-subcanvas transition shadow-2xs"
                              >
                                {patient.nextVisit ? 'Open next visit' : 'Open last visit'}
                              </Link>
                            )}
                            <Link
                              to={`/clinician/appointments/new?patient=${patient.id}`}
                              className="inline-flex items-center gap-1 rounded-lg bg-cypress px-2.5 py-1 text-xs font-semibold text-surface hover:bg-cypress-deep transition shadow-2xs"
                            >
                              <Plus size={12} /> New visit
                            </Link>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </main>
    </div>
  );
}

export default ClinicianPatients;
