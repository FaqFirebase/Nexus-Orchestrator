import { Component, type ReactNode } from 'react';
import { AlertTriangle } from 'lucide-react';

interface Props {
  children: ReactNode;
  label?: string;
}

interface State {
  hasError: boolean;
  message: string;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, message: '' };

  static getDerivedStateFromError(err: Error): State {
    return { hasError: true, message: err.message };
  }

  componentDidCatch(err: Error, info: { componentStack: string }) {
    console.error(`[ErrorBoundary:${this.props.label ?? 'unknown'}]`, err, info.componentStack);
  }

  reset = () => this.setState({ hasError: false, message: '' });

  render() {
    if (!this.state.hasError) return this.props.children;
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 p-8 text-center">
        <AlertTriangle className="w-8 h-8 text-amber-400" />
        <div>
          <p className="text-sm font-semibold text-zinc-300">
            {this.props.label ?? 'This section'} encountered an error
          </p>
          <p className="text-xs text-zinc-600 mt-1 font-mono max-w-sm">{this.state.message}</p>
        </div>
        <button
          onClick={this.reset}
          className="px-4 py-1.5 text-xs bg-zinc-800 border border-zinc-700 rounded-lg hover:border-zinc-500 transition-colors"
        >
          Try again
        </button>
      </div>
    );
  }
}
