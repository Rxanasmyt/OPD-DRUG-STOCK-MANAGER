import { useApp } from '../store/AppContext';

/**
 * Replaces the old silent-auto-reload behavior (vite-plugin-pwa's 'autoUpdate' — see
 * vite.config.ts) with an explicit choice. A new version downloads in the background exactly
 * the same as before; this banner just tells someone it's ready and lets THEM decide when to
 * take it — never mid-scan, mid-form, or mid-transaction like the automatic reload used to.
 * Stays up until dismissed or applied; not a Toast (which auto-hides in a few seconds — an
 * update someone doesn't act on right away shouldn't just vanish and be forgotten).
 */
export default function UpdateBanner() {
  const { state, applyUpdate, dismissUpdate } = useApp();
  // Never pop this up over the full-screen QR scanner (zIndex 20, covers everything) — that
  // would be exactly the kind of "interrupts an active task" moment this whole feature exists
  // to avoid. It just waits; nothing about the pending update expires by staying hidden here.
  if (!state.updateAvailable || state.qrOpen) return null;

  return (
    <div
      // Bug fix: Toast.tsx sits at bottom:78 (fires on nearly every action, so it's up often)
      // — placing this at a similar height would let the two overlap and fight for the same
      // strip of screen. Clearing well above it (and the bottom nav bar under that) keeps both
      // legible if a toast happens to fire while this banner is still up.
      style={{
        position: 'absolute', left: 10, right: 10, bottom: 'calc(env(safe-area-inset-bottom, 0px) + 150px)', zIndex: 40,
        background: 'var(--ink)', color: 'var(--ink-soft)', borderRadius: 14, padding: '12px 12px 12px 15px',
        display: 'flex', alignItems: 'center', gap: 10, boxShadow: 'var(--shadow-lg)', animation: 'sheetIn .3s var(--ease-out)',
      }}
    >
      <span style={{ fontSize: 18, flex: 'none' }}>⬆️</span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 13, fontWeight: 700 }}>มีแอพเวอร์ชันใหม่</div>
        <div style={{ fontSize: 11, opacity: 0.75, marginTop: 1, lineHeight: 1.4 }}>อัปเดตตอนที่สะดวก — ทำรายการค้างอยู่ให้เสร็จก่อนได้</div>
      </div>
      <button
        onClick={dismissUpdate}
        style={{ flex: 'none', border: 0, background: 'transparent', color: 'var(--ink-soft)', opacity: 0.6, fontSize: 13, padding: 6 }}
      >
        ปิด
      </button>
      <button
        onClick={applyUpdate}
        className="press-spring"
        style={{ flex: 'none', border: 0, background: 'var(--green)', color: '#fff', padding: '9px 14px', borderRadius: 10, fontSize: 12.5, fontWeight: 700, minHeight: 38 }}
      >
        อัปเดตเลย
      </button>
    </div>
  );
}
