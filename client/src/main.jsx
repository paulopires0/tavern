import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// A render error used to unmount the whole app into a black page; now it
// shows what broke and offers a reload.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <div className="crash-screen">
          <h1>Something broke</h1>
          <p className="muted">The view crashed while drawing. Reloading usually fixes it — if it keeps happening, tell your DM (or the DM tells the developer) what you clicked, along with this message:</p>
          <pre>{String(this.state.error?.stack || this.state.error)}</pre>
          <button onClick={() => window.location.reload()}>Reload</button>
        </div>
      );
    }
    return this.props.children;
  }
}

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
