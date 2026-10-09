import { useEffect, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { suggestPar, halfOfMaxRounded, floorMinOf, parAnomalies, usageAnomalies } from '../store/selectors';
import { nf, digitsOnly, parseIntSafe, isoDate, fiscalYearStartIso, thDate, DAY } from '../utils/format';
import { notificationsSupported } from '../utils/notify';
import { StatusDot } from '../components/Badge';
import { WEEKDAY_NAME, WEEKDAY_CLINICS } from '../data/clinics';

export default function SettingsScreen() {
  const {
    state, warn, applyAllSuggested, setAllMinHalfOfMax, setAllMinSuggested, recomputeUsageStats, analyzeWeekdayUsage, clearMedWeekdayPattern, clearMedPeakDay, go, updateGlobalSettings,
    setUsageDateFrom, setUsageDateTo, importUsageFile, setUsageConfirmFuzzy, clearUsageImport, commitUsageImport,
    notifyEnabled, notifyPermission, enableExpiryNotify, disableExpiryNotify,
    lowStockNotifyEnabled, enableLowStockNotify, disableLowStockNotify,
  } = useApp();
  // Real-world request: editing par-auto settings / alert thresholds is Admin-only now (was
  // pharm+admin) — everyone else still sees this screen read-only (see the !canEdit branches
  // below), same treatment as before, just a narrower editor set.
  const canEdit = state.role === 'admin';
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
  const [idleDraft, setIdleDraft] = useState(String(state.idleLogoutMinutes));
  useEffect(() => setWarnDraft(String(state.expiryWarnDays)), [state.expiryWarnDays]);
  useEffect(() => setFloorDraft(String(state.parFloorCoverDays)), [state.parFloorCoverDays]);
  useEffect(() => setSubDraft(String(state.parSubCoverDays)), [state.parSubCoverDays]);
  useEffect(() => setIdleDraft(String(state.idleLogoutMinutes)), [state.idleLogoutMinutes]);
  const warnDirty = warnDraft !== '' && parseIntSafe(warnDraft) !== state.expiryWarnDays;
  const coverDirty = (floorDraft !== '' && parseIntSafe(floorDraft) !== state.parFloorCoverDays)
    || (subDraft !== '' && parseIntSafe(subDraft) !== state.parSubCoverDays);
  const idleDirty = idleDraft !== '' && parseIntSafe(idleDraft) !== state.idleLogoutMinutes;

  const suggestDiff = meds.filter((m) => {
    const s = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
    return !!s && (s.sub !== m.parSub || s.floor !== m.parFloor);
  });
  const suggestDiffCount = suggestDiff.length;
  // Real-world request: "ทำข้อ...3 แบบดีที่สุด" (ตรวจสอบความแม่นยำของตัวเลขแนะนำ par) — suggestPar()
  // bases its whole calculation purely on the most recent 30-day window (used30), with no check
  // against how stable that number actually is. usageAnomalies() (ReportScreen's insights tab)
  // already flags a ≥40% swing vs the PRIOR 30-day window (usedPrev30) as worth a second look —
  // but "ใช้ค่าแนะนำทั้งหมด" below never cross-referenced it at all, so one click could silently
  // bake a par number sized off a data blip (a one-time bulk dispensing event, an import glitch)
  // into the live Min/Max for the whole formulary, with nobody ever having seen a warning.
  const suggestDiffIds = new Set(suggestDiff.map((m) => m.id));
  const unstableSuggestions = usageAnomalies(meds).filter((a) => suggestDiffIds.has(a.med.id));
  const minHalfDiffCount = meds.filter((m) => halfOfMaxRounded(m.parFloor) !== floorMinOf(m)).length;
  // Real-world request: "วิเคราะห์ Min Max...ให้เหมาะกับการใช้งานหน้างานจริง" — same diff-count
  // pattern as minHalfDiffCount above, but against suggestPar()'s own data-driven Min (real usage
  // rate × half the cover-days Max represents) instead of a flat 50%-of-Max ratio.
  const minSuggestedDiffCount = meds.filter((m) => {
    const s = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
    return !!s && s.min !== floorMinOf(m);
  }).length;

  // Real-world request: Min/Max/par substock are hand-typed numbers — an extra/missing zero,
  // or Min and Max swapped, is a genuinely easy typo to make and easy to miss just glancing at
  // a long meds list. This flags the internal-contradiction cases (always wrong, no judgment
  // call — see parAnomaliesFor()'s own doc comment) as errors, and a par that's wildly out of
  // line with the drug's own real usage rate as a softer "worth a look" review.
  const anomalies = parAnomalies(meds, state.parFloorCoverDays, state.parSubCoverDays);
  const anomalyErrors = anomalies.filter((a) => a.severity === 'error');
  const anomalyReviews = anomalies.filter((a) => a.severity === 'review');

  // Real-world request: "นำข้อมูลการจ่ายยาหน้างานจริงในแต่ละวันจันทร์-ศุกร์ นำมาวิเคราะห์การใช้ยา
  // จริง...ยาที่ใช้ในแต่ละวันก็จะต่างกัน" — a durable insight view of every med analyzeWeekdayUsage()
  // (AppContext.tsx) found a real weekday pattern for, not just a one-time toast after running
  // it — so an admin can come back and review the list at any time, not only right after a click.
  const weekdayPatternMeds = meds
    .filter((m) => m.weekdayPeakFactor && m.weekdayPeakDay)
    .sort((a, b) => (b.weekdayPeakFactor || 0) - (a.weekdayPeakFactor || 0));

  // Real-world request: "ยาบางตัว min max par ไม่เหมาะสม...จำนวนยาในการใช้ 1 ครั้ง เยอะกว่าค่า min
  // max ปัจจุบันอย่างมาก" (เช่น phenytoin สั่ง 3 เดือน 270 เม็ดใน 1 เคส) — same durable-insight
  // treatment as weekdayPatternMeds above, for the separate peakDayQty signal (Med's own doc
  // comment) analyzeWeekdayUsage() also now writes. Flags the ones where the real peak day
  // genuinely exceeds the med's CURRENT Max as the ones most worth a look first — those are
  // exactly the "เบิกฉุกเฉิน" risk this exists to catch, even before anyone clicks "ใช้ค่าแนะนำ".
  const peakDayMeds = meds
    .filter((m) => m.peakDayQty)
    .sort((a, b) => (b.peakDayQty || 0) - (a.peakDayQty || 0));
  const peakDayExceedsMaxCount = peakDayMeds.filter((m) => (m.peakDayQty || 0) > m.parFloor).length;

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
                className="btn-primary"
                style={{ marginLeft: 'auto', padding: '9px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 38 }}
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
        <div style={{ fontSize: 12, color: 'var(--amber-ink)', background: 'var(--amber-bg)', borderRadius: 10, padding: '10px 12px', marginBottom: 12 }}>ดูค่าได้แต่แก้ไม่ได้ — การแก้ par level, ชั้นวาง และค่าตั้งค่าระบบสงวนไว้สำหรับ Admin เท่านั้น</div>
      )}

      {/* Real-world request: "ตอนนี้ถ้า login นานทิ้งไว้ จะไม่ logout ออกให้อัตโนมัติเลย ซึ่ง
          อันตรายสำหรับข้อมูลยา" — see the idle-tracking effect in AppContext.tsx and
          IdleLogoutWarning.tsx for the actual countdown/warning; this is just where that
          threshold gets set, same shape as เกณฑ์แจ้งเตือนวันหมดอายุ above. Shared hospital-wide
          like every other setting on this screen, not per-device. */}
      <div className="card" style={{ padding: 13, marginBottom: 13 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>ออกจากระบบอัตโนมัติเมื่อไม่มีการใช้งาน</div>
        <div className="muted" style={{ fontSize: 12, marginBottom: 10 }}>เพื่อความปลอดภัยของข้อมูลยา — จะแจ้งเตือนล่วงหน้า 1 นาทีก่อนออกจากระบบจริง</div>
        {canEdit ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <input
              value={idleDraft}
              onChange={(e) => setIdleDraft(digitsOnly(e.target.value))}
              inputMode="numeric"
              style={{ width: 84, border: '1px solid var(--border)', borderRadius: 10, padding: '9px 10px', fontSize: 20, fontWeight: 700, textAlign: 'center' }}
            />
            <span className="muted" style={{ fontSize: 14 }}>นาที (ต่ำสุด 5)</span>
            {idleDirty && (
              <button
                onClick={() => updateGlobalSettings({ idleLogoutMinutes: parseIntSafe(idleDraft, state.idleLogoutMinutes) })}
                className="btn-primary"
                style={{ marginLeft: 'auto', padding: '9px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 38 }}
              >
                บันทึก
              </button>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 24, fontWeight: 700 }}>{state.idleLogoutMinutes} <span className="muted" style={{ fontSize: 14, fontWeight: 400 }}>นาที</span></div>
        )}
      </div>

      {/* Per-device opt-in, not a par setting — visible/settable to every role since it's just
          "แจ้งฉันตอนเปิดแอพ" on whatever phone/tablet this is, not something that affects anyone
          else's view. See utils/notify.ts for why this can only ever fire while the app is
          actually opened — a real background push needs a server this static site doesn't have. */}
      <div className="card" style={{ padding: 13, marginBottom: 13 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>แจ้งเตือนยาใกล้หมดอายุ</div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 10 }}>
          แจ้งเตือนระดับเครื่อง (OS notification) ตอนเปิดแอพ ถ้ามียาใกล้หมดอายุหรือหมดอายุแล้ว — สูงสุดวันละ 1 ครั้ง ใช้เกณฑ์วันเดียวกับ "เกณฑ์แจ้งเตือนวันหมดอายุ" ด้านบน ต้องเปิดแอพจริงถึงจะแจ้งได้ (ไม่ใช่ push เบื้องหลังแบบแอพมือถือทั่วไป เพราะระบบนี้ไม่มีเซิร์ฟเวอร์คอยเช็คให้)
        </div>
        {!notificationsSupported() ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>เบราว์เซอร์/อุปกรณ์นี้ไม่รองรับการแจ้งเตือนแบบนี้</div>
        ) : notifyEnabled ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot color="var(--green)">เปิดอยู่</StatusDot>
            <button onClick={disableExpiryNotify} style={{ marginLeft: 'auto', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', padding: '9px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 38 }}>ปิด</button>
          </div>
        ) : notifyPermission === 'denied' ? (
          <div style={{ fontSize: 12, color: 'var(--red)' }}>เบราว์เซอร์บล็อกการแจ้งเตือนไว้ — ไปเปิดสิทธิ์แจ้งเตือนให้เว็บนี้ในตั้งค่าเบราว์เซอร์/ระบบก่อน แล้วลองใหม่</div>
        ) : (
          <button onClick={enableExpiryNotify} className="btn-primary" style={{ padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40 }}>เปิดแจ้งเตือน</button>
        )}
      </div>

      {/* Same shape/reasoning as ยาใกล้หมดอายุ above — independent topic/opt-in so someone can
          turn this on without the expiry one or vice versa (see utils/notify.ts). Uses "Min"
          per drug (floorMinOf — see หน้าจัดการรายการยา to set it per item) and the same
          isUrgentLow() split TransferScreen's "เร่งด่วนวันนี้" filter uses, so the notification
          body always agrees with what that screen would actually show if opened right now. */}
      <div className="card" style={{ padding: 13, marginBottom: 13 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>แจ้งเตือนยาต่ำกว่า Min (ควรเติมหน้างาน)</div>
        <div className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 10 }}>
          แจ้งเตือนระดับเครื่อง (OS notification) ตอนเปิดแอพ ถ้ามียาถึงจุดต้องเติม (Min) แล้ว — สูงสุดวันละ 1 ครั้ง เกณฑ์ "Min" ตั้งได้แยกทีละยาที่หน้าจัดการรายการยา (ยาที่ใช้บ่อยตั้ง Min สูงขึ้นจะเติมบ่อย/ครั้งละน้อย ยาที่ใช้นาน ๆ ครั้งตั้ง Min ต่ำจะเติมนาน ๆ ครั้ง) ต้องเปิดแอพจริงถึงจะแจ้งได้เหมือนแจ้งเตือนวันหมดอายุด้านบน
        </div>
        {!notificationsSupported() ? (
          <div style={{ fontSize: 12, color: 'var(--muted)' }}>เบราว์เซอร์/อุปกรณ์นี้ไม่รองรับการแจ้งเตือนแบบนี้</div>
        ) : lowStockNotifyEnabled ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <StatusDot color="var(--green)">เปิดอยู่</StatusDot>
            <button onClick={disableLowStockNotify} style={{ marginLeft: 'auto', border: '1px solid var(--border)', background: 'var(--bg-card)', color: 'var(--ink)', padding: '9px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 38 }}>ปิด</button>
          </div>
        ) : notifyPermission === 'denied' ? (
          <div style={{ fontSize: 12, color: 'var(--red)' }}>เบราว์เซอร์บล็อกการแจ้งเตือนไว้ — ไปเปิดสิทธิ์แจ้งเตือนให้เว็บนี้ในตั้งค่าเบราว์เซอร์/ระบบก่อน แล้วลองใหม่</div>
        ) : (
          <button onClick={enableLowStockNotify} className="btn-primary" style={{ padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40 }}>เปิดแจ้งเตือน</button>
        )}
      </div>

      <div style={{ background: 'var(--green-tint)', borderRadius: 12, padding: '12px 13px', marginBottom: 13 }}>
        <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>par อัตโนมัติจากสถิติการใช้</div>
        <div style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 9 }}>คำนวณจากอัตราจ่ายเฉลี่ย/วัน (30 วันล่าสุด) × จำนวนวันที่ต้องสำรอง แล้วปรับเพิ่มตามความผันผวนของแต่ละรายการ</div>
        {/* "par substock สำรอง" ควรครอบคลุมรอบเบิกจากคลังใหญ่จริง (สัปดาห์ที่ 1/3 ของเดือน — ห่างกัน
            สูงสุด ~2-3 สัปดาห์แล้วแต่ปฏิทิน) บวกเผื่อดีเลย์จากบริษัทยาไม่มาส่ง (พบได้จริงถึง ~1
            สัปดาห์) — ไม่งั้นวันที่ของมาช้า substock อาจหมดพอดีโดยไม่มีกันชนเหลือเลย ปกติแนะนำ ~28
            วัน (รอบเบิกที่ยาวสุด + เผื่อดีเลย์ 1 สัปดาห์) */}
        <div style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 4, color: 'var(--muted)' }}>💡 par substock สำรอง ควรตั้งให้ครอบคลุมรอบเบิกจากคลังใหญ่จริง (สูงสุด ~2-3 สัปดาห์) บวกเผื่อดีเลย์กรณีบริษัทยาไม่มาส่ง (~1 สัปดาห์) — แนะนำ ~28 วัน</div>
        {/* par หน้างานสำรอง ต้องครอบคลุมช่วงวันศุกร์-จันทร์ (เติมหน้างานทุกวันทำการ แต่ไม่เติม
            เสาร์-อาทิตย์) ที่เติมวันศุกร์ต้องอยู่ได้ถึงวันจันทร์ = ช่องว่างจริง 3 วัน + เผื่ออีก 1 วัน
            สำหรับความผันผวน/กำลังคนน้อยที่บางวันอาจเติมไม่ครบทุกตัว */}
        <div style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 9, color: 'var(--muted)' }}>💡 par หน้างานสำรอง ต้องครอบคลุมช่วงศุกร์–จันทร์ (เติมหน้างานทุกวันทำการ แต่ไม่เติมเสาร์-อาทิตย์ — ของที่เติมวันศุกร์ต้องอยู่ได้ถึงเช้าวันจันทร์ ช่องว่างจริง 3 วัน) บวกเผื่ออีก 1 วันสำหรับกำลังคนน้อย — แนะนำ ~4 วัน</div>
        {canEdit && (
          <div style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginBottom: 10, flexWrap: 'wrap' }}>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>par หน้างานสำรอง (วัน)</span>
              <input
                value={floorDraft}
                onChange={(e) => setFloorDraft(digitsOnly(e.target.value))}
                inputMode="numeric"
                style={{ width: 70, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 9px', fontSize: 16, fontWeight: 600, textAlign: 'center' }}
              />
            </label>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>par substock สำรอง (วัน)</span>
              <input
                value={subDraft}
                onChange={(e) => setSubDraft(digitsOnly(e.target.value))}
                inputMode="numeric"
                style={{ width: 70, border: '1px solid var(--border)', borderRadius: 9, padding: '8px 9px', fontSize: 16, fontWeight: 600, textAlign: 'center' }}
              />
            </label>
            {coverDirty && (
              <button
                onClick={() => updateGlobalSettings({ parFloorCoverDays: parseIntSafe(floorDraft, state.parFloorCoverDays), parSubCoverDays: parseIntSafe(subDraft, state.parSubCoverDays) })}
                className="btn-primary"
                style={{ padding: '9px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 38 }}
              >
                บันทึก
              </button>
            )}
          </div>
        )}
        {!canEdit && (
          <div style={{ fontSize: 12.5, marginBottom: 9 }}>par หน้างานสำรอง {state.parFloorCoverDays} วัน, par substock สำรอง {state.parSubCoverDays} วัน</div>
        )}
        {canEdit && unstableSuggestions.length > 0 && (
          <div style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 10, background: 'var(--amber-bg)', color: 'var(--amber-ink)', borderRadius: 10, padding: '9px 11px' }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>
              ⚠ {unstableSuggestions.length} จาก {suggestDiffCount} รายการที่จะเปลี่ยน มีอัตราการใช้ผันผวนมาก (เปลี่ยน ≥40% จากช่วง 30 วันก่อนหน้า)
            </div>
            <div style={{ marginBottom: unstableSuggestions.length > 0 ? 6 : 0 }}>
              ค่าแนะนำของรายการเหล่านี้อิงจากแค่ 30 วันล่าสุด — ถ้าช่วงนั้นมีเหตุการณ์ผิดปกติ (จ่ายยาครั้งใหญ่ครั้งเดียว, นำเข้าข้อมูลผิดช่วง) ค่าที่แนะนำอาจสูง/ต่ำเกินจริง ควรตรวจสอบรายตัวก่อนกด "ใช้ค่าแนะนำทั้งหมด" ด้านล่าง
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {unstableSuggestions.slice(0, 8).map((a) => (
                <div key={a.med.id} style={{ fontSize: 11, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.med.name}</span>
                  <span style={{ flex: 'none', fontWeight: 600 }}>{nf(a.med.usedPrev30)} → {nf(a.med.used30)} ({a.direction === 'up' ? '+' : ''}{Math.round(a.changePct * 100)}%)</span>
                </div>
              ))}
              {unstableSuggestions.length > 8 && <div className="muted">และอีก {unstableSuggestions.length - 8} รายการ</div>}
            </div>
          </div>
        )}
        {canEdit && (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <button onClick={applyAllSuggested} disabled={!!state.busy['applyAllSuggested']} className="btn-primary" style={{ padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40, opacity: state.busy['applyAllSuggested'] ? 0.7 : 1 }}>
              {state.busy['applyAllSuggested'] ? 'กำลังบันทึก…' : `ใช้ค่าแนะนำทั้งหมด (${suggestDiffCount} รายการเปลี่ยน)`}
            </button>
            <button onClick={recomputeUsageStats} disabled={!!state.busy['recomputeUsageStats']} style={{ border: '1px solid var(--green)', background: 'var(--bg-card)', color: 'var(--green)', padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40, opacity: state.busy['recomputeUsageStats'] ? 0.7 : 1 }}>
              {state.busy['recomputeUsageStats'] ? 'กำลังคำนวณ…' : 'คำนวณสถิติการใช้ใหม่จากประวัติ HOSxP ↺'}
            </button>
            <button
              onClick={analyzeWeekdayUsage}
              disabled={!!state.busy['analyzeWeekdayUsage']}
              title="วิเคราะห์รูปแบบการใช้ยารายวันจันทร์-ศุกร์ (91 วันล่าสุด) และวันจ่ายยาสูงสุดในวันเดียว (180 วันล่าสุด) จากประวัติ HOSxP — ยาที่มีวันใช้มากผิดปกติชัดเจน (เช่น ตรงกับวันคลินิกเฉพาะทาง หรือมีเคสสั่งยาคราวละมากๆ) จะได้ par หน้างาน/substock ที่สูงพอรองรับวันนั้นโดยเฉพาะ"
              style={{ border: '1px solid var(--ipd)', background: 'var(--bg-card)', color: 'var(--ipd)', padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40, opacity: state.busy['analyzeWeekdayUsage'] ? 0.7 : 1 }}
            >
              {state.busy['analyzeWeekdayUsage'] ? 'กำลังวิเคราะห์…' : 'วิเคราะห์รูปแบบการใช้ยารายวัน/วันจ่ายสูงสุด ↺'}
            </button>
            {minSuggestedDiffCount > 0 && (
              <button
                onClick={setAllMinSuggested}
                disabled={!!state.busy['setAllMinSuggested']}
                title="เขียนทับค่า Min ของยาทุกตัวที่มีสถิติการใช้ (รวมที่เคยตั้งเองไว้) ด้วยค่าที่คำนวณจากอัตราการใช้จริงของยาตัวนั้นๆ"
                style={{ border: '1px solid var(--green)', background: 'var(--green-tint)', color: 'var(--green)', padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40, opacity: state.busy['setAllMinSuggested'] ? 0.7 : 1 }}
              >
                {state.busy['setAllMinSuggested'] ? 'กำลังบันทึก…' : `ตั้ง Min ตามอัตราการใช้จริงทั้งหมด (${minSuggestedDiffCount} รายการเปลี่ยน)`}
              </button>
            )}
            {minHalfDiffCount > 0 && (
              <button
                onClick={setAllMinHalfOfMax}
                disabled={!!state.busy['setAllMinHalfOfMax']}
                title="เขียนทับค่า Min ของยาทุกตัว (รวมที่เคยตั้งเองไว้) ให้เป็น 50% ของ Max — สำหรับยาที่ยังไม่มีสถิติการใช้พอให้คำนวณตามจริง"
                style={{ border: '1px solid var(--amber)', background: 'var(--amber-bg)', color: 'var(--amber-ink)', padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40, opacity: state.busy['setAllMinHalfOfMax'] ? 0.7 : 1 }}
              >
                {state.busy['setAllMinHalfOfMax'] ? 'กำลังบันทึก…' : `ตั้ง Min ที่เหลือ = 50% ของ Max (${minHalfDiffCount} รายการเปลี่ยน)`}
              </button>
            )}
          </div>
        )}
        {/* Real-world request: "used30 ไม่มีการคำนวณใหม่อัตโนมัติ...ไม่มีสัญญาณเตือนว่าข้อมูลเก่า
            แค่ไหนแล้ว" — scripts/recompute-usage-stats.mjs now runs this same calculation
            automatically every day (see its own header comment), but staff still need to actually
            SEE that it's current — or notice if the scheduled job ever silently stops running
            (a missing/expired secret, a billing issue) — not just trust it blindly. */}
        {(() => {
          const at = state.usageStatsRecomputedAt;
          const daysAgo = at ? Math.floor((Date.now() - at) / DAY) : null;
          // The scheduled job runs daily — 2 days of silence already means it skipped at least
          // one run; anything past that is worth flagging in amber/red rather than staying quiet.
          const stale = daysAgo === null || daysAgo >= 2;
          const veryStale = daysAgo === null || daysAgo >= 7;
          return (
            <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 8, color: veryStale ? 'var(--red)' : stale ? 'var(--amber-ink)' : undefined, fontWeight: stale ? 600 : undefined }}>
              {at
                ? 'คำนวณสถิติการใช้ยาล่าสุด: ' + thDate(at) + (daysAgo === 0 ? ' (วันนี้)' : ' (' + nf(daysAgo || 0) + ' วันที่แล้ว)') + (stale ? ' — นานกว่าปกติ ตรวจสอบระบบอัตโนมัติ (recompute-usage-stats.yml) หรือกด "คำนวณสถิติการใช้ใหม่" เองด้านบน' : ' — ระบบคำนวณให้อัตโนมัติทุกวันแล้ว')
                : 'ยังไม่เคยคำนวณสถิติการใช้ยาเลย — กด "คำนวณสถิติการใช้ใหม่จากประวัติ HOSxP" ด้านบนอย่างน้อย 1 ครั้ง ค่าแนะนำ par ทั้งหมดจะยังไม่แม่นยำจนกว่าจะทำขั้นตอนนี้'}
              {' '}อัตราการใช้คำนวณจากประวัติ "นำเข้าจาก HOSxP" เท่านั้น ถ้ากดตอนที่ยังไม่มีประวัติ HOSxP เลย ค่าจะกลายเป็น 0 ทั้งหมด
            </div>
          );
        })()}
        <div className="muted" style={{ fontSize: 10.5, lineHeight: 1.5, marginTop: 4 }}>"วิเคราะห์รูปแบบการใช้ยารายวัน" ตรวจแยกแต่ละวันจันทร์-ศุกร์จากประวัติ HOSxP 91 วันล่าสุด (ต้องมีข้อมูลอย่างน้อย 4 ครั้งต่อวันถึงจะนับ) — ยาที่พบวันใช้มากผิดปกติชัดเจนจะได้ par หน้างานที่แนะนำสูงขึ้นเฉพาะให้พอรองรับวันนั้น โดยไม่กระทบ par substock (รอบเบิกคลังใหญ่ยาวพอที่จะเกลี่ยยอดในแต่ละวันออกไปเองอยู่แล้ว) — พร้อมกันนี้จะตรวจหาวันที่จ่ายยาสูงสุดในวันเดียวจากประวัติ 180 วันล่าสุดด้วย (เช่น เคสสั่งยา 3 เดือนครั้งเดียว) แล้วทำให้ par หน้างาน/substock ไม่ต่ำกว่าวันที่จ่ายสูงสุดนั้น ป้องกันไม่ให้ต้องเบิกฉุกเฉินซ้ำเมื่อเคสแบบเดียวกันเกิดขึ้นอีก</div>
      </div>

      {weekdayPatternMeds.length > 0 && (
        <div className="card" style={{ padding: 13, marginBottom: 13, border: '1px solid var(--ipd)', background: 'var(--ipd-bg)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4, color: 'var(--ipd)' }}>
            📅 ยาที่มีรูปแบบการใช้รายวันชัดเจน ({weekdayPatternMeds.length} รายการ)
          </div>
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 10 }}>
            จากการวิเคราะห์ประวัติ HOSxP ล่าสุด — par หน้างานที่แนะนำของรายการเหล่านี้คิดรวมวันที่ใช้มากที่สุดของแต่ละตัวไว้แล้ว (ไม่ใช่แค่ค่าเฉลี่ยทั้งสัปดาห์)
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {weekdayPatternMeds.slice(0, 30).map((m) => {
              // Follow-up request: a drug genuinely busy on a SECOND weekday (not just its single
              // busiest one) used to be invisible here — weekdayPattern (all 5 ratios) lets this
              // list every weekday that's also meaningfully elevated, same 1.15 threshold
              // analyzeWeekdayUsage() itself uses, excluding the peak day already shown above it.
              const secondaryDays = (m.weekdayPattern || [])
                .map((ratio, i) => ({ wd: i + 1, ratio }))
                .filter((d) => d.wd !== m.weekdayPeakDay && d.ratio >= 1.15)
                .sort((a, b) => b.ratio - a.ratio);
              return (
                <div key={m.id} style={{ background: 'var(--bg-card)', borderRadius: 9, padding: '8px 10px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.name}</span>
                    <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: 'var(--ipd)' }}>×{m.weekdayPeakFactor?.toFixed(2)}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
                    ใช้มากสุดวัน{WEEKDAY_NAME[m.weekdayPeakDay as number]}
                    {WEEKDAY_CLINICS[m.weekdayPeakDay as number] ? ' — ตรงกับคลินิก: ' + WEEKDAY_CLINICS[m.weekdayPeakDay as number] : ''}
                    {/* Follow-up request: show how much real history backs this number, so an
                        admin can judge a borderline case (right at the minimum) differently from
                        a well-established one, instead of taking the bare multiplier on faith. */}
                    {' · จากข้อมูล ' + nf(m.weekdayPeakOccurrences || 0) + ' ครั้ง'}
                  </div>
                  {secondaryDays.length > 0 && (
                    <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
                      ใช้มากกว่าปกติอีกด้วย: {secondaryDays.map((d) => WEEKDAY_NAME[d.wd] + ' ×' + d.ratio.toFixed(2)).join(', ')}
                    </div>
                  )}
                  {/* Follow-up request: "แก้ไข/ยกเลิกรูปแบบที่ตรวจพบเองไม่ได้" — previously the only
                      way to clear a wrongly-detected pattern was to wait for new data to flatten
                      it out on a later analyzeWeekdayUsage() run. */}
                  <button
                    onClick={() => clearMedWeekdayPattern(m.id)}
                    style={{ marginTop: 5, border: 0, background: 'transparent', color: 'var(--muted)', fontSize: 10.5, fontWeight: 600, padding: '2px 0' }}
                  >
                    ✕ ล้างรูปแบบนี้
                  </button>
                </div>
              );
            })}
            {weekdayPatternMeds.length > 30 && <div className="muted" style={{ fontSize: 11 }}>และอีก {weekdayPatternMeds.length - 30} รายการ</div>}
          </div>
        </div>
      )}

      {/* Real-world request: "ยาบางตัว min max par ไม่เหมาะสม...จำนวนยาในการใช้ 1 ครั้ง เยอะกว่า
          ค่า min max ปัจจุบันอย่างมาก" (เช่น phenytoin สั่ง 3 เดือน 270 เม็ดใน 1 เคส ยาก็ต้องเบิก
          ฉุกเฉินหน้างานจริง) — same durable-insight-card treatment as weekdayPatternMeds above,
          red/amber (not the neutral ipd-blue the weekday card uses) specifically because a drug
          whose peak already exceeds its current Max is an active, unresolved risk right now —
          not just an interesting pattern to know about. */}
      {peakDayMeds.length > 0 && (
        <div className="card" style={{ padding: 13, marginBottom: 13, border: '1px solid ' + (peakDayExceedsMaxCount > 0 ? 'var(--red)' : 'var(--amber)'), background: peakDayExceedsMaxCount > 0 ? 'var(--red-bg, #fbeceb)' : 'var(--amber-bg)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4, color: peakDayExceedsMaxCount > 0 ? 'var(--red)' : 'var(--amber-ink)' }}>
            🚨 ยาที่มีวันจ่ายยาสูงสุดในวันเดียวสูงผิดปกติ ({peakDayMeds.length} รายการ{peakDayExceedsMaxCount > 0 ? `, ${peakDayExceedsMaxCount} รายการเกิน Max ปัจจุบัน` : ''})
          </div>
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 10 }}>
            จากการวิเคราะห์ประวัติ HOSxP 180 วันล่าสุด — เป็นวันที่มีการจ่ายยาตัวนี้มากที่สุดในวันเดียว (เช่น เคสสั่งยาคราวละมากๆ) ค่าแนะนำ par หน้างาน/substock ของรายการเหล่านี้จะไม่ต่ำกว่าตัวเลขนี้แล้ว — กด "ใช้ค่าแนะนำทั้งหมด" ด้านบนเพื่อให้มีผลจริง
          </div>
          <div style={{ maxHeight: 320, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {peakDayMeds.slice(0, 30).map((m) => {
              const exceedsMax = (m.peakDayQty || 0) > m.parFloor;
              return (
                <div key={m.id} style={{ background: 'var(--bg-card)', borderRadius: 9, padding: '8px 10px', border: '1px solid var(--border)' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                    <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>{m.name}</span>
                    <span style={{ flex: 'none', fontSize: 10.5, fontWeight: 700, color: exceedsMax ? 'var(--red)' : 'var(--amber-ink)' }}>{nf(m.peakDayQty || 0)} {m.unit}</span>
                  </div>
                  <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
                    จ่ายสูงสุดวันที่ {m.peakDayDate ? thDate(new Date(m.peakDayDate + 'T00:00:00').getTime()) : '-'}
                    {exceedsMax && <span style={{ color: 'var(--red)', fontWeight: 600 }}> — เกิน Max ปัจจุบัน ({nf(m.parFloor)} {m.unit})</span>}
                  </div>
                  {/* Same immediate-clear escape hatch as the weekday-pattern card's "✕ ล้าง
                      รูปแบบนี้" — a genuinely one-time event (data-entry error, a med being
                      discontinued) shouldn't have to wait PEAK_LOOKBACK_DAYS for new history to
                      age the old peak out on its own. */}
                  <button
                    onClick={() => clearMedPeakDay(m.id)}
                    style={{ marginTop: 5, border: 0, background: 'transparent', color: 'var(--muted)', fontSize: 10.5, fontWeight: 600, padding: '2px 0' }}
                  >
                    ✕ ล้างค่านี้
                  </button>
                </div>
              );
            })}
            {peakDayMeds.length > 30 && <div className="muted" style={{ fontSize: 11 }}>และอีก {peakDayMeds.length - 30} รายการ</div>}
          </div>
        </div>
      )}

      {anomalies.length > 0 && (
        <div className="card" style={{ padding: 13, marginBottom: 13, border: '1px solid ' + (anomalyErrors.length > 0 ? 'var(--red)' : 'var(--amber)'), background: anomalyErrors.length > 0 ? 'var(--red-bg, #fbeceb)' : 'var(--amber-bg)' }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, marginBottom: 4, color: anomalyErrors.length > 0 ? 'var(--red)' : 'var(--amber-ink)' }}>
            ⚠️ par Min/Max/substock ที่ดูผิดปกติ ({anomalies.length} รายการ)
          </div>
          <div className="muted" style={{ fontSize: 11.5, lineHeight: 1.6, marginBottom: 10 }}>
            {anomalyErrors.length > 0 && <>{anomalyErrors.length} รายการขัดแย้งในตัวเอง (เช่น Min ≥ Max, ยังไม่ได้ตั้ง par ทั้งที่มีการจ่ายจริง) ควรแก้ไข{anomalyReviews.length > 0 ? ' · ' : ''}</>}
            {anomalyReviews.length > 0 && <>{anomalyReviews.length} รายการค่าต่างจากที่แนะนำจากสถิติการใช้จริงมาก ควรตรวจสอบ</>}
          </div>
          <div style={{ maxHeight: 260, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 7 }}>
            {anomalies.slice(0, 30).map((a, i) => (
              <div key={a.med.id + a.code + i} style={{ background: 'var(--bg-card)', borderRadius: 9, padding: '8px 10px', border: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: a.severity === 'error' ? 'var(--red)' : 'var(--amber-ink)' }}>
                    {a.severity === 'error' ? 'ผิดพลาด' : 'ควรทบทวน'}
                  </span>
                  <span style={{ fontSize: 12.5, fontWeight: 600, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{a.med.name}</span>
                </div>
                <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>{a.note}</div>
              </div>
            ))}
            {anomalies.length > 30 && <div className="muted" style={{ fontSize: 11, textAlign: 'center' }}>และอีก {anomalies.length - 30} รายการ</div>}
          </div>
          {canEdit && (
            <button onClick={() => go('meds')} style={{ marginTop: 10, width: '100%', border: 0, background: anomalyErrors.length > 0 ? 'var(--red)' : 'var(--amber)', color: 'var(--ink-soft)', padding: '10px 14px', borderRadius: 9, fontSize: 12.5, fontWeight: 600, minHeight: 40 }}>
              ไปที่จัดการรายการยา เพื่อแก้ไข →
            </button>
          )}
        </div>
      )}

      {canEdit && (
        <div className="card" style={{ padding: 13, marginBottom: 13 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, marginBottom: 4 }}>นำเข้าอัตราการใช้จากไฟล์</div>
          <div className="muted" style={{ fontSize: 12, lineHeight: 1.6, marginBottom: 10 }}>
            สำหรับยาที่ยังไม่มีประวัติ "นำเข้าจาก HOSxP" ในแอปพอ (60 วัน) — แนบไฟล์รายงานการใช้ยาจาก HOSxP (.xls/.xlsx) หรือ CSV รูปแบบ "ชื่อยา,จำนวนที่ใช้" ตามช่วงวันที่ที่ห้องยามีข้อมูลจริง (เช่น ปีงบประมาณปัจจุบันที่ยังไม่ครบปี) ระบบจะคำนวณอัตราเฉลี่ย/วันจากจำนวนวันในช่วงนั้นให้เอง — ปรับแค่ตัวเลขอัตราการใช้ที่ใช้แนะนำ par เท่านั้น ไม่กระทบยอดคงคลังจริง
          </div>

          <div className="grid-2" style={{ marginBottom: 8 }}>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>จากวันที่</span>
              <input type="date" value={state.usageDateFrom} onChange={(e) => setUsageDateFrom(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 16, minHeight: 40 }} />
            </label>
            <label>
              <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>ถึงวันที่</span>
              <input type="date" value={state.usageDateTo} onChange={(e) => setUsageDateTo(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 16, minHeight: 40 }} />
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
                disabled={!usageCanCommit || !!state.busy['usageImport']}
                className="btn-primary"
                style={{ width: '100%', padding: 14, borderRadius: 11, fontSize: 14, fontWeight: 600, minHeight: 48, opacity: usageCanCommit && !state.busy['usageImport'] ? 1 : 0.5 }}
              >
                {state.busy['usageImport'] ? 'กำลังนำเข้า…' : `นำเข้าอัตราการใช้ (${nf(usageMatched + usageFuzzy)} รายการ)`}
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
