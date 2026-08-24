import { useApp } from '../store/AppContext';
import { suggestPar } from '../store/selectors';
import { nf, digitsOnly } from '../utils/format';

export default function SettingsScreen() {
  const { state, warn, applyOnePar, applyAllSuggested, setParSub, setParFloor } = useApp();
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
        <div style={{ fontSize: 12, color: 'var(--amber-ink)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>บทบาทผู้ช่วยเภสัชกรดูค่าได้แต่แก้ไม่ได้ — การแก้ par level สงวนไว้สำหรับเภสัชกรและ Admin</div>
      )}

      <div style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '12px 13px', marginBottom: 13 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>par อัตโนมัติจากสถิติการใช้</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 9 }}>คำนวณจากอัตราจ่ายเฉลี่ย/วัน (30 วันล่าสุด) × จำนวนวันที่ต้องสำรอง แล้วปรับเพิ่มตามความผันผวนของแต่ละรายการ — par หน้างานสำรอง {state.parFloorCoverDays} วัน, par substock สำรอง {state.parSubCoverDays} วัน</div>
        {canEdit && (
          <button onClick={applyAllSuggested} style={{ border: 0, background: 'var(--green)', color: '#fff', padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40 }}>ใช้ค่าแนะนำทั้งหมด ({suggestDiffCount} รายการเปลี่ยน)</button>
        )}
      </div>

      <div style={{ fontSize: 13.5, fontWeight: 600, margin: '0 2px 8px' }}>Par level ต่อรายการ</div>
      <div className="card" style={{ overflow: 'hidden' }}>
        {meds.slice(0, 120).map((m) => {
          const sug = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
          const trendPct = Math.round(((m.used30 - m.usedPrev30) / Math.max(1, m.usedPrev30)) * 100);
          const trendText = trendPct > 4 ? '↑ ใช้เพิ่มขึ้น ' + trendPct + '%' : trendPct < -4 ? '↓ ใช้ลดลง ' + Math.abs(trendPct) + '%' : '≈ ใช้คงที่';
          const trendTone = trendPct > 4 ? 'var(--red)' : trendPct < -4 ? 'var(--green)' : 'var(--muted)';
          const inStyle = { width: '100%', border: '1px solid ' + (canEdit ? 'var(--border)' : '#e6e7e0'), background: canEdit ? '#fff' : '#f2f3ee', color: canEdit ? 'var(--ink)' : '#8b9186', borderRadius: 8, padding: '8px 6px', fontSize: 13, textAlign: 'center' as const, minHeight: 40 };
          return (
            <div key={m.id} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8, marginBottom: 7 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, lineHeight: 1.3 }}>{m.name}</span>
                <span style={{ flex: 'none', fontSize: 11, fontWeight: 700, color: trendTone }}>{trendText}</span>
              </div>
              <div className="grid-2">
                <div>
                  <div className="muted" style={{ fontSize: 10.5, marginBottom: 3 }}>par substock</div>
                  <input value={m.parSub} onChange={(e) => setParSub(m.id, digitsOnly(e.target.value))} readOnly={!canEdit} inputMode="numeric" style={inStyle} />
                  {canEdit && sug.sub !== m.parSub && (
                    <button onClick={() => applyOnePar(m.id, 'sub')} style={{ width: '100%', border: 0, background: 'transparent', color: 'var(--green)', fontSize: 10.5, fontWeight: 600, padding: '3px 0', textAlign: 'center' }}>แนะนำ {nf(sug.sub)} ↺</button>
                  )}
                </div>
                <div>
                  <div className="muted" style={{ fontSize: 10.5, marginBottom: 3 }}>par หน้างาน</div>
                  <input value={m.parFloor} onChange={(e) => setParFloor(m.id, digitsOnly(e.target.value))} readOnly={!canEdit} inputMode="numeric" style={inStyle} />
                  {canEdit && sug.floor !== m.parFloor && (
                    <button onClick={() => applyOnePar(m.id, 'floor')} style={{ width: '100%', border: 0, background: 'transparent', color: 'var(--green)', fontSize: 10.5, fontWeight: 600, padding: '3px 0', textAlign: 'center' }}>แนะนำ {nf(sug.floor)} ↺</button>
                  )}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
