import { useEffect, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { inviteService } from '../../services/inviteService';
import { useAuth } from '../../hooks/useAuth';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { PasswordField } from '../../components/ui/PasswordField';
import { Spinner } from '../../components/ui/Spinner';

/**
 * Where the invite email lands.
 *
 * Two cases, decided by the server: a first-time patient sets a password
 * here, while someone who already has an account accepts the appointment by
 * entering their current password. Accepting is what links the clinician to
 * the patient, so it needs the patient's consent; an invite must never be
 * able to change the password on an existing account.
 */
export default function InvitePage() {
  const { token } = useParams();
  const navigate = useNavigate();
  const { login } = useAuth();

  const [invite, setInvite] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    inviteService
      .getInvite(token)
      .then(setInvite)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function handleSubmit(event) {
    event.preventDefault();
    setError(null);

    if (!invite.isReturningPatient) {
      if (password.length < 8) return setError('Use at least 8 characters.');
      if (password !== confirm) return setError('The two passwords do not match.');
    }

    setSubmitting(true);
    try {
      await inviteService.acceptInvite(token, password);
      await login({ email: invite.patientEmail, password });
      navigate('/', { replace: true });
    } catch (err) {
      setError(err.message);
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Spinner />
      </div>
    );
  }

  const unusable = error && !invite;
  const scheduled = invite?.scheduledAt ? new Date(invite.scheduledAt) : null;

  return (
    <div className="min-h-screen grid place-items-center bg-canvas p-4">
      <Card className="w-full max-w-md p-8">
        {unusable ? (
          <>
            <h1 className="text-2xl font-bold text-ink mb-2">This invite link isn’t valid</h1>
            <p className="text-ink-soft mb-6">{error}</p>
            <Link to="/login" className="text-primary font-bold hover:underline">
              Go to sign in
            </Link>
          </>
        ) : invite.isUsed || invite.isExpired ? (
          <>
            <h1 className="text-2xl font-bold text-ink mb-2">
              {invite.isUsed ? 'This invite has already been used' : 'This invite has expired'}
            </h1>
            <p className="text-ink-soft mb-6">
              {invite.isUsed
                ? 'Your account is already set up — just sign in.'
                : 'Ask the clinic to send you a new one.'}
            </p>
            <Link to="/login">
              <Button className="w-full">Go to sign in</Button>
            </Link>
          </>
        ) : invite.isReturningPatient ? (
          <form onSubmit={handleSubmit}>
            <h1 className="text-2xl font-bold text-ink mb-2">You have a new appointment</h1>
            <p className="text-ink-soft mb-6">
              {scheduled
                ? `Scheduled for ${scheduled.toLocaleString()}. `
                : ''}
              Enter your current password to accept it. Accepting lets this clinic see your records.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-bold text-ink-soft">Email</label>
                <p className="text-ink font-medium">{invite.patientEmail}</p>
              </div>

              <PasswordField
                label="Current password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            {error && <p className="mt-4 text-sm text-danger font-medium">{error}</p>}

            <Button type="submit" className="w-full mt-6" disabled={submitting}>
              {submitting ? 'Accepting…' : 'Accept appointment'}
            </Button>
          </form>
        ) : (
          <form onSubmit={handleSubmit}>
            <h1 className="text-2xl font-bold text-ink mb-1">
              Welcome{invite.patientFullName ? `, ${invite.patientFullName.split(' ')[0]}` : ''}
            </h1>
            <p className="text-ink-soft mb-6">
              {scheduled
                ? `Your appointment is scheduled for ${scheduled.toLocaleString()}. `
                : ''}
              Choose a password to finish setting up your account.
            </p>

            <div className="space-y-4">
              <div>
                <label className="text-sm font-bold text-ink-soft">Email</label>
                <p className="text-ink font-medium">{invite.patientEmail}</p>
              </div>

              <PasswordField
                label="Password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="new-password"
                required
              />
              <PasswordField
                label="Confirm password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                autoComplete="new-password"
                required
              />
            </div>

            {error && <p className="mt-4 text-sm text-danger font-medium">{error}</p>}

            <Button type="submit" className="w-full mt-6" disabled={submitting}>
              {submitting ? 'Setting up…' : 'Create my account'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
