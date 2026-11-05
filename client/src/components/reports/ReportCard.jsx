import { useState } from 'react';
import { FileType, CheckCircle, AlertCircle, Trash2, Share2, ExternalLink, ScanText } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { Card } from '../ui/Card';
import { Checkbox } from '../ui/Checkbox';
import OcrPreviewModal from './OcrPreviewModal';
import { cn } from '../../utils/cn';

/** Maps the report's ocr_status onto what the patient needs to know. */
function statusDisplay(ocrStatus, metricCount) {
  if (ocrStatus === 'success' && metricCount > 0) {
    return {
      icon: CheckCircle,
      color: 'text-success',
      bg: 'bg-success-light',
      label: `${metricCount} value${metricCount === 1 ? '' : 's'} read`,
    };
  }
  if (ocrStatus === 'partial') {
    return { icon: AlertCircle, color: 'text-attention', bg: 'bg-attention-light', label: 'Partly read' };
  }
  if (ocrStatus === 'failed') {
    return {
      icon: AlertCircle,
      color: 'text-attention',
      bg: 'bg-attention-light',
      label: 'Doctor will review',
    };
  }
  return { icon: FileType, color: 'text-ink-soft', bg: 'bg-canvas', label: 'Uploaded' };
}

export default function ReportCard({ report, appointments = [], onRemove, onToggleShare }) {
  const [sharingOpen, setSharingOpen] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);

  const metrics = report.lab_report_metrics ?? [];
  const status = statusDisplay(report.ocr_status, metrics.length);
  const Icon = status.icon;

  const sharedIds = report.shared_appointment_ids ?? [];
  const uploadedAt = report.uploaded_at ? new Date(report.uploaded_at) : null;
  const reportDate = report.report_date ? new Date(report.report_date) : null;

  return (
    <Card className="p-4">
      <div className="flex items-start gap-4">
        <div
          className={`w-12 h-12 rounded-lg flex items-center justify-center shrink-0 ${status.bg} ${status.color}`}
        >
          <Icon size={24} />
        </div>

        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-ink truncate">
            {reportDate ? `Report from ${format(reportDate, 'MMM d, yyyy')}` : 'Lab report'}
          </h4>
          <div className="flex flex-wrap items-center gap-2 text-xs text-ink-soft mt-1">
            <span className={`font-medium ${status.color}`}>{status.label}</span>
            {uploadedAt && (
              <>
                <span>&bull;</span>
                <span>uploaded {formatDistanceToNow(uploadedAt)} ago</span>
              </>
            )}
            <span>&bull;</span>
            <span>
              shared with {sharedIds.length} visit{sharedIds.length === 1 ? '' : 's'}
            </span>
          </div>

          {metrics.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mt-2">
              {metrics.slice(0, 4).map((m) => (
                <span
                  key={m.id}
                  className="px-2 py-0.5 rounded-full bg-canvas border border-ink-soft/15 text-[11px] font-medium text-ink"
                >
                  {m.standard_key ?? m.raw_key}: {m.reviewed_value ?? m.parsed_value ?? m.raw_value}
                </span>
              ))}
              {metrics.length > 4 && (
                <span className="text-[11px] text-ink-soft self-center">+{metrics.length - 4} more</span>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={() => setPreviewOpen(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-primary hover:bg-primary-light rounded-full transition-colors"
            aria-label="Preview what was read from this report"
          >
            <ScanText size={16} />
            <span className="hidden sm:inline">Preview</span>
          </button>
          {report.signed_url && (
            <a
              href={report.signed_url}
              target="_blank"
              rel="noreferrer"
              className="p-2 text-ink-soft hover:text-primary hover:bg-primary-light rounded-full transition-colors"
              aria-label="Open the original file"
            >
              <ExternalLink size={18} />
            </a>
          )}
          <button
            onClick={() => setSharingOpen((open) => !open)}
            className={cn(
              'p-2 rounded-full transition-colors',
              sharingOpen ? 'text-primary bg-primary-light' : 'text-ink-soft hover:text-primary hover:bg-primary-light'
            )}
            aria-expanded={sharingOpen}
            aria-label="Choose which visits can see this report"
          >
            <Share2 size={18} />
          </button>
          <button
            onClick={() => onRemove?.(report.id)}
            className="p-2 text-ink-soft hover:text-attention hover:bg-attention-light rounded-full transition-colors"
            aria-label="Remove report"
          >
            <Trash2 size={18} />
          </button>
        </div>
      </div>

      {sharingOpen && (
        <div className="mt-4 pt-4 border-t border-ink-soft/10">
          <h5 className="text-sm font-bold text-ink mb-2">Visible to these visits</h5>
          {appointments.length === 0 ? (
            <p className="text-sm text-ink-soft">You have no appointments to share this with yet.</p>
          ) : (
            <div className="space-y-2">
              {appointments.map((appointment) => {
                const checked = sharedIds.includes(appointment.id);
                return (
                  <div
                    key={appointment.id}
                    className="flex items-center gap-3 px-3 py-2 rounded-control hover:bg-canvas"
                  >
                    <Checkbox
                      checked={checked}
                      onChange={(e) => onToggleShare?.(report.id, appointment.id, e.target.checked)}
                    />
                    <span className="text-sm">
                      <span className="block font-medium text-ink">
                        {format(new Date(appointment.scheduled_at), 'MMM d, yyyy')}
                      </span>
                      <span className="block text-xs text-ink-soft">
                        {appointment.clinician?.full_name ?? 'Your clinician'}
                      </span>
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
      <OcrPreviewModal report={report} isOpen={previewOpen} onClose={() => setPreviewOpen(false)} />
    </Card>
  );
}
