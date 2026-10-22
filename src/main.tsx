import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { CommunityProvider } from './lib/community';
import './styles.css';

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    if (this.state.error)
      return (
        <main style={{ maxWidth: 600, margin: '12vh auto', padding: 32, fontFamily: 'system-ui' }}>
          <h1>Let’s get you reconnected.</h1>
          <p>{this.state.error}</p>
          <button onClick={() => window.location.reload()}>Try again</button>
        </main>
      );
    return this.props.children;
  }
}
ReactDOM.createRoot(document.getElementById('root')!).render(
  <ErrorBoundary>
    <React.StrictMode>
      <CommunityProvider>
        <App />
      </CommunityProvider>
    </React.StrictMode>
  </ErrorBoundary>,
);
