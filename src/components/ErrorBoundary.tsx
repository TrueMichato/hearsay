import { Component, type ErrorInfo, type ReactNode } from 'react';

/**
 * Catches render-time crashes.
 *
 * Without this, a thrown error unmounts the whole React tree and the player is
 * left looking at a blank page with no clue that anything failed. That is
 * exactly how a read-only-transaction bug hid during development, so the
 * boundary earns its keep as a diagnostic as well as a courtesy.
 *
 * It must be a class: there is still no hook equivalent of componentDidCatch.
 */
export class ErrorBoundary extends Component<
  { children: ReactNode },
  { error: Error | null }
> {
  state: { error: Error | null } = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Unhandled error in render tree', error, info.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div role="alert" className="mx-auto max-w-md space-y-3 p-6 text-center">
        <h1 className="text-lg font-bold">Something broke</h1>
        <p className="text-sm text-slate-300">
          The round could not be shown. Your saved progress is untouched.
        </p>
        <pre className="overflow-x-auto rounded-lg bg-slate-800 p-3 text-left text-[11px] text-rose-300">
          {this.state.error.message}
        </pre>
        <button
          type="button"
          onClick={() => {
            window.location.hash = '/';
            this.setState({ error: null });
          }}
          className="rounded-xl bg-sky-500 px-4 py-2 text-sm font-bold text-slate-900"
        >
          Back to the start
        </button>
      </div>
    );
  }
}
