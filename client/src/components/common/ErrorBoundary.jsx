import React from 'react';

/**
 * Catches unhandled render errors in child components and displays
 * a graceful recovery UI instead of an unhandled blank white screen.
 */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Unhandled React render error caught by ErrorBoundary:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex min-h-screen w-full items-center justify-center bg-canvas p-6">
          <div className="max-w-md rounded-2xl border border-line bg-surface p-6 text-center shadow-lg">
            <h2 className="font-display text-head-sm text-terracotta">Something went wrong</h2>
            <p className="mt-2 text-body-sm text-ink-2">
              An unexpected render issue occurred. You can reload the view to continue.
            </p>
            {this.state.error?.message && (
              <p className="mt-3 rounded-lg border border-line bg-canvas p-2.5 text-left text-xs font-mono text-terracotta break-words">
                {this.state.error.message}
              </p>
            )}
            {this.state.error?.stack && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-lg border border-line bg-canvas p-2 text-left text-[11px] font-mono text-ink-soft select-all">
                {this.state.error.stack}
              </pre>
            )}
            <div className="mt-5 flex justify-center gap-3">
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem('assistant_dock_pos');
                  } catch (_) {}
                  this.setState({ hasError: false, error: null });
                }}
                className="rounded-xl border border-line bg-subcanvas px-4 py-2 text-label-sm font-medium text-ink hover:bg-subcanvas/80"
              >
                Try Again
              </button>
              <button
                type="button"
                onClick={() => {
                  try {
                    localStorage.removeItem('assistant_dock_pos');
                  } catch (_) {}
                  window.location.reload();
                }}
                className="rounded-xl bg-cypress px-4 py-2 text-label-sm font-medium text-white hover:bg-cypress-deep"
              >
                Reload Page
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

export default ErrorBoundary;

