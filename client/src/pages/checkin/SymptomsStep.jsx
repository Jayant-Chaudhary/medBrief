import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { checkinService } from '../../services/checkinService';
import { usePatientContext } from '../../context/PatientContext';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { YesNoToggle } from '../../components/ui/YesNoToggle';
import { Skeleton } from '../../components/ui/Skeleton';

export default function SymptomsStep() {
  const [questions, setQuestions] = useState([]);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { activeAppointment, loading: contextLoading } = usePatientContext();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const appointmentId = activeAppointment?.id;

  useEffect(() => {
    if (contextLoading) return undefined;
    if (!appointmentId) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    Promise.all([checkinService.getQuestions(appointmentId), checkinService.getAnswers(appointmentId)])
      .then(([questionRows, answerRows]) => {
        if (cancelled) return;
        setQuestions(questionRows);
        // Coming back to this step shows what was already submitted.
        setAnswers(
          Object.fromEntries(
            answerRows.map((row) => [
              row.template_id,
              row.answer_text != null
                ? { text: row.answer_text }
                : { value: row.answer ? 'yes' : 'no', notes: row.detail ?? '' },
            ])
          )
        );
      })
      .catch((err) => !cancelled && showToast(err.message || 'Could not load the questionnaire.', 'error'))
      .finally(() => !cancelled && setLoading(false));

    return () => {
      cancelled = true;
    };
  }, [appointmentId, contextLoading, showToast]);

  const handleToggle = (questionId, value) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: { ...prev[questionId], value }
    }));
  };

  const handleText = (questionId, text) => {
    setAnswers(prev => ({ ...prev, [questionId]: { text } }));
  };

  const handleNotes = (questionId, notes) => {
    setAnswers(prev => ({
      ...prev,
      [questionId]: { ...prev[questionId], notes }
    }));
  };

  const handleNext = async () => {
    setSaving(true);
    try {
      if (questions.length > 0) await checkinService.saveAnswers(appointmentId, answers);
      navigate('/checkin/checklist');
    } catch (err) {
      showToast(err.message || 'Could not save your answers.', 'error');
    } finally {
      setSaving(false);
    }
  };

  // A visit with no questions has nothing to answer; the patient moves straight on.
  // A written question counts as answered once it has some text in it.
  const isAnswered = (q) =>
    q.response_type === 'text' ? Boolean(answers[q.id]?.text?.trim()) : answers[q.id]?.value !== undefined;
  const allAnswered = questions.every(isAnswered);

  if (loading || contextLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-40 w-full rounded-card" />
        <Skeleton className="h-40 w-full rounded-card" />
      </div>
    );
  }

  if (!appointmentId) {
    return (
      <Card className="p-8 text-center">
        <h2 className="font-bold text-lg text-ink mb-2">No appointment selected</h2>
        <p className="text-ink-soft mb-4">Choose the visit you are checking in for on your dashboard.</p>
        <Link to="/" className="text-primary font-bold hover:underline">
          Go to dashboard
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-24">
      <div>
        <h2 className="text-2xl font-bold text-ink mb-2">How are you feeling today?</h2>
        <p className="text-ink-soft">Your doctor will review these answers before your consultation begins.</p>
      </div>

      {questions.length === 0 && (
        <Card className="p-5">
          <p className="text-ink-soft">Your clinician has no questions for you before this visit.</p>
        </Card>
      )}

      <div className="space-y-6">
        {questions.map(q => {
          const ans = answers[q.id];
          return (
            <Card key={q.id} className="p-5">
              <h3 className="font-bold text-lg text-ink mb-4 leading-tight">{q.question_text}</h3>

              {q.response_type === 'text' ? (
                <textarea
                  aria-label={q.question_text}
                  className="w-full bg-canvas rounded-lg border border-ink-soft/20 p-3 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-primary"
                  placeholder="Type your answer…"
                  value={ans?.text ?? ''}
                  onChange={(e) => handleText(q.id, e.target.value)}
                />
              ) : (
                <div className="mb-4">
                  <YesNoToggle
                    value={ans?.value}
                    onChange={(val) => handleToggle(q.id, val)}
                  />
                </div>
              )}

              {q.response_type !== 'text' && ans?.value === 'yes' && (
                <div className="animate-in slide-in-from-top-2 fade-in">
                  <label className="block text-sm font-medium text-ink-soft mb-2">
                    Please provide a few details:
                  </label>
                  <textarea
                    className="w-full bg-canvas rounded-lg border border-ink-soft/20 p-3 min-h-[100px] focus:outline-none focus:ring-2 focus:ring-primary"
                    placeholder="E.g. It started yesterday..."
                    value={ans.notes || ''}
                    onChange={(e) => handleNotes(q.id, e.target.value)}
                  />
                </div>
              )}
            </Card>
          );
        })}
      </div>

      {/* Sticky footer for action button */}
      <div className="fixed bottom-0 left-0 right-0 bg-raised border-t border-ink-soft/10 p-4 z-40 max-w-3xl mx-auto">
        <Button
          className="w-full"
          onClick={handleNext}
          disabled={!allAnswered || saving}
        >
          {saving ? 'Saving…' : allAnswered ? 'Continue to Next Step' : 'Please answer all questions'}
        </Button>
      </div>
    </div>
  );
}
