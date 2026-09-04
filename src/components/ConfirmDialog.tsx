import { useApp } from '../store/AppContext';

/** In-app replacement for window.confirm() — rendered once, globally, in App.tsx. See
 * confirmAsync()/respondConfirm() in AppContext.tsx and confirmDialog's doc comment in
 * types.ts for why this exists: the native browser confirm() can silently no-op inside some
 * embedded WebView/PWA contexts, which reads to the person tapping a button as "nothing
 * happened" with no error anywhere to diagnose. A real rendered dialog can't do that — if this
 * component is on screen, the person sees it. */
export default function ConfirmDialog() {
  const { state, respondConfirm } = useApp();
  if (!state.confirmDialog) return null;
  return (
    <div
      style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        animation: 'backdropIn .18s var(--ease-out)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) respondConfirm(false); }}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 380, padding: 18, animation: 'pop .2s var(--ease-out) both' }}
      >
        <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: 18 }}>
          {state.confirmDialog.message}
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
