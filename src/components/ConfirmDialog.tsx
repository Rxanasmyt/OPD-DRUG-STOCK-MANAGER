import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';

/** In-app replacement for window.confirm() — rendered once, globally, in App.tsx. See
 * confirmAsync()/respondConfirm() in AppContext.tsx and confirmDialog's doc comment in
 * types.ts for why this exists: the native browser confirm() can silently no-op inside some
 * embedded WebView/PWA contexts, which reads to the person tapping a button as "nothing
 * happened" with no error anywhere to diagnose. A real rendered dialog can't do that — if this
 * component is on screen, the person sees it.
 *
 * Same "closes gracefully, not just vanishes" fix Toast.tsx got — this used to hard-cut the
 * instant respondConfirm() ran, so even the button you just tapped disappeared mid-frame
 * instead of visibly responding to the tap. Keeps rendering one more beat with an exit
 * animation instead. */
export default function ConfirmDialog() {
  const { state, respondConfirm } = useApp();
  const [shown, setShown] = useState<{ message: string; exiting: boolean } | null>(null);
  const exitTimer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(exitTimer.current);
    if (state.confirmDialog) {
      setShown({ message: state.confirmDialog.message, exiting: false });
    } else {
      setShown((s) => (s ? { ...s, exiting: true } : s));
      exitTimer.current = window.setTimeout(() => setShown(null), 180);
    }
    return () => window.clearTimeout(exitTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.confirmDialog]);

  if (!shown) return null;
  return (
    <div
      style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        animation: shown.exiting ? 'backdropOut .18s var(--ease) both' : 'backdropIn .18s var(--ease-out)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) respondConfirm(false); }}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 380, padding: 18, animation: shown.exiting ? 'popOut .18s var(--ease) both' : 'pop .2s var(--ease-out) both' }}
      >
        <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: 18 }}>
          {shown.message}
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => respondConfirm(false)}
            className="btn-outline"
            style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46 }}
          >
            ยกเลิก
          </button>
          <button
            onClick={() => respondConfirm(true)}
            className="btn-primary"
            style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46 }}
          >
            ยืนยัน
          </button>
        </div>
      </div>
    </div>
  );
}
