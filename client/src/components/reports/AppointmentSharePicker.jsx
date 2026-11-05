import { format } from 'date-fns';
import { Card } from '../ui/Card';
import { cn } from '../../utils/cn';

/**
 * Which appointment a newly uploaded report is shared with by default.
 * Existing reports are shared per-report on their own card.
 */
export default function AppointmentSharePicker({ appointments = [], activeId, onSelect }) {
  if (appointments.length === 0) return null;

  return (
    <Card className="p-4">
      <h3 className="text-sm font-bold text-ink mb-1">Your upcoming visits</h3>
      <p className="text-xs text-ink-soft mb-3">
        Reports in your library stay private until you explicitly choose to share them with an appointment.
      </p>

      <div className="space-y-2">
        {appointments.map((appointment) => (
          <button
            key={appointment.id}
            type="button"
            onClick={() => onSelect?.(appointment.id)}
            className={cn(
              'w-full text-left px-3 py-2 rounded-control border text-sm transition-colors',
              appointment.id === activeId
                ? 'border-primary bg-primary-light text-primary-dark font-bold'
                : 'border-ink-soft/20 hover:bg-canvas text-ink'
            )}
          >
            <span className="block">{format(new Date(appointment.scheduled_at), 'MMM d, yyyy')}</span>
            <span className="block text-xs font-medium text-ink-soft">
              {appointment.clinician?.full_name ?? 'Your clinician'}
            </span>
          </button>
        ))}
      </div>
    </Card>
  );
}
