import { Component, type ErrorInfo, type ReactNode } from 'react';
import { errorMessage } from '../core/errors';

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  error: unknown;
}

/** Keeps a crashing application from taking the whole desktop down. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error(`[${this.props.label ?? 'app'}] crashed`, error, info.componentStack);
  }

  render() {
    if (this.state.error === null) return this.props.children;
    return (
      <div className="crash">
        <h3>{this.props.label ?? 'Application'} has stopped working</h3>
        <p>{errorMessage(this.state.error)}</p>
        <button className="btn" onClick={() => this.setState({ error: null })}>
          Try again
        </button>
      </div>
    );
  }
}
