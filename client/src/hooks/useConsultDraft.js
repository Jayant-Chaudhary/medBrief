import { useCallback, useEffect, useRef, useState } from 'react';
import {
  getSessionByAppointment,
  getConsultationDraft,
  reviewConsultationDraft,
  generateConsultationDraft,
} from '../services/consultAudio/consultClient.service.js';

const DRAFT_POLL_MS = 5000;
const DRAFT_POLL_MAX_ATTEMPTS = 60;
// Checks (at DRAFT_POLL_MS apart) before a finished visit with no draft is treated as stalled.
const DRAFT_STALL_AFTER_ATTEMPTS = 12;
const FINISHED_STATES = ['processing', 'draft_ready'];

/**
 * Finds the AI notes draft for an appointment's consult session and keeps
 * checking until it exists (the server drafts after the visit ends). Polls
 * over HTTP on purpose: the socket is only a push hint, never a dependency.
 */
export function useConsultDraft(appointmentId, enabled = true) {
  const [draft, setDraft] = useState(null);
  const [sessionId, setSessionId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [stalled, setStalled] = useState(false);
  const [finished, setFinished] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const attempts = useRef(0);

  const refresh = useCallback(() => {
    setDraft(null);
    setStalled(false);
    setError(null);
    attempts.current = 0;
    setReloadKey((k) => k + 1);
  }, []);

  useEffect(() => {
    setDraft(null);
    setSessionId(null);
    setError(null);
    setStalled(false);
    setFinished(false);
    attempts.current = 0;
  }, [appointmentId]);

  useEffect(() => {
    if (!enabled || !appointmentId || draft) return undefined;
    let cancelled = false;
    let timer;

    const check = async () => {
      attempts.current += 1;
      try {
        const session = await getSessionByAppointment(appointmentId);
        const id = session?.id || session?.sessionId;
        if (cancelled) return;
        if (id) {
          setSessionId(id);
          const isFinished = FINISHED_STATES.includes(session.status);
          setFinished(isFinished);
          setStalled(isFinished && attempts.current >= DRAFT_STALL_AFTER_ATTEMPTS);
          const found = await getConsultationDraft({ sessionId: id }).catch((err) => {
            if (err?.status === 404) return null;
            throw err;
          });
          if (cancelled) return;
          if (found) {
            setStalled(false);
            setDraft(found);
            return;
          }
        }
      } catch {
        // Transient failure: keep polling until the attempt cap.
      }
      if (!cancelled && attempts.current < DRAFT_POLL_MAX_ATTEMPTS) {
        timer = setTimeout(check, DRAFT_POLL_MS);
      }
    };

    check();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [appointmentId, enabled, draft, reloadKey]);

  // If a draft is already present, detect if a newer session was started for this visit (e.g. Record Again)
  useEffect(() => {
    if (!enabled || !appointmentId || !draft) return undefined;
    let timer;
    const pollForNewerSession = async () => {
      try {
        const session = await getSessionByAppointment(appointmentId);
        const id = session?.id || session?.sessionId;
        if (id && draft?.session_id && id !== draft.session_id) {
          refresh();
          return;
        }
      } catch {}
      timer = setTimeout(pollForNewerSession, 15000);
    };
    timer = setTimeout(pollForNewerSession, 15000);
    return () => clearTimeout(timer);
  }, [appointmentId, enabled, draft, refresh]);

  const review = useCallback(
    async (action, options = {}) => {
      if (!sessionId) return;
      setBusy(true);
      setError(null);
      try {
        const updated = await reviewConsultationDraft({
          sessionId,
          draftId: options.draftId || draft?.id || null,
          action,
          editedDoctorNotes: options.editedDoctorNotes || null,
          rejectionReason: options.rejectionReason || null,
        });
        setDraft(updated);
        return updated;
      } catch (err) {
        setError(err.message || 'Could not update the draft');
        throw err;
      } finally {
        setBusy(false);
      }
    },
    [sessionId, draft]
  );

  // Drafting runs on the server after the visit ends; if it failed, ask for it again.
  const generate = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    setError(null);
    try {
      const created = await generateConsultationDraft({ sessionId });
      setDraft(created);
      setStalled(false);
    } catch (err) {
      // The server's detail can be raw validation output; show a plain message instead.
      setError('The summary could not be created this time. Please try again.');
    } finally {
      setBusy(false);
    }
  }, [sessionId]);

  const waiting = finished && !draft && !stalled;

  return {
    draft,
    sessionId,
    busy,
    error,
    stalled,
    waiting,
    refresh,
    generate,
    approve: (opts) => review('approve', opts),
    reject: (opts) => review('reject', opts),
  };
}
