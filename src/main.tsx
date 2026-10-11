import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AppProvider } from './store/AppContext';
import { ErrorBoundary } from './components/ErrorBoundary';
import { initMonitoring, reportError } from './monitoring';
import './styles.css';

// Production error monitoring (Fortification Plan) — see monitoring.ts's own doc comment for
// why this is configured as narrowly as possible (no auto-instrumentation at all) given this
// app holds real staff names and a real patient hospital number. A safe no-op until
// VITE_SENTRY_DSN is actually set.
initMonitoring();

// Bug fix (resilience audit, STRUCTURAL — defense in depth): this app's own call sites are
// unusually disciplined about try/catch (see AppContext.tsx's per-action error handling), but
// there was no global safety net for the one case that discipline can't cover on its own — a
// future fire-and-forget call, or a floating .then() chain, that's added without the
// established `void`/`.catch()` convention. ErrorBoundary only catches RENDER errors, not a
// rejected promise that nothing else observes. Logs only — never surfaces a toast here, since
// an error this generic (no context on which action failed) would be more confusing than
// helpful to someone at a hospital counter; the per-call-site catches remain the real,
// specific-message user feedback path. Also reports to Sentry (safe no-op until configured).
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled promise rejection:', e.reason);
  reportError(e.reason);
});
window.addEventListener('error', (e) => {
  console.error('Unhandled error:', e.error ?? e.message);
  reportError(e.error ?? e.message);
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppProvider>
        <App />
      </AppProvider>
    </ErrorBoundary>
  </React.StrictMode>,
);
