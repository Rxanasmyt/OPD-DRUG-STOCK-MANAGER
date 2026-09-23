import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A sheet that slides up from the bottom edge, covering the app shell behind a dimmed backdrop
 * — the standard modern-mobile pattern for "edit this one thing," instead of a form expanding
 * inline in the middle of a scrolling list (which used to make MedsScreen's edit panel easy to
 * lose track of once the list around it re-flowed).
 *
 * Same "closes gracefully, not just vanishes mid-frame" fix as ConfirmDialog/Toast: keeps
 * rendering one more beat with an exit animation instead of hard-unmounting the instant `open`
 * flips false. `position: absolute; inset: 0` — same trick ConfirmDialog uses to cover the
 * WHOLE app shell (header + bottom nav too) despite being rendered deep inside a screen
 * component nested in <main>: with no `position` set on <main> itself, this element's
 * containing block resolves up to .app-shell's `position: relative`, so <main>'s own
 * `overflow-y: auto` never clips it.
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
