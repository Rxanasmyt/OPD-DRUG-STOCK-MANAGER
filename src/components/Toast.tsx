import { useApp } from '../store/AppContext';

export default function Toast() {
  const { state } = useApp();
  if (!state.toast) return null;
  return (
    <div style={{ position: 'absolute', left: 14, right: 14, bottom: 78, background: 'var(--ink)', color: 'var(--ink-soft)', padding: '12px 14px', borderRadius: 11, fontSize: 13, zIndex: 30, animation: 'pop .2s', boxShadow: '0 10px 24px -10px rgba(0,0,0,.6)' }}>
      {state.toast}
    </div>
  );
}
