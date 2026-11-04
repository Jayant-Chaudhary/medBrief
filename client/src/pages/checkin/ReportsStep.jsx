import React, { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, CheckCircle2, ShieldCheck, ArrowRight, Share2, EyeOff } from 'lucide-react';
import { format } from 'date-fns';
import { reportService } from '../../services/reportService';
import { usePatientContext } from '../../context/PatientContext';
import { useToast } from '../../context/ToastContext';
import { Card } from '../../components/ui/Card';
import { Button } from '../../components/ui/Button';
import { Checkbox } from '../../components/ui/Checkbox';
import { Skeleton } from '../../components/ui/Skeleton';

export default function ReportsStep({ initialReports = null }) {
  const [reports, setReports] = useState(initialReports || []);
  const [loading, setLoading] = useState(initialReports === null);
  const [sharingAll, setSharingAll] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const navigate = useNavigate();
  const { activeAppointment, loading: contextLoading } = usePatientContext();
  const { showToast } = useToast();

  const appointmentId = activeAppointment?.id;

  useEffect(() => {
    if (contextLoading) return undefined;
    if (initialReports !== null) {
      setLoading(false);
      return undefined;
    }
    if (!appointmentId) {
      setLoading(false);
      return undefined;
    }

    let cancelled = false;
    setLoading(true);

    reportService
      .getReports()
      .then((data) => {
        if (!cancelled) setReports(data || []);
      })
      .catch((err) => {
        if (!cancelled) showToast(err.message || 'Could not load your reports.', 'error');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [appointmentId, contextLoading, showToast]);

  const handleShareAll = async () => {
    if (!appointmentId) return;
    setSharingAll(true);
    try {
      await reportService.shareAllWithAppointment(appointmentId);
      // Mark all current reports as shared with this appointment
      setReports((current) =>
        current.map((r) => ({
          ...r,
          shared_appointment_ids: [...new Set([...(r.shared_appointment_ids || []), appointmentId])],
        }))
      );
      showToast('All reports in your library are now shared with this visit.', 'success');
    } catch (err) {
      showToast(err.message || 'Could not share all reports.', 'error');
    } finally {
      setSharingAll(false);
    }
  };

  const handleToggleShare = async (reportId, shouldShare) => {
    if (!appointmentId) return;

    let previous = [];
    setReports((current) => {
      const target = current.find((r) => r.id === reportId);
      previous = target?.shared_appointment_ids || [];
      const next = shouldShare
        ? [...new Set([...previous, appointmentId])]
        : previous.filter((id) => id !== appointmentId);

      return current.map((r) => (r.id === reportId ? { ...r, shared_appointment_ids: next } : r));
    });

    try {
      if (shouldShare) {
        await reportService.shareWithAppointment(reportId, appointmentId);
      } else {
        await reportService.unshareFromAppointment(reportId, appointmentId);
      }
    } catch (err) {
      setReports((current) =>
        current.map((r) => (r.id === reportId ? { ...r, shared_appointment_ids: previous } : r))
      );
      showToast(err.message || 'Could not update report sharing.', 'error');
    }
  };

  if (loading || contextLoading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-48 w-full rounded-card" />
        <Skeleton className="h-32 w-full rounded-card" />
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

  const sharedCount = reports.filter((r) =>
    (r.shared_appointment_ids || []).includes(appointmentId)
  ).length;

  return (
    <div className="space-y-8 animate-in fade-in duration-300 pb-24">
      <div>
        <h2 className="text-2xl font-bold text-ink mb-2">Share Lab Reports</h2>
        <p className="text-ink-soft">
          Choose which reports your clinician can review for this consultation. Reports you do not
          share remain confidential in your private library.
        </p>
      </div>

      <Card className="p-5 border-l-4 border-l-primary bg-primary-light/10">
        <div className="flex items-start gap-3">
          <ShieldCheck className="text-primary mt-0.5 shrink-0" size={20} />
          <div>
            <h4 className="font-bold text-ink text-sm">Patient Privacy Choice</h4>
            <p className="text-xs text-ink-soft mt-1 leading-relaxed">
              Currently, <span className="font-bold text-ink">{sharedCount}</span> of{' '}
              <span className="font-bold text-ink">{reports.length}</span> report{reports.length === 1 ? '' : 's'} are
              shared with this visit. You may share all reports, select specific ones, or continue without
              sharing any new reports.
            </p>
          </div>
        </div>
      </Card>

      {reports.length === 0 ? (
        <Card className="p-8 text-center">
          <FileText className="mx-auto text-ink-soft mb-3" size={32} />
          <h3 className="font-bold text-ink mb-1">No reports in your library</h3>
          <p className="text-sm text-ink-soft mb-6">
            You have not uploaded any lab reports yet. You can proceed with the rest of your check-in.
          </p>
          <Button onClick={() => navigate('/checkin/symptoms')} className="w-full sm:w-auto">
            Continue to Symptoms
          </Button>
        </Card>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3 bg-canvas p-3 rounded-lg border border-line">
            <span className="text-sm font-medium text-ink">
              Sharing Options ({sharedCount} shared):
            </span>
            <div className="flex items-center gap-2">
              <Button
                variant="secondary"
                size="sm"
                onClick={() => setShowPicker((prev) => !prev)}
                className="text-xs"
              >
                {showPicker ? 'Hide report selection' : 'Choose reports'}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={handleShareAll}
                isLoading={sharingAll}
                disabled={sharedCount === reports.length}
                className="text-xs"
              >
                Share all
              </Button>
            </div>
          </div>

          <div className="space-y-3">
            {reports.map((report) => {
              const isShared = (report.shared_appointment_ids || []).includes(appointmentId);
              const reportDate = report.report_date ? new Date(report.report_date) : null;
              const metrics = report.lab_report_metrics || [];

              return (
                <Card
                  key={report.id}
                  className={`p-4 transition-colors ${
                    isShared ? 'border-primary/40 bg-canvas' : 'bg-canvas/50 border-ink-soft/10 opacity-80'
                  }`}
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-start gap-3 min-w-0">
                      {showPicker && (
                        <div className="pt-0.5">
                          <Checkbox
                            checked={isShared}
                            onChange={(e) => handleToggleShare(report.id, e.target.checked)}
                          />
                        </div>
                      )}
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <h4 className="font-bold text-sm text-ink truncate">
                            {reportDate ? `Report from ${format(reportDate, 'MMM d, yyyy')}` : 'Lab Report'}
                          </h4>
                          {isShared ? (
                            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-success bg-success-light px-2 py-0.5 rounded-full">
                              <CheckCircle2 size={12} /> Shared with visit
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[11px] font-medium text-ink-soft bg-raised px-2 py-0.5 rounded-full">
                              <EyeOff size={12} /> Not shared (private)
                            </span>
                          )}
                        </div>

                        {metrics.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            {metrics.slice(0, 3).map((m) => (
                              <span
                                key={m.id}
                                className="px-2 py-0.5 rounded bg-raised text-[11px] text-ink"
                              >
                                {m.standard_key || m.raw_key}: {m.reviewed_value ?? m.parsed_value ?? m.raw_value}
                              </span>
                            ))}
                            {metrics.length > 3 && (
                              <span className="text-[11px] text-ink-soft self-center">
                                +{metrics.length - 3} more
                              </span>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    {!showPicker && (
                      <Button
                        variant={isShared ? 'ghost' : 'secondary'}
                        size="sm"
                        onClick={() => handleToggleShare(report.id, !isShared)}
                        className="shrink-0 text-xs"
                      >
                        {isShared ? 'Unshare' : 'Share'}
                      </Button>
                    )}
                  </div>
                </Card>
              );
            })}
          </div>

          <div className="pt-6 border-t border-line flex flex-col sm:flex-row items-center justify-between gap-4">
            <Button
              variant="ghost"
              onClick={() => navigate('/checkin/symptoms')}
              className="text-ink-soft hover:text-ink w-full sm:w-auto"
            >
              Continue without changing reports
            </Button>
            <Button
              onClick={() => navigate('/checkin/symptoms')}
              className="w-full sm:w-auto flex items-center justify-center gap-2"
            >
              Continue to Symptoms <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
