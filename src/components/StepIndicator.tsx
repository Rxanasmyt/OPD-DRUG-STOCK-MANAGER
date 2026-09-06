// Shared step labels for the app's two real multi-screen wizards — one source of truth so
// TransferScreen/TConfirmScreen/DoneScreen (and ReceiveScreen/DoneScreen) never drift apart on
// wording between the screen that starts a flow and the one that finishes it.
export const TRANSFER_STEPS = ['เลือกยา', 'ตรวจสอบ', 'เสร็จสิ้น'];
export const RECEIVE_STEPS = ['กรอกรายการ', 'เสร็จสิ้น'];

/**
 * A slim step tracker for the app's real multi-screen wizards (เติมหน้างาน: เลือกยา →
 * ตรวจสอบ → เสร็จสิ้น; รับเข้า: กรอกรายการ → เสร็จสิ้น) — the point raised was "ไม่สับสนว่าทำ
 * ขั้นตอนอะไรอยู่" (don't get lost mid-flow): each of those is a genuinely separate screen with
 * no shared chrome telling you how far along you are or what's left, so backing out or getting
 * interrupted (a phone call, switching to another app) left no visual anchor for "where was I".
 * Purely informational — never blocks navigation, doesn't gate anything, just answers "which
 * step, how many left" at a glance every time one of these screens mounts.
 */
export function StepIndicator({ steps, current }: { steps: string[]; current: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '11px 16px 3px', animation: 'fade .2s var(--ease-out)' }}>
      {steps.map((label, i) => {
        const done = i < current;
        const active = i === current;
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', flex: i < steps.length - 1 ? 1 : 'none', minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, flex: 'none' }}>
              <div
                style={{
                  width: 22, height: 22, borderRadius: '50%', flex: 'none',
                  background: done || active ? 'var(--green)' : 'var(--border-soft)',
                  color: done || active ? '#fff' : 'var(--muted)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 11, fontWeight: 700,
                  boxShadow: active ? '0 0 0 3px rgba(var(--green-rgb), .18)' : 'none',
                  transition: 'background var(--dur) var(--ease), box-shadow var(--dur) var(--ease)',
                }}
              >
                {done ? '✓' : i + 1}
              </div>
              <span
                className={active ? undefined : 'muted'}
                style={{ fontSize: 11, fontWeight: active ? 700 : 500, whiteSpace: 'nowrap' }}
              >
                {label}
              </span>
            </div>
            {i < steps.length - 1 && (
              <div
                style={{
                  flex: 1, height: 2, margin: '0 8px', borderRadius: 1,
                  background: done ? 'var(--green)' : 'var(--border-soft)',
                  transition: 'background var(--dur-slow) var(--ease)',
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
