import type { CSSProperties, ReactNode } from 'react';

/** Small colored status pill (active/inactive, role tags, "ไม่มี substock", ward badges, ...) —
 * pulled out after the same `padding + borderRadius: 20 + fontWeight: 700` shape turned up
 * reimplemented inline, slightly differently each time (font size, padding), in 6+ places
 * (MedsScreen, AdminScreen, ReconcileScreen). One component instead, so a future tweak to how
 * these look changes at one spot instead of needing to be found and repeated everywhere. */
export function Badge({ color, bg, children, size = 10, padding = '2px 7px', flexNone }: {
  color: string;
  bg: string;
  children: ReactNode;
  size?: number;
  padding?: string;
  /** Set on badges sitting inside a flex row that could otherwise squeeze them. */
  flexNone?: boolean;
}) {
  const style: CSSProperties = { fontSize: size, fontWeight: 700, color, background: bg, padding, borderRadius: 20 };
  if (flexNone) style.flex = 'none';
  return <span style={style}>{children}</span>;
}

/** "● เปิดอยู่" — a colored dot + label, the other small status indicator that turned up
 * duplicated verbatim (SettingsScreen's two notification-toggle cards). */
export function StatusDot({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span style={{ fontSize: 12.5, fontWeight: 700, color, display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ width: 8, height: 8, borderRadius: '50%', background: color }} /> {children}
    </span>
  );
}
