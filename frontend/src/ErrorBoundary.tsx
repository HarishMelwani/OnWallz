import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { error: Error | null };

/**
 * A blank page tells the developer nothing. This turns a render crash into a
 * readable message the user can report verbatim.
 */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("[onwallz] render crashed:", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="empty" style={{ padding: 32 }}>
        <span className="glyph">◌</span>
        <h2>OnWallz hit a render error</h2>
        <p className="muted">This is a bug, not a network problem.</p>
        <pre
          className="mono"
          style={{ whiteSpace: "pre-wrap", fontSize: 12, textAlign: "left", maxWidth: 720 }}
        >
          {error.message}
          {"\n\n"}
          {error.stack ?? ""}
        </pre>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          try again
        </button>
      </div>
    );
  }
}
