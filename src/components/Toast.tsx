import { useApp } from '../store/AppContext';

export default function Toast() {
  const { state } = useApp();
  if (!state.toast) return null;
  return (
    <div
      key={state.toast}
      style={{
        position: 'absolute', left: 14, right: 14, bottom: 78,
        background: 'var(--ink)', color: 'var(--ink-soft)',
        padding: '13px 16px', borderRadius: 12, fontSize: 13, lineHeight: 1.45,
        zIndex: 30, animation: 'toastIn .32s cubic-bezier(.16,1,.3,1)',
        boxShadow: '0 16px 32px -12px rgba(0,0,0,.5), 0 2px 8px rgba(0,0,0,.25)',
      }}
    >
      {state.toast}
    </div>
  );
}
