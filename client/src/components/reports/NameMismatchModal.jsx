import { AlertTriangle } from 'lucide-react';
import { Modal } from '../ui/Modal';
import { Button } from '../ui/Button';

/**
 * Asks before keeping a report printed with a name other than the account's,
 * or one where no name could be read. Nothing has been saved at this point, so
 * cancelling leaves no trace of it.
 */
export default function NameMismatchModal({ mismatch, onCancel, onProceed }) {
  if (!mismatch) return null;
  const nameRead = Boolean(mismatch.nameOnReport);

  return (
    <Modal isOpen onClose={onCancel} title="Is this report yours?">
      <div className="space-y-4">
        <p className="flex items-start gap-2 rounded-lg bg-attention-light p-3 text-sm text-ink">
          <AlertTriangle size={16} className="mt-0.5 shrink-0 text-attention" />
          {nameRead
            ? 'The name on this report is different from the name on your account.'
            : 'We could not read a patient name on this report, so we cannot check that it is yours.'}
        </p>

        <dl className="space-y-2 text-sm">
          {nameRead && (
            <div className="flex flex-wrap justify-between gap-x-4">
              <dt className="text-ink-soft">Name on the report</dt>
              <dd className="font-medium text-ink break-words">{mismatch.nameOnReport}</dd>
            </div>
          )}
          <div className="flex flex-wrap justify-between gap-x-4">
            <dt className="text-ink-soft">Name on your account</dt>
            <dd className="font-medium text-ink break-words">{mismatch.nameOnAccount}</dd>
          </div>
        </dl>

        <p className="text-sm text-ink-soft">
          {nameRead
            ? 'If you continue, its values are added to your record and your doctor may see them. Continue only if this report is yours, for example if it uses a different spelling or a previous name.'
            : 'If you continue, its values are added to your record and your doctor may see them. Continue only if this report is yours. A clearer, upright photo can help us read the name.'}
        </p>

        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button variant="secondary" onClick={onCancel} autoFocus>
            Cancel upload
          </Button>
          <Button onClick={onProceed} className="sm:w-auto">
            Upload anyway
          </Button>
        </div>
      </div>
    </Modal>
  );
}
