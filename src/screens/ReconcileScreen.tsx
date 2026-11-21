import { useEffect, useMemo, useRef, useState } from 'react';
import { useApp } from '../store/AppContext';
import { effectiveLastCoveredTo, wardOf, hosxpMissReasons, isRegularlyDispensed, lastReconcileCoveredToIso, priorReconcileByMed, suggestMedsForFileName, diagnoseMiss, unusualDispense, weekdaysInRange, hosxpDateCheck } from '../store/selectors';
import { downloadCsv } from '../utils/csv';
import { thDateWithWeekday } from '../utils/format';
import { smartHosxpCoveredFrom } from '../store/AppContext';
import { nf, thDate, isoDate, bangkokWeekday } from '../utils/format';
import type { HosxpMatch, Med, MedId, ReconcileGapDay, ReconcileMonthDay } from '../types';
import { Badge } from '../components/Badge';
import ReconcileCalendar, { ReconcileDayDetail } from './ReconcileCalendar';
import { MissDiagnosis } from './MissDiagnosis';
import { FileRowFixer } from './FileRowFixer';
import { ReconcileStepper, ReconcileStatusCard, ReconcileProgress, ReconcileResultCard } from './ReconcileFlow';

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
  const { state, setHosxpDateConfirmed, discardHosxpFile, unresolveHosxpRow, fetchPriorReconcile, resolveHosxpRowsBulk, undoLastReconcile, dismissReconcileResult, processHosxpFile, setHosxpConfirmFuzzy, setHosxpCoveredFrom, setHosxpCoveredTo, commitReconcile, fetchReconcileGaps, fetchReconcileMonth, toast, go, setMedsFocusId } = useApp();

  // Real-world request: "เพื่อนำไปสู่การแก้ไขปัญหายาที่อาจจะยังมีปัญหาครับ"/"สามารถเชื่อมโยงปัญหานั่น
  // ไปแก้ปัญหาจริงได้" — a miss-reasons row used to just explain what's wrong with no way to act
  // on it from here; this jumps straight to that med's own edit form in หน้าจัดการรายการยา (where
  // the "ชื่อที่ไฟล์ HOSxP อาจใช้เรียกยานี้" alias field and the real name itself both live),
  // reusing the exact same medsFocusId mechanism the QR-scan "ดูข้อมูลยา" flow already uses —
  // see MedsScreen.tsx's own "A QR scan...lands here with medsFocusId set" comment.
  const goFixMed = (medId: MedId) => { setMedsFocusId(medId); go('meds'); };
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);

  const medById = (id: string) => state.meds.find((x) => x.id === id);

  // Rows the pharmacist explicitly chose to skip (no drug to map to). Reset whenever a new file loads.
  const [skippedRows, setSkippedRows] = useState<Set<number>>(new Set());
  const [ackUnusual, setAckUnusual] = useState(false);
  useEffect(() => { setSkippedRows(new Set()); setAckUnusual(false); }, [state.hosxpRows?.length, state.hosxpFileInfo?.fingerprint]);

  // Real-world request: "ป้องกันการแนบไฟล์ผิดวัน หรือสามารถรู้ได้ว่าวันไหนที่ทำการแนบไฟล์ไปแล้ว
  // วันไหนยังไม่แนบ ตอนนี้ไม่รู้อะไรเลย" — gapDays below already answers this, but only AFTER its
  // own async fetchReconcileGaps() round trip resolves, and only for the last
  // RECONCILE_GAP_LOOKBACK_DAYS. This instead reads straight off state.txs (already loaded, no
  // extra Firestore read) for an instant, always-visible answer the moment this screen opens —
  // "ตัดยอดล่าสุดถึงวันที่เท่าไร" — before anyone's even attached a file yet. Same
  // lastReconcileCoveredToIso()/weekday-skip convention commitReconcile's own continuity check
  // and fetchReconcileGaps use (see their own doc comments, selectors.ts/AppContext.tsx).
  const lastCoveredTo = useMemo(() => effectiveLastCoveredTo(state.txs, state.lastReconcileFetched), [state.txs, state.lastReconcileFetched]);
  const missingWeekdaysSoFar = useMemo(() => {
    if (!lastCoveredTo) return 0;
    const yesterdayTs = new Date(isoDate(Date.now() - DAY) + 'T00:00:00').getTime();
    let count = 0;
    for (let ts = new Date(lastCoveredTo + 'T00:00:00').getTime() + DAY; ts <= yesterdayTs; ts += DAY) {
      const wd = bangkokWeekday(ts);
      if (wd !== 0 && wd !== 6) count++;
    }
    return count;
  }, [lastCoveredTo]);

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
  // Real-world request: "แนบไฟล์ไปแล้ว ยืนยันตัดจ่าย แต่เหมือนมีข้อผิดพลาด แล้วจะมีความมั่นใจได้
  // อย่างไรว่าจำนวนถูกตัดไปแล้วหรือยัง" — see state.hosxpAppliedRowIndexes' own doc comment
  // (types.ts) for the retry-safety mechanism this surfaces. A row already in that set was
  // committed for real in an EARLIER attempt on this same loaded file (a partial failure, now
  // safely resumable) — shown as done rather than fed back into the running before/after preview
  // below, which would otherwise visually suggest it's about to be deducted a SECOND time.
  const appliedRowSet = useMemo(() => new Set(state.hosxpAppliedRowIndexes || []), [state.hosxpAppliedRowIndexes]);
  // What the covered range already took, read from Firestore (the live txs window only holds the newest
  // 300 rows, so an earlier reconcile can have scrolled out of it). Falls back to the live window.
  const [fetchedPrior, setFetchedPrior] = useState<{ key: string; map: Map<string, number> } | null>(null);
  const priorKey = state.hosxpCoveredFrom + '|' + state.hosxpCoveredTo + '|' + (state.hosxpRows ? 1 : 0);
  useEffect(() => {
    if (!state.hosxpRows || !state.hosxpCoveredFrom || !state.hosxpCoveredTo) { setFetchedPrior(null); return; }
    let cancelled = false;
    fetchPriorReconcile(state.hosxpCoveredFrom, state.hosxpCoveredTo)
      .then((map) => { if (!cancelled) setFetchedPrior({ key: priorKey, map }); })
      .catch(() => { if (!cancelled) setFetchedPrior(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [priorKey]);
  const reconcileRows = useMemo(() => {
    const running = new Map<string, number>();
    // Same range already reconciled → only the part above what it took is deducted (see commitReconcile).
    const isResumingNow = appliedRowSet.size > 0 && appliedRowSet.size < (state.hosxpRows || []).length;
    const live = priorReconcileByMed(state.txs, state.hosxpCoveredFrom, state.hosxpCoveredTo);
    const priorLeft = isResumingNow ? new Map<string, number>() : new Map(live);
    if (!isResumingNow && fetchedPrior && fetchedPrior.key === priorKey) for (const [k, v] of fetchedPrior.map) priorLeft.set(k, Math.max(priorLeft.get(k) || 0, v));
    return (state.hosxpRows || []).map((r, idx) => {
      const med = r.match.kind === 'exact' || r.match.kind === 'fuzzy' ? medById(r.match.medId) : undefined;
      if (appliedRowSet.has(idx)) {
        // med.floor already reflects this row's real deduction live — deliberately NOT seeded
        // into `running`, so the next row for the same med (if any, and if not itself already
        // applied) still starts from that real, already-reduced floor instead of double-counting.
        return { fileText: r.name, qty: r.qty, already: 0, match: r.match, med, before: med?.floor ?? 0, after: med?.floor ?? 0, applied: true };
      }
      const have = med ? priorLeft.get(med.id) || 0 : 0;
      const already = Math.min(have, r.qty);
      if (med && already > 0) priorLeft.set(med.id, have - already);
      const qtyEff = r.qty - already;
      const before = med ? (running.has(med.id) ? running.get(med.id)! : med.floor) : 0;
      const after = med ? Math.max(0, before - qtyEff) : 0;
      if (med) running.set(med.id, after);
      return { fileText: r.name, qty: r.qty, already, match: r.match, med, before, after, applied: false };
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.hosxpRows, state.meds, state.txs, state.hosxpCoveredFrom, state.hosxpCoveredTo, appliedRowSet, fetchedPrior, priorKey]);
  const unmatchedFileNames = useMemo(() => reconcileRows.filter((r) => !r.med).map((r) => r.fileText), [reconcileRows]);
  const [showAllMiss, setShowAllMiss] = useState(false);
  const appliedCount = reconcileRows.filter((r) => r.applied).length;
  // A resume (some rows done, some not) skips the same confirms commitReconcile() itself skips
  // for the identical reason — see its own isResuming doc comment (AppContext.tsx).
  const isResuming = appliedCount > 0 && appliedCount < reconcileRows.length;

  // Real-world request: "ต้องมีรายละเอียดบอกให้ชัดเจนเลยครับว่ายาในแอพตัวใดไม่ได้ถูกตัดจ่าย ต้องมี
  // เหตุผลกำกับ" — see hosxpMissReasons' own doc comment (selectors.ts) for the full design; runs
  // on this SAME file, before commit, so there's still something to fix.
  const missEntries = useMemo(() => hosxpMissReasons(state.meds, state.hosxpRows || []), [state.meds, state.hosxpRows]);

  // Unmatched rows ranked by quantity — a big one (e.g. a daily staple) must never be a quiet skip.
  const unmatchedBig = reconcileRows
    .map((r, i) => ({ ...r, i }))
    .filter((r) => (r.match.kind === 'none' || r.match.kind === 'ambiguous') && r.qty > 0 && !r.applied && !skippedRows.has(r.i))
    .sort((a, b) => b.qty - a.qty);
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
  // Is the attached file provably the one due? (see hosxpDateCheck) — otherwise the pharmacist must pick + confirm.
  const dueYesterday = isoDate(Date.now() - DAY);
  const dueFrom = smartHosxpCoveredFrom(state.txs, dueYesterday);
  const dateStatus = state.hosxpFileInfo ? hosxpDateCheck(state.hosxpFileInfo.dateRange, state.hosxpCoveredFrom, state.hosxpCoveredTo, dueFrom, dueYesterday) : 'verified';
  const dateBlocked = !!state.hosxpFileInfo && dateStatus !== 'verified' && !state.hosxpDateConfirmed;
  const dueLabel = dueFrom === dueYesterday ? thDateWithWeekday(dueYesterday) : thDateWithWeekday(dueFrom) + ' – ' + thDateWithWeekday(dueYesterday);
  // Quantities far above what the drug normally moves over this period (wrong-range file, wrong unit, typo).
  const businessDays = weekdaysInRange(state.hosxpCoveredFrom, state.hosxpCoveredTo);
  const unusualByIdx = new Map<number, NonNullable<ReturnType<typeof unusualDispense>>>();
  reconcileRows.forEach((r, i) => {
    if (r.med && !r.applied) { const u = unusualDispense(r.med, r.qty - r.already, businessDays); if (u) unusualByIdx.set(i, u); }
  });
  const unusualCount = unusualByIdx.size;
  const unusualPending = ackUnusual ? 0 : unusualCount;
  const canCommit = reconcileRows.length > 0 && (fuzzyCount === 0 || state.hosxpConfirmFuzzy) && coveredValid && unmatchedBig.length === 0 && unusualPending === 0 && !dateBlocked;

  // ---- guided-flow summary (one status card, a stepper, only-what-needs-attention lists) ----
  const rowsWithIdx = reconcileRows.map((r, i) => ({ ...r, i }));
  const shortRows = rowsWithIdx.filter((r) => r.med && !r.applied && r.qty - r.already > r.before);
  const matchedCount = reconcileRows.filter((r) => r.med).length;
  const alreadyCount = reconcileRows.filter((r) => r.med && r.already >= r.qty && r.qty > 0).length;
  const totalUnits = reconcileRows.reduce((a, r) => a + (r.med && !r.applied ? r.qty - r.already : 0), 0);
  const fuzzyPending = state.hosxpConfirmFuzzy ? 0 : fuzzyCount;
  const needDecision = unmatchedBig.length + fuzzyPending;
  const attentionIdx = useMemo(() => new Set(rowsWithIdx.filter((r) => !r.applied && (r.match.kind === 'none' || r.match.kind === 'ambiguous' || r.match.kind === 'fuzzy' || unusualByIdx.has(r.i) || (r.med && r.qty - r.already > r.before))).map((r) => r.i)), [rowsWithIdx]);
  const [rowFilter, setRowFilter] = useState<'attention' | 'all'>('attention');
  const effectiveFilter = attentionIdx.size === 0 ? 'all' : rowFilter;
  const step: 1 | 2 | 3 | 4 = state.busy['reconcile'] ? 4 : reconcileRows.length === 0 ? 1 : needDecision > 0 ? 2 : 3;
  const ready = reconcileRows.length > 0 && canCommit;
  const [editRange, setEditRange] = useState(false);
  const fileRange = state.hosxpFileInfo?.dateRange ?? null;
  const rangeMatchesFile = !!fileRange && fileRange.from === state.hosxpCoveredFrom && fileRange.to === state.hosxpCoveredTo;
  const showRangePickers = editRange || (!!state.hosxpFileInfo ? dateStatus !== 'verified' : !rangeMatchesFile);
  // Unmatched rows whose single best suggestion passes every safety check → one-tap "accept all".
  const safePairs = useMemo(() => unmatchedBig.flatMap((r) => {
    const sg = suggestMedsForFileName(state.meds, r.fileText, 3);
    const safe = sg.filter((x) => x.diff.safe);
    return safe.length === 1 && sg[0] === safe[0] ? [{ idx: r.i, medId: safe[0].med.id }] : [];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [unmatchedBig.map((r) => r.i).join(','), state.meds]);
  const [acceptedCount, setAcceptedCount] = useState(0);
  // Only the "not in file" meds that deserve a human look; the many that were most likely just not
  // dispensed today are folded into one calm count line.
  const missView = useMemo(() => {
    const worth: typeof missEntries = [];
    let normal = 0;
    for (const e of missEntries) {
      if (e.reason.kind === 'zero_qty') { normal++; continue; }
      if (e.reason.kind === 'ambiguous') { worth.push(e); continue; }
      const d = diagnoseMiss(e.med, unmatchedFileNames, state.meds);
      if (d.verdict === 'likely_no_dispense') normal++; else worth.push(e);
    }
    return { worth, normal };
  }, [missEntries, unmatchedFileNames, state.meds]);
  const scrollToFix = () => document.getElementById('reconcile-fix-area')?.scrollIntoView({ behavior: 'smooth', block: 'start' });

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

  // File names that matched no med in recent runs (from the 'hosxp_unmatched' audit entries) —
  // the pool MissDiagnosis compares a missed med against, so "ไม่พบในไฟล์" can be explained as
  // either "the file spells it differently (here's how)" or "nothing resembles it".
  const recentUnmatchedNames = useMemo(() => {
    const out: string[] = [];
    const seenN = new Set<string>();
    for (const e of state.authLog) {
      if (e.type !== 'hosxp_unmatched') continue;
      for (const n of (e.note.split('\n')[1] || '').split(' | ').map((x) => x.trim()).filter(Boolean)) {
        if (!seenN.has(n)) { seenN.add(n); out.push(n); }
      }
    }
    return out;
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
  // Tap a flagged day to see, per med, WHY it wasn't deducted (same detail as the calendar below).
  // Loaded lazily for that day's month and cached for the life of this list, so reopening is free.
  const [openGap, setOpenGap] = useState<string | null>(null);
  const [gapDetail, setGapDetail] = useState<Record<string, ReconcileMonthDay | 'loading' | 'error'>>({});
  const toggleGap = (dateIso: string) => {
    if (openGap === dateIso) { setOpenGap(null); return; }
    setOpenGap(dateIso);
    if (gapDetail[dateIso] && gapDetail[dateIso] !== 'error') return;
    setGapDetail((g) => ({ ...g, [dateIso]: 'loading' }));
    fetchReconcileMonth(dateIso.slice(0, 7)).then((month) => {
      setGapDetail((g) => {
        const next = { ...g };
        for (const d of month) if (d.dateIso === dateIso || next[d.dateIso] === undefined) next[d.dateIso] = d;
        if (!month.some((d) => d.dateIso === dateIso)) next[dateIso] = 'error';
        return next;
      });
    }).catch(() => setGapDetail((g) => ({ ...g, [dateIso]: 'error' })));
  };
  useEffect(() => {
    // Skip while a commit is mid-flight — refetches once state.busy['reconcile'] goes back to
    // false below, so the panel reflects what the commit that just ran actually wrote instead of
    // going stale until this screen is left and reopened.
    if (state.busy['reconcile']) return;
    const reqId = ++gapReqId.current;
    fetchReconcileGaps(RECONCILE_GAP_LOOKBACK_DAYS).then((days) => {
      if (reqId !== gapReqId.current) return;
      // The expanded per-med detail was computed from the previous commit's data — drop it.
      setGapDetail({});
      setOpenGap(null);
      setGapDays(days);
    }).catch((e) => {
      if (reqId !== gapReqId.current) return;
      toast((e as Error)?.message || 'ตรวจสอบวันที่ขาดการตัดยอดไม่สำเร็จ');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.busy['reconcile']]);

  const discardFile = async () => {
    const hasDecisions = skippedRows.size > 0 || ackUnusual || state.hosxpConfirmFuzzy || state.hosxpDateConfirmed || (state.hosxpRows || []).some((r) => r.prevMatch);
    await discardHosxpFile(hasDecisions);
  };

  // One row per file line (what it matched, or exactly why not), then the app drugs absent from the file.
  const exportMatchCsv = async () => {
    const statusOf = (r: (typeof reconcileRows)[number], i: number) => r.applied ? 'ตัดแล้ว' : skippedRows.has(i) ? 'ข้ามโดยผู้ใช้'
      : r.match.kind === 'exact' ? 'จับคู่ตรง' : r.match.kind === 'fuzzy' ? 'จับคู่ใกล้เคียง (ต้องยืนยัน)' : r.match.kind === 'ambiguous' ? 'กำกวม (ตรงหลายรายการ)' : 'จับคู่ไม่ได้';
    const rows: (string | number)[][] = [['แถว', 'ชื่อในไฟล์', 'จำนวนในไฟล์', 'สถานะ', 'ยาในแอพที่จับคู่', 'เคยตัดแล้ว', 'จะตัดเพิ่ม', 'ยอดหน้างานก่อน', 'ยอดหลังตัด', 'หมายเหตุ/เหตุผล']];
    reconcileRows.forEach((r, i) => {
      const notes: string[] = [];
      if (r.match.kind === 'none') {
        const sg = suggestMedsForFileName(state.meds, r.fileText, 1)[0];
        notes.push(sg ? 'คล้าย "' + sg.med.name + '" ' + Math.round(sg.diff.score * 100) + '%' + (sg.diff.onlyInApp.length ? ' · แอพมีแต่: ' + sg.diff.onlyInApp.join(' ') : '') + (sg.diff.onlyInFile.length ? ' · ไฟล์มีแต่: ' + sg.diff.onlyInFile.join(' ') : '') + (sg.diff.numbers === 'differs' ? ' · ความแรงต่าง' : sg.diff.safe ? ' · ปลอดภัยที่จะยอมรับ' : '') : 'ไม่มียาที่คล้าย');
      }
      if (r.match.kind === 'ambiguous') notes.push('ตรงกับ: ' + r.match.candidateIds.map((id) => medById(id)?.name || id).join(' | '));
      const u = unusualByIdx.get(i);
      if (u) notes.push(u.kind === 'no_history' ? 'ผิดปกติ: ไม่มีประวัติการใช้' : 'ผิดปกติ: สูงกว่าปกติ ~' + Math.round(u.ratio) + ' เท่า');
      if (r.med && !r.applied && r.qty - r.already > r.before) notes.push('ยอดหน้างานไม่พอ');
      if (!Number.isInteger(r.qty)) notes.push('จำนวนมีเศษทศนิยม');
      rows.push([i + 1, r.fileText, r.qty, statusOf(r, i), r.med?.name ?? '', r.already, r.med && !r.applied ? r.qty - r.already : 0, r.med ? r.before : '', r.med ? r.after : '', notes.join(' ; ')]);
    });
    rows.push([], ['ยาในแอพที่ปกติจ่ายแต่ไม่พบในไฟล์', 'เหตุผล', 'วินิจฉัย', 'จ่ายกี่วันใน 30 วัน']);
    for (const e of missEntries) {
      const d = e.reason.kind === 'not_in_file' ? diagnoseMiss(e.med, unmatchedFileNames, state.meds) : null;
      rows.push([e.med.name, e.reason.kind === 'zero_qty' ? 'ไฟล์ระบุจำนวน 0' : e.reason.kind === 'ambiguous' ? 'ชื่อกำกวม' : 'ไม่พบในไฟล์', d ? d.verdict : '', e.med.dispenseDays30 ?? '']);
    }
    const name = 'hosxp-match-' + (state.hosxpCoveredFrom || 'file') + (state.hosxpCoveredTo && state.hosxpCoveredTo !== state.hosxpCoveredFrom ? '_' + state.hosxpCoveredTo : '') + '.csv';
    const outcome = await downloadCsv(rows, name);
    toast(outcome === 'saved' ? 'ดาวน์โหลดผลการจับคู่แล้ว (' + name + ')' : outcome === 'declined' ? 'ยกเลิกการดาวน์โหลด' : 'ดาวน์โหลดไม่ได้บนอุปกรณ์นี้');
  };

  return (
    <div className="work-screen work-screen--glass" style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
        วิธีหลักในการตัดยอดหน้างาน — ใช้เป็นประจำทุกวัน เร็วกว่าการนับสต็อกจริง แนบไฟล์รายงานการใช้ยาจาก HOSxP (.xls/.xlsx) ของ<b>เมื่อวาน</b>โดยตรง (ถ้าเป็นเช้าวันจันทร์หลังวันหยุดสุดสัปดาห์ ครอบคลุมศุกร์-เสาร์-อาทิตย์ได้ตามจริง — ระบุช่วงวันที่ด้านล่างให้ตรง) — ระบบจะตัดยอดหน้างานให้ตรงกับที่จ่ายจริงโดยตรง
      </div>

      {lastCoveredTo ? (
        missingWeekdaysSoFar > 0 ? (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', background: 'var(--red-bg)', borderRadius: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>⚠</span>
            <span style={{ fontSize: 12.5, color: 'var(--red)', fontWeight: 600, lineHeight: 1.5 }}>
              ตัดยอด HOSxP ล่าสุดถึงวันที่ {thDate(new Date(lastCoveredTo + 'T00:00:00').getTime())} — ค้างอีก {missingWeekdaysSoFar} วันทำการที่ยังไม่ตัดยอด (รวมไฟล์ที่กำลังจะแนบนี้ด้วย ตรวจสอบให้ครอบคลุมช่วงที่ขาด)
            </span>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', background: 'var(--green-tint)', borderRadius: 10, marginBottom: 12 }}>
            <span style={{ fontSize: 13 }}>✓</span>
            <span style={{ fontSize: 12.5, color: 'var(--green)', fontWeight: 600 }}>ตัดยอด HOSxP ล่าสุดถึงวันที่ {thDate(new Date(lastCoveredTo + 'T00:00:00').getTime())} — ล่าสุดเท่าที่ควรแล้ว</span>
          </div>
        )
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', background: 'var(--amber-bg)', borderRadius: 10, marginBottom: 12 }}>
          <span style={{ fontSize: 13 }}>ℹ</span>
          <span style={{ fontSize: 12.5, color: 'var(--amber-ink)', fontWeight: 600 }}>ยังไม่มีประวัติการตัดยอด HOSxP ในระบบนี้เลย</span>
        </div>
      )}

      <ReconcileStepper step={step} onStep={(n) => {
        if (n === 1) void discardFile();
        else if (n === 2) { setRowFilter('all'); scrollToFix(); }
        else document.getElementById('reconcile-table')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }} />
      {state.reconcileResult && (
        <ReconcileResultCard result={state.reconcileResult} busy={!!state.busy['reconcile-undo']} onUndo={() => void undoLastReconcile()} onDismiss={dismissReconcileResult} />
      )}

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
      {!state.hosxpFileInfo && reconcileRows.length === 0 ? (
        <button type="button" className="rc-drop" data-over={dragOver ? '1' : '0'} data-testid="hosxp-dropzone"
          onClick={() => fileInputRef.current?.click()}
          onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer?.files?.[0]; if (f) processHosxpFile(f); }}>
          <span className="rc-drop-icon" aria-hidden="true">📎</span>
          <div className="rc-drop-title">แนบไฟล์ HOSxP ของเมื่อวาน</div>
          <div className="rc-drop-hint">แตะเพื่อเลือกไฟล์ หรือวางไฟล์ที่นี่ · .xls / .xlsx / .csv<br />ระบบตรวจวันที่ ชื่อยา และตัวเลขให้ก่อนตัดยอดทุกครั้ง</div>
        </button>
      ) : (
        <div className="rc-attach-compact" data-testid="hosxp-attach-compact"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => { e.preventDefault(); const f = e.dataTransfer?.files?.[0]; if (f) processHosxpFile(f); }}>
          <span style={{ fontSize: 20 }} aria-hidden="true">📎</span>
          <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 700, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{state.hosxpFileInfo?.name ?? 'ข้อมูลที่วางไว้'}</span>
          <button type="button" onClick={() => fileInputRef.current?.click()} style={{ flex: 'none', border: 0, background: 'transparent', fontSize: 12, fontWeight: 700, color: 'var(--green)', minHeight: 40, padding: '0 6px' }}>เปลี่ยนไฟล์</button>
          <button type="button" data-testid="hosxp-discard" onClick={() => void discardFile()} style={{ flex: 'none', border: '1px solid var(--red)', background: 'transparent', fontSize: 12, fontWeight: 700, color: 'var(--red)', borderRadius: 9, minHeight: 40, padding: '0 10px' }}>🗑 ลบไฟล์</button>
        </div>
      )}

      {/* Wrong-day check: what the attached file says about itself next to the date range about to
          be deducted. The same facts are asked again in commitReconcile's confirm dialog. */}
      {state.hosxpFileInfo && (() => {
        const fi = state.hosxpFileInfo!;
        const fr = fi.dateRange;
        const match = !!fr && fr.from === state.hosxpCoveredFrom && fr.to === state.hosxpCoveredTo;
        const tone = dateStatus === 'verified' ? 'green' : dateStatus === 'unreadable' ? 'amber' : 'red';
        const bg = tone === 'green' ? 'var(--green-tint)' : tone === 'amber' ? 'var(--amber-bg)' : 'var(--red-bg)';
        const color = tone === 'green' ? 'var(--green)' : tone === 'amber' ? 'var(--amber-ink)' : 'var(--red)';
        return (
          <div data-testid="hosxp-file-verify" style={{ background: bg, color, borderRadius: 10, padding: '10px 13px', marginBottom: 12, fontSize: 12.5, lineHeight: 1.6, fontWeight: 600 }}>
            {(fi.sheetsRead ?? 0) > 1 && <div>ℹ ไฟล์มี {fi.sheetsRead} ชีต — อ่านครบทุกชีตแล้ว</div>}
            {(fi.sheetsIgnored ?? 0) > 0 && <div>ℹ ข้าม {fi.sheetsIgnored} ชีตที่ไม่มีตารางรายงาน</div>}
            {(fi.repeatedHeaders ?? 0) > 0 && <div>ℹ ข้ามหัวตารางที่ซ้ำทุกหน้า {fi.repeatedHeaders} แถว</div>}
            {(fi.totalsIgnored ?? 0) > 0 && <div>ℹ ข้ามแถว "รวม" {fi.totalsIgnored} แถว (ไม่ใช่ยา)</div>}
            {(fi.fractional?.length ?? 0) > 0 && <div>⚠ {fi.fractional!.length} แถวมีเศษทศนิยม (ปัดเป็นจำนวนเต็ม): {fi.fractional!.slice(0, 3).map((f) => f.name + ' ' + f.qty).join(', ')}{fi.fractional!.length > 3 ? ' …' : ''}</div>}
            <div>ไฟล์: {fi.name} · {nf(fi.rowCount)} รายการ{fi.zeroRows ? ' · จำนวน 0 (ไม่ได้จ่าย) ' + nf(fi.zeroRows) + ' รายการ' : ''}</div>
            {fr && match && !showRangePickers && (
              <button type="button" onClick={() => setEditRange(true)} style={{ border: 0, background: 'transparent', color, fontWeight: 700, fontSize: 12, padding: '4px 0', textDecoration: 'underline', minHeight: 32 }}>แก้วันที่</button>
            )}
            <div data-testid="date-line" style={{ fontSize: 13.5, fontWeight: 800 }}>
              ไฟล์ระบุวันที่ {fr ? (fr.from === fr.to ? thDateWithWeekday(fr.from) : thDateWithWeekday(fr.from) + ' – ' + thDateWithWeekday(fr.to)) : 'ไม่ระบุ (อ่านวันที่จากไฟล์ไม่ได้)'}
              {' · '}ควรเป็น {dueLabel}{dateStatus === 'verified' ? ' — ตรงกับวันที่ควรตัด ✓' : ''}
            </div>
            {dateStatus === 'off_schedule' && <div>⚠ วันที่ในไฟล์ไม่ใช่ช่วงที่ถึงคิวตัดยอด (อาจเป็นวันที่ตัดไปแล้ว หรือไฟล์เก่า) — ถ้าเป็นวันที่ตัดไปแล้ว ระบบจะตัดเฉพาะส่วนต่าง ยืนยันก่อนตัดยอด</div>}
            {!fr && <div>ℹ ไฟล์นี้ไม่ได้ระบุวันที่ไว้ในตัวไฟล์ — ตรวจช่วงวันที่ด้านล่างให้ตรงกับรายงานที่ดึงมา ก่อนกดตัดยอด</div>}
            {fr && match && <div>✓ วันที่ที่ไฟล์ระบุ ({fr.from === fr.to ? fr.from : fr.from + ' ถึง ' + fr.to}) ตรงกับช่วงที่จะตัดยอด</div>}
            {fr && !match && <div>⚠ ไฟล์ระบุวันที่ {fr.from === fr.to ? fr.from : fr.from + ' ถึง ' + fr.to} แต่ช่วงที่จะตัดยอดคือ {state.hosxpCoveredFrom} ถึง {state.hosxpCoveredTo} — ไม่ตรงกัน ตรวจให้แน่ใจว่าเป็นไฟล์ของวันที่ถูกต้อง</div>}
          </div>
        );
      })()}

      {reconcileRows.length > 0 && (
        <ReconcileStatusCard
          matched={matchedCount} needDecision={needDecision} totalUnits={totalUnits} shortCount={shortRows.length}
          alreadyCount={alreadyCount} totalRows={reconcileRows.length} ready={ready} onGoFix={scrollToFix} unusualCount={unusualCount} unusualPending={unusualPending} dateBlocked={dateBlocked}
          rangeLabel={coveredValid ? (state.hosxpCoveredFrom === state.hosxpCoveredTo ? state.hosxpCoveredFrom : state.hosxpCoveredFrom + ' ถึง ' + state.hosxpCoveredTo) : null}
        />
      )}

      {reconcileRows.length > 0 && (
        <button type="button" data-testid="export-match-csv" onClick={() => void exportMatchCsv()} style={{ border: 0, background: 'transparent', color: 'var(--green)', fontWeight: 700, fontSize: 12.5, padding: '4px 2px', marginBottom: 8, minHeight: 36 }}>
          ⬇ ดาวน์โหลดผลการจับคู่ (CSV) — ไว้ตรวจความแม่นยำ
        </button>
      )}
      <div id="reconcile-fix-area" />
      {safePairs.length > 0 && (
        <button type="button" data-testid="accept-safe-all" onClick={async () => { const n = await resolveHosxpRowsBulk(safePairs, true); setAcceptedCount((c) => c + n); }}
          className="btn-primary" style={{ width: '100%', padding: 12, borderRadius: 10, fontSize: 13.5, fontWeight: 700, minHeight: 48, marginBottom: 12 }}>
          ✓ ยอมรับคำแนะนำที่ปลอดภัยทั้งหมด ({safePairs.length} รายการ — ชื่อและความแรงตรงกันทุกคำ)
        </button>
      )}
      {acceptedCount > 0 && (
        <div style={{ fontSize: 12, color: 'var(--green)', fontWeight: 600, marginBottom: 10 }}>จับคู่ตามคำแนะนำไปแล้ว {acceptedCount} รายการ</div>
      )}
      {unmatchedBig.length > 0 && (
        <div data-testid="unmatched-big-warning" style={{ background: 'var(--red-bg)', color: 'var(--red)', borderRadius: 10, padding: '10px 13px', marginBottom: 12, fontSize: 12.5, lineHeight: 1.6, fontWeight: 600 }}>
          ⚠ มี {unmatchedBig.length} รายการในไฟล์ที่ยังจับคู่กับยาในแอพไม่ได้ (รวม {nf(unmatchedBig.reduce((a, r) => a + r.qty, 0))} หน่วย) — ต้องจับคู่หรือกดข้ามทีละรายการก่อน จึงจะตัดยอดได้:
          {unmatchedBig.slice(0, 5).map((r, i) => <div key={i} style={{ fontWeight: 500 }}>• {r.fileText} — {nf(r.qty)}</div>)}
          <div style={{ fontWeight: 500 }}>เลื่อนลงในตาราง แต่ละรายการมีปุ่มจับคู่ยา/ค้นหายา/ข้าม พร้อมบอกว่าชื่อต่างกันตรงไหน</div>
        </div>
      )}

      {reconcileRows.length > 0 && (
        <>
          {isResuming && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 13px', background: 'var(--amber-bg)', borderRadius: 10, marginBottom: 12 }}>
              <span style={{ fontSize: 13 }}>↻</span>
              <span style={{ fontSize: 12.5, color: 'var(--amber-ink)', fontWeight: 600, lineHeight: 1.5 }}>
                ตัดยอดไปแล้ว {appliedCount} จาก {reconcileRows.length} รายการ (รอบที่แล้วเกิดปัญหาระหว่างทาง) — รายการที่ทำไปแล้วจะไม่ถูกตัดซ้ำ กดปุ่มด้านล่างเพื่อทำส่วนที่เหลือต่อ
              </span>
            </div>
          )}
          {attentionIdx.size > 0 && (
            <div role="tablist" aria-label="กรองรายการ" style={{ display: 'flex', gap: 6, marginBottom: 8 }}>
              {([['attention', 'ต้องดู (' + attentionIdx.size + ')'], ['all', 'ทั้งหมด (' + reconcileRows.length + ')']] as const).map(([k, label]) => (
                <button key={k} type="button" role="tab" className="rc-chip" aria-selected={effectiveFilter === k} onClick={() => setRowFilter(k)}>
                  {label}
                </button>
              ))}
            </div>
          )}
          <div id="reconcile-table" className="card stagger" style={{ overflow: 'hidden', marginBottom: 13 }}>
            {/* Bug fix (audit finding): width: 70 (below, both here and on the value row) clips a
                large quantity (e.g. a 4-5 digit จ่ายจริง or ก่อน→หลัง pair) on a narrow phone
                instead of letting the column grow — minWidth + nowrap keeps the right-alignment
                for the common case while still letting a wide number push the column out. */}
            <div style={{ display: 'flex', padding: '9px 13px', background: 'var(--bg-subtle)', fontSize: 11, color: 'var(--muted)', fontWeight: 600 }}>
              <span style={{ flex: 1 }}>รายการยา</span><span style={{ minWidth: 70, textAlign: 'right', flex: 'none', whiteSpace: 'nowrap' }}>จ่ายจริง</span><span style={{ minWidth: 70, textAlign: 'right', flex: 'none', whiteSpace: 'nowrap' }}>ก่อน → หลัง</span>
            </div>
            {rowsWithIdx.filter((r) => effectiveFilter === 'all' || attentionIdx.has(r.i)).map((r) => { const i = r.i; return (
              <div key={i} className="rc-row" data-tone={r.applied || skippedRows.has(i) ? 'ok' : (r.match.kind === 'none' || r.match.kind === 'ambiguous') ? 'bad' : (r.match.kind === 'fuzzy' || unusualByIdx.has(i) || (r.med && r.qty - r.already > r.before)) ? 'warn' : 'ok'} style={{ opacity: r.applied ? 0.6 : 1 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, lineHeight: 1.3, fontWeight: r.match.kind === 'exact' ? 400 : 600 }}>
                    {r.med ? r.med.name : r.fileText}
                  </span>
                  {r.applied ? (
                    <Badge flexNone size={10.5} padding="2px 7px" color="var(--green)" bg="var(--green-tint)">✓ ตัดยอดแล้ว</Badge>
                  ) : (
                    <>
                      <span style={{ minWidth: 70, textAlign: 'right', flex: 'none', fontSize: 13, fontWeight: 600, color: 'var(--red)', whiteSpace: 'nowrap' }}>{r.med ? '−' + nf(r.qty - r.already) : '—'}</span>
                      <span className="muted" style={{ minWidth: 70, textAlign: 'right', flex: 'none', fontSize: 12.5, whiteSpace: 'nowrap' }}>{r.med ? nf(r.before) + '→' + nf(r.after) : '—'}</span>
                    </>
                  )}
                </div>
                {!r.applied && r.already > 0 && (
                  <div style={{ fontSize: 10.5, color: 'var(--green)', fontWeight: 600, marginTop: 3 }}>
                    {r.already >= r.qty ? '✓ ช่วงวันที่นี้เคยตัดยอดยานี้ครบแล้ว (' + nf(r.already) + ') — ไม่ตัดซ้ำ' : 'เคยตัดไปแล้ว ' + nf(r.already) + ' จากไฟล์ ' + nf(r.qty) + ' — ตัดเพิ่มเฉพาะส่วนต่าง ' + nf(r.qty - r.already)}
                  </div>
                )}
                {!r.applied && unusualByIdx.has(i) && (() => { const u = unusualByIdx.get(i)!; return (
                  <div data-testid="unusual-row" style={{ fontSize: 10.5, color: 'var(--amber-ink)', fontWeight: 600, marginTop: 3 }}>
                    ⚠ {u.kind === 'no_history' ? 'ยานี้ไม่มีประวัติการใช้ 30 วันล่าสุด แต่ไฟล์จ่าย ' + nf(u.qty) : 'สูงกว่าปกติ ~' + Math.round(u.ratio) + ' เท่า — ไฟล์จ่าย ' + nf(u.qty) + ' แต่ปกติ ~' + nf(Math.round(u.expected)) + ' ต่อ ' + businessDays + ' วันทำการ'} — ตรวจว่าไฟล์ถูกช่วงวันที่/หน่วยถูกต้อง
                  </div>
                ); })()}
                {!r.applied && state.hosxpRows?.[i]?.prevMatch && (
                  <div style={{ fontSize: 10.5, color: 'var(--green)', fontWeight: 700, marginTop: 3 }}>
                    ✎ จับคู่ด้วยมือ{' '}
                    <button type="button" data-testid="unresolve-row" onClick={() => unresolveHosxpRow(i)} style={{ border: 0, background: 'transparent', color: 'var(--red)', fontWeight: 700, fontSize: 10.5, textDecoration: 'underline', padding: '6px 4px', minHeight: 32 }}>ยกเลิกการจับคู่</button>
                  </div>
                )}
                {!r.applied && <MatchBadge match={r.match} fileText={r.fileText} medById={medById} />}
                {!r.applied && (r.match.kind === 'none' || r.match.kind === 'ambiguous') && (
                  <FileRowFixer idx={i} fileText={r.fileText} qty={r.qty} skipped={skippedRows.has(i)}
                    onSkip={(sk) => setSkippedRows((prev) => { const n = new Set(prev); if (sk) n.add(i); else n.delete(i); return n; })} />
                )}
                {!r.applied && r.med && r.qty - r.already > r.before && (
                  <div style={{ fontSize: 10.5, color: 'var(--red)', fontWeight: 600, marginTop: 3 }}>
                    ⚠ ยอดหน้างานมีแค่ {nf(r.before)} {r.med.unit} แต่ไฟล์จ่าย {nf(r.qty - r.already)} — จะตัดได้เท่าที่มี (ตรวจนับ/เติมยา)
                  </div>
                )}
              </div>
            ); })}
          </div>

          {missView.worth.length > 0 && (
            <div className="card" style={{ padding: 13, marginBottom: 12, border: '1px solid var(--border)' }}>
              <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 2 }}>ยาที่ปกติจ่ายทุกวันแต่ไม่ถูกตัดยอดจากไฟล์นี้ — ควรตรวจ ({missView.worth.length} รายการ)</div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginBottom: 10 }}>ตรวจสอบก่อนตัดยอด — รายการที่มีเหตุผล "ควรตรวจสอบ"/"ต้องแก้ไข" อาจทำให้จำนวนยาในระบบไม่ตรงกับที่จ่ายจริง</div>
              <div className="stagger" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
                {(showAllMiss ? missView.worth : missView.worth.slice(0, 30)).map(({ med, reason }) => (
                  <div key={med.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border-soft)', borderRadius: 9, padding: '8px 10px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                      <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{med.name}</span>
                      {reason.kind === 'zero_qty' && <Badge flexNone size={10.5} padding="2px 7px" color="var(--green)" bg="var(--green-tint)">ปกติ</Badge>}
                      {reason.kind === 'not_in_file' && <Badge flexNone size={10.5} padding="2px 7px" color="var(--amber-ink)" bg="var(--amber-bg)">ไม่พบในไฟล์</Badge>}
                      {reason.kind === 'ambiguous' && <Badge flexNone size={10.5} padding="2px 7px" color="var(--red)" bg="var(--red-bg)">ต้องตรวจสอบ</Badge>}
                    </div>
                    <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
                      {reason.kind === 'zero_qty' && 'พบในไฟล์ HOSxP แล้ว แต่จำนวนจ่าย = 0 จึงไม่ตัดยอด — ไม่ใช่ปัญหา'}
                      {reason.kind === 'ambiguous' && reason.wardClash && `พบชื่อ "${reason.fileText}" ในไฟล์ แต่ยานี้มีทั้งชั้น OPD และ IPD ชื่อเดียวกัน — HOSxP บอกไม่ได้ว่าจ่ายจากฝั่งไหน ต้องปรับยอดด้วยมือแยกราย ward`}
                      {reason.kind === 'ambiguous' && !reason.wardClash && `พบชื่อ "${reason.fileText}" ในไฟล์ แต่ตรงกับยาหลายรายการ (${reason.otherNames.join(', ')}) — ระบบแยกไม่ได้ว่าหมายถึงตัวไหน ต้องปรับยอดด้วยมือ`}
                    </div>
                    {reason.kind === 'not_in_file' && (
                      <MissDiagnosis med={med} fileNames={unmatchedFileNames} onFixMed={goFixMed} />
                    )}
                  </div>
                ))}
                {!showAllMiss && missView.worth.length > 30 && (
                  <button type="button" onClick={() => setShowAllMiss(true)} style={{ border: '1px dashed var(--border)', background: 'transparent', borderRadius: 9, padding: '10px', fontSize: 12.5, fontWeight: 600, color: 'var(--green)', minHeight: 44 }}>
                    แสดงอีก {missView.worth.length - 30} รายการ
                  </button>
                )}
              </div>
            </div>
          )}

          {missView.normal > 0 && (
            <div className="muted" data-testid="miss-normal-count" style={{ fontSize: 11.5, lineHeight: 1.5, margin: '0 2px 12px' }}>
              อีก {missView.normal} รายการที่ปกติจ่ายแต่ไม่อยู่ในไฟล์วันนี้ — น่าจะไม่มีการจ่ายจริง (ไฟล์ HOSxP แสดงเฉพาะยาที่มีการจ่าย) ไม่ต้องแก้
            </div>
          )}

          {unusualCount > 0 && (
            <label data-testid="ack-unusual" style={{ display: 'flex', gap: 9, alignItems: 'flex-start', background: 'var(--amber-bg)', border: '1px solid var(--amber)', borderRadius: 10, padding: '11px 12px', marginBottom: 12, cursor: 'pointer' }}>
              <input type="checkbox" checked={ackUnusual} onChange={(e) => setAckUnusual(e.target.checked)} style={{ marginTop: 2, flex: 'none', width: 17, height: 17 }} />
              <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--amber-ink)' }}>ตรวจแล้วว่า {unusualCount} รายการที่ติดป้าย ⚠ "สูงผิดปกติ" ถูกต้อง (ไฟล์เป็นของช่วงวันที่นี้จริง และหน่วยตรงกับหน่วยของยาในแอพ)</span>
            </label>
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
          {showRangePickers && (
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
            {state.hosxpFileInfo && dateStatus !== 'verified' && (
              <div style={{ marginTop: 9 }}>
                <button type="button" data-testid="use-due-range" onClick={() => { setHosxpCoveredFrom(dueFrom); setHosxpCoveredTo(dueYesterday); }} style={{ border: '1px solid var(--amber)', background: 'transparent', color: 'var(--amber-ink)', borderRadius: 999, padding: '7px 12px', fontSize: 12, fontWeight: 700, minHeight: 38, marginBottom: 8 }}>
                  ใช้วันที่ที่ควรตัด: {dueLabel}
                </button>
                <label style={{ display: 'flex', gap: 9, alignItems: 'flex-start', cursor: coveredValid ? 'pointer' : 'not-allowed', opacity: coveredValid ? 1 : 0.55 }}>
                  <input type="checkbox" data-testid="ack-date" disabled={!coveredValid} checked={state.hosxpDateConfirmed} onChange={(e) => setHosxpDateConfirmed(e.target.checked)} style={{ marginTop: 2, flex: 'none', width: 18, height: 18 }} />
                  <span style={{ fontSize: 12.5, lineHeight: 1.5, color: 'var(--amber-ink)', fontWeight: 600 }}>
                    ยืนยันว่าไฟล์นี้เป็นข้อมูลการจ่ายยาของวันที่ {coveredValid ? (state.hosxpCoveredFrom === state.hosxpCoveredTo ? thDateWithWeekday(state.hosxpCoveredFrom) : thDateWithWeekday(state.hosxpCoveredFrom) + ' – ' + thDateWithWeekday(state.hosxpCoveredTo)) : '(เลือกวันที่ก่อน)'} จริง
                  </span>
                </label>
              </div>
            )}
          </div>
          )}

          <div className="rc-commit" data-testid="commit-bar">
            {unmatchedBig.length > 0 && (
              <div role="status" style={{ fontSize: 12, color: 'var(--red)', fontWeight: 700, marginBottom: 6, lineHeight: 1.5, textAlign: 'center' }}>
                ยังตัดยอดไม่ได้: เหลือ {unmatchedBig.length} รายการที่ยังไม่ได้จับคู่/ข้าม
              </div>
            )}
            {unmatchedBig.length === 0 && unusualPending > 0 && (
              <div role="status" style={{ fontSize: 12, color: 'var(--amber-ink)', fontWeight: 700, marginBottom: 6, lineHeight: 1.5, textAlign: 'center' }}>ติ๊กยืนยันตัวเลขที่สูงผิดปกติก่อน</div>
            )}
            {canCommit && !state.busy['reconcile'] && (
              <div className="rc-readback" data-testid="commit-readback">
                จะตัด <b>{nf(matchedCount - alreadyCount)}</b> รายการ รวม <b>{nf(totalUnits)}</b> หน่วย · ช่วงวันที่ <b>{state.hosxpCoveredFrom === state.hosxpCoveredTo ? state.hosxpCoveredFrom : state.hosxpCoveredFrom + ' ถึง ' + state.hosxpCoveredTo}</b>{skippedCount > 0 ? ' · ข้าม ' + skippedCount : ''}
              </div>
            )}
            {state.busy['reconcile'] && state.reconcileProgress && <ReconcileProgress done={state.reconcileProgress.done} total={state.reconcileProgress.total} />}
          <button onClick={commitReconcile} disabled={!canCommit || !!state.busy['reconcile']} className="btn-primary rc-commit-btn">
            {state.busy['reconcile']
              ? 'กำลังตัดยอด…'
              : isResuming
                ? `ตัดยอดส่วนที่เหลือต่อ (${reconcileRows.length - appliedCount} รายการ)`
                : `ตัดยอดหน้างานตามไฟล์นี้ และบันทึก discrepancy log${skippedCount > 0 ? ' (ข้าม ' + skippedCount + ' รายการที่จับคู่ไม่ได้)' : ''}`}
          </button>
          </div>
        </>
      )}

      <details data-testid="reconcile-history" open={gapDays !== null && gapDays.length > 0} style={{ marginTop: 18 }}>
        <summary style={{ cursor: 'pointer', fontSize: 13, fontWeight: 700, padding: '10px 2px', minHeight: 44, display: 'flex', alignItems: 'center' }}>
          ประวัติและการตรวจย้อนหลัง{gapDays !== null && gapDays.length > 0 ? ' — พบ ' + gapDays.length + ' วันที่ตัดไม่ครบ' : ''}
        </summary>
        <ReconcileCalendar onFixMed={goFixMed} />
      {gapDays !== null && gapDays.length > 0 && (
        <div style={{ marginTop: 18 }}>
          <div className="muted" style={{ fontSize: 12, fontWeight: 600, margin: '0 2px 8px' }}>
            ตรวจสอบความครบถ้วนของการตัดยอด {RECONCILE_GAP_LOOKBACK_DAYS} วันล่าสุด — พบ {gapDays.length} วันที่ควรตรวจสอบ
          </div>
          <div className="card stagger" style={{ overflow: 'hidden' }}>
            {gapDays.map((g) => {
              const open = openGap === g.dateIso;
              const detail = gapDetail[g.dateIso];
              return (
                <div key={g.dateIso} style={{ borderBottom: '1px solid var(--border-soft)' }}>
                  <button type="button" aria-expanded={open} onClick={() => toggleGap(g.dateIso)} style={{ width: '100%', textAlign: 'left', border: 0, background: 'transparent', padding: '10px 13px', display: 'block', color: 'inherit', cursor: 'pointer' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: g.kind === 'partial' ? 4 : 0 }}>
                      {g.kind === 'missing'
                        ? <Badge flexNone size={11} padding="2px 8px" color="var(--red)" bg="var(--red-bg)">ไม่มีไฟล์</Badge>
                        : <Badge flexNone size={11} padding="2px 8px" color="var(--amber-ink)" bg="var(--amber-bg)">ตัดไม่ครบ</Badge>}
                      <span style={{ fontSize: 12.5, fontWeight: 600, flex: 1, minWidth: 0 }}>
                        {thDate(new Date(g.dateIso + 'T12:00:00').getTime())}
                        {g.kind === 'missing' ? ' — ไม่มีการตัดยอด HOSxP เลยทั้งวัน' : ' — ' + g.missingMeds.length + ' รายการที่ปกติจ่ายทุกวันไม่ถูกตัดยอด'}
                      </span>
                      <span className="muted" style={{ flex: 'none', fontSize: 11 }}>{open ? 'ซ่อน ▲' : 'ดูสาเหตุรายตัว ▾'}</span>
                    </div>
                    {g.kind === 'partial' && !open && (
                      <div className="muted" style={{ fontSize: 11, lineHeight: 1.5 }}>
                        {g.missingMeds.slice(0, 5).map((m) => m.name).join(', ')}
                        {g.missingMeds.length > 5 ? ' และอีก ' + (g.missingMeds.length - 5) + ' รายการ' : ''}
                      </div>
                    )}
                  </button>
                  {open && (
                    <div style={{ padding: '0 13px 12px' }}>
                      {detail === 'loading' || detail === undefined
                        ? <div className="muted" style={{ fontSize: 12 }}>กำลังโหลดสาเหตุ…</div>
                        : detail === 'error'
                          ? <div style={{ fontSize: 12, color: 'var(--red)' }}>โหลดสาเหตุของวันนี้ไม่สำเร็จ — กดที่แถวเพื่อลองใหม่</div>
                          : <ReconcileDayDetail day={detail} onFixMed={goFixMed} />}
                    </div>
                  )}
                </div>
              );
            })}
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
                      {liveMed && <MissDiagnosis med={liveMed} fileNames={recentUnmatchedNames} onFixMed={goFixMed} />}
                    </div>
                  );
                })}
              </div>
              <div className="muted" style={{ fontSize: 11, lineHeight: 1.5, marginTop: 6 }}>
                ยานี้มาจากประวัติการตัดยอดจริง (ไม่ใช่แค่ไฟล์ล่าสุด) — ตัวที่ขึ้น "ต้องตรวจสอบ" ซ้ำๆ มักเป็น
                ยาชื่อเดียวกันระหว่าง OPD/IPD ที่จับคู่ไม่ได้ว่าเป็นฝั่งไหน ส่วนตัวที่ขึ้น "ไม่พบในไฟล์" ระบบเทียบชื่อ
                กับรายชื่อที่จับคู่ไม่ได้ในไฟล์ล่าสุดให้แล้ว: ถ้ามีชื่อคล้ายจะบอกว่าต่างกันตรงไหนและเพิ่มชื่อได้ในคลิกเดียว
                ถ้าไม่มีชื่อคล้ายเลย แปลว่าส่วนใหญ่วันนั้นไม่มีการจ่ายยานี้
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
      </details>
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
