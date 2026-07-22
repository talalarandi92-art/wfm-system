/**
 * ERROR BOUNDARY — one broken page must never blank the whole platform.
 *
 * Why this exists: the Capacity page rendered an API object straight into JSX
 * (React #31). React unmounted the ENTIRE tree, so the app went white a second
 * after load — no message, no navigation, nothing to act on. With no boundary
 * anywhere in the app, every page carried that same single point of failure.
 *
 * What it does: catches a render/lifecycle crash below it, keeps the rest of the
 * shell alive, and says plainly WHAT broke and WHERE — the real error message,
 * not a shrug. Retry re-mounts the subtree; if the data is still bad it will
 * fail again honestly rather than pretending.
 */
import { Component, type ErrorInfo, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
  /** Shown in the card so the user knows which surface failed. */
  label?: string;
  ar?: boolean;
}
interface State { error: Error | null; info: string | null; key: number }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null, info: null, key: 0 };

  static getDerivedStateFromError(error: Error): Partial<State> {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // Keep the stack in the console for diagnosis — the card stays readable.
    console.error('[ErrorBoundary]', this.props.label ?? 'page', error, info.componentStack);
    this.setState({ info: info.componentStack ?? null });
  }

  private retry = () => this.setState((s) => ({ error: null, info: null, key: s.key + 1 }));

  render() {
    const { error } = this.state;
    const ar = !!this.props.ar;
    if (!error) return <div key={this.state.key}>{this.props.children}</div>;

    return (
      <div className="rounded-2xl p-5 m-4" dir={ar ? 'rtl' : 'ltr'}
        style={{ background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.25)' }}>
        <p className="text-sm font-bold mb-1" style={{ color: '#f87171' }}>
          {ar ? 'تعذّر عرض هذه الصفحة' : 'This page could not be rendered'}
          {this.props.label ? ` — ${this.props.label}` : ''}
        </p>
        <p className="text-xs mb-3" style={{ color: 'var(--text-2)' }}>
          {ar
            ? 'باقي النظام يعمل. الخطأ الحقيقي مكتوب أدناه — وهو ليس تحذيرًا عامًا.'
            : 'The rest of the platform still works. The actual error is below — this is not a generic warning.'}
        </p>
        <pre className="text-[11px] overflow-x-auto rounded-lg p-2.5 mb-3"
          style={{ background: 'var(--surface-2)', color: 'var(--text-2)', whiteSpace: 'pre-wrap' }}>
          {error.message || String(error)}
        </pre>
        <div className="flex gap-2">
          <button onClick={this.retry}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', cursor: 'pointer' }}>
            {ar ? 'إعادة المحاولة' : 'Retry'}
          </button>
          <button onClick={() => window.location.reload()}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg"
            style={{ background: 'var(--surface-2)', color: 'var(--text-2)', border: '1px solid var(--border)', cursor: 'pointer' }}>
            {ar ? 'تحديث الصفحة' : 'Reload'}
          </button>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
