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

/** High-Alert Drug flag — real-world request: make HAD "ชัดเจนขึ้น" everywhere it appears.
 * Every call site used to just color the literal text "HAD" red/maroon with no background,
 * border, or icon — identical visual weight to any other small caption on the row, so it read
 * as a label rather than a safety flag and was easy to skim past on a busy list. A filled
 * badge with a warning glyph gives it its own shape (not just a color, which also helps the
 * ~5-8% of men with red-green color blindness distinguish it from other severity colors on the
 * same screen) so it registers as "stop and check" before anyone reads the letters. */
export function HadTag({ size = 10.5 }: { size?: number }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: size, fontWeight: 800, color: 'var(--had)', background: 'rgba(var(--had-rgb, 143, 31, 79), .12)', border: '1px solid var(--had)', padding: '1.5px 6px', borderRadius: 20, flex: 'none', letterSpacing: '.02em' }} aria-label="ยา High Alert — ต้องสแกน QR ยืนยันก่อนทำรายการ">
      <span aria-hidden="true">⚠</span>HAD
    </span>
  );
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
