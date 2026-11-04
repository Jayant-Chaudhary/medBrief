import { useEffect, useRef } from 'react';
import { X } from 'lucide-react';

/**
 * A panel that slides in from the right edge over the page.
 *
 * It stays mounted while closed (moved off-screen and made inert) rather than
 * unmounting, so anything inside keeps its state — in particular a notes
 * autosave that is still in flight when the panel is closed.
 *
 * Closes on Escape, a backdrop click or the close button. Focus moves into
 * the panel on open and back to whatever opened it on close.
 */
export function SlideOver({ open, onClose, title, subtitle, children }) {
  const panelRef = useRef(null);
  const returnFocusRef = useRef(null);

  // React 18 has no `inert` prop; set it directly so a closed panel's
  // controls can't be tabbed into or read out.
  useEffect(() => {
    if (panelRef.current) panelRef.current.inert = !open;
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;

    returnFocusRef.current = document.activeElement;
    panelRef.current?.focus();

    const onKey = (event) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      returnFocusRef.current?.focus?.();
    };
  }, [open, onClose]);

  return (
    <div className={`fixed inset-0 z-50 ${open ? '' : 'pointer-events-none'}`} aria-hidden={!open}>
      <div
        className={`absolute inset-0 bg-slate-900/20 backdrop-blur-[2px] transition-opacity duration-300 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
      />

      <aside
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className={`absolute inset-y-0 right-0 flex w-full max-w-[540px] xl:max-w-[620px] flex-col bg-white border-l border-slate-200 shadow-2xl outline-none
                    transition-transform duration-300 ease-out ${open ? 'translate-x-0' : 'translate-x-full'}`}
      >
        <header className="flex items-start justify-between gap-3 border-b border-emerald-100 bg-gradient-to-r from-emerald-50/50 via-white to-slate-50 px-6 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-head-sm font-bold text-ink">{title}</h2>
            {subtitle && <p className="mt-0.5 text-body-sm text-slate-500">{subtitle}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close panel"
            className="-mr-1 rounded-full p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </header>

        <div className="scroll-column min-h-0 flex-1 space-y-4 p-5 bg-slate-50/40">{children}</div>
      </aside>
    </div>
  );
}

export default SlideOver;
