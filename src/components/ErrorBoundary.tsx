import { Component, type ReactNode } from 'react';

// This app's screens are code-split (see the lazy() imports in App.tsx) and gets redeployed
// often — every hashed chunk filename changes on each deploy, and the service worker prunes
// old ones (cleanupOutdatedCaches). A ward device that's had the app open since before the
// last deploy will 404 the moment someone navigates to a screen whose chunk changed, which
// throws here as an ordinary render error — not a bug in the screen, just a stale tab. Reload
// once automatically to pick up the new build instead of showing a scary error for something
// a plain refresh fixes; a session-storage guard stops a genuinely broken deploy from
// reload-looping forever.
const CHUNK_ERROR_RE = /dynamically imported module|Importing a module script failed|Loading chunk|Failed to fetch/i;
const RELOAD_GUARD_KEY = 'opd-chunk-reload-ts';

/**
 * Last-resort catch for an uncaught render error. Without this, any unexpected exception
 * (e.g. a malformed doc from a manual Firestore console edit) white-screens the whole app
 * for whoever's at the counter — this shows a recoverable message instead.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Uncaught render error:', error, info.componentStack);
    if (CHUNK_ERROR_RE.test(error.message)) {
      let lastReload = 0;
      try { lastReload = Number(sessionStorage.getItem(RELOAD_GUARD_KEY)) || 0; } catch { /* ignore */ }
      // Only auto-reload if we haven't just tried this — a fresh page load hitting the same
      // error means the new build itself is broken, not a stale-tab mismatch, and needs the
      // visible fallback + manual reload instead of silently looping.
      if (Date.now() - lastReload > 15000) {
        try { sessionStorage.setItem(RELOAD_GUARD_KEY, String(Date.now())); } catch { /* ignore */ }
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', background: 'var(--bg-app, #f7f6f2)', color: 'var(--ink, #1a2b20)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>เกิดข้อผิดพลาดที่ไม่คาดคิด</div>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 18, maxWidth: 320, lineHeight: 1.6 }}>ข้อมูลสต็อกยังปลอดภัย ไม่ถูกกระทบ — ลองโหลดหน้าใหม่อีกครั้ง ถ้ายังเกิดซ้ำให้แจ้งผู้ดูแลระบบ</div>
          <button
            onClick={() => window.location.reload()}
            style={{ border: 0, background: 'var(--green, #17552f)', color: '#fff', padding: '13px 22px', borderRadius: 11, fontSize: 14.5, fontWeight: 600, minHeight: 48 }}
          >
            โหลดหน้าใหม่
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
