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
  getSessionByAppointment,
} from '../../services/consultAudio/consultClient.service.js';
import { WebRecorder } from '../../services/consultAudio/webRecorder.js';

export function DoctorConsultationModal({
  isOpen,
  onClose,
  appointment,
  initialTab = 'RECORD', // 'RECORD' | 'TRANSCRIPT'
  onConsultationFinished,
}) {
  const [activeTab, setActiveTab] = useState(initialTab); // 'RECORD' | 'TRANSCRIPT'
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

  const [micLevelDbfs, setMicLevelDbfs] = useState(-100);
  const [offsetInfo, setOffsetInfo] = useState(null);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [chunksUploaded, setChunksUploaded] = useState(0);
  const [remainingQueue, setRemainingQueue] = useState(0);

  const recorderRef = useRef(null);
  const socketRef = useRef(null);
  const timerRef = useRef(null);
  const pollingRef = useRef(null);
  const originalTitleRef = useRef(document.title);

  // Resilient accessors for session attributes
  const getSessionId = () => session?.sessionId || session?.session_id || session?.id;
  const getDoctorToken = () => session?.doctorToken || session?.doctor_token || session?.token;
  const getRoomCode = () => session?.roomCode || session?.room_code || '------';

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
        if (existingSession && (initialTab === 'TRANSCRIPT' || existingSession.session_state === 'ended')) {
          setSession(existingSession);
          loadTranscript(existingSession.id || existingSession.sessionId);
          if (initialTab === 'TRANSCRIPT' || existingSession.session_state === 'ended') {
            setActiveTab('TRANSCRIPT');
          }
          return;
        }

        // Otherwise create / fetch current active consultation session
        return createConsultSession(targetAppointmentId).then((data) => {
          if (!mounted) return;
          setSession(data);
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
                setPatientReady(true);
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

  // Polling hook for transcript processing progress
  useEffect(() => {
    const isTranscribing = transcriptData?.isProcessing;
    const sessId = getSessionId();

    if ((activeTab === 'TRANSCRIPT' || step === 'DONE') && sessId && isTranscribing) {
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

  // Start Mic Level Check & Clock Handshake
  const handleProceedToMicCheck = async () => {
    const sessionId = getSessionId();
    const token = getDoctorToken();

    if (!sessionId || !token) {
      setError('Consultation session is still initializing. Please wait a moment or reopen the dialog.');
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
        apiBaseUrl: import.meta.env.VITE_API_BASE_URL || 'http://localhost:4000',
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
    const sessionId = getSessionId();
    const token = getDoctorToken();

    if (!sessionId || !token) {
      setError('Consultation session is not ready. Please wait a moment or reopen the dialog.');
      return;
    }

    setLoading(true);
    setError(null);

    try {
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
      setActiveTab('TRANSCRIPT');
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
      className={activeTab === 'TRANSCRIPT' ? 'max-w-2xl' : 'max-w-xl'}
    >
      <div className="space-y-4">
        {/* Navigation Tabs (Available when not actively recording) */}
        {step !== 'RECORDING' && step !== 'ENDING' && (
          <div className="flex border-b border-line pb-1 gap-2">
            <button
              type="button"
              onClick={() => setActiveTab('RECORD')}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeTab === 'RECORD'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-ink-2 hover:bg-slate-100'
              }`}
            >
              <Mic className="w-3.5 h-3.5" />
              {step === 'DONE' ? 'Record New Audio' : 'Record Audio'}
            </button>
            <button
              type="button"
              onClick={() => {
                setActiveTab('TRANSCRIPT');
                loadTranscript();
              }}
              className={`flex items-center gap-2 px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
                activeTab === 'TRANSCRIPT'
                  ? 'bg-primary text-white shadow-sm'
                  : 'text-ink-2 hover:bg-slate-100'
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
                    <div className="flex items-center gap-1.5 px-3 py-1 bg-white rounded-full shadow-sm border text-xs font-medium text-ink-2">
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
                    <button
                      type="button"
                      onClick={copyRoomCode}
                      className="p-2 bg-white hover:bg-slate-50 border rounded-lg shadow-sm text-ink-2 transition"
                      title="Copy room code"
                    >
                      {copiedCode ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
                    </button>
                  </div>
                  <p className="text-xs text-ink-3 mt-2 px-6">
                    Ask the patient to enter this 6-character code on their phone to connect their microphone.
                  </p>
                </div>

                {/* Connection Status Box */}
                <div className="p-3.5 bg-slate-50 border rounded-xl flex items-center justify-between text-xs">
                  <div className="flex items-center gap-2">
                    <Radio className={`w-4 h-4 ${patientJoined ? 'text-emerald-500 animate-pulse' : 'text-slate-400'}`} />
                    <span className="font-medium text-ink">
                      {patientJoined ? 'Patient Connected on Mobile' : 'Waiting for patient device...'}
                    </span>
                  </div>
                  <span className={`px-2 py-0.5 rounded-full font-semibold ${patientJoined ? 'bg-emerald-100 text-emerald-800' : 'bg-slate-200 text-slate-600'}`}>
                    {patientJoined ? 'Connected' : 'Waiting'}
                  </span>
                </div>

                <div className="pt-2 flex justify-end gap-3">
                  <button
                    type="button"
                    onClick={onClose}
                    className="px-4 py-2 border rounded-lg text-sm text-ink-2 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={handleProceedToMicCheck}
                    disabled={loading || !session}
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

                <div className="grid grid-cols-2 gap-3 pt-1">
                  <div className={`p-3 border rounded-xl flex items-center justify-between text-xs ${doctorReady ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-200'}`}>
                    <span className="font-medium">Doctor Device</span>
                    {doctorReady ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <span className="text-slate-400 font-medium">Pending</span>}
                  </div>
                  <div className={`p-3 border rounded-xl flex items-center justify-between text-xs ${patientReady ? 'bg-emerald-50 border-emerald-200 text-emerald-800' : 'bg-slate-50 border-slate-200'}`}>
                    <span className="font-medium">Patient Device</span>
                    {patientReady ? <CheckCircle2 className="w-4 h-4 text-emerald-600" /> : <span className="text-slate-400 font-medium">Optional / Joined</span>}
                  </div>
                </div>

                <label className="flex items-start gap-3 p-3.5 bg-slate-50 border border-slate-200 rounded-xl cursor-pointer select-none">
                  <input
                    type="checkbox"
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

                  <div className="flex gap-2">
                    {!doctorReady ? (
                      <button
                        type="button"
                        onClick={handleConfirmReady}
                        disabled={!consentAccepted || loading}
                        className="px-4 py-2 bg-emerald-600 text-white font-medium rounded-lg text-sm hover:bg-emerald-700 transition flex items-center gap-2 shadow-sm disabled:opacity-50"
                      >
                        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldCheck className="w-4 h-4" />}
                        Confirm Readiness
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={handleStartRecording}
                        disabled={loading}
                        className="px-5 py-2 bg-rose-600 text-white font-semibold rounded-lg text-sm hover:bg-rose-700 transition flex items-center gap-2 shadow-sm animate-pulse"
                      >
                        <Radio className="w-4 h-4" />
                        Start Consultation
                      </button>
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

                <div className="max-w-xs mx-auto p-3 bg-slate-50 border rounded-xl text-xs space-y-1.5">
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
                <div className="pt-3 flex justify-center gap-3">
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
                    onClick={onClose}
                    className="px-5 py-2 border rounded-lg text-sm text-ink-2 hover:bg-slate-50 transition"
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
            <div className="bg-slate-50 border border-line rounded-xl p-3.5 space-y-2.5">
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
                    className="p-1.5 hover:bg-slate-200 border rounded-lg text-ink-2 text-xs transition"
                    title="Refresh transcript"
                  >
                    <RefreshCw className={`w-3.5 h-3.5 ${loadingTranscript ? 'animate-spin' : ''}`} />
                  </button>
                  <button
                    type="button"
                    onClick={handleCopyTranscript}
                    disabled={!transcriptData?.segments?.length}
                    className="flex items-center gap-1 px-2.5 py-1.5 hover:bg-slate-200 border rounded-lg text-ink-2 text-xs transition disabled:opacity-40"
                    title="Copy transcript dialogue"
                  >
                    {copiedTranscript ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
                    <span>{copiedTranscript ? 'Copied' : 'Copy'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={handleDownloadTranscript}
                    disabled={!transcriptData?.segments?.length}
                    className="flex items-center gap-1 px-2.5 py-1.5 bg-white hover:bg-slate-100 border rounded-lg text-ink-2 text-xs transition shadow-sm disabled:opacity-40"
                    title="Download .txt transcript"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download</span>
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
                <div className="h-1.5 w-full bg-slate-200 rounded-full overflow-hidden">
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
            <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1">
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
                            <span className="bg-white/80 px-1.5 py-0.5 rounded border border-line">
                              {Math.round(seg.confidence * 100)}% conf
                            </span>
                          )}
                          {seg.language && (
                            <span className="bg-white/80 px-1.5 py-0.5 rounded border border-line uppercase font-mono">
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
      </div>
    </Modal>
  );
}
