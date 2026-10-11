// Regression test for the Fortification Plan's monitoring module: initMonitoring()/reportError()
// must stay a safe no-op whenever VITE_SENTRY_DSN isn't set (the default — see monitoring.ts's
// own doc comment) or outside a production build, and must never throw regardless, since every
// call site (main.tsx's global handlers, ErrorBoundary.componentDidCatch) calls these
// unconditionally and can't itself be wrapped in another try/catch without defeating the point.
import { describe, it, expect } from 'vitest';
import { initMonitoring, reportError, setMonitoringUser } from './monitoring';

describe('monitoring — safe no-op without a configured DSN', () => {
  it('initMonitoring() does not throw when VITE_SENTRY_DSN is unset (the test/dev default)', () => {
    expect(() => initMonitoring()).not.toThrow();
  });

  it('reportError() does not throw even though Sentry was never initialized', () => {
    expect(() => reportError(new Error('test error'))).not.toThrow();
    expect(() => reportError(new Error('test error'), { extra: 'context' })).not.toThrow();
  });

  it('setMonitoringUser() does not throw for both a signed-in and a signed-out call', () => {
    expect(() => setMonitoringUser('u1', 'pharm')).not.toThrow();
    expect(() => setMonitoringUser(null, null)).not.toThrow();
  });
});
