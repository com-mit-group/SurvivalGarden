import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App, { RecoveryScreen } from './App';
import './index.css';

type AppErrorBoundaryProps = {
  children: React.ReactNode;
};

type AppErrorBoundaryState = {
  error: unknown | null;
  retryKey: number;
};

class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = {
    error: null,
    retryKey: 0,
  };

  static getDerivedStateFromError(error: unknown): Pick<AppErrorBoundaryState, 'error'> {
    return { error };
  }

  handleRetry = () => {
    this.setState((current) => ({ error: null, retryKey: current.retryKey + 1 }));
  };

  render() {
    if (this.state.error) {
      return <RecoveryScreen error={this.state.error} onRetry={this.handleRetry} />;
    }

    return <React.Fragment key={this.state.retryKey}>{this.props.children}</React.Fragment>;
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <AppErrorBoundary>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </AppErrorBoundary>
  </React.StrictMode>
);
