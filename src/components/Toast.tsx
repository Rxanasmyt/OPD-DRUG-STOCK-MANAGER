import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';

/**
 * Bug fix (polish): a toast used to just vanish — state.toast flips to null and React removes
 * the DOM node in the same tick, so there was no way to animate an exit no matter how nice
 * toastIn looked going the other way. Keeps rendering the last message for one more beat with
 * an exit animation instead of an abrupt cut, mirroring the same "enters AND leaves gracefully"
 * treatment every other transient surface in the app (dialogs, sheets) already gets.
 */
export default function Toast() {
  const { state } = useApp();
  const [shown, setShown] = useState<{ text: string; exiting: boolean } | null>(null);
  const exitTimer = useRef<number>();

  useEffect(() => {
    window.clearTimeout(exitTimer.current);
    if (state.toast) {
      setShown({ text: state.toast, exiting: false });
    } else {
      setShown((s) => (s ? { ...s, exiting: true } : s));
      exitTimer.current = window.setTimeout(() => setShown(null), 220);
    }
    return () => window.clearTimeout(exitTimer.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.toast]);

  if (!shown) return null;
  return (
    <div
      style={{
        position: 'absolute', left: 14, right: 14, bottom: 78,
        background: 'var(--ink)', color: 'var(--ink-soft)',
        padding: '13px 16px', borderRadius: 12, fontSize: 13, lineHeight: 1.45,
        zIndex: 30, animation: shown.exiting ? 'toastOut .2s var(--ease) both' : 'toastIn .32s cubic-bezier(.16,1,.3,1)',
        boxShadow: '0 16px 32px -12px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.25)',
      }}
    >
      {shown.text}
    </div>
  );
}
