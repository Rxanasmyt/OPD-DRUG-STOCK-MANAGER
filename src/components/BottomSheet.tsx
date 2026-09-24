import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A sheet that slides up from the bottom edge, covering the app shell behind a dimmed backdrop
 * — the standard modern-mobile pattern for "edit this one thing," instead of a form expanding
 * inline in the middle of a scrolling list (which used to make MedsScreen's edit panel easy to
 * lose track of once the list around it re-flowed).
 *
 * Same "closes gracefully, not just vanishes mid-frame" fix as ConfirmDialog/Toast: keeps
 * rendering one more beat with an exit animation instead of hard-unmounting the instant `open`
 * flips false.
 *
 * Bug fix (reported live: "จะแก้ไขรายการยาแต่ขึ้นแบบนี้ใช้ยากมาก" — a screenshot showed the sheet
 * rendering as a small box overlapping the list instead of covering the screen). `position:
 * absolute; inset: 0` is correct for reaching .app-shell's `position: relative` — the real fault
 * was upstream: App.tsx wraps every screen's content in a `.nav-slide-fwd`/`.nav-slide-back` div
 * for the slide transition (see styles.css), and that class's animation used to carry fill-mode
 * `both`. The `forwards` half of `both` keeps an animation "applicable" to its element forever
 * after it finishes playing, not just during its 220ms run — and per the CSS Transforms spec,
 * any element an animation is still applying a `transform` to (even one whose value has settled
 * on a harmless identity matrix, exactly what the `to` keyframe's `transform: none` produces)
 * establishes a new containing block for `position: fixed`/`absolute` descendants. That silently
 * intercepted `inset: 0` here — sized against the SCREEN's own full unscrolled content height
 * (tens of thousands of pixels for a long list like MedsScreen's) instead of the viewport-sized
 * .app-shell, stretching the backdrop to match and pushing the sheet card (bottom-aligned within
 * it) far below the visible viewport. Fixed at the source (styles.css's `.nav-slide-fwd`/`-back`
 * dropped the now-needless `both`) rather than here, since it silently broke `position: fixed`
 * exactly the same way and would have broken any future absolutely/fixed-positioned element
 * added to any screen, not just this component.
 *
 * Deliberately does NOT close automatically on outside-tap/✕ without going through `onClose` —
 * every real caller wires that to AppContext's confirmLeaveIfDirty() so a sheet holding unsaved
 * edits (see setFormDirty) still asks before discarding them, exactly like go() already does
 * for whole-screen navigation. This component has no opinion on that; it just always asks.
 */
export function BottomSheet({ open, onClose, title, children }: {
  open: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState<{ exiting: boolean } | null>(null);
  const exitTimer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(exitTimer.current);
    if (open) {
      setShown({ exiting: false });
    } else {
      setShown((s) => (s ? { exiting: true } : s));
      exitTimer.current = window.setTimeout(() => setShown(null), 220);
    }
    return () => window.clearTimeout(exitTimer.current);
  }, [open]);

  if (!shown) return null;
  return (
    <div
      style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 30,
        display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
        animation: shown.exiting ? 'backdropOut .2s var(--ease) both' : 'backdropIn .18s var(--ease-out)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="card"
        style={{
          width: '100%', maxWidth: 560, maxHeight: '88dvh', overflowY: 'auto',
          borderBottomLeftRadius: 0, borderBottomRightRadius: 0,
          borderTopLeftRadius: 18, borderTopRightRadius: 18,
          paddingBottom: 'calc(16px + env(safe-area-inset-bottom, 0px))',
          animation: shown.exiting ? 'sheetOut .22s var(--ease) both' : 'sheetIn .26s var(--ease-spring) both',
        }}
      >
        {/* Grab-handle affordance — purely visual (no drag gesture wired up), but signals
            "this is a sheet, there's a ✕ or backdrop tap to dismiss it" at a glance. */}
        <div style={{ display: 'flex', justifyContent: 'center', padding: '10px 0 4px' }}>
          <div style={{ width: 36, height: 4, borderRadius: 3, background: 'var(--border-strong)' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '2px 16px 10px' }}>
          {title && <div style={{ flex: 1, fontSize: 15, fontWeight: 700 }}>{title}</div>}
          <button
            onClick={onClose}
            aria-label="ปิด"
            style={{ marginLeft: title ? 0 : 'auto', flex: 'none', width: 32, height: 32, borderRadius: 9, border: 0, background: 'var(--bg-subtle)', color: 'var(--ink)', fontSize: 15 }}
          >
            ✕
          </button>
        </div>
        <div style={{ padding: '0 16px' }}>{children}</div>
      </div>
    </div>
  );
}
