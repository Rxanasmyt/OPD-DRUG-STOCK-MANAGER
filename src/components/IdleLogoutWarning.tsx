import { useChrome } from '../store/AppContext';

/**
 * Real-world request: "ตอนนี้ถ้า login นานทิ้งไว้ จะไม่ logout ออกให้อัตโนมัติเลย ซึ่งอันตราย
 * สำหรับข้อมูลยา" — shown for exactly the last minute before the idle-timeout auto-logout in
 * AppContext.tsx actually fires (see state.idleWarnVisible's own doc comment in types.ts).
 * A full-screen modal rather than a small dismissible corner banner like UpdateBanner.tsx on
 * purpose: by the time this shows, nobody has touched the screen in a while, so whoever walks
 * back up to it needs to notice this immediately, not glance past a small strip at the edge.
 * Tapping anywhere — not just "ยังอยู่" — counts as "still here" and dismisses it; the backdrop
 * tap matches ConfirmDialog.tsx's own convention of not being stricter than it needs to be.
 */
export default function IdleLogoutWarning() {
  // Bug fix (audit finding — performance): reads the narrower chrome-only context instead of
  // useApp() — see ChromeCtx's own doc comment in AppContext.tsx for why.
  const { idleWarnVisible, qrOpen, dismissIdleWarning } = useChrome();
  // Same guard as UpdateBanner — never cover the full-screen QR scanner.
  if (!idleWarnVisible || qrOpen) return null;

  return (
    <div
      style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,.6)', zIndex: 45,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        animation: 'backdropIn .18s var(--ease-out)',
      }}
      onClick={dismissIdleWarning}
    >
      <div
        className="card"
        role="alertdialog"
        aria-modal="true"
        aria-describedby="idle-logout-message"
        style={{ width: '100%', maxWidth: 380, padding: 20, textAlign: 'center', animation: 'pop .2s var(--ease-out) both' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ fontSize: 30, marginBottom: 8 }}>⏱️</div>
        <div style={{ fontSize: 15, fontWeight: 700, marginBottom: 6 }}>ไม่มีการใช้งานมานาน</div>
        <div id="idle-logout-message" style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--muted)', marginBottom: 18 }}>
          ระบบจะออกจากระบบอัตโนมัติในอีกไม่ถึง 1 นาที เพื่อความปลอดภัยของข้อมูลยา — แตะปุ่มด้านล่างถ้ายังอยู่
        </div>
        <button
          onClick={dismissIdleWarning}
          className="btn-primary press-spring"
          style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 14, fontWeight: 700, minHeight: 48 }}
        >
          ยังอยู่ ทำงานต่อ
        </button>
      </div>
    </div>
  );
}
