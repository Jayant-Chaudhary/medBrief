import { useNavigate } from 'react-router-dom';
import { format, differenceInCalendarDays } from 'date-fns';
import { usePatientContext } from '../../context/PatientContext';
import { Button } from '../ui/Button';

/**
 * What the patient should do next for the appointment they have selected.
 * Keyed on the appointment_status values the database actually stores.
 */
function contentFor(status, daysUntil, navigate) {
  switch (status) {
    case 'invited':
    case 'active':
      return {
        bg: 'bg-primary-light',
        title: daysUntil >= 0 ? `Your appointment is in ${daysUntil} day${daysUntil === 1 ? '' : 's'}` : 'Your appointment is due',
        subtitle: 'Pre-visit check-in not started',
        btnText: 'Start pre-visit check-in',
        btnAction: () => navigate('/checkin/reports'),
        secondaryBtnText: 'Share lab reports',
        secondaryBtnAction: () => navigate('/reports'),
      };
    case 'checked_in':
      return {
        bg: 'bg-success-light',
        title: "You're all set for your visit",
        subtitle: 'Check-in complete',
        btnText: 'Review shared reports',
        btnAction: () => navigate('/reports'),
      };
    case 'completed':
      return {
        bg: 'bg-canvas',
        border: 'border border-primary',
        title: 'Your visit summary is ready',
        subtitle: 'Doctor notes and next steps available',
        btnText: 'View summary',
        btnAction: () => navigate('/summary'),
        secondaryBtnText: 'Add lab reports',
        secondaryBtnAction: () => navigate('/reports'),
      };
    default:
      return null;
  }
}

export default function ActionBanner() {
  const { activeAppointment } = usePatientContext();
  const navigate = useNavigate();

  if (!activeAppointment) return null;

  const date = new Date(activeAppointment.scheduled_at);
  const content = contentFor(activeAppointment.status, differenceInCalendarDays(date, new Date()), navigate);
  if (!content) return null;

  return (
    <div className={`rounded-card p-5 ${content.bg} ${content.border || ''} shadow-sm`}>
      <div className="mb-4">
        <h2 className="text-lg font-bold text-ink mb-1">{content.title}</h2>
        <p className="text-sm font-medium text-primary">{content.subtitle}</p>
      </div>

      <div className="bg-raised/60 rounded-lg p-3 mb-4 space-y-1">
        <p className="text-sm font-bold text-ink">{format(date, 'MMM d, yyyy · h:mm a')}</p>
        <p className="text-xs text-ink-soft">
          {activeAppointment.clinician?.full_name ?? 'Your clinician'}
        </p>
      </div>

      <div className="flex flex-col sm:flex-row gap-3">
        <Button onClick={content.btnAction} className="w-full">
          {content.btnText}
        </Button>
        {content.secondaryBtnText && (
          <Button onClick={content.secondaryBtnAction} variant="secondary" className="w-full bg-raised">
            {content.secondaryBtnText}
          </Button>
        )}
      </div>
    </div>
  );
}
