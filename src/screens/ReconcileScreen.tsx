import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { wardOf, hosxpMissReasons, isRegularlyDispensed } from '../store/selectors';
import { nf, thDate, isoDate } from '../utils/format';
import type { HosxpMatch, Med, MedId, ReconcileGapDay } from '../types';
import { Badge } from '../components/Badge';

// Real-world request: "ป้องกันการหลุดยาที่มีในระบบแต่ไม่ได้ถูกตัดจำนวนยา และป้องกันการหลุดวันที่
// ยังไม่ได้แนบไฟล์" — how far back fetchReconcileGaps (AppContext.tsx) looks every time this
// screen opens. 7 days: far enough to catch a missed day from a few days ago (a short staffing
// gap, a long weekend) while staying a cheap, bounded Firestore query every mount — not the
// unbounded full-history scan recomputeUsageStats/analyzeWeekdayUsage use for their own very
// different (admin-triggered, infrequent) purpose.
const RECONCILE_GAP_LOOKBACK_DAYS = 7;

const DAY = 24 * 60 * 60 * 1000;

// Shared with the retrospective "ฝั่งแอพ" panel below — same label/color convention as the
// live pre-commit miss-reasons panel (hosxpMissReasons' own render below), minus 'zero_qty'
// (never persisted to the audit log — see commitReconcile's own comment on why, AppContext.tsx).
const MISS_REASON_BADGE: Record<'not_in_file' | 'ambiguous', { label: string; color: string; bg: string }> = {
  not_in_file: { label: 'ไม่พบในไฟล์', color: 'var(--amber-ink)', bg: 'var(--amber-bg)' },
  ambiguous: { label: 'ต้องตรวจสอบ', color: 'var(--red)', bg: 'var(--red-bg)' },
};

export default function ReconcileScreen() {
  const { state, setHosxpText, processHosxp, processHosxpFile, setHosxpConfirmFuzzy, setHosxpCoveredFrom, setHosxpCoveredTo, commitReconcile, fetchReconcileGaps, toast, go, setMedsFocusId } = useApp();

  // Real-world request: "เพื่อนำไปสู่การแก้ไขปัญหายาที่อาจจะยังมีปัญหาครับ"/"สามารถเชื่อมโยงปัญหานั่น
  // ไปแก้ปัญหาจริงได้" — a miss-reasons row used to just explain what's wrong with no way to act
  // on it from here; this jumps straight to that med's own edit form in หน้าจัดการรายการยา (where
  // the "ชื่อที่ไฟล์ HOSxP อาจใช้เรียกยานี้" alias field and the real name itself both live),
  // reusing the exact same medsFocusId mechanism the QR-scan "ดูข้อมูลยา" flow already uses —
  // see MedsScreen.tsx's own "A QR scan...lands here with medsFocusId set" comment.
  const goFixMed = (medId: MedId) => { setMedsFocusId(medId); go('meds'); };
  const fileInputRef = useRef<HTMLInputElement>(null);

  const medById = (id: string) => state.meds.find((x) => x.id === id);

  // Bug fix: `before` used to read `med.floor` fresh off live app state for every row
  // independently — correct for the common case (one line per drug), but commitReconcile()
  // below processes rows SEQUENTIALLY, each via its own transaction that re-reads whatever the
  // PRECEDING row in this same batch just wrote. A HOSxP export with two lines that both match
  // the same drug (two package-size rows fuzzy-matching one med, or a genuine duplicate line)
  // used to show both rows against the same original floor — e.g. floor 100, two rows of
  // qty 10 and 5 both previewed as "100 → 90" — silently under-stating the real combined effect
  // (100 → 90 → 85) a pharmacist is about to confirm. Track a running per-med floor across this
  // preview's own rows, mirroring commitReconcile()'s real sequential behavior exactly, so the
  // second (and any later) row for the same med previews against what the first row actually
  // left behind.
  const reconcileRows = (() => {
    const running = new Map<string, number>();
    return (state.hosxpRows || []).map((r) => {
      const med = r.match.kind === 'exact' || r.match.kind === 'fuzzy' ? medById(r.match.medId) : undefined;
      const before = med ? (running.has(med.id) ? running.get(med.id)! : med.floor) : 0;
      const after = med ? Math.max(0, before - r.qty) : 0;
      if (med) running.set(med.id, after);
      return { fileText: r.name, qty: r.qty, match: r.match, med, before, after };
    });
  })();

  // Real-world request: "ต้องมีรายละเอียดบอกให้ชัดเจนเลยครับว่ายาในแอพตัวใดไม่ได้ถูกตัดจ่าย ต้องมี
  // เหตุผลกำกับ" — see hosxpMissReasons' own doc comment (selectors.ts) for the full design; runs
  // on this SAME file, before commit, so there's still something to fix.
  const missEntries = useMemo(() => hosxpMissReasons(state.meds, state.hosxpRows || []), [state.meds, state.hosxpRows]);

  const fuzzyCount = reconcileRows.filter((r) => r.match.kind === 'fuzzy').length;
  const skippedCount = reconcileRows.filter((r) => r.match.kind === 'ambiguous' || r.match.kind === 'none').length;
  // Real-world explanation: "เช้าวันจันทร์จะตัดยอดหน้างานโดยแนบไฟล์ ของวันศุกร์ เสาร์และอาทิตย์ เป็น
  // จำนวน 3 วัน" — the old single boolean "confirm this covers 1 day" checkbox was factually
  // wrong every Monday. hosxpCoveredFrom/To now state the real range directly (see their own doc
  // comment, types.ts) — valid when both are set, from ≤ to, and the range doesn't reach into
  // today (today's own dispensing isn't in any file yet — see commitReconcile()'s own check).
  const todayIso = isoDate(Date.now());
  const coveredValid = !!state.hosxpCoveredFrom && !!state.hosxpCoveredTo && state.hosxpCoveredFrom <= state.hosxpCoveredTo && state.hosxpCoveredTo < todayIso;
  const daysCovered = coveredValid
    ? Math.round((new Date(state.hosxpCoveredTo + 'T00:00:00').getTime() - new Date(state.hosxpCoveredFrom + 'T00:00:00').getTime()) / DAY) + 1
    : 0;
  const canCommit = reconcileRows.length > 0 && (fuzzyCount === 0 || state.hosxpConfirmFuzzy) && coveredValid;

  // "ยาที่หลุดบ่อย" — aggregates commitReconcile()'s own 'hosxp_unmatched' audit entries (see
  // its doc comment, AppContext.tsx) across whatever's in the currently-loaded audit log
  // (capped 300, newest first — same window every other audit-derived view in this app already
  // works from). A name that fails to match every single day is easy to miss as "just another
  // skip" in the moment; tallied up over time it's obviously worth fixing (renaming the med, or
  // adding the HOSxP spelling as the med's own name) instead of re-discovering it each morning.
  const unmatchedFreq = useMemo(() => {
    const counts = new Map<string, { count: number; lastTs: number }>();
    for (const e of state.authLog) {
      if (e.type !== 'hosxp_unmatched') continue;
      const names = (e.note.split('\n')[1] || '').split(' | ').map((s) => s.trim()).filter(Boolean);
      for (const name of names) {
        const cur = counts.get(name);
        if (cur) { cur.count++; if (e.ts > cur.lastTs) cur.lastTs = e.ts; } else counts.set(name, { count: 1, lastTs: e.ts });
      }
    }
    return Array.from(counts.entries()).map(([name, v]) => ({ name, ...v })).sort((a, b) => b.count - a.count || b.lastTs - a.lastTs).slice(0, 10);
  }, [state.authLog]);

  // The OTHER direction from unmatchedFreq above — a med THIS APP carries that regularly
  // dispenses but kept getting no deduction, WITH the specific reason, aggregated across
  // recent commitReconcile() runs' own 'hosxp_miss_reasons' audit entries (see that function's
  // doc comment, AppContext.tsx, for the exact note format this parses). Only exists from the
  // moment that logging shipped onward — a run from before it existed simply isn't in this
  // count, same "audit log is the only history, nothing retroactive" limit every other
  // audit-derived view in this app already has.
  const missReasonFreq = useMemo(() => {
    const counts = new Map<string, { name: string; reason: 'not_in_file' | 'ambiguous'; count: number; lastTs: number }>();
    for (const e of state.authLog) {
      if (e.type !== 'hosxp_miss_reasons') continue;
      const entries = (e.note.split('\n')[1] || '').split(' | ').map((s) => s.trim()).filter(Boolean);
      for (const entry of entries) {
        const m = /^\[(not_in_file|ambiguous)\]\s*(.+)$/.exec(entry);
        if (!m) continue;
        const reason = m[1] as 'not_in_file' | 'ambiguous';
        const name = m[2];
        const key = reason + '::' + name;
        const cur = counts.get(key);
        if (cur) { cur.count++; if (e.ts > cur.lastTs) cur.lastTs = e.ts; } else counts.set(key, { name, reason, count: 1, lastTs: e.ts });
      }
    }
    return Array.from(counts.values()).sort((a, b) => b.count - a.count || b.lastTs - a.lastTs).slice(0, 10);
  }, [state.authLog]);

  // Real-world request: "ตรวจสอบว่าไหนที่ยังไม่ถูกตัดจำนวนยาที่ใช้ เนื่องจากอาจเกิดจากความผิดพลาด
  // ของไฟล์ที่ดึงข้อมูลมาไม่หมด หรือจำนวนยาที่ใช้เป็น 0 จริง" — the "ยาที่หลุดบ่อย" panel above only
  // covers a row that WAS in a HOSxP file but failed to match a med by name; it says nothing
  // about a drug that's genuinely regularly dispensed but missing from the file ENTIRELY (no row
  // at all — the exact "file didn't pull complete data" risk being asked about), which no
  // existing view surfaces. Finds the most recent calendar day any reconcile_hosxp tx landed
  // (state.txs, same capped-300-newest window every other audit-derived view here already
  // works from — see unmatchedFreq above), collects which meds got a deduction that day, and
  // diffs that against every active med with a real, regular usage history (used30 > 0) — a
  // formulary has plenty of genuinely-rare drugs that go days without being dispensed at all,
  // so limiting to used30 > 0 keeps this focused on "this one normally moves and didn't" instead
  // of listing half the formulary every single day.
  const notDeductedLatestDay = useMemo(() => {
    let latestTs = 0;
    for (const t of state.txs) {
      if (t.type === 'reconcile_hosxp' && t.ts > latestTs) latestTs = t.ts;
    }
    if (!latestTs) return null;
    const latestDayKey = new Date(latestTs).toDateString();
    const deductedIds = new Set<string>();
    for (const t of state.txs) {
      if (t.type === 'reconcile_hosxp' && t.medId && new Date(t.ts).toDateString() === latestDayKey) deductedIds.add(t.medId);
    }
    // isRegularlyDispensed() (selectors.ts), not the old plain `used30 > 0` — see its own doc
    // comment on why: a drug kept for rare emergency use was flooding this exact panel with
    // false positives.
    const missing = state.meds
      .filter((m) => m.active && isRegularlyDispensed(m) && !deductedIds.has(m.id))
      .sort((a, b) => b.used30 - a.used30);
    return { dayLabel: thDate(latestTs), missing };
  }, [state.txs, state.meds]);

  // Real-world request: "ป้องกันการหลุดยาที่มีในระบบแต่ไม่ได้ถูกตัดจำนวนยา และป้องกันการหลุดวันที่
  // ยังไม่ได้แนบไฟล์ เพื่อป้องกันจำนวนยาในระบบไม่ตรงกับจำนวนยาที่ใช้ยาจริง" — notDeductedLatestDay
  // above only ever checks the single MOST RECENT day with any reconcile_hosxp tx, so a day
  // skipped entirely (the file never attached — the exact risk being asked about) becomes
  // invisible the moment the next day's file IS attached. This instead scans the whole last
  // RECONCILE_GAP_LOOKBACK_DAYS window independently of whatever's loaded in hosxpRows above —
  // see fetchReconcileGaps' own doc comment (AppContext.tsx) for exactly what it flags.
  const [gapDays, setGapDays] = useState<ReconcileGapDay[] | null>(null);
  const gapReqId = useRef(0);
  useEffect(() => {
    // Skip while a commit is mid-flight — refetches once state.busy['reconcile'] goes back to
    // false below, so the panel reflects what the commit that just ran actually wrote instead of
    // going stale until this screen is left and reopened.
    if (state.busy['reconcile']) return;
    const reqId = ++gapReqId.current;
    fetchReconcileGaps(RECONCILE_GAP_LOOKBACK_DAYS).then((days) => {
      if (reqId !== gapReqId.current) return;
      setGapDays(days);
    }).catch((e) => {
      if (reqId !== gapReqId.current) return;
      toast((e as Error)?.message || 'ตรวจสอบวันที่ขาดการตัดยอดไม่สำเร็จ');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.busy['reconcile']]);

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        วิธีหลักในการตัดยอดหน้างาน — ใช้เป็นประจำทุกวัน เร็วกว่าการนับสต็อกจริง แนบไฟล์รายงานการใช้ยาจาก HOSxP (.xls/.xlsx) ของ<b>เมื่อวาน</b>โดยตรง (ถ้าเป็นเช้าวันจันทร์หลังวันหยุดสุดสัปดาห์ ครอบคลุมศุกร์-เสาร์-อาทิตย์ได้ตามจริง — ระบุช่วงวันที่ด้านล่างให้ตรง) หรือวางข้อมูล CSV รูปแบบ "ชื่อยา,จำนวนจ่าย" ในช่องด้านล่าง — ระบบจะตัดยอดหน้างานให้ตรงกับที่จ่ายจริงโดยตรง
      </div>
      <input
        ref={fileInputRef}
        type="file"
        accept=".xls,.xlsx,.csv,text/csv"
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) processHosxpFile(f);
          e.target.value = '';
        }}
      />
      <button
        onClick={() => fileInputRef.current?.click()}
        className="btn-primary"
        style={{ width: '100%', padding: 11, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46, marginBottom: 10 }}
      >
        📎 แนบไฟล์ HOSxP ของเมื่อวาน (.xls/.xlsx)
      </button>
      <div className="muted" style={{ fontSize: 11, textAlign: 'center', marginBottom: 10 }}>— หรือวางข้อความด้านล่าง —</div>
      <textarea
        value={state.hosxpText}
        onChange={(e) => setHosxpText(e.target.value)}
        placeholder={'วางข้อมูลจากไฟล์ HOSxP รูปแบบ "ชื่อยา,จำนวนที่จ่าย" บรรทัดละ 1 รายการ เช่น\nPARACETAMOL 500 mg,340\namlodipine 5 mg,120'}
        // Bug fix (mobile fit): under 16px, iOS Safari zooms the whole page in the moment
        // this textarea is focused — pasting/typing HOSxP data on a phone is exactly the
        // moment the layout should stay put, not zoom out from under the person typing.
        style={{ width: '100%', minHeight: 120, border: '1px solid var(--border)', background: 'var(--bg-card)', borderRadius: 10, padding: '11px 12px', fontSize: 16, fontFamily: 'ui-monospace, monospace', resize: 'vertical', marginBottom: 10 }}
      />
      <button onClick={processHosxp} className="btn-primary" style={{ width: '100%', padding: 11, borderRadius: 10, fontSize: 13.5, fontWeight: 600, minHeight: 46, marginBottom: 14 }}>ประมวลผล</button>

      {reconcileRows.length > 0 && (
        <>
          <div className="card stagger" style={{ overflow: 'hidden', marginBottom: 13 }}>
            {/* Bug fix (audit finding): width: 70 (below, both here and on the value row) clips a
                large quantity (e.g. a 4-5 digit จ่ายจริง or ก่อน→หลัง pair) on a narrow phone
                instead of letting the column grow — minWidth + nowrap keeps the right-alignment
                for the common case while still letting a wide number push the column out. */}
            <div style={{ display: 'flex', padding: '9px 13px', background: 'var(--bg-subtle)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
              <span style={{ flex: 1 }}>รายการยา</span><span style={{ minWidth: 70, textAlign: 'right', flex: 'none', whiteSpace: 'nowrap' }}>จ่ายจริง</span><span style={{ minWidth: 70, textAlign: 'right', flex: 'none', whiteSpace: 'nowrap' }}>ก่อน → หลัง</span>
            </div>
            {reconcileRows.map((r, i) => (
              <div key={i} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.3, fontWeight: r.match.kind === 'exact' ? 400 : 600 }}>
                    {r.med ? r.med.name : r.fileText}
                  </span>
                  <span style={{ minWidth: 70, textAlign: 'right', flex: 'none', fontSize: 13, fontWeight: 600, color: 'var(--red)', whiteSpace: 'nowrap' }}>{r.med ? '−' + nf(r.qty) : '—'}</span>
                  <span className="muted" style={{ minWidth: 70, textAlign: 'right', flex: 'none', fontSize: 12.5, whiteSpace: 'nowrap' }}>{r.med ? nf(r.before) + '→' + nf(r.after) : '—'}</span>
                </div>
                <MatchBadge match={r.match} fileText={r.fileText} medById={medById} />
              </div>
            ))}
          </div>

          {missEntries.length > 0 && (
            <div className="card" style={{ padding: 13, marginBottom: 12, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>ยาที่ปกติจ่ายทุกวันแต่ไม่ถูกตัดยอดจากไฟล์นี้ ({missEntries.length} รายการ)</div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 10 }}>ตรวจสอบก่อนตัดยอด — รายการที่มีเหตุผล "ควรตรวจสอบ"/"ต้องแก้ไข" อาจทำให้จำนวนยาในระบบไม่ตรงกับที่จ่ายจริง</div>
              <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {missEntries.map(({ med, reason }) => (
                  <div key={med.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 9, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{med.name}</span>
                      {reason.kind === 'zero_qty' && <Badge flexNone size={10.5} padding="2px 7px" color="var(--green)" bg="var(--green-tint)">ปกติ</Badge>}
                      {reason.kind === 'not_in_file' && <Badge flexNone size={10.5} padding="2px 7px" color="var(--amber-ink)" bg="var(--amber-bg)">ไม่พบในไฟล์</Badge>}
                      {reason.kind === 'ambiguous' && <Badge flexNone size={10.5} padding="2px 7px" color="var(--red)" bg="var(--red-bg)">ต้องตรวจสอบ</Badge>}
                    </div>
                    <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
                      {reason.kind === 'zero_qty' && 'พบในไฟล์ HOSxP แล้ว แต่จำนวนจ่าย = 0 จึงไม่ตัดยอด — ไม่ใช่ปัญหา'}
                      {reason.kind === 'not_in_file' && 'ไม่พบชื่อยานี้ในไฟล์ HOSxP เลย (แม้แต่ชื่อใกล้เคียง) — ถ้าวันนี้มีจ่ายยาตัวนี้จริง ควรกลับไปตรวจสอบว่าไฟล์ดึงข้อมูลมาครบหรือไม่'}
                      {reason.kind === 'ambiguous' && reason.wardClash && `พบชื่อ "${reason.fileText}" ในไฟล์ แต่ยานี้มีทั้งชั้น OPD และ IPD ชื่อเดียวกัน — HOSxP บอกไม่ได้ว่าจ่ายจากฝั่งไหน ต้องปรับยอดด้วยมือแยกราย ward`}
                      {reason.kind === 'ambiguous' && !reason.wardClash && `พบชื่อ "${reason.fileText}" ในไฟล์ แต่ตรงกับยาหลายรายการ (${reason.otherNames.join(', ')}) — ระบบแยกไม่ได้ว่าหมายถึงตัวไหน ต้องปรับยอดด้วยมือ`}
                    </div>
                    {reason.kind === 'not_in_file' && (
                      <button
                        type="button"
                        onClick={() => goFixMed(med.id)}
                        style={{ marginTop: 6, fontSize: 11, fontWeight: 600, color: 'var(--green)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                      >
                        แก้ไขชื่อยา/เพิ่มชื่อ HOSxP ที่รู้จัก →
                      </button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {fuzzyCount > 0 && (
            <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 10, padding: '11px 12px', marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={state.hosxpConfirmFuzzy} onChange={(e) => setHosxpConfirmFuzzy(e.target.checked)} style={{ marginTop: 2, flex: 'none', width: 17, height: 17 }} />
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--amber-ink)' }}>ตรวจสอบแล้วว่า {fuzzyCount} รายการที่ทำเครื่องหมาย ⚠ ด้านบน จับคู่กับยาถูกตัว (ชื่อในไฟล์ไม่ตรงกับชื่อในระบบเป๊ะๆ ระบบเดาให้จากชื่อที่ใกล้เคียงที่สุด)</span>
            </label>
          )}

          {/* Real-world explanation: "เช้าวันจันทร์จะตัดยอดหน้างานโดยแนบไฟล์ ของวันศุกร์ เสาร์และ
              อาทิตย์ เป็นจำนวน 3 วัน" (บางครั้งมากกว่านั้น) — the old "confirm this covers only 1
              day" checkbox was factually wrong every Monday. Asking for the real range directly
              both fixes that AND lets commitReconcile() record it (Tx.coveredFrom/coveredTo) so
              downstream per-day analysis (analyzeWeekdayUsage, fetchReconcileGaps) can correctly
              spread a multi-day total back across the real days it represents. Defaults to
              yesterday-only (see processHosxp/processHosxpFile, AppContext.tsx) — zero extra taps
              for the normal single-day case; only needs widening backward on a catch-up. */}
          <div style={{ background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 10, padding: '11px 12px', marginBottom: 12 }}>
            <div style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--amber-ink)', fontWeight: 600, marginBottom: 8 }}>ไฟล์/ข้อมูลนี้ครอบคลุมยอดจ่ายยาวันที่เท่าไรบ้าง?</div>
            <div className="grid-2" style={{ marginBottom: 6 }}>
              <label>
                <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>จากวันที่</span>
                <input type="date" value={state.hosxpCoveredFrom} max={isoDate(Date.now() - DAY)} onChange={(e) => setHosxpCoveredFrom(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 16, minHeight: 40 }} />
              </label>
              <label>
                <span className="muted" style={{ display: 'block', fontSize: 11, marginBottom: 3 }}>ถึงวันที่</span>
                <input type="date" value={state.hosxpCoveredTo} max={isoDate(Date.now() - DAY)} onChange={(e) => setHosxpCoveredTo(e.target.value)} style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 9, padding: '9px 8px', fontSize: 16, minHeight: 40 }} />
              </label>
            </div>
            <div style={{ fontSize: 11, lineHeight: 1.5, color: 'var(--amber-ink)' }}>
              {coveredValid ? 'รวม ' + daysCovered + ' วัน' + (daysCovered > 1 ? ' — เช่น กรณีตัดยอดเช้าวันจันทร์หลังวันหยุดสุดสัปดาห์' : '') : 'ระบุช่วงวันที่ให้ครบ (ถึงวันที่ต้องไม่ใช่วันนี้)'}
            </div>
          </div>

          <button onClick={commitReconcile} disabled={!canCommit || !!state.busy['reconcile']} className="btn-primary" style={{ width: '100%', padding: 15, borderRadius: 12, fontSize: 15, minHeight: 52, opacity: canCommit && !state.busy['reconcile'] ? 1 : 0.5 }}>
            {state.busy['reconcile'] ? 'กำลังตัดยอด…' : `ตัดยอดหน้างานตามไฟล์นี้ และบันทึก discrepancy log${skippedCount > 0 ? ' (ข้าม ' + skippedCount + ' รายการที่จับคู่ไม่ได้)' : ''}`}
          </button>
        </>
      )}

      {gapDays !== null && gapDays.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 600, margin: '0 2px 8px' }}>
            ตรวจสอบความครบถ้วนของการตัดยอด {RECONCILE_GAP_LOOKBACK_DAYS} วันล่าสุด — พบ {gapDays.length} วันที่ควรตรวจสอบ
          </div>
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            {gapDays.map((g) => (
              <div key={g.dateIso} style={{ padding: '10px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: g.kind === 'partial' ? 4 : 0 }}>
                  {g.kind === 'missing'
                    ? <Badge flexNone size={11} padding="2px 8px" color="var(--red)" bg="var(--red-bg)">ไม่มีไฟล์</Badge>
                    : <Badge flexNone size={11} padding="2px 8px" color="var(--amber-ink)" bg="var(--amber-bg)">ตัดไม่ครบ</Badge>}
                  <span style={{ fontSize: 12.5, fontWeight: 600 }}>
                    {thDate(new Date(g.dateIso + 'T12:00:00').getTime())}
                    {g.kind === 'missing' ? ' — ไม่มีการตัดยอด HOSxP เลยทั้งวัน' : ' — ' + g.missingMeds.length + ' รายการที่ปกติจ่ายทุกวันไม่ถูกตัดยอด'}
                  </span>
                </div>
                {g.kind === 'partial' && (
                  <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
                    {g.missingMeds.slice(0, 5).map((m) => m.name).join(', ')}
                    {g.missingMeds.length > 5 ? ' และอีก ' + (g.missingMeds.length - 5) + ' รายการ' : ''}
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
            "ไม่มีไฟล์" คือวันที่ไม่มีการตัดยอด HOSxP แม้แต่รายการเดียว — ถ้ายังมีไฟล์ของวันนั้นอยู่ ควรกลับไปแนบให้ครบ
            "ตัดไม่ครบ" คือมีการตัดยอดวันนั้นแล้ว แต่ยาบางตัวที่ปกติจ่ายทุกวันไม่ถูกตัด อาจเพราะไฟล์วันนั้นดึงข้อมูลมาไม่ครบ
            หรือวันนั้นผู้ป่วยไม่ได้ใช้ยาตัวนั้นจริงๆ
          </div>
        </div>
      )}
      {gapDays !== null && gapDays.length === 0 && (
        <div style={{ marginTop: 18, display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', background: 'var(--green-tint)', borderRadius: 10 }}>
          <span style={{ fontSize: 13 }}>✓</span>
          <span style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 600 }}>ตัดยอด HOSxP ครบทุกวันใน {RECONCILE_GAP_LOOKBACK_DAYS} วันที่ผ่านมา — ไม่พบวันที่ขาดหรือยาที่หลุด</span>
        </div>
      )}

      {/* Real-world request: "รวมแผง 'ยาที่หลุดบ่อย' (ฝั่งไฟล์) กับแผงใหม่ (ฝั่งยาในแอพ) ให้ดูคู่กัน" —
          these are two genuinely different failure directions (a name IN the file this app
          can't resolve to any med, vs. a med in this app's own formulary that never shows up
          deducted at all), so they stay two separate lists with their own explanations rather
          than one merged algorithm — but grouped under one heading, stacked right next to each
          other, so a pharmacist cross-checking "ยาที่หลุดบ่อย" sees both at a glance instead of
          having to remember a second, disconnected panel exists further down the screen. */}
      {(unmatchedFreq.length > 0 || missReasonFreq.length > 0) && (
        <div style={{ marginTop: 18 }}>
          <div className="muted" style={{ fontSize: 12.5, fontWeight: 700, margin: '0 2px 10px' }}>ยาที่หลุดบ่อย (ย้อนหลัง)</div>

          {unmatchedFreq.length > 0 && (
            <div style={{ marginBottom: missReasonFreq.length > 0 ? 16 : 0 }}>
              <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, margin: '0 2px 6px' }}>ฝั่งไฟล์ — ชื่อในไฟล์ HOSxP ที่จับคู่กับยาในแอพไม่ได้</div>
              <div className="card stagger" style={{ overflow: 'hidden' }}>
                {unmatchedFreq.map((u, i) => (
                  <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', borderBottom: i < unmatchedFreq.length - 1 ? '1px solid var(--border-soft)' : 0 }}>
                    <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.3 }}>{u.name}</span>
                    <Badge flexNone size={11} padding="2px 8px" color="var(--red)" bg="var(--red-bg)">{u.count} ครั้ง</Badge>
                    <span className="muted" style={{ flex: 'none', fontSize: 11 }}>ล่าสุด {thDate(u.lastTs)}</span>
                  </div>
                ))}
              </div>
              {/* Real-world clarification: the HOSxP export naturally lists more drugs than this
                  app carries at all (drugs this hospital never stocks, or carried once but cut
                  from the formulary since) — a name showing up here over and over is very often
                  exactly that, not a mistake needing a fix. Said plainly so this list doesn't
                  read as N alarms every morning; see the ฝั่งแอพ panel below (or
                  notDeductedLatestDay further down) for the panel that actually catches a real
                  missed deduction (checked from this app's own med list, not the file's). */}
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
                ส่วนใหญ่เป็นเรื่องปกติ — ไฟล์ HOSxP มียามากกว่าที่ รพ. นี้มีจริงในระบบ (ยาที่ไม่มีใช้ที่ รพ.
                หรือยาที่เคยมีแต่ตัดออกจากบัญชีไปแล้ว) ชื่อพวกนี้จึง "จับคู่ไม่ได้" โดยธรรมชาติ ไม่ต้องแก้ไข
                อะไร — เช็คเฉพาะตัวที่รู้อยู่แล้วว่า รพ. มีใช้จริง ถ้าชื่อนั้นสะกดไม่ตรงกับในไฟล์ ลองแก้ชื่อยา
                ในระบบ (หน้าจัดการรายการยา) ให้ตรงกัน หรือเพิ่มเป็น "ชื่อที่ไฟล์ HOSxP อาจใช้เรียกยานี้"
                ในฟอร์มแก้ไขยาก็ได้
              </div>
            </div>
          )}

          {missReasonFreq.length > 0 && (
            <div>
              <div className="muted" style={{ fontSize: 11.5, fontWeight: 600, margin: '0 2px 6px' }}>ฝั่งแอพ — ยาในแอพที่ไม่ถูกตัดยอดบ่อย พร้อมเหตุผล</div>
              <div className="card stagger" style={{ overflow: 'hidden' }}>
                {missReasonFreq.map((u, i) => {
                  const badge = MISS_REASON_BADGE[u.reason];
                  // The audit log only ever stored the med's NAME (see commitReconcile's own
                  // note format, AppContext.tsx) — resolve it back to a live, active med to
                  // link the fix action. A stale entry (med renamed/deactivated since) simply
                  // gets no button rather than a dead/wrong link.
                  const liveMed = u.reason === 'not_in_file' ? state.meds.find((m) => m.active && m.name === u.name) : undefined;
                  return (
                    <div key={i} style={{ padding: '9px 13px', borderBottom: i < missReasonFreq.length - 1 ? '1px solid var(--border-soft)' : 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.3 }}>{u.name}</span>
                        <Badge flexNone size={10.5} padding="2px 7px" color={badge.color} bg={badge.bg}>{badge.label}</Badge>
                        <Badge flexNone size={11} padding="2px 8px" color="var(--red)" bg="var(--red-bg)">{u.count} ครั้ง</Badge>
                        <span className="muted" style={{ flex: 'none', fontSize: 11 }}>ล่าสุด {thDate(u.lastTs)}</span>
                      </div>
                      {liveMed && (
                        <button
                          type="button"
                          onClick={() => goFixMed(liveMed.id)}
                          style={{ marginTop: 4, fontSize: 11, fontWeight: 600, color: 'var(--green)', background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}
                        >
                          แก้ไขชื่อยา/เพิ่มชื่อ HOSxP ที่รู้จัก →
                        </button>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
                ยานี้มาจากประวัติการตัดยอดจริง (ไม่ใช่แค่ไฟล์ล่าสุด) — ตัวที่ขึ้น "ต้องตรวจสอบ" ซ้ำๆ มักเป็น
                ยาชื่อเดียวกันระหว่าง OPD/IPD ที่จับคู่ไม่ได้ว่าเป็นฝั่งไหน ส่วนตัวที่ขึ้น "ไม่พบในไฟล์" ซ้ำๆ
                ควรลองเช็คชื่อในไฟล์ HOSxP จริงกับชื่อในแอพอีกครั้ง
              </div>
            </div>
          )}
        </div>
      )}

      {notDeductedLatestDay && notDeductedLatestDay.missing.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 600, margin: '0 2px 8px' }}>
            ยาที่ปกติมีการจ่ายแต่ยังไม่ถูกตัดยอดจากไฟล์วันที่ {notDeductedLatestDay.dayLabel} ({notDeductedLatestDay.missing.length} รายการ)
          </div>
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            {notDeductedLatestDay.missing.map((m) => (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '9px 13px', borderBottom: '1px solid var(--border-soft)' }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.3 }}>{m.name}</span>
                <span className="muted" style={{ flex: 'none', fontSize: 11 }}>ปกติ {nf(m.used30)} {m.unit}/30 วัน</span>
              </div>
            ))}
          </div>
          <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
            ยาพวกนี้ปกติมีอัตราการจ่ายจริง (used30 &gt; 0) แต่ไม่มีรายการตัดยอดจากไฟล์ HOSxP ล่าสุดเลย —
            อาจเป็นเพราะ (1) วันนั้นไม่มีคนไข้มาใช้ยาตัวนี้จริงๆ (ปกติ ไม่ต้องทำอะไร) หรือ (2) ไฟล์ที่ดึง
            จาก HOSxP ดึงข้อมูลมาไม่ครบ (เช่น ตัดหน้า/ตัดช่วงวันที่ผิด) — ควรกลับไปเช็คไฟล์ต้นฉบับหรือ
            รายงานจาก HOSxP อีกครั้งถ้ายาตัวไหนในนี้ปกติจ่ายทุกวัน
          </div>
        </div>
      )}
    </div>
  );
}

function MatchBadge({ match, fileText, medById }: { match: HosxpMatch; fileText: string; medById: (id: string) => Med | undefined }) {
  if (match.kind === 'exact') return null; // clean match — no need to draw attention
  if (match.kind === 'fuzzy') {
    return <div style={{ fontSize: 10.5, color: 'var(--amber-ink)', fontWeight: 600, marginTop: 3 }}>⚠ ไม่ตรงชื่อเป๊ะ — ไฟล์เขียนว่า "{fileText}"</div>;
  }
  if (match.kind === 'ambiguous') {
    const candidates = match.candidateIds.map((id) => medById(id)).filter((m): m is Med => !!m);
    const names = candidates.map((m) => m.name).join(', ');
    // The common real case: the exact same drug exists as separate OPD and IPD shelf
    // records (same name, different bin/par) — HOSxP's plain "ชื่อยา,จำนวน" export has no
    // ward info to say which one this row belongs to, so it can never be auto-resolved
    // safely. Name a specific reason instead of a generic "found several" — this is the one
    // case a pharmacist will hit often and should recognize immediately, not puzzle over.
    const isOpdIpdPair = candidates.length === 2 && candidates[0].name === candidates[1].name && wardOf(candidates[0]) !== wardOf(candidates[1]);
    return (
      <div style={{ fontSize: 10.5, color: 'var(--red)', fontWeight: 600, marginTop: 3 }}>
        {isOpdIpdPair
          ? '✕ ยานี้มีทั้งชั้น OPD และ IPD ชื่อเดียวกัน — HOSxP บอกไม่ได้ว่าจ่ายจากฝั่งไหน ต้องปรับยอดด้วยมือแยกราย ward'
          : '✕ พบยาที่ชื่อใกล้เคียงกันหลายรายการ — ข้าม (' + names + ')'}
      </div>
    );
  }
  return <div style={{ fontSize: 10.5, color: 'var(--red)', fontWeight: 600, marginTop: 3 }}>✕ ไม่พบยานี้ในระบบ — ข้าม</div>;
}
