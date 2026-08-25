import { Component, type ReactNode } from 'react';

/**
 * Last-resort catch for an uncaught render error. Without this, any unexpected exception
 * (e.g. a malformed doc from a manual Firestore console edit) white-screens the whole app
 * for whoever's at the counter — this shows a recoverable message instead.
 */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  constructor(props: { children: ReactNode }) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error('Uncaught render error:', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{ minHeight: '100dvh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center', background: 'var(--bg-app, #f7f6f2)', color: 'var(--ink, #1a2b20)' }}>
          <div style={{ fontSize: 40, marginBottom: 12 }}>⚠️</div>
          <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 6 }}>เกิดข้อผิดพลาดที่ไม่คาดคิด</div>
          <div style={{ fontSize: 13, opacity: 0.7, marginBottom: 18, maxWidth: 320, lineHeight: 1.6 }}>ข้อมูลสต็อกยังปลอดภัย ไม่ถูกกระทบ — ลองโหลดหน้าใหม่อีกครั้ง ถ้ายังเกิดซ้ำให้แจ้งผู้ดูแลระบบ</div>
          <button
            onClick={() => window.location.reload()}
            style={{ border: 0, background: 'var(--green, #17552f)', color: '#fff', padding: '13px 22px', borderRadius: 11, fontSize: 14.5, fontWeight: 600, minHeight: 48 }}
          >
            โหลดหน้าใหม่
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
