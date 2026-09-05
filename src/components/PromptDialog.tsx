import { useEffect, useState } from 'react';
import { useApp } from '../store/AppContext';

/** In-app replacement for window.prompt() — rendered once, globally, in App.tsx. Same
 * reasoning as ConfirmDialog.tsx: the native browser prompt() can silently no-op inside some
 * embedded WebView/PWA contexts. See promptAsync()/respondPrompt() in AppContext.tsx. */
export default function PromptDialog() {
  const { state, respondPrompt } = useApp();
  const [value, setValue] = useState('');

  // Reset the draft text each time a new prompt is opened, not just on mount — this component
  // stays mounted for the app's whole lifetime (App.tsx renders it unconditionally), so a
  // leftover value from a previous prompt would otherwise bleed into the next one.
  useEffect(() => {
    if (state.promptDialog) setValue('');
  }, [state.promptDialog]);

  if (!state.promptDialog) return null;
  return (
    <div
      style={{
        position: 'absolute', inset: 0, background: 'rgba(0,0,0,.5)', zIndex: 40,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20,
        animation: 'backdropIn .18s var(--ease-out)',
      }}
      onClick={(e) => { if (e.target === e.currentTarget) respondPrompt(null); }}
    >
      <div
        className="card"
        style={{ width: '100%', maxWidth: 380, padding: 18, animation: 'pop .2s var(--ease-out) both' }}
      >
        <div style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-line', marginBottom: 10 }}>
          {state.promptDialog.message}
        </div>
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') respondPrompt(value); }}
          style={{ width: '100%', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 14, minHeight: 44, marginBottom: 16 }}
        />
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={() => respondPrompt(null)}
            className="btn-outline"
            style={{ flex: 1, padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46 }}
          >
            ยกเลิก
          </button>
          <button
            onClick={() => respondPrompt(value)}
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
