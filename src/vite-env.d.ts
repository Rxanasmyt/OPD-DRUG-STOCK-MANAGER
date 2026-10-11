/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  // Production error monitoring (see src/monitoring.ts) — optional; unset means monitoring
  // stays a safe no-op. Set via a build-time env var, never committed to the repo.
  readonly VITE_SENTRY_DSN?: string;
}
