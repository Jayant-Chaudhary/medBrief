import { NavLink } from 'react-router-dom';
import { Icon } from '../common/Icon.jsx';
import { Avatar } from '../common/Avatar.jsx';
import { ThemeToggle } from '../common/ThemeToggle.jsx';
import { useAuthContext } from '../../context/AuthContext.jsx';

const NAV_ITEMS = [
  { to: '/clinician', label: 'Dashboard', icon: 'triage', end: true },
  { to: '/clinician/appointments/new', label: 'New Visit', icon: 'plus' },
  { to: '/clinician/schedule', label: 'Schedule', icon: 'calendar' },
  { to: '/clinician/patients', label: 'Patients', icon: 'users' },
  { to: '/clinician/maternity', label: 'Maternity Card', icon: 'heart' },
  { to: '/clinician/checklists', label: 'Checklists', icon: 'check' },
  { to: '/clinician/lab-inbox', label: 'Lab Inbox', icon: 'flask' },
  { to: '/clinician/analytics', label: 'Analytics', icon: 'chart' },
];

/**
 * Expandable left rail. Collapsed it keeps the icons so the clinician can
 * still navigate while reclaiming ~200px of width for the data columns.
 */
export function Sidebar({ collapsed, onToggle }) {
  const { profile } = useAuthContext();
  const clinicianName = profile?.full_name || 'Your profile';
  const clinicianRole = profile?.clinicianDetails?.specialty || 'Clinician';

  return (
    <aside
      className={`flex shrink-0 flex-col border-r border-line bg-subcanvas transition-[width] duration-250
                  ${collapsed ? 'w-[72px]' : 'w-[248px]'}`}
    >
      <div className={`flex items-center gap-3 px-4 py-4 ${collapsed ? 'justify-center' : ''}`}>
        <img src="/logo-mark.png" alt="MedBrief" className="h-10 w-10 shrink-0 object-contain" />
        {!collapsed && (
          <div className="min-w-0 flex-1">
            <p className="font-display text-label-lg text-ink">MedBrief</p>
            <p className="whitespace-nowrap text-[10px] font-bold uppercase tracking-[0.08em] text-ink-3">
              Clinician Portal
            </p>
          </div>
        )}
        {!collapsed && (
          <button
            type="button"
            onClick={onToggle}
            aria-label="Collapse sidebar"
            className="rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-line/60 hover:text-ink"
          >
            <Icon name="panelLeft" size={18} />
          </button>
        )}
      </div>

      {collapsed && (
        <button
          type="button"
          onClick={onToggle}
          aria-label="Expand sidebar"
          className="mx-auto mb-2 rounded-lg p-1.5 text-ink-3 transition-colors hover:bg-line/60 hover:text-ink"
        >
          <Icon name="chevronRight" size={18} />
        </button>
      )}

      <nav className="flex-1 space-y-1 px-3 py-2">
        {NAV_ITEMS.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={collapsed ? item.label : undefined}
            className={({ isActive }) =>
              `relative flex items-center gap-3 rounded-xl px-3 py-2.5 font-display text-label-lg transition-colors
               ${collapsed ? 'justify-center' : ''}
               ${isActive ? 'bg-cypress text-surface' : 'text-ink-2 hover:bg-line/50 hover:text-ink'}`
            }
          >
            <Icon name={item.icon} size={18} className="shrink-0" />
            {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* In the sidebar because every clinician page has one; not every page has the top bar. */}
      <div className={`flex gap-2 border-t border-line p-3 ${collapsed ? 'flex-col items-center' : 'items-center'}`}>
        <NavLink
          to="/clinician/profile"
          className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 transition-colors hover:bg-line/50"
        >
          <Avatar name={clinicianName} size="sm" tone="cypress" />
          {!collapsed && (
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-label-md text-ink">{clinicianName}</p>
              <p className="truncate text-body-sm text-ink-3">{clinicianRole}</p>
            </div>
          )}
        </NavLink>
        <ThemeToggle />
      </div>
    </aside>
  );
}

export default Sidebar;
