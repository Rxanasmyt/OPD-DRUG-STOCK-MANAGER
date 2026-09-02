import { useApp } from '../store/AppContext';
import type { Screen } from '../types';
import versionRaw from '../../VERSION?raw';

const APP_VERSION = versionRaw.trim();

interface MenuItem { icon: string; label: string; sub: string; screen: Screen }
interface MenuGroup { title: string; items: MenuItem[] }

/**
 * Every new feature this session landed as one more row in a flat list — reasonable one at a
 * time, but the list itself never got redesigned as it grew, so it turned into 8 undifferentiated
 * rows mixing daily-use screens with once-a-fortnight admin tools (reported: "ฟังก์ชั่นเยอะแต่หายาก").
 * Grouped by how often/who actually opens each one, with an icon per row so scanning the list
 * doesn't require reading every line of text — the fix for "too many flat options" is chunking
 * them, not cutting features nobody asked to remove.
 */
export default function MoreScreen() {
  const { state, go, userName, roleLabel, logout } = useApp();
  const canEditPar = state.role !== 'tech';

  const groups: MenuGroup[] = [
    {
      title: 'งานประจำวัน',
      items: [
        { icon: '⚖️', label: 'ปรับยอด / คืนยา / ยาหมดอายุ', sub: 'บันทึกเหตุผลทุกครั้ง', screen: 'adjust' },
        { icon: '🔢', label: 'นับสต็อกหน้างาน', sub: 'ใช้เมื่อสงสัยยอดคลาดเคลื่อน — ไม่บังคับ', screen: 'count' },
      ],
    },
    {
      title: 'จัดการยาและชั้นวาง',
      items: [
        ...(canEditPar ? [{ icon: '💊', label: 'จัดการรายการยา', sub: 'ชื่อ ขนาด หน่วย ราคา par ชั้นวาง — แก้ทุกอย่างของยาที่นี่', screen: 'meds' as Screen }] : []),
        { icon: '↔️', label: 'ย้ายยาระหว่างชั้นวาง', sub: 'เช่น แบ่งยาฉีดจากลิ้นชักล็อก IPD มาวาง stat OPD', screen: 'wardmove' },
        { icon: '📈', label: 'par อัตโนมัติ & เกณฑ์แจ้งเตือน', sub: 'คำนวณ par แนะนำจากสถิติการใช้ · ตั้งวันแจ้งเตือนหมดอายุ', screen: 'settings' },
      ],
    },
    {
      title: 'รายงานและเอกสาร',
      items: [
        { icon: '📊', label: 'รายงานและ Export CSV', sub: 'stock aging · turnover · discrepancy', screen: 'report' },
        { icon: '🗂️', label: 'บัตรสต็อก substock', sub: 'รับ-จ่าย-คงเหลือ real-time แทนบัตรกระดาษ', screen: 'substockcard' },
        { icon: '▣', label: 'ระบบฉลาก QR', sub: 'พิมพ์ฉลากตัวยา lot และชั้นวาง', screen: 'labels' },
      ],
    },
    ...(state.role === 'admin' ? [{
      title: 'ผู้ดูแลระบบ',
      items: [{ icon: '🛡️', label: 'จัดการผู้ใช้ & Audit log', sub: 'ควบคุมบัญชีผู้ใช้ ตามรอยทุกธุรกรรมในระบบ', screen: 'admin' as Screen }],
    }] : []),
  ];

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      {groups.map((g) => (
        <div key={g.title} style={{ marginBottom: 16 }}>
          <div style={{ fontSize: 11.5, fontWeight: 700, color: 'var(--muted)', letterSpacing: '.03em', margin: '0 3px 7px' }}>{g.title.toUpperCase()}</div>
          <div className="card" style={{ overflow: 'hidden' }}>
            {g.items.map((m) => (
              <button key={m.label} onClick={() => go(m.screen)} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border-soft)', background: '#fff', padding: '13px 13px', minHeight: 58, display: 'flex', alignItems: 'center', gap: 12 }}>
                <span style={{ flex: 'none', width: 34, height: 34, borderRadius: 10, background: 'var(--green-tint)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 16 }}>{m.icon}</span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span style={{ display: 'block', fontSize: 14, fontWeight: 600 }}>{m.label}</span>
                  <span className="muted" style={{ display: 'block', fontSize: 11, marginTop: 1, lineHeight: 1.35 }}>{m.sub}</span>
                </span>
                <span style={{ color: 'var(--green)', fontSize: 16, flex: 'none' }}>→</span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="card" style={{ padding: 13, marginBottom: 14 }}>
        <div className="muted" style={{ fontSize: 12 }}>เข้าใช้งานเป็น</div>
        <div style={{ fontSize: 15.5, fontWeight: 600, marginTop: 2 }}>{userName()}</div>
        <div className="muted" style={{ fontSize: 12.5 }}>{roleLabel()} · ห้องยา OPD</div>
      </div>

      <button onClick={logout} style={{ width: '100%', border: '1px solid var(--border)', background: '#fff', color: 'var(--red)', padding: 14, borderRadius: 11, fontSize: 14.5, fontWeight: 600, minHeight: 50 }}>ออกจากระบบ</button>
      <div className="muted" style={{ textAlign: 'center', fontSize: 11, marginTop: 16 }}>เวอร์ชัน {APP_VERSION}</div>
    </div>
  );
}
