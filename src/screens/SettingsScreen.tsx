import { useRef } from 'react';
import { useApp } from '../store/AppContext';
import { suggestPar, USAGE_PERIOD_DAYS, USAGE_PERIOD_LABEL } from '../store/selectors';
import { nf } from '../utils/format';
import type { UsagePeriod } from '../types';

const PERIODS: UsagePeriod[] = ['month', 'quarter', 'fiscalYear'];

export default function SettingsScreen() {
  const {
    state, warn, applyAllSuggested, recomputeUsageStats, go,
    setUsagePeriod, importUsageFile, setUsageConfirmFuzzy, clearUsageImport, commitUsageImport,
  } = useApp();
  const canEdit = state.role !== 'tech';
  const meds = state.meds.filter((m) => m.active);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const suggestDiffCount = meds.filter((m) => {
    const s = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
    return s.sub !== m.parSub || s.floor !== m.parFloor;
  }).length;

  const usageRows = state.usageRows || [];
  const usageMatched = usageRows.filter((r) => r.match.kind === 'exact').length;
  const usageFuzzy = usageRows.filter((r) => r.match.kind === 'fuzzy').length;
  const usageSkipped = usageRows.filter((r) => r.match.kind === 'ambiguous' || r.match.kind === 'none').length;
  const usageCanCommit = usageRows.length > 0 && (usageFuzzy === 0 || state.usageConfirmFuzzy);

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
            <button onClick={recomputeUsageStats} style={{ border: '1px solid var(--green)', background: 'var(--bg-card)', color: 'var(--green)', padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40 }}>คำนวณสถิติการใช้ใหม่จากประวัติ HOSxP ↺</button>
          </div>
        )}
        <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 8 }}>อัตราการใช้คำนวณจากประวัติ "นำเข้าจาก HOSxP" เท่านั้น ไม่ได้อัปเดตอัตโนมัติทุกวัน — ควรกด "คำนวณสถิติการใช้ใหม่" เป็นระยะ (เช่น เดือนละครั้ง) หลังจากใช้งานนำเข้า HOSxP มาสม่ำเสมอแล้ว ถ้ากดตอนที่ยังไม่มีประวัติ HOSxP เลย ค่าจะกลายเป็น 0 ทั้งหมด</div>
      </div>

      {canEdit && (
        <div className="card" style={{ padding: 13, marginBottom: 13 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>นำเข้าอัตราการใช้จากไฟล์</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 10 }}>
            สำหรับยาที่ยังไม่มีประวัติ "นำเข้าจาก HOSxP" ในแอปพอ (60 วัน) — แนบไฟล์ CSV จำนวนที่ใช้จริงรายเดือน/ไตรมาส/ปีงบประมาณที่ห้องยามีอยู่แล้วแทนได้ รูปแบบ "ชื่อยา,จำนวนที่ใช้" บรรทัดละ 1 รายการ ระบบจะคำนวณอัตราเฉลี่ย/วันให้เอง — ปรับแค่ตัวเลขอัตราการใช้ที่ใช้แนะนำ par เท่านั้น ไม่กระทบยอดคงคลังจริง
          </div>

          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            {PERIODS.map((p) => {
              const active = state.usagePeriod === p;
              return (
                <button
                  key={p}
                  onClick={() => setUsagePeriod(p)}
                  className="chip"
                  style={{ flex: 1, textAlign: 'center', border: active ? '1px solid var(--green)' : '1px solid var(--border)', background: active ? 'var(--green)' : 'var(--bg-card)', color: active ? '#fff' : 'var(--ink)', minHeight: 38 }}
                >
                  {USAGE_PERIOD_LABEL[p]}
                </button>
              );
            })}
          </div>

          {!usageRows.length ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,text/csv,text/plain"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importUsageFile(f); e.target.value = ''; }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-outline"
                style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46 }}
              >
                ↑ เลือกไฟล์ CSV — จำนวนที่ใช้{USAGE_PERIOD_LABEL[state.usagePeriod].replace(/\s*\(.*\)/, '')}
              </button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--bg-subtle)', borderRadius: 10, padding: '9px 12px', marginBottom: 9 }}>
                <span style={{ minWidth: 0, fontSize: 12, lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 600 }}>{state.usageFileName}</span>
                  <span className="muted" style={{ display: 'block', marginTop: 1 }}>
                    ตรงเป๊ะ {nf(usageMatched)} · ไม่ตรงเป๊ะ {nf(usageFuzzy)} · ข้าม {nf(usageSkipped)} รายการ ({USAGE_PERIOD_DAYS[state.usagePeriod]} วัน)
                  </span>
                </span>
                <button onClick={clearUsageImport} style={{ flex: 'none', border: 0, background: 'transparent', color: 'var(--red)', fontSize: 12, fontWeight: 600 }}>ยกเลิก</button>
              </div>

              {usageFuzzy > 0 && (
                <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 10, padding: '11px 12px', marginBottom: 10, cursor: 'pointer' }}>
                  <input type="checkbox" checked={state.usageConfirmFuzzy} onChange={(e) => setUsageConfirmFuzzy(e.target.checked)} style={{ marginTop: 2, flex: 'none', width: 17, height: 17 }} />
                  <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--amber-ink)' }}>ตรวจสอบแล้วว่า {usageFuzzy} รายการที่ชื่อในไฟล์ไม่ตรงกับชื่อในระบบเป๊ะๆ จับคู่กับยาถูกตัว (ระบบเดาให้จากชื่อที่ใกล้เคียงที่สุด)</span>
                </label>
              )}

              <button
                onClick={commitUsageImport}
                disabled={!usageCanCommit}
                className="btn-primary"
                style={{ width: '100%', padding: 14, borderRadius: 11, fontSize: 14, fontWeight: 600, minHeight: 48, opacity: usageCanCommit ? 1 : 0.5 }}
              >
                นำเข้าอัตราการใช้ ({nf(usageMatched + usageFuzzy)} รายการ)
              </button>
            </>
          )}
        </div>
      )}

      <button
        onClick={() => go('meds')}
        className="row-interactive"
        style={{ width: '100%', textAlign: 'left', border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 12, padding: '13px 14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, minHeight: 56 }}
      >
        <span>
          <span style={{ fontSize: 13.5, fontWeight: 600 }}>แก้ par substock / par หน้างาน / ชั้นวาง รายตัว</span>
          <span className="muted" style={{ display: 'block', fontSize: 11.5, marginTop: 2 }}>ไปที่ "จัดการรายการยา" — แก้ได้ทุกฟิลด์ของยาแต่ละตัวในที่เดียว ({meds.length} รายการ)</span>
        </span>
        <span className="row-arrow" style={{ color: 'var(--green)', fontSize: 16, flex: 'none' }}>→</span>
      </button>
    </div>
  );
}
