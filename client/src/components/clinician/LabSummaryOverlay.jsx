import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { ChevronLeft, ChevronRight, Grip, X } from 'lucide-react';
import { TrendChart } from './TrendChart.jsx';

function reportDate(report) {
  return report.reportDate || report.uploadedAt;
}

function metricKey(metric) {
  return metric.standardKey || String(metric.rawKey || metric.name || 'unknown').trim().toLowerCase();
}

function numericValue(metric) {
  const value = metric.value ?? metric.rawValue;
  if (value == null || String(value).trim() === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatDate(value) {
  if (!value) return 'Date unavailable';
  return new Date(value).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function LabSummaryOverlay({ open, onClose, patientId, reports = [] }) {
  const panelRef = useRef(null);
  const dragRef = useRef(null);
  const resizeRef = useRef(null);
  const [geometry, setGeometry] = useState({ x: 24, y: 24, width: 920, height: 760 });
  const [metricIndex, setMetricIndex] = useState(0);
  const [metricQuery, setMetricQuery] = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);

  const latestReports = useMemo(
    () => [...reports].sort((a, b) => new Date(reportDate(b) || 0) - new Date(reportDate(a) || 0)).slice(0, 5),
    [reports]
  );
  const metrics = useMemo(() => {
    const byKey = new Map();
    for (const report of latestReports) {
      for (const metric of report.metrics || []) {
        const key = metricKey(metric);
        const existing = byKey.get(key) || {
          key,
          name: metric.name || metric.rawKey || 'Unnamed test',
          unit: metric.unit || '',
          entries: [],
        };
        existing.entries.push({
          reportId: report.id,
          metricId: metric.id,
          date: reportDate(report),
          value: metric.value ?? metric.rawValue ?? '—',
          numeric: numericValue(metric),
          unit: metric.unit || existing.unit,
          needsReview: metric.needsReview,
        });
        byKey.set(key, existing);
      }
    }
    return [...byKey.values()]
      .map((metric) => ({
        ...metric,
        entries: metric.entries.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [latestReports]);

  const selectedMetric = metrics[metricIndex] || null;
  const chartSeries = selectedMetric
    ? [...selectedMetric.entries]
      .filter((entry) => entry.numeric != null)
      .sort((a, b) => new Date(a.date || 0) - new Date(b.date || 0))
      .map((entry) => ({ date: entry.date, value: entry.numeric }))
    : [];

  useEffect(() => {
    if (!open) return undefined;
    const width = Math.min(920, window.innerWidth - 24);
    const height = Math.min(760, window.innerHeight - 24);
    setGeometry({
      x: Math.max(12, Math.round((window.innerWidth - width) / 2)),
      y: Math.max(12, Math.round((window.innerHeight - height) / 2)),
      width,
      height,
    });
    setMetricIndex(0);
    setMetricQuery(metrics[0]?.name || '');
    setPickerOpen(false);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; };
  }, [open, metrics]);

  useEffect(() => {
    if (!open) return undefined;
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);

  useEffect(() => {
    if (!open) return undefined;
    const keepInViewport = () => setGeometry((current) => {
      const width = Math.min(current.width, Math.max(280, window.innerWidth - 24));
      const height = Math.min(current.height, Math.max(300, window.innerHeight - 24));
      return {
        width,
        height,
        x: Math.max(0, Math.min(window.innerWidth - width, current.x)),
        y: Math.max(0, Math.min(window.innerHeight - height, current.y)),
      };
    });
    window.addEventListener('resize', keepInViewport);
    return () => window.removeEventListener('resize', keepInViewport);
  }, [open]);

  useEffect(() => {
    setMetricIndex((index) => Math.min(index, Math.max(0, metrics.length - 1)));
  }, [metrics.length]);

  useEffect(() => {
    setMetricQuery(selectedMetric?.name || '');
  }, [selectedMetric?.key, selectedMetric?.name]);

  function startDrag(event) {
    if (event.target.closest('button, a, select')) return;
    const bounds = panelRef.current?.getBoundingClientRect();
    if (!bounds) return;
    dragRef.current = { pointerX: event.clientX, pointerY: event.clientY, x: bounds.left, y: bounds.top };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveDrag(event) {
    if (!dragRef.current || !panelRef.current) return;
    const x = dragRef.current.x + event.clientX - dragRef.current.pointerX;
    const y = dragRef.current.y + event.clientY - dragRef.current.pointerY;
    setGeometry((current) => ({
      ...current,
      x: Math.max(0, Math.min(window.innerWidth - current.width, x)),
      y: Math.max(0, Math.min(window.innerHeight - current.height, y)),
    }));
  }

  function startResize(event) {
    event.preventDefault();
    event.stopPropagation();
    resizeRef.current = {
      pointerX: event.clientX,
      pointerY: event.clientY,
      width: geometry.width,
      height: geometry.height,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function moveResize(event) {
    if (!resizeRef.current) return;
    const maxWidth = Math.max(280, window.innerWidth - geometry.x - 12);
    const maxHeight = Math.max(300, window.innerHeight - geometry.y - 12);
    setGeometry((current) => ({
      ...current,
      width: Math.max(320, Math.min(maxWidth, resizeRef.current.width + event.clientX - resizeRef.current.pointerX)),
      height: Math.max(360, Math.min(maxHeight, resizeRef.current.height + event.clientY - resizeRef.current.pointerY)),
    }));
  }

  function selectMetric(index) {
    if (index < 0 || index >= metrics.length) return;
    setMetricIndex(index);
    setMetricQuery(metrics[index].name);
    setPickerOpen(false);
  }

  const filteredMetrics = metrics.filter((metric) => metric.name.toLowerCase().includes(metricQuery.trim().toLowerCase()));

  function handleMetricKeyDown(event) {
    if (event.key === 'Escape') {
      event.stopPropagation();
      setPickerOpen(false);
      setMetricQuery(selectedMetric?.name || '');
    } else if (event.key === 'Enter') {
      event.preventDefault();
      if (filteredMetrics.length) selectMetric(metrics.findIndex((metric) => metric.key === filteredMetrics[0].key));
    } else if (event.key === 'ArrowDown' && filteredMetrics.length) {
      event.preventDefault();
      setPickerOpen(true);
      if (filteredMetrics.length === 1) selectMetric(metrics.findIndex((metric) => metric.key === filteredMetrics[0].key));
    }
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70] bg-black/40" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label="Shared lab report summaries"
        className="fixed flex flex-col overflow-hidden rounded-2xl border border-line bg-canvas shadow-2xl"
        style={{
          left: geometry.x,
          top: geometry.y,
          width: geometry.width,
          height: geometry.height,
          minWidth: 'min(320px, calc(100vw - 24px))',
          minHeight: 'min(360px, calc(100vh - 24px))',
          maxWidth: 'calc(100vw - 24px)',
          maxHeight: 'calc(100vh - 24px)',
        }}
      >
        <header
          onPointerDown={startDrag}
          onPointerMove={moveDrag}
          onPointerUp={() => { dragRef.current = null; }}
          onPointerCancel={() => { dragRef.current = null; }}
          className="flex shrink-0 cursor-grab touch-none items-start justify-between gap-3 border-b border-line bg-surface px-5 py-4 active:cursor-grabbing"
        >
          <div className="flex min-w-0 items-start gap-3">
            <Grip size={17} className="mt-1 shrink-0 text-ink-3" />
            <div>
              <h2 className="font-display text-head-sm text-ink">Lab report summaries</h2>
              <p className="mt-1 text-body-sm text-ink-3">Latest {latestReports.length} shared report{latestReports.length === 1 ? '' : 's'} · Drag this header to move · Resize from the lower corner</p>
            </div>
          </div>
          <button type="button" onPointerDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="Close lab summaries" className="rounded-lg p-2 text-ink-3 hover:bg-subcanvas hover:text-ink">
            <X size={18} />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-5">
          {latestReports.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-body-sm text-ink-3">No lab reports have been shared with this clinician.</p>
          ) : metrics.length === 0 ? (
            <p className="rounded-xl border border-dashed border-line px-4 py-8 text-center text-body-sm text-ink-3">The latest shared reports do not contain readable test entries.</p>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-surface p-3">
                <div className="min-w-56 flex-1 space-y-1 text-label-sm text-ink-2">
                  <label htmlFor="lab-summary-metric-picker">Select a test field</label>
                  <div className="relative">
                    <input
                      id="lab-summary-metric-picker"
                      className="field w-full"
                      type="text"
                      role="combobox"
                      aria-autocomplete="list"
                      aria-expanded={pickerOpen}
                      aria-controls="lab-summary-metric-options"
                      value={metricQuery}
                      placeholder="Type a test name…"
                      onFocus={() => setPickerOpen(true)}
                      onBlur={() => window.setTimeout(() => setPickerOpen(false), 120)}
                      onChange={(event) => { setMetricQuery(event.target.value); setPickerOpen(true); }}
                      onKeyDown={handleMetricKeyDown}
                    />
                    {pickerOpen && <ul id="lab-summary-metric-options" role="listbox" className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-xl border border-line bg-surface p-1 shadow-xl">
                      {filteredMetrics.length ? filteredMetrics.map((metric) => {
                        const index = metrics.findIndex((candidate) => candidate.key === metric.key);
                        return <li key={metric.key} role="option" aria-selected={selectedMetric?.key === metric.key}>
                          <button type="button" onMouseDown={(event) => event.preventDefault()} onClick={() => selectMetric(index)} className={`w-full rounded-lg px-3 py-2 text-left text-body-sm hover:bg-subcanvas ${selectedMetric?.key === metric.key ? 'bg-subcanvas text-cypress' : 'text-ink-2'}`}>
                            {metric.name}{metric.unit ? <span className="ml-1 text-ink-3">({metric.unit})</span> : null}
                          </button>
                        </li>;
                      }) : <li className="px-3 py-2 text-body-sm text-ink-3">No matching test fields.</li>}
                    </ul>}
                  </div>
                </div>
                <div className="flex items-center gap-2 text-body-sm text-ink-3">
                  <button type="button" onClick={() => setMetricIndex((index) => Math.max(0, index - 1))} disabled={metricIndex <= 0} aria-label="Previous test field" className="rounded-lg border border-line p-2 text-ink-2 hover:bg-subcanvas disabled:opacity-40"><ChevronLeft size={18} /></button>
                  <span className="min-w-12 text-center tabular">{metricIndex + 1} / {metrics.length}</span>
                  <button type="button" onClick={() => setMetricIndex((index) => Math.min(metrics.length - 1, index + 1))} disabled={metricIndex >= metrics.length - 1} aria-label="Next test field" className="rounded-lg border border-line p-2 text-ink-2 hover:bg-subcanvas disabled:opacity-40"><ChevronRight size={18} /></button>
                </div>
              </div>

              <section className="rounded-xl border border-line bg-surface p-4">
                <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
                  <div><h3 className="font-display text-head-sm text-ink">{selectedMetric.name}</h3><p className="text-body-sm text-ink-3">One entry per shared report · up to five reports</p></div>
                  {selectedMetric.unit && <span className="rounded-full bg-subcanvas px-2.5 py-1 text-label-sm text-ink-2">{selectedMetric.unit}</span>}
                </div>
                {chartSeries.length > 0
                  ? <TrendChart key={selectedMetric.key} series={chartSeries} unit={selectedMetric.unit} />
                  : <p className="rounded-lg bg-subcanvas px-4 py-5 text-center text-body-sm text-ink-3">These results are qualitative or unreadable as numbers, so there is no numeric trend to plot.</p>}
              </section>

              <section className="overflow-hidden rounded-xl border border-line bg-surface">
                <h3 className="border-b border-line px-4 py-3 text-label-md text-ink">Report entries</h3>
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[460px] text-left text-body-sm">
                    <thead className="bg-subcanvas text-label-sm text-ink-3"><tr><th className="px-4 py-2">Report date</th><th className="px-4 py-2">Result</th><th className="px-4 py-2">Review</th></tr></thead>
                    <tbody>{selectedMetric.entries.map((entry) => <tr key={`${entry.reportId}-${entry.metricId || entry.date}`} className="border-t border-line"><td className="px-4 py-2.5 text-ink-2">{formatDate(entry.date)}</td><td className="px-4 py-2.5 tabular text-ink">{entry.value}{entry.unit ? ` ${entry.unit}` : ''}</td><td className="px-4 py-2.5">{entry.needsReview ? <span className="rounded-full bg-terracotta-surface px-2 py-0.5 text-label-sm text-terracotta">Needs review</span> : <span className="text-ink-3">—</span>}</td></tr>)}</tbody>
                  </table>
                </div>
              </section>
            </>
          )}
        </div>

        <footer className="flex shrink-0 flex-wrap items-center justify-between gap-3 border-t border-line bg-surface px-5 py-3">
          <span className="text-body-sm text-ink-3">Summaries are reference only; verify values against the report.</span>
          <Link to={`/clinician/patients/${patientId}/lab-history`} onClick={onClose} className="text-label-md text-cypress hover:underline">Open full lab history and charts →</Link>
        </footer>
        <button
          type="button"
          aria-label="Resize summary overlay"
          title="Drag to resize; use arrow keys for precise sizing"
          onPointerDown={startResize}
          onPointerMove={moveResize}
          onPointerUp={() => { resizeRef.current = null; }}
          onPointerCancel={() => { resizeRef.current = null; }}
          onKeyDown={(event) => {
            const step = event.shiftKey ? 40 : 16;
            if (!['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key)) return;
            event.preventDefault();
            setGeometry((current) => ({
              ...current,
              width: Math.max(320, Math.min(window.innerWidth - current.x - 12, current.width + (event.key === 'ArrowRight' ? step : event.key === 'ArrowLeft' ? -step : 0))),
              height: Math.max(360, Math.min(window.innerHeight - current.y - 12, current.height + (event.key === 'ArrowDown' ? step : event.key === 'ArrowUp' ? -step : 0))),
            }));
          }}
          className="absolute bottom-0 right-0 z-10 flex h-7 w-7 touch-none cursor-nwse-resize items-center justify-center rounded-tl-lg bg-subcanvas text-ink-3 hover:text-cypress"
        >
          <Grip size={15} className="rotate-[-45deg]" />
        </button>
      </section>
    </div>
  );
}

export default LabSummaryOverlay;
