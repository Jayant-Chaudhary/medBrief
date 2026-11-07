import { useState, useEffect, useRef, useCallback } from 'react';
import {
  Mic,
  MicOff,
  Radio,
  Users,
  CheckCircle2,
  AlertCircle,
  Square,
  Copy,
  Check,
  Loader2,
  Sparkles,
  ShieldCheck,
  FileText,
  Download,
  RefreshCw,
  Clock,
  Activity,
  Layers,
  Volume2,
  Zap,
} from 'lucide-react';
import { Modal } from '../ui/Modal.jsx';
import {
  createConsultSession,
  recordDoctorConsent,
  performClockHandshake,
  setDoctorReady,
  startConsultation,
  endConsultation,
  connectConsultationSocket,
  getConsultationTranscript,
  getConsultationState,
  getSessionByAppointment,
  testSpeechToText,
  refreshConsultRoomCode,

} from '../../services/consultAudio/consultClient.service.js';


// States after recording has started: reopening shows that visit's transcript
// rather than creating a new session that would hide it.
const STARTED_SESSION_STATES = ['recording', 'ending', 'processing', 'draft_ready'];
// How often the lobby re-reads patient presence over HTTP (socket events are only hints).
const LOBBY_POLL_MS = 3000;
import { getApiBaseUrl } from '../../services/apiClient.js';
import { WebRecorder } from '../../services/consultAudio/webRecorder.js';

export function DoctorConsultationModal({
  isOpen,
  onClose,
  appointment,
  initialTab = 'RECORD', // 'RECORD' | 'TRANSCRIPT' | 'NOTES'
  onConsultationFinished,
  onInsertNotes,
}) {
  const [activeTab, setActiveTab] = useState(initialTab); // 'RECORD' | 'TRANSCRIPT' | 'NOTES'
  const [step, setStep] = useState('LOBBY'); // LOBBY | CHECK | RECORDING | ENDING | DONE
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [session, setSession] = useState(null);
  const [patientJoined, setPatientJoined] = useState(false);
  const [patientReady, setPatientReady] = useState(false);
  const [doctorReady, setDoctorReadyState] = useState(false);
  const [consentAccepted, setConsentAccepted] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);

  // Transcript state
  const [transcriptData, setTranscriptData] = useState(null);
  const [loadingTranscript, setLoadingTranscript] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);

  // Draft notes state
  const [draftData, setDraftData] = useState(null);
  const [loadingDraft, setLoadingDraft] = useState(false);
  const [draftError, setDraftError] = useState(null);
  const [approvingDraft, setApprovingDraft] = useState(false);
  const [copiedDraftText, setCopiedDraftText] = useState(false);

  const [micLevelDbfs, setMicLevelDbfs] = useState(-100);
  const [offsetInfo, setOffsetInfo] = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [chunksUploaded, setChunksUploaded] = useState(0);
  const [remainingQueue, setRemainingQueue] = useState(0);

  // STT Pipeline Pre-Flight Verification State
  const [sttTesting, setSttTesting] = useState(false);
  const [sttCountdown, setSttCountdown] = useState(0);
  const [sttTestResult, setSttTestResult] = useState(null);
  const [sttTestError, setSttTestError] = useState(null);
  const [hasCompletedSttTest, setHasCompletedSttTest] = useState(() => {
    try {
      return localStorage.getItem('medbrief_stt_verified') === 'true';
    } catch {
      return false;
    }
  });

  const recorderRef = useRef(null);
  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const pollingRef = useRef(null);
  const originalTitleRef = useRef(document.title);

  // Resilient accessors for session attributes
  const getSessionId = () => session?.sessionId || session?.session_id || session?.id;
  const getDoctorToken = () => session?.doctorToken || session?.doctor_token || session?.token;
  const getRoomCode = () => session?.roomCode || session?.room_code || '------';

  // Run a short 3-second speech recognition test to verify STT pipeline before consultation
  const handleRunSttTest = async () => {
    if (!recorderRef.current) {
      setError('Recorder is not initialized. Please click "Proceed to Mic Check" again.');
      return;
    }

    setSttTesting(true);
    setSttTestError(null);
    setSttTestResult(null);
    setSttCountdown(3);

    try {
      const sampleBlob = await recorderRef.current.recordTestSample(3000, (remaining) => {
        setSttCountdown(remaining);
      });

      const result = await testSpeechToText({
        audioBlob: sampleBlob,
        sessionId: getSessionId(),
        token: getDoctorToken(),
      });

      setSttTestResult(result);
      setHasCompletedSttTest(true);
      try {
        localStorage.setItem('medbrief_stt_verified', 'true');
      } catch {}
    } catch (err) {
      setSttTestError(err.message || 'Speech-to-text test failed');
    } finally {
      setSttTesting(false);
      setSttCountdown(0);
    }
  };

  // Load transcript data
  const loadTranscript = useCallback(async (sessId, token) => {
    const idToUse = sessId || getSessionId();
    if (!idToUse) return;

    setLoadingTranscript(true);
    try {
      const data = await getConsultationTranscript({
        sessionId: idToUse,
        token: token || getDoctorToken(),
      });
      setTranscriptData(data);
      return data;
    } catch (err) {
      console.error('[DoctorConsultationModal] Failed to fetch transcript:', err.message);
    } finally {
      setLoadingTranscript(false);
    }
  }, [session]);

  // Load AI notes draft data
  const loadDraft = useCallback(async (sessId, pollAttempts = 15) => {
    const idToUse = sessId || getSessionId();
    if (!idToUse) return;

    setLoadingDraft(true);
    setDraftError(null);

    let attempts = 0;
    const fetchLoop = async () => {
      attempts += 1;
      try {
        const found = await getConsultationDraft({ sessionId: idToUse });
        if (found) {
          setDraftData(found);
          setLoadingDraft(false);
          return found;
        }
      } catch (err) {
        if (err?.status !== 404) {
          console.warn('[DoctorConsultationModal] Draft fetch attempt error:', err.message);
        }
      }

      if (attempts < pollAttempts) {
        setTimeout(fetchLoop, 3000);
      } else {
        setLoadingDraft(false);
      }
    };

    fetchLoop();
  }, [session]);

  // Approve draft and insert into clinical notes
  const handleApproveDraft = async () => {
    const idToUse = getSessionId();
    if (!idToUse || !draftData) return;
    setApprovingDraft(true);
    setDraftError(null);
    try {
      await reviewConsultationDraft({
        sessionId: idToUse,
        draftId: draftData.id,
        action: 'approve',
      });
      const notesText = draftToNotesText(draftData.doctor_notes);
      if (onInsertNotes) {
        await onInsertNotes(notesText);
      }
      onClose();
    } catch (err) {
      setDraftError(err.message || 'Could not approve and insert draft');
    } finally {
      setApprovingDraft(false);
    }
  };

  // Trigger manual generation of draft
  const handleGenerateDraft = async () => {
    const idToUse = getSessionId();
    if (!idToUse) return;
    setLoadingDraft(true);
    setDraftError(null);
    try {
      const created = await generateConsultationDraft({ sessionId: idToUse });
      setDraftData(created);
    } catch (err) {
      setDraftError('Could not generate notes draft. Please try again.');
    } finally {
      setLoadingDraft(false);
    }
  };

  // Initialize or fetch session when modal opens
  useEffect(() => {
    const targetAppointmentId = appointment?.appointmentId || appointment?.id || appointment?.appointment_id;
    if (!isOpen) return;

    if (!targetAppointmentId) {
      setError('No appointment specified for consultation session.');
      return;
    }

    let mounted = true;
    setLoading(true);
    setError(null);
    setStep('LOBBY');
    setElapsedSec(0);
    setChunksUploaded(0);
    setRemainingQueue(0);
    setActiveTab(initialTab || 'RECORD');

    // Check if an existing session already exists for this appointment
    getSessionByAppointment(targetAppointmentId)
      .then((existingSession) => {
        if (!mounted) return;
        const alreadyStarted = existingSession && STARTED_SESSION_STATES.includes(existingSession.status);
        if (existingSession && (initialTab === 'TRANSCRIPT' || alreadyStarted)) {
          setSession(existingSession);
          loadTranscript(existingSession.id || existingSession.sessionId);
          setActiveTab('TRANSCRIPT');
          if (alreadyStarted) setStep('DONE');
          return;
        }

        // Otherwise create / fetch current active consultation session
        return createConsultSession(targetAppointmentId, { patientRequired: false }).then((data) => {
          if (!mounted) return;
          setSession(data);
          // A reopened session keeps the patient who already joined.
          setPatientJoined(Boolean(data?.patientJoined));
          setPatientReady(Boolean(data?.patientReady));
          const token = data?.doctorToken || data?.doctor_token || data?.token;
          const sessId = data?.sessionId || data?.session_id || data?.id;

          // Connect real-time push socket
          const socket = connectConsultationSocket({
            sessionId: sessId,
            token,
            onEvent: (eventName, payload) => {
              if (eventName === 'device_joined' && payload.device === 'patient') {
                setPatientJoined(true);
              }
              if (eventName === 'device_ready' && payload.device === 'patient') {
                setPatientJoined(true);
                setPatientReady(true);
              }
              if (eventName === 'device_left' && payload.device === 'patient') {
                setPatientJoined(false);
                setPatientReady(false);
              }
              if (eventName === 'end_requested') {
                handleStopConsultation();
              }
            },
          });
          socketRef.current = socket;
        });
      })
      .catch((err) => {
        if (!mounted) return;
        setError(err.message || 'Failed to initialize consultation session');
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });

    return () => {
      mounted = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
        socketRef.current = null;
      }
      if (recorderRef.current) {
        recorderRef.current.cleanup();
      }
      if (timerRef.current) {
        clearInterval(timerRef.current);
      }
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
      document.title = originalTitleRef.current;
    };
  }, [isOpen, appointment?.appointmentId, appointment?.id, appointment?.appointment_id, initialTab]);

  // Lobby: re-read patient presence and the current room code over HTTP, so a
  // patient joining, finishing setup or leaving shows even without the socket.
  useEffect(() => {
    const sessId = getSessionId();
    const token = getDoctorToken();
    if (!isOpen || !sessId || !token || !['LOBBY', 'CHECK'].includes(step)) return undefined;

    let cancelled = false;
    const refresh = async () => {
      try {
        const state = await getConsultationState({ sessionId: sessId, token });
        if (cancelled || !state?.session) return;
        setPatientJoined(Boolean(state.session.patientJoined));
        setPatientReady(Boolean(state.session.patientReady));
        const code = state.session.roomCode;
        if (code !== undefined) {
          setSession((prev) => (prev && (prev.roomCode !== code)
            ? { ...prev, roomCode: code, room_code: code }
            : prev));
        }
      } catch {
        // Transient: the next poll retries.
      }
    };
    refresh();
    const timer = setInterval(refresh, LOBBY_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isOpen, step, session?.sessionId, session?.session_id, session?.id]);

  // Polling hook for transcript processing progress
  useEffect(() => {
    const isTranscribing = transcriptData ? transcriptData.isProcessing : true;
    const sessId = getSessionId();

    if ((activeTab === 'TRANSCRIPT' || step === 'DONE') && sessId && isTranscribing) {
      // Immediate fetch once upon entering tab
      loadTranscript(sessId, getDoctorToken());

      if (pollingRef.current) clearInterval(pollingRef.current);
      pollingRef.current = setInterval(() => {
        loadTranscript(sessId, getDoctorToken());
      }, 2500);
    } else {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
        pollingRef.current = null;
      }
    }

    return () => {
      if (pollingRef.current) {
        clearInterval(pollingRef.current);
      }
    };
  }, [activeTab, step, transcriptData?.isProcessing, session, loadTranscript]);

  // Tab Title Animation during active recording
  useEffect(() => {
    if (step === 'RECORDING') {
      const mins = Math.floor(elapsedSec / 60).toString().padStart(2, '0');
      const secs = (elapsedSec % 60).toString().padStart(2, '0');
      document.title = `🔴 Recording [${mins}:${secs}] - MedBrief`;
    } else {
      document.title = originalTitleRef.current;
    }
  }, [step, elapsedSec]);

  // Copy Room Code Helper
  const copyRoomCode = () => {
    const code = getRoomCode();
    if (!code || code === '------') return;
    navigator.clipboard.writeText(code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  // Refresh Room Code Helper
  const handleRefreshRoomCode = async () => {
    const sessionId = getSessionId();
    const token = getDoctorToken();
    if (!sessionId) return;

    setLoading(true);
    setError(null);
    try {
      const res = await refreshConsultRoomCode({ sessionId, token });
      const newCode = res?.roomCode || res?.room_code;
      if (newCode) {
        setSession((prev) => (prev ? { ...prev, roomCode: newCode, room_code: newCode } : prev));
      }
    } catch (err) {
      setError(err.message || 'Failed to refresh room code');
    } finally {
      setLoading(false);
    }
  };

  // Start a fresh new consultation session for this appointment (Record Again)
  const handleRecordAgain = async () => {
    const targetAppointmentId = appointment?.appointmentId || appointment?.id || appointment?.appointment_id;
    if (!targetAppointmentId) {
      setError('No appointment specified for consultation session.');
      return;
    }

    setLoading(true);
    setError(null);

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    if (recorderRef.current) {
      try {
        await recorderRef.current.cleanup();
      } catch {}
      recorderRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }
    if (pollingRef.current) {
      clearInterval(pollingRef.current);
      pollingRef.current = null;
    }

    try {
      const data = await createConsultSession(targetAppointmentId, { forceNew: true, patientRequired: false });
      setSession(data);
      setPatientJoined(Boolean(data?.patientJoined));
      setPatientReady(Boolean(data?.patientReady));
      setDoctorReadyState(false);
      setConsentAccepted(false);
      setTranscriptData(null);
      setElapsedSec(0);
      setChunksUploaded(0);
      setRemainingQueue(0);
      setMicLevelDbfs(-100);
      setOffsetInfo(null);
      setStep('LOBBY');
      setActiveTab('RECORD');

      const token = data?.doctorToken || data?.doctor_token || data?.token;
      const sessId = data?.sessionId || data?.session_id || data?.id;

      const socket = connectConsultationSocket({
        sessionId: sessId,
        token,
        onEvent: (eventName, payload) => {
          if (eventName === 'device_joined' && payload.device === 'patient') {
            setPatientJoined(true);
          }
          if (eventName === 'device_ready' && payload.device === 'patient') {
            setPatientJoined(true);
            setPatientReady(true);
          }
          if (eventName === 'device_left' && payload.device === 'patient') {
            setPatientJoined(false);
            setPatientReady(false);
          }
          if (eventName === 'end_requested') {
            handleStopConsultation();
          }
        },
      });
      socketRef.current = socket;
    } catch (err) {
      setError(err.message || 'Failed to start a new consultation session');
    } finally {
      setLoading(false);
    }
  };

  // Start Mic Level Check & Clock Handshake
  const handleProceedToMicCheck = async () => {
    const sessionId = getSessionId();
    const token = getDoctorToken();
    const roomCode = getRoomCode();

    if (!sessionId || !token) {
      setError('Consultation session is still initializing. Please wait a moment or reopen the dialog.');
      return;
    }

    if (!roomCode || roomCode === '------') {
      setError('A valid patient room code is required before proceeding. Please generate or refresh the room code.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Initialize WebRecorder for level check
      const recorder = new WebRecorder({
        sessionId,
        sessionToken: token,
        device: 'doctor',
        apiBaseUrl: getApiBaseUrl(),
        onLoudness: (dbfs) => {
          setMicLevelDbfs(dbfs);
        },
        onChunkUploaded: ({ seq, remainingQueue: rem }) => {
          setChunksUploaded((prev) => prev + 1);
          setRemainingQueue(rem);
        },
        onError: (recErr) => {
          setError(recErr.message);
        },
      });

      const micOk = await recorder.initMicrophone();
      if (!micOk) {
        throw new Error('Microphone permission is required to conduct audio consultation.');
      }

      recorder.startLevelMeter();
      recorderRef.current = recorder;

      // 2. Perform clock sync handshake
      const syncResult = await performClockHandshake();
      setOffsetInfo(syncResult);

      setStep('CHECK');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Mark Doctor Ready
  const handleConfirmReady = async () => {
    if (!consentAccepted) {
      setError('Doctor and patient consent is required before recording.');
      return;
    }

    if (!hasCompletedSttTest && !sttTestResult) {
      setError('Please run the speech recognition pre-flight test above to verify the pipeline.');
      return;
    }

    const sessionId = getSessionId();
    const token = getDoctorToken();

    if (!sessionId || !token) {
      setError('Consultation session is not ready. Please wait a moment or reopen the dialog.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      await recordDoctorConsent({ sessionId, token });
      await setDoctorReady({
        sessionId,
        token,
        offsetMs: offsetInfo?.offset_ms || 0,
        rttMs: offsetInfo?.rtt_ms || 0,
        captureZeroDeviceMs: Date.now(),
      });
      setDoctorReadyState(true);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Start Active Consultation Recording
  const handleStartRecording = async () => {
    if (!consentAccepted) {
      setError('Doctor and patient consent is required before recording.');
      return;
    }

    if (!hasCompletedSttTest && !sttTestResult) {
      setError('Please run the speech recognition pre-flight test above to verify the pipeline.');
      return;
    }

    const sessionId = getSessionId();
    const token = getDoctorToken();

    if (!sessionId || !token) {
      setError('Consultation session is not ready. Please wait a moment or reopen the dialog.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // 1. Ensure doctor consent and ready state are committed first
      await recordDoctorConsent({ sessionId, token });
      await setDoctorReady({
        sessionId,
        token,
        offsetMs: offsetInfo?.offset_ms || 0,
        rttMs: offsetInfo?.rtt_ms || 0,
        captureZeroDeviceMs: Date.now(),
      });
      setDoctorReadyState(true);

      // 2. Start consultation on server
      await startConsultation({ sessionId, token });

      if (recorderRef.current) {
        await recorderRef.current.startRecording();
      }

      setStep('RECORDING');
      setElapsedSec(0);

      timerRef.current = setInterval(() => {
        setElapsedSec((s) => s + 1);
      }, 1000);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Stop Consultation & Flush Final Audio Chunks
  const handleStopConsultation = async () => {
    if (step !== 'RECORDING') return;

    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }

    setStep('ENDING');

    try {
      const sessionId = getSessionId();
      const token = getDoctorToken();

      if (recorderRef.current) {
        await recorderRef.current.stopRecording();
      }

      if (sessionId && token) {
        await endConsultation({ sessionId, token });
      }

      setStep('DONE');
      setActiveTab('NOTES');
      loadDraft(sessionId);
      loadTranscript(sessionId, token);

      if (onConsultationFinished) {
        onConsultationFinished({
          sessionId,
          chunksTotal: chunksUploaded,
        });
      }
    } catch (err) {
      setError(err.message);
    }
  };

  // Format Milliseconds to [mm:ss]
  const formatTimestampRange = (startMs, endMs) => {
    const formatTime = (ms) => {
      if (ms == null || isNaN(ms)) return '00:00';
      const totalSeconds = Math.max(0, Math.floor(ms / 1000));
      const mins = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
      const secs = (totalSeconds % 60).toString().padStart(2, '0');
      return `${mins}:${secs}`;
    };
    return `[${formatTime(startMs)} - ${formatTime(endMs)}]`;
  };

  // Copy Full Formatted Transcript
  const handleCopyTranscript = () => {
    if (!transcriptData?.segments?.length) return;
    const lines = transcriptData.segments.map((seg) => {
      const range = formatTimestampRange(seg.startMs, seg.endMs);
      const speakerLabel = seg.speaker === 'doctor' ? 'Doctor' : seg.speaker === 'patient' ? 'Patient' : 'Speaker';
      return `${range} ${speakerLabel}: ${seg.text}`;
    });
    navigator.clipboard.writeText(lines.join('\n'));
    setCopiedTranscript(true);
    setTimeout(() => setCopiedTranscript(false), 2000);
  };

  // Download Transcript as .txt
  const handleDownloadTranscript = () => {
    if (!transcriptData?.segments?.length) return;
    const lines = [
      `MedBrief Consultation Transcript`,
      `Appointment: ${appointment?.appointmentId || appointment?.id || 'N/A'}`,
      `Patient: ${appointment?.patientFullName || 'Patient'}`,
      `Session ID: ${getSessionId() || 'N/A'}`,
      `Exported: ${new Date().toLocaleString()}`,
      `==================================================`,
      '',
      ...transcriptData.segments.map((seg) => {
        const range = formatTimestampRange(seg.startMs, seg.endMs);
        const speakerLabel = seg.speaker === 'doctor' ? 'Doctor' : seg.speaker === 'patient' ? 'Patient' : 'Speaker';
        return `${range} ${speakerLabel}: ${seg.text}`;
      }),
    ];

    const blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `consultation-transcript-${getSessionId() || 'session'}.txt`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  // Meter percentage (from -60 dBFS to 0 dBFS)
  const meterPercent = Math.min(100, Math.max(0, ((micLevelDbfs + 60) / 60) * 100));

  const formatTimer = (totalSeconds) => {
    const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
    const s = (totalSeconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={step === 'RECORDING' ? () => {} : onClose}
      title={step === 'RECORDING' ? 'Consultation In Progress' : 'Consultation Audio & Transcript'}
      className={activeTab === 'TRANSCRIPT' || activeTab === 'NOTES' ? 'max-w-2xl' : 'max-w-xl'}
    >
      <div className="space-y-4">
        {/* Navigation Tabs (Available when not actively recording) */}
        {step !== 'RECORDING' && step !== 'ENDING' && (
          <div className="flex border-b border-line pb-1 gap-2">
            <button
              type="button"
              data-assistant-effect="free"
              onClick={() => setActiveTab('RECORD')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeTab === 'RECORD'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-ink-2 hover:bg-subcanvas'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              {step === 'DONE' ? 'Record New Audio' : 'Record Audio'}
            </button>
            <button
              type="button"
              data-assistant-effect="free"
              onClick={() => {
                setActiveTab('TRANSCRIPT');
                loadTranscript();
              }}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeTab === 'TRANSCRIPT'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-ink-2 hover:bg-subcanvas'
              }`}
            >
              <FileText className="w-3.5 h-3.5" />
              Transcript & Processing Logs
              {transcriptData?.segments?.length > 0 && (
                <span className="px-1.5 py-0.2 bg-white/20 text-white rounded-full text-[10px]">
                  {transcriptData.segments.length}
                </span>
              )}
            </button>
            <button
              type="button"
              data-assistant-effect="free"
              onClick={() => {
                setActiveTab('NOTES');
                loadDraft();
              }}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeTab === 'NOTES'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-ink-2 hover:bg-subcanvas'
              }`}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Clinical Notes Draft
              {draftData && (
                <span className={`px-1.5 py-0.2 rounded-full text-[10px] ${
                  draftData.status === 'approved' ? 'bg-emerald-500/30 text-emerald-100' : 'bg-indigo-500/30 text-indigo-100'
                }`}>
                  {draftData.status === 'approved' ? 'Approved' : 'Ready'}
                </span>
              )}
            </button>
          </div>
        )}

        {/* Error Alert */}
        {error && (
          <div className="flex items-start gap-3 p-3.5 bg-red-50 text-red-700 border border-red-200 rounded-lg text-sm">
            <AlertCircle className="w-5 h-5 flex-shrink-0 mt-0.5" />
            <div className="flex-1">
              <p className="font-medium">Notice</p>
              <p className="text-xs mt-0.5">{error}</p>
            </div>
          </div>
        )}

        {/* TAB 1: RECORD AUDIO TAB */}
        {activeTab === 'RECORD' && (
          <div className="space-y-4">
            {/* STEP 1: LOBBY & ROOM CODE */}
            {step === 'LOBBY' && (
              <div className="space-y-4">
                <div className="bg-sage-surface/40 p-4 rounded-xl border border-sage-border/60">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-ink text-base">
                        {appointment?.patientFullName || 'Patient Consultation'}
                      </h3>
                      <p className="text-xs text-ink-3 mt-0.5">
                        {appointment?.scheduledAt ? new Date(appointment.scheduledAt).toLocaleString() : 'Scheduled Visit'}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-subcanvas rounded-full shadow-sm border border-line text-xs font-medium text-ink-2">
                      <Users className="w-3.5 h-3.5 text-primary" />
                      Dual Device Sync
                    </div>
                  </div>
                </div>

                {/* Room Code Display */}
                <div className="text-center py-4 bg-primary-light/40 border border-primary/20 rounded-2xl">
                  <p className="text-xs font-semibold text-primary-dark uppercase tracking-wider">
                    Patient Room Code
                  </p>
                  <div className="flex items-center justify-center gap-3 mt-2">
                    <span className="font-mono text-3xl font-extrabold tracking-widest text-ink">
                      {getRoomCode()}
                    </span>
                    {getRoomCode() !== '------' ? (
                      <button
                        type="button"
                        onClick={copyRoomCode}
                        className="p-2 bg-surface hover:bg-subcanvas border border-line rounded-lg shadow-sm text-ink-2 transition"
                        data-assistant-effect="free"
                        title="Copy room code"
                      >
                        {copiedCode ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleRefreshRoomCode}
                        disabled={loading}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white text-xs font-semibold rounded-lg shadow-sm hover:bg-primary-dark transition disabled:opacity-50"
                        data-assistant-effect="free"
                        title="Generate a new room code"
                      >
                        <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
                        Generate Code
                      </button>
                    )}
                  </div>
                  <p className="text-xs text-ink-3 mt-2 px-6">
                    {getRoomCode() !== '------'
                      ? 'Ask the patient to enter this 6-character code on their phone to connect their microphone.'
                      : 'No active room code. Click "Generate Code" above to create a patient connection code.'}
                  </p>
                </div>

                {/* Connection Status Box */}
                <div className="p-3.5 bg-subcanvas border border-line rounded-xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Radio className={`w-4 h-4 ${patientJoined ? 'text-emerald-500 animate-pulse' : 'text-slate-400'}`} />
                    <span className="font-medium text-ink">
                      {patientJoined ? 'Patient Connected on Mobile' : 'Waiting for patient device...'}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full font-semibold border ${patientJoined ? 'bg-emerald-100 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:border-emerald-800/40 dark:text-emerald-300' : 'bg-subcanvas text-ink-3 border-line'}`}>
                    {patientJoined ? 'Connected' : 'Waiting'}
                  </span>
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    data-assistant-effect="free"
                    onClick={onClose}
                    className="px-4 py-2 border border-line rounded-lg text-sm text-ink-2 hover:bg-subcanvas"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    data-assistant-effect="never"
                    onClick={handleProceedToMicCheck}
                    disabled={loading || !session || !getRoomCode() || getRoomCode() === '------'}
                    className="px-5 py-2 bg-primary text-white font-medium rounded-lg text-sm hover:bg-primary-dark transition flex items-center gap-2 shadow-sm disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mic className="w-4 h-4" />}
                    Proceed to Mic Check
                  </button>
                </div>
              </div>
            )}

            {/* STEP 2: MIC CHECK & CONSENT */}
            {step === 'CHECK' && (
              <div className="space-y-4">
                <div className="p-3.5 bg-amber-50/70 border border-amber-200/60 rounded-xl flex items-start gap-3">
                  <Sparkles className="w-5 h-5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <div className="text-xs text-amber-900 leading-relaxed">
                    <p className="font-semibold">Microphone Placement Recommendation:</p>
                    <p className="mt-0.5">
                      Place this device flat on the consultation table between you and the patient for balanced voice capture.
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-slate-900 text-white rounded-xl shadow-inner space-y-2">
                  <div className="flex justify-between items-center text-xs">
                    <span className="flex items-center gap-1.5 font-medium text-slate-300">
                      <Mic className="w-4 h-4 text-emerald-400" />
                      Live Microphone Level
                    </span>
                    <span className="font-mono text-slate-400">
                      {micLevelDbfs > -99 ? `${micLevelDbfs.toFixed(1)} dBFS` : 'Silence'}
                    </span>
                  </div>
                  <div className="h-3 w-full bg-slate-800 rounded-full overflow-hidden p-0.5 border border-slate-700">
                    <div
                      className="h-full rounded-full transition-all duration-75 bg-gradient-to-r from-emerald-500 via-yellow-400 to-rose-500"
                      style={{ width: `${meterPercent}%` }}
                    />
                  </div>
                  <p className="text-[11px] text-slate-400">Speak normally to verify that voice activity registers in the green bar.</p>
                </div>

                {/* PRE-FLIGHT SPEECH-TO-TEXT PIPELINE VERIFICATION */}
                <div className="p-4 bg-subcanvas border border-line rounded-xl space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Volume2 className="w-4 h-4 text-primary" />
                      <span className="font-semibold text-xs text-ink">
                        Speech Recognition Pre-Flight Check
                      </span>
                    </div>
                    {hasCompletedSttTest || sttTestResult ? (
                      <span className="px-2 py-0.5 bg-emerald-100 text-emerald-800 text-[11px] font-semibold rounded-full flex items-center gap-1 shadow-xs">
                        <Check className="w-3 h-3 text-emerald-600" /> STT Verified
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 bg-amber-100 text-amber-900 text-[11px] font-semibold rounded-full flex items-center gap-1">
                        <AlertCircle className="w-3 h-3 text-amber-600" /> Mandatory Initial Check
                      </span>
                    )}
                  </div>

                  <p className="text-[11px] text-ink-3 leading-relaxed">
                    {!hasCompletedSttTest && !sttTestResult
                      ? 'Say a test phrase (e.g. "Testing consultation audio pipeline") to verify that speech recognition and GPU transcription are operating before starting.'
                      : 'Speech recognition has been verified for your device. You may re-test anytime or proceed directly.'}
                  </p>

                  {/* ACTIVE RECORDING BANNER */}
                  {sttTesting && (
                    <div className="p-3 bg-rose-50 border border-rose-200 rounded-xl text-center space-y-1.5 animate-pulse">
                      <div className="inline-flex items-center gap-2 text-rose-700 font-bold text-xs uppercase tracking-wide">
                        <span className="w-2.5 h-2.5 rounded-full bg-rose-600"></span>
                        Listening... Speak into microphone!
                      </div>
                      <div className="text-2xl font-black text-rose-900 font-mono">
                        00:0{sttCountdown}s
                      </div>
                      <p className="text-[11px] text-rose-600">Say anything to test speech transcription...</p>
                    </div>
                  )}

                  {/* TRANSCRIPTION RESULT DISPLAY */}
                  {sttTestResult && !sttTesting && (
                    <div className="p-3 bg-emerald-50/80 border border-emerald-200/80 rounded-xl space-y-2">
                      <div className="flex items-center justify-between text-[11px]">
                        <span className="font-semibold text-emerald-900 flex items-center gap-1.5">
                          <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                          Recognized Transcript:
                        </span>
                        <span className="font-mono text-emerald-800 dark:text-emerald-300 bg-surface px-2 py-0.5 rounded border border-line text-[10px] flex items-center gap-1">
                          <Zap className="w-3 h-3 text-amber-500 fill-amber-400" />
                          {sttTestResult.latencyMs}ms • {sttTestResult.provider || 'Whisper'}
                        </span>
                      </div>
                      <p className="text-xs text-ink font-medium bg-surface p-2.5 rounded-lg border border-line italic shadow-xs">
                        "{sttTestResult.text}"
                      </p>
                    </div>
                  )}

                  {/* ERROR DISPLAY */}
                  {sttTestError && !sttTesting && (
                    <div className="p-3 bg-red-50 border border-red-200 rounded-xl flex items-start gap-2 text-xs text-red-700">
                      <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
                      <div className="flex-1">
                        <p className="font-semibold">STT Test Failed</p>
                        <p className="text-[11px] mt-0.5">{sttTestError}</p>
                      </div>
                    </div>
                  )}

                  {/* TEST TRIGGER BUTTON */}
                  <div className="flex items-center justify-between pt-1">
                    <button
                      type="button"
                      data-assistant-effect="never"
                      onClick={handleRunSttTest}
                      disabled={sttTesting}
                      className={`px-4 py-2 rounded-lg text-xs font-semibold flex items-center gap-2 shadow-sm transition ${
                        sttTesting
                          ? 'bg-rose-500 text-white cursor-not-allowed opacity-80'
                          : hasCompletedSttTest || sttTestResult
                          ? 'bg-surface border border-line text-ink-2 hover:bg-subcanvas'
                          : 'bg-primary text-white hover:bg-primary-dark ring-2 ring-primary/20'
                      }`}
                    >
                      {sttTesting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Recording Sample ({sttCountdown}s)...
                        </>
                      ) : hasCompletedSttTest || sttTestResult ? (
                        <>
                          <RefreshCw className="w-3.5 h-3.5 text-ink-3" />
                          Re-test Microphone & STT
                        </>
                      ) : (
                        <>
                          <Mic className="w-3.5 h-3.5" />
                          Speak Test Phrase (3s)
                        </>
                      )}
                    </button>

                    {hasCompletedSttTest && !sttTesting && (
                      <span className="text-[11px] text-emerald-700 font-medium flex items-center gap-1">
                        <Check className="w-3.5 h-3.5 text-emerald-600" /> Ready to proceed (Skip available)
                      </span>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className={`p-3 border rounded-xl flex items-center justify-between text-xs ${doctorReady ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800/40 dark:text-emerald-300' : 'bg-subcanvas border-line text-ink-3'}`}>
                    <span className="font-medium">Doctor Device</span>
                    {doctorReady ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <span className="text-slate-400 font-medium">Pending</span>}
                  </div>
                  <div className={`p-3 border rounded-xl flex items-center justify-between text-xs ${patientReady ? 'bg-emerald-50 border-emerald-200 text-emerald-800 dark:bg-emerald-950/40 dark:border-emerald-800/40 dark:text-emerald-300' : 'bg-subcanvas border-line text-ink-3'}`}>
                    <span className="font-medium">Patient Device</span>
                    {patientReady
                      ? <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      : <span className="text-slate-400 font-medium">{patientJoined ? 'Joined, setting up' : 'Not joined (optional)'}</span>}
                  </div>
                </div>
                <p className="text-xs text-ink-3">
                  You can start without the patient&apos;s phone. A patient who has not finished setup on their phone is not recorded from their device.
                </p>

                <label className="flex items-start gap-3 p-3.5 bg-subcanvas border border-line rounded-xl cursor-pointer select-none">
                  <input
                    type="checkbox"
                    data-assistant-effect="never"
                    checked={consentAccepted}
                    onChange={(e) => setConsentAccepted(e.target.checked)}
                    className="mt-0.5 h-4 w-4 rounded text-primary focus:ring-primary border-slate-300"
                  />
                  <span className="text-xs text-ink-2 leading-relaxed">
                    <span className="font-semibold text-ink">Informed Consent Confirmation:</span> I confirm that both parties have agreed to consultation audio recording to facilitate clinical note generation.
                  </span>
                </label>

                <div className="pt-2 flex justify-between items-center">
                  <button
                    type="button"
                    onClick={() => setStep('LOBBY')}
                    className="text-xs text-ink-3 hover:text-ink font-medium"
                  >
                    Back to Room Code
                  </button>

                  <div className="flex flex-col items-end gap-1">
                    <div className="flex gap-2">
                      {!doctorReady ? (
                        <button
                          type="button"
                          data-assistant-effect="never"
                          onClick={handleConfirmReady}
                          disabled={!consentAccepted || loading || (!hasCompletedSttTest && !sttTestResult)}
                          className="px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg text-sm hover:bg-emerald-700 transition flex items-center gap-2 shadow-sm disabled:opacity-50"
                        >
                          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                          Confirm Readiness
                        </button>
                      ) : (
                        <button
                          type="button"
                          data-assistant-effect="never"
                          onClick={handleStartRecording}
                          disabled={loading || (!hasCompletedSttTest && !sttTestResult)}
                          className="px-5 py-2 bg-rose-600 text-white font-semibold rounded-lg text-sm hover:bg-rose-700 transition flex items-center gap-2 shadow-sm animate-pulse disabled:opacity-50"
                        >
                          <Radio className="w-4 h-4" />
                          Start Consultation
                        </button>
                      )}
                    </div>
                    {!hasCompletedSttTest && !sttTestResult && (
                      <span className="text-[10px] text-amber-700 font-medium">
                        * Pre-flight speech test required once
                      </span>
                    )}
                  </div>
                </div>
              </div>
            )}

            {/* STEP 3: ACTIVE RECORDING VIEW */}
            {step === 'RECORDING' && (
              <div className="space-y-6 py-4 text-center">
                <div className="inline-flex items-center gap-2 px-4 py-1.5 bg-rose-100 text-rose-800 rounded-full text-xs font-bold uppercase tracking-wider animate-pulse">
                  <span className="w-2.5 h-2.5 rounded-full bg-rose-600"></span>
                  Recording Active
                </div>

                <div className="font-mono text-5xl font-black text-ink tracking-tight">
                  {formatTimer(elapsedSec)}
                </div>

                <div className="max-w-xs mx-auto p-3 bg-subcanvas border border-line rounded-xl text-xs space-y-1.5">
                  <div className="flex justify-between font-medium text-ink-2">
                    <span>Audio Slices Transferred:</span>
                    <span className="font-bold text-ink">{chunksUploaded}</span>
                  </div>
                  <div className="flex justify-between text-ink-3 text-[11px]">
                    <span>Pipeline Status:</span>
                    <span className="text-emerald-600 font-semibold">Streaming 15s Chunks</span>
                  </div>
                </div>

                <p className="text-[11px] text-ink-3 max-w-sm mx-auto leading-relaxed">
                  🔒 Audio is encrypted and uploaded incrementally. In accordance with clinical privacy standards, live speech transcripts are hidden during the active consultation.
                </p>

                <div className="pt-2">
                  <button
                    type="button"
                    data-assistant-effect="never"
                    onClick={handleStopConsultation}
                    className="w-full py-3 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl shadow-lg transition flex items-center justify-center gap-2 text-base"
                  >
                    <Square className="w-5 h-5 fill-current" />
                    End Consultation & Generate Notes
                  </button>
                </div>
              </div>
            )}

            {/* STEP 4: FLUSHING / ENDING VIEW */}
            {step === 'ENDING' && (
              <div className="py-10 text-center space-y-4">
                <Loader2 className="w-12 h-12 text-primary animate-spin mx-auto" />
                <h3 className="text-base font-bold text-ink">Finalizing Consultation Audio</h3>
                <p className="text-xs text-ink-3 max-w-sm mx-auto">
                  Uploading the final audio chunk and submitting total chunk counts to the processing engine...
                </p>
              </div>
            )}

            {/* STEP 5: COMPLETED VIEW */}
            {step === 'DONE' && (
              <div className="py-6 text-center space-y-4">
                <div className="w-12 h-12 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                  <Check className="w-6 h-6 stroke-[3]" />
                </div>
                <h3 className="text-lg font-bold text-ink">Consultation Successfully Recorded</h3>
                <p className="text-xs text-ink-3 max-w-sm mx-auto">
                  All audio chunks have been captured and queued for background transcription.
                </p>
                <div className="pt-3 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    data-assistant-effect="never"
                    onClick={handleRecordAgain}
                    disabled={loading}
                    className="px-5 py-2 bg-rose-600 text-white font-medium rounded-lg text-sm hover:bg-rose-700 transition flex items-center gap-2 shadow-sm disabled:opacity-50"
                  >
                    {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                    Record Again (New Session)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('NOTES');
                      loadDraft();
                    }}
                    className="px-5 py-2 bg-indigo-600 text-white font-medium rounded-lg text-sm hover:bg-indigo-700 transition flex items-center gap-2 shadow-sm"
                  >
                    <Sparkles className="w-4 h-4" />
                    Review Clinical Notes
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('TRANSCRIPT');
                      loadTranscript();
                    }}
                    className="px-5 py-2 bg-primary text-white font-medium rounded-lg text-sm hover:bg-primary-dark transition flex items-center gap-2 shadow-sm"
                  >
                    <FileText className="w-4 h-4" />
                    View Live Transcript Logs
                  </button>
                  <button
                    type="button"
                    data-assistant-effect="free"
                    onClick={onClose}
                    className="px-5 py-2 border border-line rounded-lg text-sm text-ink-2 hover:bg-subcanvas transition"
                  >
                    Return to Patient Record
                  </button>
                </div>
              </div>
            )}
          </div>
        )}

        {/* TAB 2: TRANSCRIPT & PROCESSING LOGS VIEW */}
        {activeTab === 'TRANSCRIPT' && (
          <div className="space-y-4">
            {/* Status & Processing Progress Banner */}
            <div className="bg-subcanvas border border-line rounded-xl p-3.5 space-y-2.5">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs">
                  {transcriptData?.isProcessing ? (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 bg-amber-100 text-amber-800 rounded-full font-semibold animate-pulse">
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      Transcribing Audio (Whisper GPU)...
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 px-2.5 py-1 bg-emerald-100 text-emerald-800 rounded-full font-semibold">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Transcription Up-to-Date
                    </span>
                  )}

                  <span className="text-ink-3 text-[11px]">
                    Session: <span className="font-mono text-ink-2">{getSessionId()?.slice(0, 8) || 'N/A'}</span>
                  </span>
                </div>

                {/* Action buttons */}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => loadTranscript()}
                    disabled={loadingTranscript}
className="p-1.5 hover:bg-subcanvas border border-line rounded-lg text-ink-2 text-xs transition"
                    data-assistant-effect="free"
                    title="Refresh transcript"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingTranscript ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyTranscript}
                    disabled={!transcriptData?.segments?.length}
                    className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-subcanvas border border-line rounded-lg text-ink-2 text-xs transition disabled:opacity-40"
                    title="Copy transcript dialogue"
                  >
                    {copiedTranscript ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedTranscript ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    data-assistant-effect="never"
                    onClick={handleDownloadTranscript}
                    disabled={!transcriptData?.segments?.length}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-surface hover:bg-subcanvas border border-line rounded-lg text-ink-2 text-xs transition shadow-sm disabled:opacity-40"
                    title="Download .txt transcript"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
                  </button>
                  <button
                    type="button"
                    data-assistant-effect="never"
                    onClick={handleRecordAgain}
                    disabled={loading}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold transition shadow-xs disabled:opacity-50"
                    title="Start a new consultation recording for this visit"
                  >
                    {loading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Mic className="w-3.5 h-3.5" />}
                    <span>Record Again</span>
                  </button>
                </div>
              </div>

              {/* Progress Bar for Chunks */}
              <div className="space-y-1">
                <div className="flex justify-between text-[11px] text-ink-2 font-medium">
                  <span className="flex items-center gap-1">
                    <Layers className="w-3 h-3 text-primary" />
                    Audio Chunks Processed:
                  </span>
                  <span>
                    {transcriptData?.transcribedChunks || 0} / {transcriptData?.totalChunks || 0} chunks
                    {transcriptData?.totalChunks > 0 &&
                      ` (${Math.round(((transcriptData.transcribedChunks || 0) / transcriptData.totalChunks) * 100)}%)`}
                  </span>
                </div>
                <div className="h-1.5 w-full bg-line rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 rounded-full"
                    style={{
                      width: `${
                        transcriptData?.totalChunks > 0
                          ? Math.min(100, ((transcriptData.transcribedChunks || 0) / transcriptData.totalChunks) * 100)
                          : transcriptData?.segments?.length > 0 ? 100 : 0
                      }%`,
                    }}
                  />
                </div>
              </div>
            </div>

            {/* Segments Stream / Transcript Feed */}
            <div data-assistant-private className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
              {loadingTranscript && !transcriptData ? (
                <div className="py-12 text-center text-ink-3 text-xs space-y-2">
                  <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  <p>Loading consultation transcript logs...</p>
                </div>
              ) : transcriptData?.segments?.length > 0 ? (
                transcriptData.segments.map((seg, idx) => {
                  const isDoctor = seg.speaker === 'doctor' || seg.device === 'doctor';
                  return (
                    <div
                      key={seg.id || idx}
                      className={`p-3 rounded-xl border text-xs space-y-1.5 transition ${
                        isDoctor
                          ? 'bg-emerald-50/50 border-emerald-200/80'
                          : 'bg-purple-50/50 border-purple-200/80'
                      }`}
                    >
                      <div className="flex items-center justify-between text-[11px]">
                        <div className="flex items-center gap-2">
                          <span
                            className={`px-2 py-0.5 rounded-full font-bold uppercase tracking-wider text-[10px] ${
                              isDoctor
                                ? 'bg-emerald-100 text-emerald-800'
                                : 'bg-purple-100 text-purple-800'
                            }`}
                          >
                            {isDoctor ? 'Doctor' : 'Patient'}
                          </span>
                          <span className="font-mono text-ink-3 flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {formatTimestampRange(seg.startMs, seg.endMs)}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 text-ink-3 text-[10px]">
                          {seg.confidence != null && (
                            <span className="bg-surface px-1.5 py-0.5 rounded border border-line">
                              {Math.round(seg.confidence * 100)}% conf
                            </span>
                          )}
                          {seg.language && (
                            <span className="bg-surface px-1.5 py-0.5 rounded border border-line uppercase font-mono">
                              {seg.language}
                            </span>
                          )}
                        </div>
                      </div>

                      <p className="text-ink text-sm leading-relaxed font-sans font-normal pt-0.5">
                        {seg.text}
                      </p>
                    </div>
                  );
                })
              ) : (
                <div className="py-12 px-6 text-center border-2 border-dashed border-line rounded-xl space-y-2">
                  <FileText className="w-8 h-8 mx-auto text-ink-3 opacity-60" />
                  <p className="text-xs font-semibold text-ink">No Speech Segments Available Yet</p>
                  <p className="text-[11px] text-ink-3 max-w-sm mx-auto">
                    {transcriptData?.isProcessing
                      ? 'The speech-to-text worker is currently analyzing recorded audio chunks. Transcribed segments will appear automatically.'
                      : 'Record consultation audio from the "Record Audio" tab to generate dialogue segments.'}
                  </p>
                </div>
              )}
            </div>

            {/* Modal Bottom Actions */}
            <div className="pt-2 flex justify-end gap-3 border-t border-line">
              <button
                type="button"
                onClick={onClose}
                className="px-5 py-2 bg-primary text-white font-medium rounded-lg text-sm hover:bg-primary-dark transition shadow-sm"
              >
                Done
              </button>
            </div>
          </div>
        )}

        {/* TAB 3: CLINICAL NOTES DRAFT VIEW */}
        {activeTab === 'NOTES' && (
          <div className="space-y-4">
            {loadingDraft && !draftData ? (
              <div className="py-12 px-6 text-center border-2 border-dashed border-indigo-200 dark:border-indigo-900/50 rounded-xl space-y-3 bg-indigo-50/40 dark:bg-indigo-950/20">
                <Loader2 className="w-8 h-8 animate-spin mx-auto text-indigo-600 dark:text-indigo-400" />
                <p className="text-sm font-semibold text-ink">Synthesizing Clinical Notes with Gemini AI…</p>
                <p className="text-xs text-ink-3 max-w-sm mx-auto leading-relaxed">
                  Analyzing speech segments to generate structured chief complaint, vitals observed, clinical assessment, and follow-up plan.
                </p>
              </div>
            ) : draftData ? (
              <div className="space-y-3">
                {/* Status banner */}
                <div className="flex items-center justify-between p-3 rounded-xl bg-indigo-50/70 border border-indigo-200 dark:bg-indigo-950/40 dark:border-indigo-900/60">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
                    <span className="text-xs font-semibold text-indigo-900 dark:text-indigo-200">
                      AI Consultation Draft
                    </span>
                    {draftData.model_version && draftData.model_version !== 'not-called' && (
                      <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/60 text-indigo-800 dark:text-indigo-300">
                        {draftData.model_version}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        const txt = draftToNotesText(draftData.doctor_notes);
                        if (txt) {
                          navigator.clipboard.writeText(txt);
                          setCopiedDraftText(true);
                          setTimeout(() => setCopiedDraftText(false), 2000);
                        }
                      }}
                      className="p-1.5 hover:bg-subcanvas border border-line rounded-lg text-ink-2 text-xs transition flex items-center gap-1"
                      title="Copy notes draft"
                    >
                      {copiedDraftText ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                      <span>{copiedDraftText ? 'Copied' : 'Copy'}</span>
                    </button>
                    <button
                      type="button"
                      onClick={handleGenerateDraft}
                      disabled={loadingDraft}
                      className="p-1.5 hover:bg-subcanvas border border-line rounded-lg text-ink-2 text-xs transition"
                      title="Regenerate draft"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${loadingDraft ? 'animate-spin' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Draft content or no-speech warning */}
                {draftData.review_reasons?.includes('no_speech_captured') || !draftToNotesText(draftData.doctor_notes) ? (
                  <div className="py-8 px-6 text-center border-2 border-dashed border-amber-200 dark:border-amber-900/50 rounded-xl space-y-2 bg-amber-50/40 dark:bg-amber-950/20">
                    <AlertCircle className="w-7 h-7 mx-auto text-amber-600 dark:text-amber-400" />
                    <p className="text-sm font-semibold text-amber-900 dark:text-amber-200">No Speech Detected in Consultation</p>
                    <p className="text-xs text-amber-800 dark:text-amber-300 max-w-sm mx-auto leading-relaxed">
                      The audio recording captured no dialogue (the microphone was silent or muted), so Gemini was not invoked. You can record again with a fresh session.
                    </p>
                    <div className="pt-2">
                      <button
                        type="button"
                        onClick={handleRecordAgain}
                        className="px-4 py-2 bg-rose-600 text-white font-medium rounded-lg text-xs hover:bg-rose-700 transition inline-flex items-center gap-1.5 shadow-sm"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        Record Again (New Session)
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="max-h-[380px] overflow-y-auto space-y-3 pr-1">
                    {/* Chief Complaint */}
                    {draftData.doctor_notes?.chief_complaint && (
                      <div className="p-3 bg-surface border border-line rounded-xl space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Chief Complaint</span>
                        <p className="text-xs text-ink leading-relaxed">{draftData.doctor_notes.chief_complaint}</p>
                      </div>
                    )}
                    {/* Vitals Observed */}
                    {draftData.doctor_notes?.vitals_observed && (
                      <div className="p-3 bg-surface border border-line rounded-xl space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Vitals Observed</span>
                        <p className="text-xs text-ink leading-relaxed">{draftData.doctor_notes.vitals_observed}</p>
                      </div>
                    )}
                    {/* Assessment */}
                    {draftData.doctor_notes?.assessment && (
                      <div className="p-3 bg-surface border border-line rounded-xl space-y-1">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Assessment</span>
                        <p className="text-xs text-ink leading-relaxed">{draftData.doctor_notes.assessment}</p>
                      </div>
                    )}
                    {/* Plan & Recommendations */}
                    {draftData.doctor_notes?.plan_and_recommendations?.length > 0 && (
                      <div className="p-3 bg-surface border border-line rounded-xl space-y-1.5">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-ink-3">Plan & Recommendations</span>
                        <ul className="space-y-1 text-xs text-ink">
                          {draftData.doctor_notes.plan_and_recommendations.map((rec, i) => (
                            <li key={i} className="flex items-start gap-1.5">
                              <span className="text-primary font-bold">•</span>
                              <span>{rec.recommendation}</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {draftError && <p className="text-xs text-rose-600">{draftError}</p>}

                {/* Bottom Actions */}
                <div className="pt-2 flex justify-between items-center border-t border-line">
                  <button
                    type="button"
                    onClick={handleRecordAgain}
                    disabled={loading}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-lg text-xs font-semibold transition"
                  >
                    <RefreshCw className="w-3.5 h-3.5" />
                    Record Again
                  </button>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={onClose}
                      className="px-4 py-2 border border-line rounded-lg text-xs text-ink-2 hover:bg-subcanvas transition"
                    >
                      Close
                    </button>
                    {draftToNotesText(draftData?.doctor_notes) && (
                      <button
                        type="button"
                        onClick={handleApproveDraft}
                        disabled={approvingDraft}
                        className="px-4 py-2 bg-primary hover:bg-primary-dark text-white text-xs font-semibold rounded-lg shadow-sm transition flex items-center gap-1.5 disabled:opacity-60"
                      >
                        {approvingDraft ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                        Approve & Insert into Notes
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="py-12 px-6 text-center border-2 border-dashed border-line rounded-xl space-y-2">
                <FileText className="w-8 h-8 mx-auto text-ink-3 opacity-60" />
                <p className="text-xs font-semibold text-ink">No Notes Draft Available</p>
                <p className="text-[11px] text-ink-3 max-w-sm mx-auto">
                  Click "Generate Notes Draft" to synthesize notes from the recorded dialogue.
                </p>
                <button
                  type="button"
                  onClick={handleGenerateDraft}
                  disabled={loadingDraft}
                  className="mt-2 px-4 py-2 bg-primary text-white text-xs font-semibold rounded-lg shadow-sm"
                >
                  Generate Notes Draft
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </Modal>
  );
}
