import * as Sentry from '@sentry/react';
// Same "?raw" VERSION import AppContext.tsx/LoginScreen.tsx/MoreScreen.tsx already use.
import versionRaw from '../VERSION?raw';

const APP_VERSION = versionRaw.trim();

// Production error monitoring (Fortification Plan — Monitoring domain). Off by default: a
// missing VITE_SENTRY_DSN (nothing configured yet) or a dev build is a silent no-op, never an
// error — every call in this module is safe to make unconditionally from main.tsx even before
// anyone sets up a Sentry project.
//
// PII/PHI posture — this app holds real staff names (User.name) and a real patient hospital
// number (DrugReturnRecord.hn), so this is deliberately configured as narrowly as possible
// rather than "default settings + scrub afterward":
//   - `integrations: []` disables EVERY default Sentry integration — no automatic console-
//     breadcrumb capture, no automatic fetch/XHR breadcrumb capture (which could otherwise
//     surface a Firestore query's own request/response body), no session replay, no browser
//     tracing. Sentry receives ONLY what this app explicitly sends via reportError() below —
//     nothing is auto-instrumented. That is the actual PII control here, not a regex scrubber
//     run after the fact (which would give false confidence against data it didn't anticipate).
//   - Sentry.setUser() below is called with only the Firebase uid, never name/username/email.
//   - No app state (cart contents, search text, form fields) is ever attached as Sentry
//     context from this file or from any call site — only the error itself, the component
//     stack (render errors) and the role tag (operationally useful, not personal data).
//   - tracesSampleRate: 0 — this is a low-traffic internal hospital tool; error capture is the
//     goal, not performance tracing, so no transaction data is collected at all.
export function initMonitoring(): void {
  const dsn = import.meta.env.VITE_SENTRY_DSN;
  if (!import.meta.env.PROD || !dsn) return;
  Sentry.init({
    dsn,
    environment: import.meta.env.MODE,
    release: APP_VERSION,
    integrations: [],
    tracesSampleRate: 0,
  });
}

/** Safe to call even when initMonitoring() was never run or never configured — Sentry's SDK
 * no-ops on every call below until init() has actually run with a real DSN. */
export function reportError(error: unknown, extra?: Record<string, unknown>): void {
  Sentry.captureException(error, extra ? { extra } : undefined);
}

/** Called once the real auth/profile state is known (AppContext.tsx's auth effect) — uid only,
 * see this module's own PII note above for why name/username/email are never passed here. */
export function setMonitoringUser(uid: string | null, role: string | null): void {
  Sentry.setUser(uid ? { id: uid } : null);
  Sentry.setTag('role', role ?? 'none');
}
