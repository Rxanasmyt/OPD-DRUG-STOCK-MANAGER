import { useApp } from '../store/AppContext';
import { suggestPar } from '../store/selectors';

export default function SettingsScreen() {
  const { state, warn, applyAllSuggested, recomputeUsageStats, go } = useApp();
  const canEdit = state.role !== 'tech';
  const meds = state.meds.filter((m) => m.active);

  const suggestDiffCount = meds.filter((m) => {
    const s = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
    return s.sub !== m.parSub || s.floor !== m.parFloor;
  }).length;

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="card" style={{ padding: 13, marginBottom: 13 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>เกณฑ์แจ้งเตือนวันหมดอายุ</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>แจ้งเตือนเมื่อ lot เหลืออายุน้อยกว่าจำนวนวันนี้</div>
        <div style={{ fontSize: 24, fontWeight: 700 }}>{warn()} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>วัน</span></div>
      </div>

      {!canEdit && (
        <div style={{ fontSize: 12, color: 'var(--amber-ink)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>บทบาทผู้ช่วยเภสัชกรดูค่าได้แต่แก้ไม่ได้ — การแก้ par level และชั้นวางสงวนไว้สำหรับเภสัชกรและ Admin</div>
      )}

      <div style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '12px 13px', marginBottom: 13 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>par อัตโนมัติจากสถิติการใช้</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 9 }}>คำนวณจากอัตราจ่ายเฉลี่ย/วัน (30 วันล่าสุด) × จำนวนวันที่ต้องสำรอง แล้วปรับเพิ่มตามความผันผวนของแต่ละรายการ — par หน้างานสำรอง {state.parFloorCoverDays} วัน, par substock สำรอง {state.parSubCoverDays} วัน</div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={applyAllSuggested} style={{ border: 0, background: 'var(--green)', color: '#fff', padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40 }}>ใช้ค่าแนะนำทั้งหมด ({suggestDiffCount} รายการเปลี่ยน)</button>
            <button onClick={recomputeUsageStats} style={{ border: '1px solid var(--green)', background: '#fff', color: 'var(--green)', padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40 }}>คำนวณสถิติการใช้ใหม่จากประวัติ HOSxP ↺</button>
          </div>
        )}
        <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 8 }}>อัตราการใช้คำนวณจากประวัติ "นำเข้าจาก HOSxP" เท่านั้น ไม่ได้อัปเดตอัตโนมัติทุกวัน — ควรกด "คำนวณสถิติการใช้ใหม่" เป็นระยะ (เช่น เดือนละครั้ง) หลังจากใช้งานนำเข้า HOSxP มาสม่ำเสมอแล้ว ถ้ากดตอนที่ยังไม่มีประวัติ HOSxP เลย ค่าจะกลายเป็น 0 ทั้งหมด</div>
      </div>

      <button
        onClick={() => go('meds')}
        style={{ width: '100%', textAlign: 'left', border: '1px solid var(--border)', background: '#fff', borderRadius: 12, padding: '13px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 56 }}
      >
        <span>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>แก้ par substock / par หน้างาน / ชั้นวาง รายตัว</span>
          <span className="muted" style={{ display: 'block', fontSize: 11.5, marginTop: 2 }}>ไปที่ "จัดการรายการยา" — แก้ได้ทุกฟิลด์ของยาแต่ละตัวในที่เดียว ({meds.length} รายการ)</span>
        </span>
        <span style={{ color: 'var(--green)', fontSize: 16, flex: 'none' }}>→</span>
      </button>
    </div>
  );
}
