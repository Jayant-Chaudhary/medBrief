import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '../common/Icon.jsx';
import { Avatar } from '../common/Avatar.jsx';
import { ThemeToggle } from '../common/ThemeToggle.jsx';
import { formatHeaderDate } from '../../utils/format.js';
import { statusOf } from '../../utils/clinical.js';
import { useAuthContext } from '../../context/AuthContext.jsx';

/**
 * Search · date · notifications · clinician identity.
 * The search field is a live patient switcher rather than decoration — typing
 * filters the queue and selecting swaps the dashboard's patient.
 */
export function Topbar({ patients = [], onSelectPatient, notifications = [] }) {
  const { profile } = useAuthContext();
  const clinicianName = profile?.full_name || 'Clinician';
  const clinicianRole = profile?.clinicianDetails?.specialty || 'Clinician';
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [showNotifications, setShowNotifications] = useState(false);
  const containerRef = useRef(null);

  const results = query.trim()
    ? patients.filter((patient) =>
        `${patient.name} ${patient.email ?? ''}`.toLowerCase().includes(query.trim().toLowerCase())
      )
    : patients;

  // Close both popovers on an outside click or Escape.
  useEffect(() => {
    function onPointerDown(event) {
      if (!containerRef.current?.contains(event.target)) {
        setOpen(false);
        setShowNotifications(false);
      }
    }
    function onKeyDown(event) {
      if (event.key === 'Escape') {
        setOpen(false);
        setShowNotifications(false);
      }
    }

    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
    };
  }, []);

  function select(patient) {
    onSelectPatient?.(patient);
    setQuery('');
    setOpen(false);
  }

  return (
    <header
      ref={containerRef}
      className="flex shrink-0 items-center gap-3 border-b border-line bg-canvas px-6 py-3"
    >
      <div className="relative min-w-0 flex-1">
        <Icon
          name="search"
          size={16}
          className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-3"
        />
        <input
          type="search"
          value={query}
          onChange={(event) => {
            setQuery(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          placeholder="Search today's patients by name"
          aria-label="Search patients"
          className="field h-10 pl-10"
        />

        {open && (
          <ul className="absolute z-20 mt-2 max-h-80 w-full overflow-y-auto rounded-xl border border-line-strong bg-raised py-1 shadow-raised" data-assistant-private="">
            {results.length === 0 && (
              <li className="px-4 py-3 text-body-sm text-ink-3">No patient matches “{query}”.</li>
            )}
            {results.map((patient) => (
              <li key={patient.appointmentId ?? patient.id}>
                <button
                  type="button"
                  onClick={() => select(patient)}
                  className="flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-subcanvas"
                >
                  <span className={`h-2 w-2 shrink-0 rounded-full ${statusOf(patient.acuity).dot}`} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-label-lg text-ink">{patient.name}</span>
                    <span className="block truncate text-body-sm text-ink-3">
                      {patient.scheduledAt ? formatHeaderDate(patient.scheduledAt) : ''}
                      {patient.isPending ? ' · invite pending' : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="hidden shrink-0 items-center gap-2 rounded-xl border border-line bg-surface px-3.5 py-2 text-body-sm text-ink-2 lg:flex">
        <Icon name="calendar" size={15} className="text-ink-3" />
        <span className="tabular">{formatHeaderDate()}</span>
      </div>

      <ThemeToggle />

      <div className="relative shrink-0">
        <button
          type="button"
          aria-label={`Notifications (${notifications.length} unread)`}
          onClick={() => setShowNotifications((value) => !value)}
          className="relative inline-flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-surface text-ink-2 transition-colors hover:bg-subcanvas hover:text-ink"
        >
          <Icon name="bell" size={18} />
          {notifications.length > 0 && (
            <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-terracotta ring-2 ring-surface" />
          )}
        </button>

        {showNotifications && (
          <div className="absolute right-0 z-20 mt-2 w-80 rounded-xl border border-line-strong bg-raised p-2 shadow-raised">
            <p className="px-2 py-1.5 text-label-sm uppercase text-ink-3">Notifications</p>
            {notifications.length === 0 ? (
              <p className="px-2 py-3 text-body-sm text-ink-3">Nothing new.</p>
            ) : (
              <ul className="space-y-0.5" data-assistant-private="">
                {notifications.map((item) => (
                  <li key={item.id} className="rounded-lg px-2 py-2 text-body-sm text-ink-2 hover:bg-subcanvas">
                    {item.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      <Link
        to="/clinician/profile"
        title="Your profile"
        className="flex shrink-0 items-center gap-2.5 rounded-xl p-1 pl-1 transition-colors hover:bg-subcanvas"
      >
        <Avatar name={clinicianName} size="sm" tone="cypress" />
        <div className="hidden leading-tight xl:block">
          <p className="font-display text-label-md text-ink">{clinicianName}</p>
          <p className="text-body-sm text-ink-3">{clinicianRole}</p>
        </div>
      </Link>
    </header>
  );
}

export default Topbar;
