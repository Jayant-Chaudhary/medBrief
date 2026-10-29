import { useRef, useState } from 'react';
import { SectionCard } from '../common/SectionCard.jsx';
import { Icon } from '../common/Icon.jsx';
import { Button } from '../common/Button.jsx';
import { formatDate } from '../../utils/format.js';

/**
 * Prescriptions for this visit. A dropped or chosen file is held until the
 * clinician saves it, together with any typed instructions; saved ones are
 * listed with a link, and the patient sees them in their visit summary.
 */
export function PrescriptionUpload({ prescriptions = [], onUpload, children }) {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [instructions, setInstructions] = useState('');
  const [dragging, setDragging] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  async function save() {
    if (!file) return;
    setSaving(true);
    setError(null);
    try {
      await onUpload?.(file, instructions.trim());
      setFile(null);
      setInstructions('');
      if (inputRef.current) inputRef.current.value = '';
    } catch (err) {
      setError(err.message || 'Could not save the prescription.');
    } finally {
      setSaving(false);
    }
  }

  const attachments = (
    <>
      {prescriptions.length > 0 && (
        <ul className="mb-3 space-y-2">
          {prescriptions.map((prescription) => (
            <li key={prescription.id} className="rounded-xl border border-line bg-subcanvas px-3 py-2 text-body-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="text-ink-2">Saved {formatDate(prescription.created_at)}</span>
                {prescription.signed_url && (
                  <a
                    href={prescription.signed_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-label-md text-cypress hover:underline"
                  >
                    View
                  </a>
                )}
              </div>
              {prescription.typed_instructions && (
                <p className="mt-1 whitespace-pre-wrap text-ink">{prescription.typed_instructions}</p>
              )}
            </li>
          ))}
        </ul>
      )}

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          event.preventDefault();
          setDragging(false);
          setFile(event.dataTransfer.files?.[0] ?? null);
        }}
        className={`flex flex-col items-center gap-2 rounded-xl border border-dashed p-5 text-center transition-colors
                    ${dragging ? 'border-cypress bg-subcanvas' : 'border-line-strong bg-subcanvas/60'}`}
      >
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-surface text-ink-2">
          <Icon name="upload" size={18} />
        </span>

        {file ? (
          <p className="text-body-sm text-ink">
            <span className="font-medium">{file.name}</span>
            <span className="block text-ink-3">{(file.size / 1024).toFixed(0)} KB — not saved yet</span>
          </p>
        ) : (
          <p className="text-body-sm text-ink-3">Drop the prescription image or PDF here, or</p>
        )}

        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="rounded-xl border border-line bg-surface px-3 py-1.5 text-label-md text-cypress hover:bg-subcanvas"
        >
          {file ? 'Replace file' : 'Browse files'}
        </button>

        <input
          ref={inputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp,application/pdf"
          className="sr-only"
          onChange={(event) => setFile(event.target.files?.[0] ?? null)}
        />
      </div>

      {file && (
        <div className="mt-3 space-y-2">
          <textarea
            value={instructions}
            onChange={(event) => setInstructions(event.target.value)}
            rows={3}
            placeholder="Instructions for the patient (optional)"
            className="field w-full resize-y py-2"
          />
          <Button type="button" onClick={save} disabled={saving} className="w-full">
            {saving ? 'Saving…' : 'Save prescription'}
          </Button>
        </div>
      )}

      {error && <p className="mt-2 text-body-sm text-terracotta">{error}</p>}
    </>
  );

  return (
    <SectionCard icon="upload" title="Prescription" subtitle={children ? "Prepare the prescription during this consultation" : "Shared with the patient after the visit"} bodyClassName="p-4">
      {children}
      {children ? (
        <details className="mt-5 border-t border-line pt-3">
          <summary className="cursor-pointer text-body-sm text-ink-2">
            Prescription files {prescriptions.length > 0 ? `(${prescriptions.length} saved)` : '(optional)'}
          </summary>
          <div className="mt-3">
            <p className="mb-3 text-body-sm text-ink-3">Upload a finalized image or PDF to share with the patient.</p>
            {attachments}
          </div>
        </details>
      ) : attachments}
    </SectionCard>
  );
}

export default PrescriptionUpload;
