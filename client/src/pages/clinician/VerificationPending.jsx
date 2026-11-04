import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../../components/ui/Button';
import { useAuthContext } from '../../context/AuthContext';
import { request } from '../../services/apiClient';
import { profileService } from '../../services/profileService';

export default function VerificationPending() {
  const { logout, refreshProfile } = useAuthContext();
  const navigate = useNavigate();
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState(null);
  const [canSelfVerify, setCanSelfVerify] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(true);

  useEffect(() => {
    let isMounted = true;
    async function checkVerificationCapability() {
      try {
        const data = await profileService.getProfile();
        if (isMounted) {
          setCanSelfVerify(Boolean(data?.canSelfVerify));
        }
      } catch (err) {
        if (isMounted) {
          setCanSelfVerify(false);
        }
      } finally {
        if (isMounted) {
          setLoadingConfig(false);
        }
      }
    }
    checkVerificationCapability();
    return () => {
      isMounted = false;
    };
  }, []);

  /**
   * Demo only: verifies this account on the spot instead of waiting for an
   * administrator. The API refuses outside development or once DEMO_SELF_VERIFY=false.
   */
  async function handleDemoVerify() {
    setVerifying(true);
    setError(null);
    try {
      await request('/api/profile/demo-verify', { method: 'POST' });
      // The route guard reads verification from the loaded profile.
      await refreshProfile();
      navigate('/clinician', { replace: true });
    } catch (err) {
      setError(err.message || 'Could not verify your account.');
      setVerifying(false);
    }
  }

  async function handleLogout() {
    await logout();
    navigate('/login', { replace: true });
  }

  return (
    <div className="max-w-md w-full mx-auto p-8 bg-raised rounded-xl shadow-sm border border-line mt-12 text-center">
      <div className="w-16 h-16 bg-attention-light text-attention-dark rounded-full flex items-center justify-center mx-auto mb-6">
        <svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-shield-alert"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10"/><path d="M12 8v4"/><path d="M12 16h.01"/></svg>
      </div>
      <h2 className="text-2xl font-bold text-ink mb-2">Verification Pending</h2>
      <p className="text-ink-2 mb-8">
        Your medical credentials are currently being verified with the National Medical Commission.
        You will receive an email once your account has been approved to take patients.
      </p>

      <div className="space-y-3">
        {!loadingConfig && canSelfVerify && (
          <>
            <Button onClick={handleDemoVerify} isLoading={verifying} className="w-full">
              {verifying ? 'Verifying…' : 'Verify my account (demo)'}
            </Button>
            <p className="text-xs text-ink-3">
              Demo shortcut: skips the medical council check and verifies this account immediately.
            </p>
          </>
        )}
        {error && <p className="text-sm text-attention-dark">{error}</p>}

        <Button onClick={handleLogout} variant="secondary" className="w-full" disabled={verifying}>
          Sign Out
        </Button>
      </div>
    </div>
  );
}
