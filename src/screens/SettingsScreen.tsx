import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { suggestPar } from '../store/selectors';
import { nf, digitsOnly, parseIntSafe, isoDate, fiscalYearStartIso, DAY } from '../utils/format';

export default function SettingsScreen() {
  const {
    state, warn, applyAllSuggested, recomputeUsageStats, go, updateGlobalSettings,
    setUsageDateFrom, setUsageDateTo, importUsageFile, setUsageConfirmFuzzy, clearUsageImport, commitUsageImport,
  } = useApp();
  const canEdit = state.role !== 'tech';
  const meds = state.meds.filter((m) => m.active);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Bug fix: these three numbers used to be pure hardcoded constants with no UI anywhere to
  // actually change them, even though this screen — labeled "ตั้งค่า" — displayed them right
  // next to real, working controls as if they were already a saved setting. Local draft state
  // + an explicit save (only enabled once the draft actually differs from the live value)
  // rather than autosave-on-every-keystroke, since these feed par calculations for the whole
  // formulary — a save should be a deliberate action, not a side effect of typing.
  const [warnDraft, setWarnDraft] = useState(String(state.expiryWarnDays));
  const [floorDraft, setFloorDraft] = useState(String(state.parFloorCoverDays));
  const [subDraft, setSubDraft] = useState(String(state.parSubCoverDays));
  useEffect(() => setWarnDraft(String(state.expiryWarnDays)), [state.expiryWarnDays]);
  useEffect(() => setFloorDraft(String(state.parFloorCoverDays)), [state.parFloorCoverDays]);
  useEffect(() => setSubDraft(String(state.parSubCoverDays)), [state.parSubCoverDays]);
  const warnDirty = warnDraft !== '' && parseIntSafe(warnDraft) !== state.expiryWarnDays;
  const coverDirty = (floorDraft !== '' && parseIntSafe(floorDraft) !== state.parFloorCoverDays)
    || (subDraft !== '' && parseIntSafe(subDraft) !== state.parSubCoverDays);

  const suggestDiffCount = meds.filter((m) => {
    const s = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
    return s.sub !== m.parSub || s.floor !== m.parFloor;
  }).length;

  const usageRows = state.usageRows || [];
  const usageMatched = usageRows.filter((r) => r.match.kind === 'exact').length;
  const usageFuzzy = usageRows.filter((r) => r.match.kind === 'fuzzy').length;
  const usageSkipped = usageRows.filter((r) => r.match.kind === 'ambiguous' || r.match.kind === 'none').length;
  const usagePeriodDays = state.usageDateFrom && state.usageDateTo
    ? Math.round((new Date(state.usageDateTo + 'T00:00:00').getTime() - new Date(state.usageDateFrom + 'T00:00:00').getTime()) / DAY) + 1
    : 0;
  const usageCanCommit = usageRows.length > 0 && usagePeriodDays > 0 && (usageFuzzy === 0 || state.usageConfirmFuzzy);

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="card" style={{ padding: 13, marginBottom: 13 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>เกณฑ์แจ้งเตือนวันหมดอายุ</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>แจ้งเตือนเมื่อ lot เหลืออายุน้อยกว่าจำนวนวันนี้</div>
        {canEdit ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              value={warnDraft}
              onChange={(e) => setWarnDraft(digitsOnly(e.target.value))}
              inputMode="numeric"
              style={{ width: 84, border: '1px solid var(--border)', borderRadius: 10, padding: '9px 10px', fontSize: 20, fontWeight: 700, textAlign: 'center' }}
            />
            <span className="muted" style={{ fontSize: 14 }}>วัน</span>
            {warnDirty && (
              <button
                onClick={() => updateGlobalSettings({ expiryWarnDays: parseIntSafe(warnDraft, state.expiryWarnDays) })}
                style={{ marginLeft: 'auto', border: 0, background: 'var(--green)', color: '#fff', padding: '9px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 38 }}
              >
                บันทึก
              </button>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 24, fontWeight: 700 }}>{warn()} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>วัน</span></div>
        )}
      </div>

      {!canEdit && (
        <div style={{ fontSize: 12, color: 'var(--amber-ink)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>บทบาทผู้ช่วยเภสัชกรดูค่าได้แต่แก้ไม่ได้ — การแก้ par level และชั้นวางสงวนไว้สำหรับเภสัชกรและ Admin</div>
      )}

      <div style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '12px 13px', marginBottom: 13 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>par อัตโนมัติจากสถิติการใช้</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 9 }}>คำนวณจากอัตราจ่ายเฉลี่ย/วัน (30 วันล่าสุด) × จำนวนวันที่ต้องสำรอง แล้วปรับเพิ่มตามความผันผวนของแต่ละรายการ</div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }}>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>par หน้างานสำรอง (วัน)</span>
              <input
                value={floorDraft}
                onChange={(e) => setFloorDraft(digitsOnly(e.target.value))}
                inputMode="numeric"
                style={{ width: 70, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 9px', fontSize: 14, fontWeight: 600, textAlign: 'center' }}
              />
            </label>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>par substock สำรอง (วัน)</span>
              <input
                value={subDraft}
                onChange={(e) => setSubDraft(digitsOnly(e.target.value))}
                inputMode="numeric"
                style={{ width: 70, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 9px', fontSize: 14, fontWeight: 600, textAlign: 'center' }}
              />
            </label>
            {coverDirty && (
              <button
                onClick={() => updateGlobalSettings({ parFloorCoverDays: parseIntSafe(floorDraft, state.parFloorCoverDays), parSubCoverDays: parseIntSafe(subDraft, state.parSubCoverDays) })}
                style={{ border: 0, background: 'var(--green)', color: '#fff', padding: '9px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 38 }}
              >
                บันทึก
              </button>
            )}
          </div>
        )}
        {!canEdit && (
          <div style={{ fontSize: 12.5, marginBottom: 9 }}>par หน้างานสำรอง {state.parFloorCoverDays} วัน, par substock สำรอง {state.parSubCoverDays} วัน</div>
        )}
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
            สำหรับยาที่ยังไม่มีประวัติ "นำเข้าจาก HOSxP" ในแอปพอ (60 วัน) — แนบไฟล์รายงานการใช้ยาจาก HOSxP (.xls/.xlsx) หรือ CSV รูปแบบ "ชื่อยา,จำนวนที่ใช้" ตามช่วงวันที่ที่ห้องยามีข้อมูลจริง (เช่น ปีงบประมาณปัจจุบันที่ยังไม่ครบปี) ระบบจะคำนวณอัตราเฉลี่ย/วันจากจำนวนวันในช่วงนั้นให้เอง — ปรับแค่ตัวเลขอัตราการใช้ที่ใช้แนะนำ par เท่านั้น ไม่กระทบยอดคงคลังจริง
          </div>

          <div className="grid-2" style={{ marginBottom: 8 }}>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>จากวันที่</span>
              <input type="date" value={state.usageDateFrom} onChange={(e) => setUsageDateFrom(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 13, minHeight: 40 }} />
            </label>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>ถึงวันที่</span>
              <input type="date" value={state.usageDateTo} onChange={(e) => setUsageDateTo(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 13, minHeight: 40 }} />
            </label>
          </div>
          <div style={{ display: 'flex', gap: 6, marginBottom: 10 }}>
            <button onClick={() => { setUsageDateFrom(fiscalYearStartIso()); setUsageDateTo(isoDate(Date.now())); }} className="chip" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)' }}>ปีงบประมาณนี้ (ต.ค.–ปัจจุบัน)</button>
            <button onClick={() => { const to = Date.now(); setUsageDateTo(isoDate(to)); setUsageDateFrom(isoDate(to - 30 * DAY)); }} className="chip" style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)' }}>30 วันล่าสุด</button>
          </div>
          {usagePeriodDays > 0 && <div className="muted" style={{ fontSize: 11, marginBottom: 10, marginTop: -4 }}>รวม {usagePeriodDays} วัน</div>}

          {!usageRows.length ? (
            <>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv,.txt,.xls,.xlsx,text/csv,text/plain,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                style={{ display: 'none' }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) importUsageFile(f); e.target.value = ''; }}
              />
              <button
                onClick={() => fileInputRef.current?.click()}
                className="btn-outline"
                style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46 }}
              >
                ↑ เลือกไฟล์ — รายงานการใช้ยาจาก HOSxP (.xls/.xlsx) หรือ CSV
              </button>
            </>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'var(--bg-subtle)', borderRadius: 10, padding: '9px 12px', marginBottom: 9 }}>
                <span style={{ minWidth: 0, fontSize: 12, lineHeight: 1.4 }}>
                  <span style={{ fontWeight: 600 }}>{state.usageFileName}</span>
                  <span className="muted" style={{ display: 'block', marginTop: 1 }}>
                    ตรงเป๊ะ {nf(usageMatched)} · ไม่ตรงเป๊ะ {nf(usageFuzzy)} · ข้าม {nf(usageSkipped)} รายการ
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
