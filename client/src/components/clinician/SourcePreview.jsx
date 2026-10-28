import { useEffect, useRef, useState } from 'react';
import { ExternalLink, FileText } from 'lucide-react';
import { Modal } from '../ui/Modal.jsx';
import { cropForRow, highlightInCrop } from '../../utils/sourceCrop.js';

/** Rendered width of a PDF page, in pixels; enough to read small print when cropped. */
const PDF_RENDER_WIDTH = 1600;
/** Width of the whole-page thumbnail beside the clipping, in CSS pixels. */
const THUMB_WIDTH = 96;

/**
 * A torn paper edge along the top or bottom of the clipping. Filled with the
 * dialog's own background so it reads as the page being cut, whatever the theme.
 */
function TornEdge({ side }) {
  const teeth = 40;
  const points = Array.from({ length: teeth + 1 }, (_, i) => `${(i * 100) / teeth},${i % 2 ? 0 : 6}`).join(' ');
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 100 6"
      preserveAspectRatio="none"
      className={`pointer-events-none absolute left-0 h-2 w-full text-raised ${side === 'top' ? 'top-0' : 'bottom-0 rotate-180'}`}
    >
      <polygon points={`0,0 ${points} 100,0`} fill="currentColor" />
    </svg>
  );
}

// One download per report per session: a doctor checks several values from
// the same file, and signed URLs stay valid for 10 minutes.
const pdfCache = new Map();

async function loadPdf(url) {
  if (!pdfCache.has(url)) {
    pdfCache.set(
      url,
      (async () => {
        // Loaded on first use only, so the dashboard bundle doesn't carry it.
        const pdfjs = await import('pdfjs-dist');
        const { default: workerUrl } = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
        pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
        return pdfjs.getDocument({ url }).promise;
      })().catch((err) => {
        pdfCache.delete(url);
        throw err;
      })
    );
  }
  return pdfCache.get(url);
}

/** The full page as a drawable source (canvas or image) with its pixel size. */
async function loadPage({ url, fileKind, page }) {
  if (fileKind === 'pdf') {
    const doc = await loadPdf(url);
    const pdfPage = await doc.getPage(page);
    const base = pdfPage.getViewport({ scale: 1 });
    const viewport = pdfPage.getViewport({ scale: PDF_RENDER_WIDTH / base.width });
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(viewport.width);
    canvas.height = Math.round(viewport.height);
    await pdfPage.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    return { source: canvas, width: canvas.width, height: canvas.height };
  }
  const image = new Image();
  image.src = url;
  await image.decode();
  return { source: image, width: image.naturalWidth, height: image.naturalHeight };
}

/**
 * The line of the original report a value was read from, with the value
 * outlined. For a value that needs review, the correction box sits right
 * under it, so checking and fixing happen in one place.
 *
 * `item` needs: name, value, printed, scanUrl, fileKind, sourcePage,
 * sourceBox, and for review: needsReview, reason.
 */
export function SourcePreview({ item, onClose, onResolve }) {
  const canvasRef = useRef(null);
  const thumbRef = useRef(null);
  const [status, setStatus] = useState('loading'); // loading | ready | missing | error
  const [highlight, setHighlight] = useState(null);
  const [cropArea, setCropArea] = useState(null);

  const located = Boolean(item?.sourceBox?.row && item?.sourcePage && item?.scanUrl && item?.fileKind);

  useEffect(() => {
    if (!item) return undefined;
    if (!located) {
      setStatus('missing');
      return undefined;
    }
    let cancelled = false;
    setStatus('loading');
    loadPage({ url: item.scanUrl, fileKind: item.fileKind, page: item.sourcePage })
      .then(({ source, width, height }) => {
        if (cancelled || !canvasRef.current) return;
        const crop = cropForRow(item.sourceBox.row);
        const sx = crop.x * width;
        const sy = crop.y * height;
        const sw = crop.w * width;
        const sh = crop.h * height;
        const canvas = canvasRef.current;
        canvas.width = Math.round(sw);
        canvas.height = Math.round(sh);
        canvas.getContext('2d').drawImage(source, sx, sy, sw, sh, 0, 0, canvas.width, canvas.height);
        // The whole page, small, so the clipping is visibly part of it.
        const thumb = thumbRef.current;
        if (thumb) {
          const scale = (THUMB_WIDTH * 2) / width;
          thumb.width = Math.round(width * scale);
          thumb.height = Math.round(height * scale);
          thumb.getContext('2d').drawImage(source, 0, 0, thumb.width, thumb.height);
        }
        setCropArea(crop);
        setHighlight(highlightInCrop(item.sourceBox.value, crop));
        setStatus('ready');
      })
      .catch(() => !cancelled && setStatus('error'));
    return () => {
      cancelled = true;
    };
  }, [item, located]);

  if (!item) return null;

  return (
    <Modal isOpen={Boolean(item)} onClose={onClose} title={`${item.name} — on the report`} className="max-w-3xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2 text-body-sm text-ink-2">
          <span>
            Read as <span className="font-semibold text-ink">{item.value ?? '—'}</span>
            {item.printed && item.printed !== String(item.value) && (
              <span className="text-ink-3"> · printed “{item.printed}”</span>
            )}
          </span>
          {located && <span className="text-ink-3">Page {item.sourcePage}</span>}
        </div>

        {located && status !== 'missing' && (
          <div className="flex items-start gap-3">
            <figure className="min-w-0 flex-1">
              <figcaption className="mb-1.5 flex items-center gap-1.5 text-label-sm uppercase text-ink-3">
                <FileText className="h-3.5 w-3.5" aria-hidden="true" />
                Clipped from the original report · page {item.sourcePage}
              </figcaption>
              {/* The report's own pixels (PDF page or photo), cut out; only the outline is ours. */}
              <div className="relative overflow-hidden bg-white shadow-[0_2px_10px_rgba(0,0,0,0.18)]">
                <canvas
                  ref={canvasRef}
                  className={`block h-auto w-full ${status === 'ready' ? '' : 'invisible h-40'}`}
                  aria-label={`Part of page ${item.sourcePage} of the original report, showing ${item.name}`}
                  role="img"
                />
                {status === 'ready' && highlight && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute rounded-sm border-2 border-terracotta"
                    style={{
                      left: `${highlight.left * 100}%`,
                      top: `${highlight.top * 100}%`,
                      width: `${highlight.width * 100}%`,
                      height: `${highlight.height * 100}%`,
                    }}
                  />
                )}
                {status === 'ready' && (
                  <>
                    <TornEdge side="top" />
                    <TornEdge side="bottom" />
                  </>
                )}
                {status === 'loading' && (
                  <p className="absolute inset-0 flex items-center justify-center text-body-sm text-ink-3">
                    Loading the report…
                  </p>
                )}
              </div>
            </figure>

            {/* Where the clipping sits on the whole page. */}
            <div className={`hidden shrink-0 sm:block ${status === 'ready' ? '' : 'invisible'}`} style={{ width: THUMB_WIDTH }}>
              <p className="mb-1.5 text-label-sm uppercase text-ink-3">Page {item.sourcePage}</p>
              <div className="relative bg-white shadow-[0_1px_4px_rgba(0,0,0,0.2)]">
                <canvas ref={thumbRef} className="block h-auto w-full" aria-hidden="true" />
                {cropArea && (
                  <span
                    aria-hidden="true"
                    className="pointer-events-none absolute left-0 w-full border-2 border-terracotta bg-terracotta/15"
                    style={{ top: `${cropArea.y * 100}%`, height: `${cropArea.h * 100}%` }}
                  />
                )}
              </div>
            </div>
          </div>
        )}

        {status === 'missing' && (
          <p className="rounded-xl bg-subcanvas p-4 text-body-md text-ink-2">
            The location of this value wasn’t recorded — the report was uploaded before this feature. Open the full
            report to check it, or re-upload the report to record locations.
          </p>
        )}
        {status === 'error' && (
          <p className="rounded-xl bg-terracotta-surface p-4 text-body-md text-terracotta-deep">
            Couldn’t load the report page. The link may have expired — reload the dashboard, or open the full report.
          </p>
        )}

        {item.needsReview && onResolve && <ReviewForm item={item} onResolve={onResolve} onDone={onClose} />}

        <div className="flex justify-end">
          {item.scanUrl && (
            <a
              href={item.scanUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-xl border border-line px-4 py-2 text-label-lg text-cypress hover:bg-subcanvas"
            >
              <ExternalLink className="h-4 w-4" /> Open full report
            </a>
          )}
        </div>
      </div>
    </Modal>
  );
}

function ReviewForm({ item, onResolve, onDone }) {
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function submit(event) {
    event.preventDefault();
    if (!value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onResolve(value.trim());
      onDone();
    } catch (err) {
      setError(err.message || 'Could not save that value.');
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="rounded-xl border border-terracotta-border bg-terracotta-surface p-3">
      <p className="mb-2 text-body-sm text-terracotta-deep">{item.reason || 'This value needs review.'}</p>
      <div className="flex items-center gap-2">
        <label className="sr-only" htmlFor="source-correction">
          Correct value for {item.name}
        </label>
        <input
          id="source-correction"
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Enter the value shown above"
          inputMode="decimal"
          className="field h-10 flex-1"
          autoFocus
        />
        <button
          type="submit"
          disabled={saving || !value.trim()}
          className="rounded-xl bg-cypress px-4 py-2 text-label-lg text-white hover:bg-cypress-deep disabled:opacity-50"
        >
          {saving ? 'Saving…' : 'Save correction'}
        </button>
      </div>
      {error && <p className="mt-1.5 text-body-sm text-terracotta">{error}</p>}
    </form>
  );
}

export default SourcePreview;
