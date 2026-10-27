import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, ExternalLink } from 'lucide-react';
import { Sidebar } from '../../components/layout/Sidebar.jsx';
import { Spinner } from '../../components/common/Spinner.jsx';
import { HistoryGrid } from '../../components/clinician/HistoryGrid.jsx';
import { useToast } from '../../context/ToastContext.jsx';
import { fetchMyPatients, fetchPatientLabHistory } from '../../services/clinicianService.js';
import { buildFlowsheet } from '../../utils/flowsheet.js';

function reportDate(report) {
  return report.report_date || report.uploaded_at;
}

function formatDate(value) {
  if (!value) return 'Date unavailable';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ClinicianLabHistoryPage() {
  const { patientId } = useParams();
  const { showToast } = useToast();
  const [collapsed, setCollapsed] = useState(false);
  const [patient, setPatient] = useState(null);
  const [reports, setReports] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    Promise.all([fetchMyPatients(), fetchPatientLabHistory(patientId)])
      .then(([patients, history]) => {
        if (!active) return;
        setPatient(patients.find((item) => item.id === patientId) || null);
        setReports(history || []);
      })
      .catch((error) => {
        if (active) showToast(error.message || 'Could not load the patient lab history.', 'error');
      })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [patientId, showToast]);

  const flowsheet = useMemo(() => buildFlowsheet(reports), [reports]);

  if (loading) return <div className="flex h-screen items-center justify-center gap-3 text-ink-3"><Spinner /> Loading lab history…</div>;

  return (
    <div className="flex h-screen overflow-hidden bg-canvas">
      <Sidebar collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} />
      <main className="min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-8">
        <div className="mx-auto max-w-7xl space-y-5">
          <Link to={`/clinician/patients/${patientId}/maternal-record`} className="inline-flex items-center gap-2 text-label-md text-cypress hover:underline"><ArrowLeft size={16} /> Maternal record</Link>
          <header>
            <h1 className="font-display text-head-lg text-ink">Complete lab report history</h1>
            <p className="text-body-md text-ink-2">{patient?.fullName || patient?.name || patient?.email || 'Patient'} · {reports.length} shared report{reports.length === 1 ? '' : 's'} with full test history and trends</p>
          </header>

          <HistoryGrid flowsheet={flowsheet} patientId={patientId} />

          <section className="space-y-3">
            <div><h2 className="font-display text-head-sm text-ink">Report details</h2><p className="mt-1 text-body-sm text-ink-3">All reports this patient has shared with this clinician.</p></div>
            {!reports.length ? <div className="card px-5 py-8 text-center text-body-sm text-ink-3">No lab reports have been shared with this clinician.</div> : reports.map((report) => (
              <details key={report.id} className="card overflow-hidden">
                <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4 hover:bg-subcanvas/60">
                  <div><h3 className="text-label-md text-ink">{report.source_name || 'Uploaded lab report'} · {formatDate(reportDate(report))}</h3><p className="mt-1 text-body-sm text-ink-3">OCR status: {report.ocr_status || 'unknown'} · {(report.lab_report_metrics || []).length} test entries</p></div>
                  {report.signed_url && <a href={report.signed_url} target="_blank" rel="noreferrer" onClick={(event) => event.stopPropagation()} className="inline-flex items-center gap-1 text-label-sm text-cypress hover:underline">Open report <ExternalLink size={13} /></a>}
                </summary>
                <div className="overflow-x-auto border-t border-line">
                  <table className="w-full min-w-[620px] text-left text-body-sm">
                    <thead className="bg-subcanvas text-label-sm text-ink-3"><tr><th className="px-5 py-2">Test</th><th className="px-5 py-2">Result</th><th className="px-5 py-2">Unit</th><th className="px-5 py-2">Review</th></tr></thead>
                    <tbody>{(report.lab_report_metrics || []).map((metric) => <tr key={metric.id} className="border-t border-line"><td className="px-5 py-2.5 text-ink-2">{metric.metric_dictionary?.display_name || metric.raw_key || 'Unnamed test'}</td><td className="px-5 py-2.5 tabular text-ink">{metric.reviewed_value ?? metric.parsed_value ?? metric.raw_value ?? '—'}</td><td className="px-5 py-2.5 text-ink-2">{metric.unit_standard || metric.unit_raw || '—'}</td><td className="px-5 py-2.5">{metric.needs_review ? <span className="rounded-full bg-terracotta-surface px-2 py-0.5 text-label-sm text-terracotta">Needs review</span> : <span className="text-ink-3">—</span>}</td></tr>)}</tbody>
                  </table>
                </div>
              </details>
            ))}
          </section>
        </div>
      </main>
    </div>
  );
}
