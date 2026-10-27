import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Sidebar } from '../../components/layout/Sidebar.jsx';
import { Avatar } from '../../components/common/Avatar.jsx';
import { Icon } from '../../components/common/Icon.jsx';
import { Spinner } from '../../components/common/Spinner.jsx';
import { EmptyState } from '../../components/common/EmptyState.jsx';
import { fetchMyPatients } from '../../services/clinicianService.js';
import { formatDate } from '../../utils/format.js';

/** Everyone who has accepted a visit with this clinician. */
export function ClinicianPatients() {
  const [collapsed, setCollapsed] = useState(false);
  const [patients, setPatients] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState('');

  useEffect(() => {
    fetchMyPatients()
      .then(setPatients)
      .catch(setError)
      .finally(() => setLoading(false));
  }, []);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return patients;
    return patients.filter((p) => `${p.fullName ?? ''} ${p.email ?? ''}`.toLowerCase().includes(needle));
  }, [patients, query]);

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />

      <main className="flex min-w-0 flex-1 flex-col overflow-hidden px-6 py-5">
        <header className="mb-4 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="font-display text-head-lg text-ink">Patients</h1>
            <p className="text-body-md text-ink-2">Everyone who has accepted a visit with you.</p>
          </div>
          <div className="relative w-full max-w-xs">
            <Icon name="search" size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by name or email"
              aria-label="Search patients"
              className="field h-10 pl-9"
            />
          </div>
        </header>

        <section className="card min-h-0 flex-1 overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center gap-3 py-16 text-ink-3">
              <Spinner /> Loading patients…
            </div>
          ) : error ? (
            <p className="p-8 text-center text-body-md text-terracotta">{error.message}</p>
          ) : shown.length === 0 ? (
            <EmptyState
              icon="users"
              title={patients.length === 0 ? 'No patients yet' : 'No patient matches'}
              description={
                patients.length === 0
                  ? 'Patients appear here once they accept an invite to a visit.'
                  : 'Try another name or email.'
              }
            />
          ) : (
            <table className="w-full border-collapse text-left">
              <thead>
                <tr className="text-label-sm uppercase text-ink-3">
                  <th scope="col" className="px-5 py-2.5 font-semibold">Patient</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Last visit</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold">Next visit</th>
                  <th scope="col" className="px-3 py-2.5 font-semibold tabular">Visits</th>
                  <th scope="col" className="px-5 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {shown.map((patient) => {
                  const latest = patient.nextVisit ?? patient.lastVisit;
                  return (
                    <tr key={patient.id} className="border-t border-line">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3">
                          <Avatar name={patient.fullName || patient.email || '?'} size="sm" />
                          <div className="min-w-0">
                            <p className="truncate text-body-md text-ink">{patient.fullName || 'Unnamed patient'}</p>
                            <p className="truncate text-body-sm text-ink-3">
                              {[patient.email, patient.phone].filter(Boolean).join(' · ')}
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 text-body-sm text-ink-2">
                        {patient.lastVisit ? formatDate(patient.lastVisit.scheduledAt) : '—'}
                      </td>
                      <td className="px-3 py-3 text-body-sm text-ink-2">
                        {patient.nextVisit ? formatDate(patient.nextVisit.scheduledAt) : '—'}
                      </td>
                      <td className="px-3 py-3 text-body-sm tabular text-ink-2">{patient.visitCount}</td>
                      <td className="px-5 py-3">
                        <div className="flex justify-end gap-2">
                          {latest && (
                            <Link
                              to={`/clinician?appointment=${latest.appointmentId}`}
                              className="rounded-xl border border-line bg-surface px-3 py-1.5 text-label-md text-cypress hover:bg-subcanvas"
                            >
                              {patient.nextVisit ? 'Open next visit' : 'Open last visit'}
                            </Link>
                          )}
                          <Link
                            to={`/clinician/patients/${patient.id}/maternal-record`}
                            className="rounded-xl border border-line bg-surface px-3 py-1.5 text-label-md text-cypress hover:bg-subcanvas"
                          >
                            Maternal record
                          </Link>
                          <Link
                            to={`/clinician/appointments/new?patient=${patient.id}`}
                            className="rounded-xl bg-cypress px-3 py-1.5 text-label-md text-surface hover:bg-cypress-deep"
                          >
                            New visit
                          </Link>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </div>
  );
}

export default ClinicianPatients;
