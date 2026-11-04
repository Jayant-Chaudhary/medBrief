import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toast, setToast] = useState(null);

  // Stable across renders: pages list showToast in effect dependencies, and a
  // new function per toast would re-run (and re-fetch in) those effects.
  // Supports both showToast(message, type) and showToast({ message, type }).
  const showToast = useCallback((messageOrPayload, explicitType = 'success') => {
    let message = messageOrPayload;
    let type = explicitType;
    if (typeof messageOrPayload === 'object' && messageOrPayload !== null) {
      message = messageOrPayload.message || messageOrPayload.text || '';
      type = messageOrPayload.type || explicitType;
    }
    setToast({ message: String(message ?? ''), type, id: Date.now() });
  }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const value = useMemo(() => ({ showToast }), [showToast]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      {toast && (
        <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-50 pointer-events-none">
          <div
            className={`px-6 py-3 rounded-control shadow-card text-sm font-medium animate-in fade-in slide-in-from-bottom-4 ${
              toast.type === 'error'
                ? 'bg-rose-700 text-white'
                : toast.type === 'info'
                ? 'bg-slate-800 text-white'
                : 'bg-ink text-white'
            }`}
          >
            {typeof toast.message === 'string' ? toast.message : String(toast.message)}
          </div>
        </div>
      )}
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
