import type { AdjType, Screen, Ward } from '../types';

type Zone = { key: 'substock' | 'floor'; label: string; icon: string; color: string; bg: string; border: string };

// Same two colors the QR scanner modal already themes รับเข้า (amber) vs เติมหน้างาน (green)
// with (see MODE_THEME in QrModal.tsx) — reusing them here means "amber = substock, green =
// หน้างาน" reads as one consistent language across the whole app, not just inside the scanner.
const SUBSTOCK: Zone = { key: 'substock', label: 'คลังย่อย Substock', icon: '📦', color: 'var(--amber-ink)', bg: 'var(--amber-bg)', border: 'var(--amber-border)' };
const FLOOR: Zone = { key: 'floor', label: 'หน้างาน (ชั้นจ่ายยา)', icon: '🏥', color: 'var(--green)', bg: 'var(--green-tint)', border: 'var(--green)' };

// Which physical stock a screen is actually touching — not always obvious from the screen's
// own title alone (โดยเฉพาะ "ปรับยอด" ซึ่งปกติแก้ยอดหน้างาน แต่ตัดยาหมดอายุออกจาก substock,
// และ "สำเร็จ" ซึ่งใช้ร่วมกันทั้งตอนเติมหน้างานและตอนรับเข้า substock)
function zoneFor(screen: Screen, adjType: AdjType | null, doneKind: 'transfer' | 'receive' | 'recvPending' | null): Zone | null {
  switch (screen) {
    case 'receive': case 'substockcard': return SUBSTOCK;
    case 'tconfirm': case 'wardmove': case 'count': return FLOOR;
    case 'adjust': return adjType === 'expired' ? SUBSTOCK : FLOOR;
    case 'done': return doneKind === 'transfer' ? FLOOR : SUBSTOCK;
    default: return null;
  }
}

const WARD_TONE: Record<Ward, { label: string; color: string; bg: string }> = {
  opd: { label: 'OPD', color: 'var(--green)', bg: 'var(--green-tint)' },
  ipd: { label: 'IPD', color: 'var(--ipd)', bg: 'var(--ipd-bg)' },
};
// Only the screens that actually scope their list by state.wardFilter — showing a ward pill
// anywhere else (wardmove moves freely between wards; count/substockcard work per-med, not
// per-ward) would claim a scoping that isn't real and could read as "only OPD is affected"
// when it isn't.
const SHOWS_WARD_PILL: Screen[] = ['receive', 'transfer', 'adjust'];

/** Persistent "where am I right now" strip, pinned under the header on every screen — not a
 * per-screen filter tab someone might scroll past, but a fixed, always-visible answer to
 * "ตอนนี้กำลังอยู่ที่ substock หรือหน้างาน OPD/IPD" so a เภสัชกร/ผู้ช่วยเภสัชกรที่สลับหน้าจอ
 * ไปมาทั้งวันไม่ต้องอ่านรายละเอียดหน้าจอเพื่อเดาบริบทเอง — สีและไอคอนบอกทันทีที่เห็น. */
export function ContextBar({ screen, wardFilter, adjType, doneKind }: {
  screen: Screen;
  wardFilter: 'all' | Ward;
  adjType: AdjType | null;
  doneKind: 'transfer' | 'receive' | 'recvPending' | null;
}) {
  const zone = zoneFor(screen, adjType, doneKind);
  if (!zone) return null;
  const showWard = SHOWS_WARD_PILL.includes(screen);
  const wardTone = wardFilter !== 'all' ? WARD_TONE[wardFilter] : null;
  return (
    <div
      key={zone.key + '|' + wardFilter}
      style={{
        flex: 'none', display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px',
        background: zone.bg, borderBottom: '1px solid ' + zone.border, fontSize: 12.5, fontWeight: 700,
        color: zone.color, animation: 'fade .22s var(--ease-out)', position: 'relative', zIndex: 2,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: 14, lineHeight: 1 }}>{zone.icon}</span>
      <span>กำลังทำงานที่ {zone.label}</span>
      {showWard && (
        <span
          style={{
            marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, padding: '3px 10px', borderRadius: 20,
            fontSize: 11, fontWeight: 800, letterSpacing: '.03em', flex: 'none',
            background: wardTone ? wardTone.bg : 'rgba(0,0,0,.06)', color: wardTone ? wardTone.color : zone.color,
          }}
        >
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: 'currentColor', animation: 'pulse 2.4s infinite' }} />
          {wardTone ? wardTone.label : 'ทุกหอผู้ป่วย'}
        </span>
      )}
    </div>
  );
}
