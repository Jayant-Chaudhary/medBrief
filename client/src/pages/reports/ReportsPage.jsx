import { useState, useEffect, useCallback } from 'react';
import { FileText } from 'lucide-react';
import { reportService } from '../../services/reportService';
import { usePatientContext } from '../../context/PatientContext';
import { useToast } from '../../context/ToastContext';
import UploadZone from '../../components/reports/UploadZone';
import ReportCard from '../../components/reports/ReportCard';
import AppointmentSharePicker from '../../components/reports/AppointmentSharePicker';
import NameMismatchModal from '../../components/reports/NameMismatchModal';
import { Skeleton } from '../../components/ui/Skeleton';
import { EmptyState } from '../../components/ui/EmptyState';

/**
 * The patient's report library.
 *
 * Reports belong to the patient, not to a visit. Each one carries the set of
 * appointments it has been shared with, and the clinician for a given
 * appointment sees only what was shared with that appointment.
 */
export default function ReportsPage() {
  const { appointments, activeAppointment, selectAppointment } = usePatientContext();
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [nameMismatch, setNameMismatch] = useState(null);
  const { showToast } = useToast();

  const loadReports = useCallback(async () => {
    try {
      setReports(await reportService.getReports());
    } catch (err) {
      showToast(err.message || 'Could not load your reports.', 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    loadReports();
  }, [loadReports]);

  const handleUpload = async (file, { confirmNameMismatch = false } = {}) => {
    setUploading(true);
    showToast('Uploading and reading your report…', 'info');

    try {
      const result = await reportService.uploadReport(file, {
        appointmentId: activeAppointment?.id,
        confirmNameMismatch,
      });

      const found = result?.metrics?.length ?? 0;
      showToast(
        found > 0
          ? `Report added — ${found} value${found === 1 ? '' : 's'} read from it. Tap Preview to check them.`
          : 'Report added. We could not read values automatically; your doctor will review it.',
        found > 0 ? 'success' : 'info'
      );

      await loadReports();
    } catch (err) {
      if (err.code === 'REPORT_NAME_MISMATCH' || err.code === 'REPORT_NAME_UNREADABLE') {
        setNameMismatch({ file, ...err.details });
      } else {
        showToast(err.message || 'Failed to upload report.', 'error');
      }
    } finally {
      setUploading(false);
    }
  };

  const handleCancelNameMismatch = () => {
    setNameMismatch(null);
    showToast('Upload cancelled. The report was not saved.', 'info');
  };

  const handleProceedNameMismatch = () => {
    const { file } = nameMismatch;
    setNameMismatch(null);
    handleUpload(file, { confirmNameMismatch: true });
  };

  const handleRemove = async (id) => {
    try {
      await reportService.removeReport(id);
      await loadReports();
      showToast('Report removed.');
    } catch (err) {
      showToast(err.message || 'Could not remove that report.', 'error');
    }
  };

  /** Optimistic toggle — a sharing switch that lags feels broken. */
  const handleToggleShare = async (report, appointmentId, shouldShare) => {
    const previous = report.shared_appointment_ids ?? [];
    const next = shouldShare
      ? [...previous, appointmentId]
      : previous.filter((id) => id !== appointmentId);

    setReports((current) =>
      current.map((r) => (r.id === report.id ? { ...r, shared_appointment_ids: next } : r))
    );

    try {
      if (shouldShare) {
        await reportService.shareWithAppointment(report.id, appointmentId);
      } else {
        await reportService.unshareFromAppointment(report.id, appointmentId);
      }
    } catch (err) {
      setReports((current) =>
        current.map((r) => (r.id === report.id ? { ...r, shared_appointment_ids: previous } : r))
      );
      showToast(err.message || 'Could not update sharing.', 'error');
    }
  };

  return (
    <div className="py-8 animate-in fade-in duration-300">
      <header className="mb-8">
        <h1 className="text-3xl font-bold text-ink mb-2">Lab Reports</h1>
        <p className="text-ink-soft">
          Upload a report once. Choose which appointments each one is shared with.
        </p>
      </header>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-1">
          <div className="sticky top-24 space-y-4">
            <UploadZone
              onUpload={handleUpload}
              onBusy={() => showToast('Please wait for the current upload to finish.', 'info')}
              disabled={uploading}
            />
            {uploading && (
              <p className="text-sm text-primary font-bold flex items-center justify-center gap-2">
                <span className="animate-spin inline-block">⏳</span> Reading your document…
              </p>
            )}
            <AppointmentSharePicker
              appointments={appointments.upcoming}
              activeId={activeAppointment?.id}
              onSelect={selectAppointment}
            />
          </div>
        </div>

        <div className="lg:col-span-2 space-y-4">
          {loading ? (
            <>
              <Skeleton className="h-32 w-full rounded-card" />
              <Skeleton className="h-32 w-full rounded-card" />
            </>
          ) : reports.length === 0 ? (
            <EmptyState
              icon={<FileText size={22} />}
              title="No reports yet"
              description="Upload a photo or PDF of a printed lab report and we'll read the values from it."
            />
          ) : (
            reports.map((report) => (
              <ReportCard
                key={report.id}
                report={report}
                appointments={appointments.all}
                onRemove={handleRemove}
                onToggleShare={handleToggleShare}
              />
            ))
          )}
        </div>
      </div>

      <NameMismatchModal
        mismatch={nameMismatch}
        onCancel={handleCancelNameMismatch}
        onProceed={handleProceedNameMismatch}
      />
    </div>
  );
}
