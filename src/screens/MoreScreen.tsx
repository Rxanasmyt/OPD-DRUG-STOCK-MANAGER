import { useApp } from '../store/AppContext';
import versionRaw from '../../VERSION?raw';

const APP_VERSION = versionRaw.trim();

export default function MoreScreen() {
  const { state, go, userName, roleLabel, logout } = useApp();
  const items = [
    { label: 'ปรับยอด / คืนยา / ยาหมดอายุ', sub: 'บันทึกเหตุผลทุกครั้ง', go: () => go('adjust') },
    { label: 'รายงานและ Export CSV', sub: 'stock aging · turnover · discrepancy', go: () => go('report') },
    { label: 'ระบบฉลาก QR', sub: 'พิมพ์ฉลากตัวยา lot และชั้นวาง', go: () => go('labels') },
    { label: 'ตั้งค่า par level และชั้นวาง', sub: state.role !== 'tech' ? 'แก้ไขได้ — รวมกำหนดชั้นวางของแต่ละยา' : 'ดูได้เท่านั้น', go: () => go('settings') },
    ...(state.role !== 'tech' ? [{ label: 'จัดการรายการยา', sub: 'เพิ่มยาใหม่ / ปิดใช้งาน / ลบยาที่เลิกใช้', go: () => go('meds') }] : []),
    { label: 'นับสต็อกหน้างาน (เสริม)', sub: 'ใช้เมื่อสงสัยยอดคลาดเคลื่อน — ไม่บังคับ', go: () => go('count') },
    ...(state.role === 'admin' ? [{ label: 'จัดการผู้ใช้ & Audit log', sub: 'ควบคุมบัญชีผู้ใช้ ตามรอยทุกธุรกรรมในระบบ', go: () => go('admin') }] : []),
  ];

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="card" style={{ overflow: 'hidden', marginBottom: 14 }}>
        {items.map((m) => (
          <button key={m.label} onClick={m.go} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border-soft)', background: '#fff', padding: '14px 13px', minHeight: 56, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
            <span style={{ minWidth: 0 }}>
              <span style={{ fontSize: 14.5, fontWeight: 600 }}>{m.label}</span>
              <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>{m.sub}</span>
            </span>
            <span style={{ color: 'var(--green)', fontSize: 16, flex: 'none' }}>→</span>
          </button>
        ))}
      </div>

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
