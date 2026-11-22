import { Component, type ErrorInfo, type ReactNode } from 'react';

interface State {
  error: Error | null;
}

/**
 * Last-resort boundary for errors outside the router (providers, bootstrapping).
 * Route-level errors are handled by RouteErrorPage. Deliberately dependency-free.
 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: ErrorInfo) {
    if (import.meta.env.DEV)
      console.error('Unhandled application error', error, info.componentStack);
  }

  override render() {
    if (!this.state.error) return this.props.children;
    return (
      <div
        role="alert"
        style={{
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          padding: 24,
          fontFamily: 'system-ui, sans-serif',
          background: '#F8F6F1',
          color: '#222725',
        }}
      >
        <div style={{ maxWidth: 420, textAlign: 'center' }}>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>STAYSCAPE ran into a problem</h1>
          <p style={{ color: '#545B58', marginBottom: 24 }}>
            Please reload the page. If this keeps happening, try again in a few minutes.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              background: '#173D35',
              color: '#fff',
              border: 0,
              borderRadius: 999,
              padding: '12px 24px',
              fontSize: 15,
              cursor: 'pointer',
            }}
          >
            Reload
          </button>
        </div>
      </div>
    );
  }
}
