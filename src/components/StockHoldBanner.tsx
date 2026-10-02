import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { isOnStockHold } from '../store/selectors';
import { thDate } from '../utils/format';

/**
 * Real-world request: "บริษัทยาไม่มาส่งยา ล่าช้า หรือเลิกผลิต อยู่ระหว่างสั่งยาบริษัทอื่น คลังปิด
 * ช่วงปลาย/ต้นปีงบประมาณ...แจ้งเตือนด้วยว่ามียาตัวไหนที่ยังขาดชั่วคราวทุกๆการเบิก เพื่อแจ้งเตือน
 * หรือดำเนินการหายามาใช้" — a med flagged isOnStockHold() (see MedsScreen's "ยาขาดชั่วคราว"
 * action) is already excluded from "ควรเบิกจากคลังใหญ่" everywhere that's computed (nothing a
 * requisition does fixes a real supply problem), but that silence on its own reads as "nothing
 * to do" rather than "already known, still unresolved" — this banner is the explicit reminder,
 * shown on every screen where staff actually do a เบิก (TransferScreen's เติมหน้างาน,
 * ReceiveScreen's รับเข้า/เบิกจากคลังใหญ่) plus HomeScreen for general visibility.
 *
 * Deliberately NOT dismissible-for-the-day like TransferScreen's own clinic/Friday banners —
 * those are one-time FYIs; an open stock hold is an ongoing operational fact someone should see
 * every time they're about to act on stock, for as long as it stays unresolved. Collapsible for
 * THIS view only (local state, resets on next visit) so it doesn't permanently crowd the screen
 * once read, without it ever silently going away "for the rest of today" the way those do.
 */
export default function StockHoldBanner({ margin = '10px 14px 0' }: {
  /** Override for callers whose own container already carries horizontal padding (e.g.
   * HomeScreen) — TransferScreen/ReceiveScreen mount this outside their padded content div
   * (same spot their own screen-local banners sit), where the default margin is correct as-is. */
  margin?: string;
}) {
  const { state, endStockHold } = useApp();
  const [collapsed, setCollapsed] = useState(false);
  const canResolve = state.role === 'admin';
  const held = state.meds.filter((m) => m.active && isOnStockHold(m));
  if (!held.length) return null;

  return (
    <div style={{ margin, border: '1px solid var(--red)', background: 'var(--red-bg)', borderRadius: 10, overflow: 'hidden' }}>
      <button
        onClick={() => setCollapsed((v) => !v)}
        style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 8, padding: '9px 12px', border: 0, background: 'transparent', color: 'var(--red)', fontSize: 11.5, fontWeight: 600, textAlign: 'left' }}
      >
        <span style={{ flex: 'none', fontSize: 14 }}>⏸</span>
        <span style={{ flex: 1 }}>ยาขาดชั่วคราว {held.length} รายการ — รอดำเนินการจัดหา</span>
        <span style={{ flex: 'none', fontSize: 11 }}>{collapsed ? 'ดูรายการ ▾' : 'ย่อ ▴'}</span>
      </button>
      {!collapsed && (
        <div style={{ padding: '0 12px 10px' }}>
          {held.map((m) => (
            <div key={m.id} style={{ display: 'flex', alignItems: 'flex-start', gap: 8, padding: '7px 0', borderTop: '1px solid rgba(163,43,34,.15)' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--ink)' }}>{m.name}</div>
                <div style={{ fontSize: 10.5, color: 'var(--red)', lineHeight: 1.5 }}>
                  {m.outOfStockReason} · ขาดตั้งแต่ {thDate(m.outOfStockSince as number)}
                  {m.outOfStockExpectedReturn ? ' · คาดว่าจะมีของ ' + thDate(m.outOfStockExpectedReturn) : ''}
                </div>
              </div>
              {canResolve && (
                <button
                  onClick={() => endStockHold(m.id)}
                  style={{ flex: 'none', border: '1px solid var(--red)', background: 'var(--bg-card)', color: 'var(--red)', borderRadius: 8, padding: '5px 9px', fontSize: 10.5, fontWeight: 600, minHeight: 32 }}
                >
                  ยกเลิกสถานะ
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
