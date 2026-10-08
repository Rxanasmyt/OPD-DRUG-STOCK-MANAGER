import { useState, useEffect, useMemo, useRef, Fragment, type ReactNode, type CSSProperties } from 'react';
import { useApp } from '../store/AppContext';
import { subQty, wardOf, subTone, usesSubstock, toneFor, boxBreakdownLabel } from '../store/selectors';
import { nf, thDate, fiscalYear } from '../utils/format';
import { printSubstockCardSheet } from '../utils/print';
import { downloadCsv } from '../utils/csv';
import { MedDot } from '../components/MedDot';
import { Qty, UsageRateBadge, PAR_LABEL_COLOR } from '../components/Qty';
import { WardBadge } from '../components/WardBadge';
import { SkeletonList } from '../components/Skeleton';
import { EmptyState } from '../components/EmptyState';
import { SearchInput } from '../components/SearchInput';

interface LedgerRow { ts: number; type: string; qty: number; note: string; by: string; balance: number }

// Traceability fix: "จ่าย" alone doesn't say WHY stock left substock — เติมหน้างาน (normal
// dispensing to the floor) and ตัดหมดอายุ (writing off an expired lot) both showed as an
// identical red number with nothing to tell them apart, which is exactly the kind of thing a
// real stock-card review needs to distinguish at a glance. One small icon+label per row fixes
// it without touching the color-coded รับ/จ่าย columns already in place.
const TYPE_META: Record<string, { icon: string; label: string }> = {
  receive_from_central: { icon: '📥', label: 'รับจากคลังใหญ่' },
  transfer_to_floor: { icon: '🚚', label: 'เติมหน้างาน' },
  expired: { icon: '🗑️', label: 'ตัดหมดอายุ' },
  // Generic fallback label for 'count' — labelFor() below always overrides this with a
  // substock-vs-หน้างาน-specific wording instead, since which one applies depends on which
  // ledger side is open (not knowable from the type string alone). Kept here only as the
  // icon source and a safety-net label for any caller that doesn't go through labelFor().
  count: { icon: '🔢', label: 'นับสต็อก (ปรับยอด)' },
  // The rest only ever show up on a FLOOR ledger (noSubstock med — see fetchFloorLedger) —
  // adjust/return/damaged/reconcile_hosxp/ward_move all only ever touch floor, never substock.
  reconcile_hosxp: { icon: '🧾', label: 'ตัดยอด HOSxP' },
  adjust: { icon: '⚖️', label: 'ปรับยอด' },
  return: { icon: '↩️', label: 'คืนยา' },
  damaged: { icon: '💥', label: 'ยาเสีย/ชำรุด' },
  ward_move_in: { icon: '↘️', label: 'ย้ายมาจากชั้นอื่น' },
  ward_move_out: { icon: '↗️', label: 'ย้ายไปชั้นอื่น' },
};

// Real-world request: "นับสต็อคหน้างานใหม่แล้วคลาดเคลื่อนจากเดิม นับสต็อคsubstockใหม่แล้ว
// คลาดเคลื่อนจากเดิม" — a floor recount and a substock recount both logged as the same flat
// "นับสต็อก (ปรับยอด)" label (TYPE_META.count above), giving no hint which stage was actually
// recounted when read out of context (a printed sheet or CSV row, away from this screen's own
// substock/หน้างาน toggle). Both are always logged type:'count' (commitCount vs commitSubCount
// in AppContext.tsx) and only ever SHOWN on the ledger side that matches which one they are
// (the loc:'substock'/loc:'floor' guard in fetchSubstockLedger/fetchFloorLedger already keeps
// them from bleeding into each other's ledger) — so `hasSub`, already known at every call site
// below, is enough on its own to pick the right wording, with no new data needed.
function labelFor(type: string, hasSub: boolean): string {
  if (type === 'count') return hasSub ? 'นับสต็อก substock ใหม่ (ปรับยอด)' : 'นับสต็อกหน้างานใหม่ (ปรับยอด)';
  return TYPE_META[type]?.label || type;
}

// Must match fetchSubstockLedger's/fetchFloorLedger's own *_LEDGER_TYPES (AppContext.tsx)
// exactly — used below only to detect when a NEW relevant row has arrived via the live txs
// listener, not to filter what's shown (the fetch functions already do the real filtering
// server-round-trip).
const SUBSTOCK_LEDGER_TYPES = new Set(['receive_from_central', 'transfer_to_floor', 'expired', 'count']);
const FLOOR_LEDGER_TYPES = new Set(['receive_from_central', 'transfer_to_floor', 'reconcile_hosxp', 'adjust', 'return', 'damaged', 'ward_move_in', 'ward_move_out', 'count']);

/** The digital replacement for the paper "บัตรคุมสต็อกยา" (yellow stock card) — same
 * วันที่/รับ/จ่าย/คงเหลือ layout staff already read off the physical card, generated from real
 * substock transaction history instead of copied there by hand. Pick a med, see it on screen
 * live, or print an A4 sheet in the same shape as the card for anyone who still wants a
 * physical printout on file. */
export default function SubstockCardScreen() {
  const { state, fetchSubstockLedger, fetchFloorLedger, toast, setSubstockFocusId, go, setAdminTab, setAuditFilter, userName } = useApp();
  const [search, setSearch] = useState('');
  const [medId, setMedId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<LedgerRow[] | null>(null);
  // ปีงบประมาณที่กำลังดู — 'all' ดูทุกปีที่มีข้อมูล (บัตรกระดาษเดิมต้องเปลี่ยนแผ่นทุกปีงบประมาณ,
  // แต่ที่นี่เก็บได้ไม่จำกัดปีแล้วสลับดูย้อนหลังได้ทันทีโดยไม่ต้องโหลดใหม่ — คำนวณคงเหลือสะสม
  // จากประวัติทั้งหมดเสมอ ไม่ว่าจะกรองปีไหนอยู่ ยอดคงเหลือในแต่ละแถวจึงถูกต้องเสมอ)
  const [year, setYear] = useState<number | 'all'>('all');
  // Real-world request: "ยาหน้างาน ไม่มีประวัติว่าแต่ละวันถูกตัดยอดไปเท่าไร คงเหลือเท่าไร" — a
  // med WITH a substock stage used to only ever show its substock ledger here; fetchFloorLedger
  // already existed and already worked for ANY med (it was only ever called for a noSubstock
  // one) — the gap was purely that this screen never offered a way to switch to it for a
  // substock-backed med. 'sub' is the default for one (matches the old always-substock
  // behavior); a noSubstock med is forced to 'floor' in openCard below and has no toggle to
  // show (there's only one side for it).
  const [viewSide, setViewSide] = useState<'sub' | 'floor'>('sub');
  // Real-world request: "ยังไม่มีรายละเอียดบอกว่าที่บอกเพิ่มหรือลบคือเกิดจากอะไร...ให้มีรายละเอียด
  // ที่ชัดเจนตรวจสอบย้อนหลังได้" — every row already carried this exact detail in its `note`
  // (FEFO lot used, box breakdown, นับได้มากกว่า/น้อยกว่าระบบ เท่าไร, the typed adjust/return
  // reason, ...), but the only place it ever showed was the row's `title` attribute — a
  // mouse-hover tooltip a touchscreen never triggers, same class of gap already fixed for the
  // type-icon legend below. Tap-to-expand works on both; a Set so more than one row can be open
  // for comparison at once. Keyed by row index within the currently-viewed rows, so it's reset
  // whenever that set changes (new med, side switch, live refetch) to avoid a stale index
  // pointing at a now-different row.
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set());
  const toggleRowNote = (i: number) => setExpandedRows((prev) => {
    const next = new Set(prev);
    if (next.has(i)) next.delete(i); else next.add(i);
    return next;
  });

  const med = medId ? state.meds.find((m) => m.id === medId) : null;
  // Real-world request: a noSubstock med (liquids/inhalers/sprays/injectables) has no substock
  // stage, but floor plays substock's role for it (receive from central lands directly on
  // floor, the daily HOSxP usage-cut deducts from floor too — see fetchFloorLedger in
  // AppContext.tsx), so it gets the same card, just built from floor history instead of
  // substock history. No longer excluded from the picker.
  const options = !medId && search.trim()
    ? state.meds.filter((m) => { const s = search.trim().toLowerCase(); return m.active && (m.name.toLowerCase().indexOf(s) >= 0 || m.code.toLowerCase().indexOf(s) >= 0); }).slice(0, 10)
    : [];

  // Bug fix (stale-response race): openCard's fetch is async — opening med A (slow network/
  // large history) then immediately searching and opening med B (small/fast history) before
  // A's fetch finishes used to let A's slower response land AFTER B's and silently overwrite
  // B's already-correct rows with A's ledger, while the header/search box/liveBalance still
  // showed med B — a wrong-drug ledger table. One monotonic counter shared with the live
  // re-fetch effect below: whichever fetch was issued LAST always wins, however they resolve.
  const loadReqId = useRef(0);
  // Bug fix (false mismatch): -1 means "no fetch has completed for the currently open med yet"
  // — distinct from 0, which is latestRelevantTxTs's own legitimate value for "this med truly
  // has no relevant transaction at all". The old code used 0 for both meanings, so a med opened
  // with no relevant history yet (0) looked identical to "not initialized" (also 0) — when its
  // first-ever relevant transaction then landed while the card was open, the live-refetch effect
  // below mistook that brand-new transaction for the one openCard's initial fetch already
  // covered, set the baseline, and returned WITHOUT refetching — liveBalance updated immediately
  // (it's reactive) but the ledger rows stayed empty/stale, firing a false mismatch banner that
  // only ever self-corrected once a SECOND new transaction arrived. See openCard and the effect
  // below for where each end of this fix lives.
  const seenTxTs = useRef(-1);
  // Shared by openCard (first open) and switchSide (flipping substock ⇄ หน้างาน on an
  // already-open card) — identical fetch/stale-response-guard/fiscal-year-default logic either
  // way, just parameterized on which side to pull.
  const loadLedger = async (id: string, side: 'sub' | 'floor') => {
    const reqId = ++loadReqId.current;
    setLoading(true);
    setRows(null);
    setYear('all');
    try {
      const ledger = await (side === 'sub' ? fetchSubstockLedger(id) : fetchFloorLedger(id));
      if (loadReqId.current !== reqId) return; // a newer openCard()/switchSide()/live-refetch has since superseded this
      setRows(ledger);
      // Bug fix (false mismatch): baseline the "already covered by this fetch" marker off the
      // ledger's OWN last row ts (0 when it has none), not off latestRelevantTxTs computed from
      // state.txs — see the live-refetch effect below for why relying on that alone dropped the
      // very first new transaction after opening a med with no relevant history yet.
      seenTxTs.current = ledger.length ? ledger[ledger.length - 1].ts : 0;
      // Default to whichever fiscal year is most relevant to look at right now: this year's
      // (ปีงบประมาณปัจจุบัน) if it already has activity, otherwise the most recent year that
      // does — never lands on an empty screen for a drug whose last movement was last year.
      const curFy = fiscalYear();
      const fys = new Set(ledger.map((r) => fiscalYear(r.ts)));
      if (fys.has(curFy)) setYear(curFy);
      else if (fys.size) setYear(Math.max(...fys));
    } catch (e) {
      if (loadReqId.current !== reqId) return;
      console.error(e);
      toast('ดึงประวัติบัตรสต็อกไม่สำเร็จ — ต้องใช้อินเทอร์เน็ต ลองใหม่อีกครั้ง');
    } finally {
      if (loadReqId.current === reqId) setLoading(false);
    }
  };
  const openCard = async (id: string) => {
    const m = state.meds.find((x) => x.id === id);
    if (!m) return;
    const side = usesSubstock(m) ? 'sub' : 'floor';
    setMedId(id);
    setSearch(m.name);
    setViewSide(side);
    await loadLedger(id, side);
  };
  // Lets a substock-backed med's card flip over to show its หน้างาน history too — see
  // viewSide's own doc comment. A noSubstock med has only one side (openCard forces 'floor'
  // and the toggle button never renders for it — see canToggle below), so this never fires
  // for one in practice.
  const switchSide = (side: 'sub' | 'floor') => {
    if (!medId || side === viewSide) return;
    setViewSide(side);
    loadLedger(medId, side);
  };

  // All fiscal years that have at least one row, newest first — populates the year dropdown.
  const years = useMemo(() => {
    if (!rows) return [];
    return Array.from(new Set(rows.map((r) => fiscalYear(r.ts)))).sort((a, b) => b - a);
  }, [rows]);

  // Rows to actually render/print/export — the running balance on each row was already
  // computed over the FULL history in fetchSubstockLedger, so filtering down to one fiscal
  // year here for display never has to touch that math again.
  const viewRows = useMemo(() => {
    if (!rows) return null;
    return year === 'all' ? rows : rows.filter((r) => fiscalYear(r.ts) === year);
  }, [rows, year]);

  // Collapse any open note rows whenever the underlying ledger changes — a new med, a side
  // switch, or a live refetch all swap in a different set of rows, so an expanded-by-index
  // row from before could otherwise silently point at an unrelated transaction after the swap.
  useEffect(() => { setExpandedRows(new Set()); }, [rows]);

  const yearTotals = useMemo(() => {
    if (!viewRows) return null;
    let received = 0, dispensed = 0, expired = 0, counted = 0;
    for (const r of viewRows) {
      // Bug fix: a substock count adjustment (type:'count', either sign — commitSubCount) used
      // to fall through into "received" (any positive qty) or "dispensed" (any non-'expired'
      // negative qty) here, mislabeling a shrinkage found during a cycle count as if it had
      // really been transferred out to the floor, or a surplus found as if it had really come
      // from the central warehouse — neither happened. Give it its own bucket instead.
      if (r.type === 'count') counted += r.qty;
      else if (r.qty > 0) received += r.qty;
      else if (r.type === 'expired') expired += -r.qty;
      else dispensed += -r.qty;
    }
    return { received, dispensed, expired, counted, net: received - dispensed - expired + counted };
  }, [viewRows]);

  // Arrived here from DoneScreen's "ดูบัตรสต็อก" right after a receive/transfer — open that
  // med's card immediately instead of landing on an empty search box.
  useEffect(() => {
    if (!state.substockFocusId) return;
    const id = state.substockFocusId;
    setSubstockFocusId(null);
    openCard(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state.substockFocusId]);

  // Bug fix (real-time): the ledger rows were only ever fetched once, on openCard — a receive
  // into substock or a transfer out to the floor happening on ANY device while this card sits
  // open (e.g. left up on a tablet at the shelf) never appeared until the med was re-searched.
  // Worse, the top-line liveBalance above IS reactive (subQty reads the live lots listener), so
  // it would race ahead of the stale ledger and the "mismatch" banner below would fire on a
  // perfectly normal new transaction, not a real discrepancy. state.txs is itself a live-synced
  // listener (capped to the 300 most recent, but a just-happened transaction is always in that
  // window), so watch it for a newer row belonging to this med and silently re-pull the ledger
  // when one shows up — no loading spinner, no resetting search/year, just the rows updating
  // under the reader the way the balance already did.
  // Whether a substock-backed med CAN flip to a floor view — the toggle button only renders
  // for one of these (a noSubstock med has only one side to show at all).
  const canToggle = med ? usesSubstock(med) : false;
  // Which side is actually being DISPLAYED right now — driven by viewSide once a toggle exists,
  // not just usesSubstock(med) directly (that alone would always force the substock side back
  // on, defeating the whole point of the toggle).
  const hasSub = med ? (canToggle && viewSide === 'sub') : true;
  const latestRelevantTxTs = useMemo(() => {
    if (!medId || !med) return 0;
    const useSub = hasSub;
    const types = useSub ? SUBSTOCK_LEDGER_TYPES : FLOOR_LEDGER_TYPES;
    return state.txs.reduce((mx, t) => {
      if (t.medId !== medId || !types.has(t.type)) return mx;
      if (useSub) {
        if ((t.type === 'expired' || t.type === 'count') && t.loc !== 'substock') return mx;
      } else {
        if (t.type === 'receive_from_central' && t.to !== 'floor') return mx;
        if (t.type === 'count' && t.loc !== 'floor') return mx;
      }
      return t.ts > mx ? t.ts : mx;
    }, 0);
  }, [state.txs, medId, med, hasSub]);
  useEffect(() => {
    seenTxTs.current = -1; // reset the baseline whenever a different med's card opens — openCard's own fetch will set the real one
  }, [medId]);
  // Also reset on a side switch — switchSide's own loadLedger call is the authoritative fetch
  // for the newly-displayed side (and sets the real baseline once it resolves); without this,
  // this effect could briefly compare the NEW side's latestRelevantTxTs against the OLD side's
  // leftover baseline right after flipping.
  useEffect(() => {
    seenTxTs.current = -1;
  }, [hasSub]);
  useEffect(() => {
    if (!medId || !latestRelevantTxTs || !med) return;
    // seenTxTs.current still -1 here means openCard's/switchSide's own fetch for this med/side
    // hasn't resolved yet (this effect raced ahead of it) — let that fetch's own completion set
    // the real baseline instead of guessing one here, so its stale-response guard (loadReqId)
    // stays the single source of truth for which fetch's result actually wins.
    if (seenTxTs.current < 0) return;
    if (latestRelevantTxTs <= seenTxTs.current) return;
    seenTxTs.current = latestRelevantTxTs;
    const reqId = ++loadReqId.current;
    (hasSub ? fetchSubstockLedger(medId) : fetchFloorLedger(medId))
      .then((ledger) => { if (loadReqId.current === reqId) setRows(ledger); })
      .catch((e) => console.error(e));
  }, [latestRelevantTxTs, medId, med, hasSub, fetchSubstockLedger, fetchFloorLedger]);

  const liveBalance = med ? (hasSub ? subQty(state, med.id) : med.floor) : 0;
  const balanceTone = med ? (hasSub ? subTone(liveBalance, med.parSub) : toneFor(med)) : 'var(--green)';
  // Bug fix (misleading number): Math.max(1, par) only guarded the divide-by-zero crash, not a
  // misleading RESULT — a med with no par configured (a real, common state; see
  // parAnomaliesFor's own no_par_sub/no_par_floor checks) silently divided by 1 instead, so a
  // med sitting at 50 units with par 0 showed "5000% ของ par" in bold next to the one number
  // this whole screen exists to show clearly. null (no percentage to show at all), same idea as
  // daysOfStockLeft() returning null rather than a misleading number when there's no real basis
  // for one.
  const par = med ? (hasSub ? med.parSub : med.parFloor) : 0;
  const balancePct = med && par > 0 ? Math.round((liveBalance / par) * 100) : null;
  const lastLedgerBalance = rows && rows.length ? rows[rows.length - 1].balance : 0;
  // The live balance (from current lots) and the ledger's computed running total should
  // always agree — if they don't, something in the tx history is incomplete or a lot was
  // touched outside the normal receive/transfer/scrap paths. Surface the mismatch rather
  // than silently showing two different numbers.
  const mismatch = rows && rows.length > 0 && liveBalance !== lastLedgerBalance;
  // Same drug on both OPD and IPD shelves (same name, separate records — see wardOf) means
  // the ledger only trusts tx rows explicitly tagged with this med's id, so anything logged
  // before that tagging existed won't appear here even though it's the right drug's history.
  // Worth naming specifically — it looks identical to a real discrepancy otherwise, and "check
  // the audit log" (the generic mismatch message) isn't the actual right next step for it.
  // Bug fix: this used to also match a deactivated ex-sibling left behind by "รวมสต็อก
  // OPD+IPD" (mergeWardMeds/mergeAllWardPairs — see AppContext.tsx) — that record still shares
  // the name but isn't a live ambiguity anymore (it's zeroed out and inactive, its stock
  // already folded into this one), so warning about it here was just wrong once merged.
  // Bug fix (audit finding): but treating EVERY inactive same-name med as "not a twin" went too
  // far the other way — an accidental duplicate deactivated for any unrelated reason would
  // wrongly suppress this warning too, even though its history genuinely is ambiguous. Med.
  // mergedInto (types.ts) now distinguishes the two: only a same-name med actually merged INTO
  // this one skips the warning; any other inactive same-name med still triggers it, same as an
  // active twin would. Must match AppContext.tsx's fetchFloorLedger/fetchSubstockLedger — same
  // check, same reasoning.
  const hasNameTwin = med ? state.meds.some((x) => x.id !== med.id && x.name === med.name && (x.active || x.mergedInto !== med.id)) : false;

  const printCard = () => {
    if (!med || !viewRows) return;
    const cardRows = viewRows.map((r) => ({
      ts: r.ts, received: r.qty > 0 ? r.qty : 0, dispensed: r.qty < 0 ? -r.qty : 0, balance: r.balance, by: r.by,
      typeLabel: labelFor(r.type, hasSub), note: r.note || undefined,
    }));
    // ยอดยกมา — the balance right before this printed period's first row, backed out of that
    // row's own signed qty (same math the running balance itself uses).
    const openingBalance = viewRows.length ? viewRows[0].balance - viewRows[0].qty : undefined;
    // Bug fix (false mismatch on printed sheet): the tie-out block compares the LAST ROW OF
    // THE PRINTED (year-filtered) PERIOD against today's real-time balance — correct only when
    // the period printed is the most recent one with activity. Printing an archival PAST fiscal
    // year (e.g. pulling last year's card for a file, after this year already has its own
    // transactions) would otherwise always show "ไม่สอดคล้องกัน" even though nothing is
    // actually wrong — the two numbers are for different points in time by construction, not a
    // real discrepancy. Only include the live-balance comparison when printing the current/most
    // recent year (or the full unfiltered history), where "last row's balance" and "right now"
    // really are supposed to be the same number.
    const isMostRecentYear = year === 'all' || year === years[0];
    const ok = printSubstockCardSheet(
      hasSub
        ? { code: med.code, name: med.name, parSub: med.parSub, unit: med.unit, ward: wardOf(med), packSize: med.packSize }
        : { code: med.code, name: med.name, parSub: med.parFloor, unit: med.unit, ward: wardOf(med), parLabel: 'par หน้างาน (Max)', heading: 'บัตรคุมยา (ไม่มี substock)', packSize: med.packSize },
      cardRows,
      year,
      { totals: yearTotals ? { received: yearTotals.received, dispensed: yearTotals.dispensed } : undefined, openingBalance, liveBalance: isMostRecentYear ? liveBalance : undefined, printedBy: userName() },
    );
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  };

  const exportCard = async () => {
    if (!med || !viewRows) return;
    const header = ['วันที่', 'ประเภท', 'รับ', 'จ่าย', 'คงเหลือ', 'โดย', 'หมายเหตุ'];
    const body = viewRows.map((r) => [
      thDate(r.ts), labelFor(r.type, hasSub),
      r.qty > 0 ? r.qty : '', r.qty < 0 ? -r.qty : '', r.balance, r.by, r.note,
    ]);
    const fname = (hasSub ? 'substock_card_' : 'floor_card_') + med.code + '_' + (year === 'all' ? 'ทุกปี' : 'FY' + year) + '.csv';
    const outcome = await downloadCsv([header, ...body], fname);
    toast(outcome === 'saved' ? 'ดาวน์โหลด CSV แล้ว' : outcome === 'declined' ? 'ยกเลิกการบันทึกไฟล์' : 'ดาวน์โหลดไม่สำเร็จ — เบราว์เซอร์นี้ไม่รองรับ');
  };

  return (
    <div style={{ padding: '14px 14px 24px', animation: 'fade .18s' }}>
      {/* Bug fix (real-world request): this onboarding line used to stay on screen even after
          a drug was already picked — pure clutter at that point, pushing the actual card
          (what someone opened this screen to see) further down. Gated the same way the search
          box already is: relevant only before a med is chosen. */}
      {!medId && (
        <div className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 12 }}>
          เลือกยาเพื่อดูบัตรคุมยาแบบ real-time — รับจากคลังใหญ่ / เติมหน้างาน / ตัดหมดอายุ พร้อมยอดคงเหลือสะสม แทนบัตรกระดาษที่ต้องจดมือ — ยาที่ไม่มี substock (ยาฉีด/ยาน้ำ/ยาพ่น) จะแสดงบัตรอ้างอิงจากยอดหน้างานแทน
        </div>
      )}

      {!medId && (
        <>
          <SearchInput value={search} onChange={setSearch} placeholder="ค้นหาชื่อยา" onEnter={options.length === 1 ? () => openCard(options[0].id) : undefined} />
          {options.length > 0 && (
            <div style={{ border: '1px solid var(--border-soft)', borderRadius: 10, maxHeight: 280, overflowY: 'auto', marginTop: 9 }}>
              {options.map((m) => (
                <button key={m.id} onClick={() => openCard(m.id)} style={{ width: '100%', textAlign: 'left', border: 0, borderBottom: '1px solid var(--border-soft)', background: 'var(--bg-card)', padding: '10px 12px', minHeight: 44 }}>
                  <span style={{ fontSize: 13.5, display: 'flex', alignItems: 'center', gap: 7 }}><MedDot code={m.code} /> {m.name} <WardBadge med={m} /></span>
                  <span className="muted" style={{ display: 'block', fontSize: 11.5 }}>
                    {usesSubstock(m) ? 'substock ปัจจุบัน ' + nf(subQty(state, m.id)) : 'หน้างานปัจจุบัน ' + nf(m.floor)} {m.unit}
                  </span>
                </button>
              ))}
            </div>
          )}
        </>
      )}

      {med && (
        <>
          {/* Styled after the real hand-written yellow "บัตรคุมสต็อกยา" ledger card — kept the
              amber identity (staff already recognize that color as "this is the stock card"),
              but with a more deliberate, formal chrome: a gradient header with a thin animated
              highlight (same premium-chrome language LoginScreen's card uses), deeper shadow,
              more generous radius — a real elevated instrument panel rather than a flat colored
              box. Data underneath is still live — this is a skin over the same real-time
              subQty()/fetchSubstockLedger() plumbing. */}
          <div style={{ position: 'relative', border: '1px solid var(--amber)', borderRadius: 18, overflow: 'hidden', marginBottom: 14, boxShadow: '0 14px 34px -16px rgba(120,80,10,.35), var(--shadow-sm)' }}>
            <div aria-hidden="true" style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: 'linear-gradient(90deg, transparent, #fff, rgba(255,255,255,.4), #fff, transparent)', backgroundSize: '200% 100%', animation: 'aiGradientShift 4.5s ease-in-out infinite', zIndex: 1 }} />
            <div style={{ background: 'linear-gradient(135deg, #f0b429 0%, var(--amber) 100%)', color: '#2a1f0a', padding: '12px 15px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <span style={{ fontSize: 14, fontWeight: 800, letterSpacing: '.02em', display: 'flex', alignItems: 'center', gap: 7 }}>
                <span aria-hidden="true" style={{ width: 26, height: 26, borderRadius: 8, background: 'rgba(255,255,255,.4)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13 }}>🗂️</span>
                {hasSub ? 'บัตรคุมสต็อกยา' : canToggle ? 'บัตรคุมยา (มุมมองหน้างาน)' : 'บัตรคุมยา (ไม่มี substock)'}
              </span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {/* Multi-year history browser — the paper card needed a new sheet every fiscal
                    year; this keeps every year in one record and lets you flip between them,
                    "ทั้งหมด" pooling every year ever recorded for this drug into one view. */}
                <select
                  value={year}
                  onChange={(e) => setYear(e.target.value === 'all' ? 'all' : Number(e.target.value))}
                  // Bug fix (mobile fit): a <select> under 16px triggers the same iOS Safari
                  // auto-zoom-on-focus as a text input — tapping this year picker zoomed the
                  // whole page in. Padding trimmed slightly to keep the pill's proportions
                  // close to before now that the text itself is bigger.
                  style={{ border: '1px solid rgba(42,31,10,.35)', background: 'rgba(255,255,255,.6)', color: '#2a1f0a', padding: '4px 6px', borderRadius: 8, fontSize: 16, fontWeight: 700 }}
                >
                  {years.length === 0 && <option value={fiscalYear()}>ปีงบประมาณ {fiscalYear()}</option>}
                  {years.map((y) => <option key={y} value={y}>ปีงบ {y}</option>)}
                  <option value="all">ทุกปี</option>
                </select>
                <button onClick={() => { setMedId(null); setSearch(''); setRows(null); }} style={{ border: '1px solid rgba(42,31,10,.35)', background: 'rgba(255,255,255,.4)', color: '#2a1f0a', padding: '5px 10px', borderRadius: 8, fontSize: 11.5, fontWeight: 600 }}>เปลี่ยนยา</button>
              </div>
            </div>
            {/* Real-world request: "ยาหน้างาน ไม่มีประวัติว่าแต่ละวันถูกตัดยอดไปเท่าไร คงเหลือ
                เท่าไร" — a med with a substock stage used to only ever show its substock
                ledger here, with no way to also see the SAME picture for its หน้างาน side
                (daily deduction/balance, รับจาก substock, ปรับยอด, ฯลฯ) — fetchFloorLedger
                already computed this correctly, it just was never wired up for one. Only
                rendered when there's actually a second side to switch to (canToggle). */}
            {canToggle && (
              <div style={{ display: 'flex', gap: 6, padding: '8px 14px', background: 'var(--amber-bg)', borderTop: '1px solid var(--amber-border)' }}>
                <button
                  onClick={() => switchSide('sub')}
                  className="press-spring"
                  style={{ flex: 1, border: '1px solid ' + (hasSub ? 'var(--amber-ink)' : 'rgba(42,31,10,.3)'), background: hasSub ? 'rgba(255,255,255,.6)' : 'transparent', color: '#2a1f0a', fontWeight: hasSub ? 800 : 600, padding: '7px 10px', borderRadius: 9, fontSize: 12.5 }}
                >
                  substock
                </button>
                <button
                  onClick={() => switchSide('floor')}
                  className="press-spring"
                  style={{ flex: 1, border: '1px solid ' + (!hasSub ? 'var(--amber-ink)' : 'rgba(42,31,10,.3)'), background: !hasSub ? 'rgba(255,255,255,.6)' : 'transparent', color: '#2a1f0a', fontWeight: !hasSub ? 800 : 600, padding: '7px 10px', borderRadius: 9, fontSize: 12.5 }}
                >
                  หน้างาน
                </button>
              </div>
            )}
            <div style={{ background: 'var(--amber-bg)', display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
              {/* Bug fix (real-device report, mobile overlap): a marginLeft:auto badge in a
                  non-wrapping flex span can overflow past the card's own edge on a narrow phone
                  for a long drug name — flexWrap lets it drop to its own line instead. */}
              <Field label="ชื่อยา" full><span style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}><MedDot code={med.code} size={9} />{med.name} <WardBadge med={med} size="md" /><UsageRateBadge m={med} /></span></Field>
              <Field label="รหัสยา">{med.code}</Field>
              <Field label="หน่วยนับ" noBorderRight>{med.unit}</Field>
              <Field label={hasSub ? 'par substock' : 'par หน้างาน (Max)'} noBorder><span style={{ color: hasSub ? PAR_LABEL_COLOR.sub : PAR_LABEL_COLOR.max, fontWeight: 700 }}>{nf(hasSub ? med.parSub : med.parFloor)} {med.unit}</span></Field>
            </div>
            <div style={{ padding: '12px 14px', background: 'var(--bg-card)', display: 'flex', gap: 10 }}>
              {/* The one number everyone actually walks up to this screen for — sized to read
                  from arm's length, not squeezed next to the print button as small text. Now
                  colored/bar'd against par substock (same red/amber/green bands as the rest of
                  the app's toneFor()-driven screens) instead of a flat green box regardless of
                  whether 6,150 of 15,700 is actually fine or a problem — the raw number alone
                  never said which, and reading that off by mental math isn't "เห็นภาพชัดเจน". */}
              <div style={{ flex: 1, background: 'var(--bg-subtle)', border: '1px solid var(--border-soft)', borderRadius: 12, padding: '11px 13px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <span className="muted" style={{ fontSize: 11 }}>{hasSub ? 'substock คงเหลือตอนนี้ (real-time)' : 'หน้างานคงเหลือตอนนี้ (real-time)'}</span>
                  <span style={{ fontSize: 11, fontWeight: 800, color: balanceTone }}>{balancePct === null ? 'ยังไม่ตั้ง par' : balancePct + '% ของ par'}</span>
                </div>
                <div style={{ lineHeight: 1.15, marginTop: 2 }}><Qty value={liveBalance} tone={balanceTone} size={30} /> <span style={{ fontSize: 13, fontWeight: 600, color: balanceTone }}>{med.unit}</span></div>
                <div className="bar-track" style={{ height: 5, background: 'var(--border-soft)', borderRadius: 3, marginTop: 8 }}>
                  <div className="bar-fill" style={{ height: '100%', transform: 'scaleX(' + Math.max(3, Math.min(100, balancePct ?? 0)) / 100 + ')', background: balanceTone, borderRadius: 3 }} />
                </div>
              </div>
              <div style={{ flex: 'none', display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                  onClick={printCard}
                  disabled={!viewRows}
                  title="พิมพ์บัตรสต็อก"
                  aria-label="พิมพ์บัตรสต็อก"
                  className="press-spring"
                  style={{ flex: 1, width: 54, border: '1px solid var(--border)', background: 'var(--bg-card)', color: viewRows ? 'var(--ink)' : 'var(--muted)', borderRadius: 10, fontSize: 19 }}
                >
                  🖨
                </button>
                <button
                  onClick={exportCard}
                  disabled={!viewRows}
                  title="ดาวน์โหลดเป็น CSV"
                  aria-label="ดาวน์โหลดเป็น CSV"
                  className="press-spring"
                  style={{ flex: 1, width: 54, border: '1px solid var(--border)', background: 'var(--bg-card)', color: viewRows ? 'var(--ink)' : 'var(--muted)', borderRadius: 10, fontSize: 17 }}
                >
                  ⬇
                </button>
              </div>
            </div>

            {/* Period summary — the "how much moved this year" picture the flat row-by-row
                ledger doesn't give at a glance, right below the live balance so both read
                together: what's on the shelf now, and what it took to get there. */}
            {yearTotals && viewRows && viewRows.length > 0 && (
              // Bug fix: this used to hardcode either 2 or 3 columns based on whether ANY one
              // of the two optional tiles (ตัดหมดอายุ, ปรับยอดจากนับสต็อก) was showing — true for
              // a med with both an expired-lot scrap AND a substock count adjustment in the same
              // fiscal year (an entirely ordinary combination, not a rare edge case), which then
              // renders 4 SummaryTiles into a 3-column grid: the 4th tile wraps onto its own row
              // alone at 1/3 width instead of lining up with the other three. Count the tiles
              // that will actually render and size the grid to that, so any combination (2, 3,
              // or 4 tiles) always fills its row evenly.
              <div style={{ padding: '0 14px 12px', display: 'grid', gridTemplateColumns: `repeat(${2 + (yearTotals.expired > 0 ? 1 : 0) + (yearTotals.counted !== 0 ? 1 : 0)}, 1fr)`, gap: 8 }}>
                <SummaryTile label="รับเข้ารวม" value={yearTotals.received} unit={med.unit} color="var(--green)" />
                <SummaryTile label={hasSub ? 'เติมหน้างานรวม' : 'จ่ายออก/ปรับยอดรวม'} value={yearTotals.dispensed} unit={med.unit} color="var(--red)" />
                {yearTotals.expired > 0 && <SummaryTile label="ตัดหมดอายุรวม" value={yearTotals.expired} unit={med.unit} color="var(--amber-ink)" />}
                {yearTotals.counted !== 0 && <SummaryTile label="ปรับยอดจากนับสต็อก" value={yearTotals.counted} unit={med.unit} color={yearTotals.counted > 0 ? 'var(--green)' : 'var(--red)'} />}
              </div>
            )}
            {mismatch && (
              <div style={{ fontSize: 11, color: 'var(--amber-ink)', background: 'var(--amber-bg)', padding: '9px 14px', lineHeight: 1.5, borderTop: '1px solid var(--amber-border)', display: 'flex', alignItems: 'flex-end', gap: 10 }}>
                <span style={{ flex: 1 }}>
                  {hasNameTwin
                    ? `ยานี้มีทั้งชั้น OPD และ IPD ชื่อเดียวกัน — ยอดจากประวัติ (${nf(lastLedgerBalance)} ${med.unit}) อาจไม่ครบตั้งแต่ก่อนระบบแยกประวัติตาม ward ได้ ยอดคงเหลือจริงด้านบนยังถูกต้องเสมอ`
                    : `ยอดจากประวัติธุรกรรม (${nf(lastLedgerBalance)} ${med.unit}) ไม่ตรงกับยอดจริงตอนนี้ — อาจมีการปรับยอดนอกช่องทางปกติ ลองตรวจสอบใน Audit log`}
                </span>
                {/* Was just an instruction to "go check the Audit log" with no way to actually
                    get there — only wired up for role==='admin' since AdminScreen's user/audit
                    data (state.users, etc.) is only ever subscribed for that role; sending a
                    pharm/tech there would land on a broken/empty screen instead of helping. */}
                {!hasNameTwin && state.role === 'admin' && (
                  <button
                    onClick={() => { setAuditFilter('stock'); setAdminTab('audit'); go('admin'); }}
                    className="press-spring"
                    style={{ flex: 'none', border: '1px solid var(--amber)', background: 'rgba(255,255,255,.5)', color: 'var(--amber-ink)', padding: '5px 10px', borderRadius: 8, fontSize: 11, fontWeight: 700 }}
                  >
                    ไปดู Audit log →
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Real-world request: "ควรมีกราฟมั้ย หรือแผนภูมิ" — screen-only (never printed: the
              official paper card stays a plain, audit-friendly table — see printCard() below,
              untouched). A quick visual read of the trend that the flat ledger table doesn't
              give at a glance, using the SAME viewRows/fiscal-year filter as everything else on
              this screen so it never disagrees with the totals right above it. */}
          {viewRows && viewRows.length >= 2 && (
            <BalanceTrendChart rows={viewRows} unit={med.unit} tone={balanceTone} periodLabel={year === 'all' ? 'ทุกปี' : 'ปีงบ ' + year} />
          )}

          {/* Type-icon legend — the ledger table below packs each row's type into a single
              icon (📥🚚🗑️🔢🧾⚖️↩️💥↘️↗️) to keep the grid narrow enough for a phone screen; the
              only place their meaning used to live was each row's `title` attribute, which
              needs a mouse hover that a touchscreen never provides. Spelled out once, plainly,
              here — only the types that actually appear in THIS med's full history, not all 10
              possible ones at once (a floor-ledger med legitimately only ever sees a handful of
              them; showing the rest would just be clutter with no matching rows below). */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', padding: '9px 13px', background: 'var(--bg-subtle)', border: '1px solid var(--border-soft)', borderRadius: 12, marginBottom: 12 }}>
            {Array.from(new Set((rows || []).map((r) => r.type)))
              .filter((t) => !!TYPE_META[t])
              .map((t) => ({ type: t, icon: TYPE_META[t].icon, label: labelFor(t, hasSub) }))
              .map((t) => (
                <span key={t.type} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11 }}>
                  <span aria-hidden="true">{t.icon}</span>
                  <span className="muted">{t.label}</span>
                </span>
              ))}
          </div>

          {loading && <SkeletonList rows={5} />}

          {/* Bug fix (real-world request): on a phone screen the table's header row is often
              the last thing visible before the bottom nav bar covers the rest — with no count
              anywhere, there's no way to tell "is that the whole history or is there more
              below?" without scrolling to find out. One line settles it up front. */}
          {viewRows && !loading && viewRows.length > 0 && (
            <div className="muted" style={{ fontSize: 11.5, marginBottom: 7 }}>ประวัติทั้งหมด {nf(viewRows.length)} รายการ</div>
          )}

          {viewRows && !loading && (
            <div style={{ border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }} className="stagger">
              {/* A real ruled grid (vertical + horizontal cell borders), not just underlines —
                  same shape as the physical card: ลำดับ / วันที่ / รับ / จ่าย / คงเหลือ / โดย,
                  chronological oldest-first, read top-to-bottom like the paper it replaces. */}
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ background: 'var(--bg-subtle)' }}>
                    <Th w={28}>#</Th><Th w={26} /><Th w={58}>วันที่</Th><Th w={54} num>รับ</Th><Th w={54} num>จ่าย</Th><Th w={62} num>คงเหลือ</Th><Th>โดย</Th>
                  </tr>
                </thead>
                <tbody>
                  {viewRows.map((r, i) => {
                    const meta = TYPE_META[r.type];
                    const label = labelFor(r.type, hasSub);
                    const title = label + (r.note ? ' — ' + r.note : '');
                    // Real-world request: "ให้ทุกส่วนที่เติมข้อมูลเรื่องจำนวน...ในส่วนบัตรสต็อค
                    // หรือบัตรหน้างาน เขียนรูปแบบนี้ด้วย" — every row's รับ/จ่าย/คงเหลือ shows the
                    // same "1x60" box breakdown already used on the printed sheet/cart, via the
                    // same boxBreakdownLabel() helper (not just transfer_to_floor rows anymore).
                    const boxLine = boxBreakdownLabel(med, Math.abs(r.qty), true);
                    const balanceBoxLine = boxBreakdownLabel(med, Math.abs(r.balance), true);
                    // Real-world request: "ยังไม่มีรายละเอียดบอกว่าที่บอกเพิ่มหรือลบคือเกิดจาก
                    // อะไร...ให้มีรายละเอียดที่ชัดเจนตรวจสอบย้อนหลังได้" — tap the row to expand
                    // its full type label + note (see expandedRows' own doc comment above for
                    // why this replaces a hover-only title on a screen staff mainly use by
                    // phone). A row with no note (`r.note` is '' for the rare type that never
                    // sets one) has nothing more to reveal, so it isn't made tappable at all —
                    // no dead-end expand arrow for an empty detail.
                    const expanded = expandedRows.has(i);
                    return (
                      <Fragment key={i}>
                        <tr
                          title={title}
                          onClick={r.note ? () => toggleRowNote(i) : undefined}
                          style={r.note ? { cursor: 'pointer' } : undefined}
                        >
                          <Td num style={{ color: 'var(--muted)', fontSize: 10.5 }}>{i + 1}</Td>
                          <Td style={{ textAlign: 'center', fontSize: 12 }}>{meta ? meta.icon : ''}</Td>
                          <Td>
                            {thDate(r.ts)}
                            {r.note && <span aria-hidden="true" style={{ marginLeft: 3, fontSize: 8.5, color: 'var(--muted)' }}>{expanded ? '▲' : '▾'}</span>}
                          </Td>
                          <Td num style={{ fontWeight: 700, fontSize: 13, color: 'var(--green)' }}>
                            {r.qty > 0 ? nf(r.qty) : ''}
                            {r.qty > 0 && boxLine?.includes('x') && <div className="muted" style={{ fontSize: 9, fontWeight: 500 }}>{boxLine}</div>}
                          </Td>
                          <Td num style={{ fontWeight: 700, fontSize: 13, color: 'var(--red)' }}>
                            {r.qty < 0 ? nf(-r.qty) : ''}
                            {r.qty < 0 && boxLine?.includes('x') && <div className="muted" style={{ fontSize: 9, fontWeight: 500 }}>{boxLine}</div>}
                          </Td>
                          <Td num style={{ fontWeight: 800, fontSize: 13.5 }}>
                            {nf(r.balance)}
                            {balanceBoxLine?.includes('x') && <div className="muted" style={{ fontSize: 9, fontWeight: 500 }}>{balanceBoxLine}</div>}
                          </Td>
                          <Td style={{ color: 'var(--muted)', fontSize: 10.5, maxWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.by}</Td>
                        </tr>
                        {expanded && r.note && (
                          <tr>
                            <td colSpan={7} style={{ padding: '7px 10px', fontSize: 11, fontWeight: 600, lineHeight: 1.5, background: 'var(--bg-subtle)', border: '1px solid var(--border-soft)' }}>
                              {label + ' — ' + r.note}
                            </td>
                          </tr>
                        )}
                      </Fragment>
                    );
                  })}
                </tbody>
              </table>
              {viewRows.length === 0 && (
                <EmptyState
                  icon="🗂️"
                  title={rows && rows.length > 0 ? 'ไม่มีประวัติใน' + (year === 'all' ? 'ช่วงนี้' : 'ปีงบ ' + year) : 'ยานี้ยังไม่มีประวัติ' + (hasSub ? ' substock' : '')}
                  sub={rows && rows.length > 0 ? 'ลองสลับดูปีงบอื่น หรือเลือก "ทุกปี"' : hasSub ? 'จะเริ่มมีประวัติทันทีที่รับเข้า/เติมหน้างาน/ตัดหมดอายุยานี้ครั้งแรก' : 'จะเริ่มมีประวัติทันทีที่รับเข้า/ตัดยอด HOSxP/ปรับยอดยานี้ครั้งแรก'}
                />
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// Fixed drawing area — a compact glance-sparkline, not a full analytical chart (the real,
// exact numbers are one scroll away in the ledger table right below it). Width is measured
// live via ResizeObserver since this sits in a responsive card, not a fixed-mm print sheet.
const CHART_H = 72;
const CHART_PAD = 8;

/** Screen-only balance-over-time trend line for the currently viewed period (see its call
 * site's own "Real-world request" comment) — plotted by TRANSACTION INDEX, not real calendar
 * spacing, since substock movements land irregularly (some drugs move daily, some monthly);
 * an evenly-spaced x-axis reads as a clean trend line at a glance, which is this chart's only
 * job — the exact date of any point is one tap (or the ledger table right below) away. Single
 * series, so no legend (the caption above already names it) — just a thin line, a soft area
 * fill, and a highlighted end point in the SAME tone the live-balance number above already
 * uses, so the color means the same thing here as it does everywhere else on this screen. */
function BalanceTrendChart({ rows, unit, tone, periodLabel }: { rows: LedgerRow[]; unit: string; tone: string; periodLabel: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = () => setWidth(el.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const balances = rows.map((r) => r.balance);
  const minB = Math.min(...balances);
  const maxB = Math.max(...balances);
  // A perfectly flat run (every row the same balance) would divide by zero below — treat it as
  // its own tiny range so the line still draws as one flat, readable stroke instead of NaN.
  const span = Math.max(1, maxB - minB);
  const innerW = Math.max(1, width - CHART_PAD * 2);
  const innerH = CHART_H - CHART_PAD * 2;
  const xAt = (i: number) => CHART_PAD + (rows.length === 1 ? 0 : (i / (rows.length - 1)) * innerW);
  const yAt = (v: number) => CHART_PAD + innerH - ((v - minB) / span) * innerH;
  const points = rows.map((r, i) => [xAt(i), yAt(r.balance)] as const);
  const linePath = points.map(([x, y], i) => (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1)).join(' ');
  const areaPath = linePath + ` L${points[points.length - 1][0].toFixed(1)},${CHART_H - CHART_PAD} L${points[0][0].toFixed(1)},${CHART_H - CHART_PAD} Z`;
  const gradId = 'sparkfill-' + tone.replace(/[^a-z0-9]/gi, '');

  const pointerToIndex = (clientX: number) => {
    const el = wrapRef.current;
    if (!el || rows.length < 2) return 0;
    const rect = el.getBoundingClientRect();
    const rel = clientX - rect.left - CHART_PAD;
    const frac = Math.min(1, Math.max(0, rel / innerW));
    return Math.round(frac * (rows.length - 1));
  };

  const hovered = hoverIdx !== null ? rows[hoverIdx] : null;
  // Clamp the tooltip's own horizontal position so it never overflows the card's left/right
  // edge for a hovered point right near either end.
  const tooltipLeftPct = hoverIdx !== null ? Math.min(88, Math.max(12, (hoverIdx / (rows.length - 1)) * 100)) : 0;

  return (
    <div style={{ border: '1px solid var(--border-soft)', borderRadius: 12, background: 'var(--bg-subtle)', padding: '10px 12px 8px', marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
        <span style={{ fontSize: 11.5, fontWeight: 700 }}>แนวโน้มยอดคงเหลือ</span>
        <span className="muted" style={{ fontSize: 10.5 }}>{periodLabel} · {nf(rows.length)} รายการ</span>
      </div>
      <div ref={wrapRef} style={{ position: 'relative', height: CHART_H }}>
        {hovered && (
          <div
            aria-hidden="true"
            style={{
              position: 'absolute', left: tooltipLeftPct + '%', transform: 'translateX(-50%)', top: -2,
              background: 'var(--ink)', color: 'var(--ink-soft)', borderRadius: 8, padding: '4px 8px',
              fontSize: 10.5, lineHeight: 1.4, whiteSpace: 'nowrap', pointerEvents: 'none', zIndex: 1, boxShadow: 'var(--shadow-sm)',
            }}
          >
            <div>{thDate(hovered.ts)}</div>
            <div style={{ fontWeight: 800, color: tone }}>{nf(hovered.balance)} {unit}</div>
          </div>
        )}
        {width > 0 && (
          <svg
            width="100%"
            height={CHART_H}
            viewBox={`0 0 ${width} ${CHART_H}`}
            style={{ display: 'block', touchAction: 'none' }}
            onPointerMove={(e) => setHoverIdx(pointerToIndex(e.clientX))}
            onPointerLeave={() => setHoverIdx(null)}
          >
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={tone} stopOpacity={0.22} />
                <stop offset="100%" stopColor={tone} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={areaPath} fill={`url(#${gradId})`} stroke="none" />
            <path d={linePath} fill="none" stroke={tone} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
            {/* End point — always shown, unhovered, so the chart reads correctly even before
                any pointer interaction (a touch device may never "hover" at all). */}
            <circle cx={points[points.length - 1][0]} cy={points[points.length - 1][1]} r={3.5} fill={tone} stroke="var(--bg-card)" strokeWidth={1.5} />
            {hoverIdx !== null && (
              <>
                <line x1={points[hoverIdx][0]} x2={points[hoverIdx][0]} y1={CHART_PAD} y2={CHART_H - CHART_PAD} stroke="var(--border)" strokeWidth={1} />
                <circle cx={points[hoverIdx][0]} cy={points[hoverIdx][1]} r={4} fill={tone} stroke="var(--bg-card)" strokeWidth={1.5} />
              </>
            )}
          </svg>
        )}
      </div>
    </div>
  );
}

/** One labeled cell in the header's field grid — mirrors the paper card's ruled ชื่อยา/รหัส/
 * หน่วยนับ boxes: a small caption above the value, boxed in on the right/bottom by default. */
function Field({ label, children, full, noBorder, noBorderRight }: { label: string; children: ReactNode; full?: boolean; noBorder?: boolean; noBorderRight?: boolean }) {
  return (
    <div style={{
      gridColumn: full ? '1 / -1' : undefined,
      padding: '7px 14px',
      borderBottom: noBorder ? 0 : '1px solid var(--amber-border)',
      borderRight: full || noBorderRight || noBorder ? 0 : '1px solid var(--amber-border)',
    }}>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--amber-ink)', opacity: 0.75 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 600, marginTop: 1 }}>{children}</div>
    </div>
  );
}

/** One period-total number, big and unambiguous — "how much moved" alongside "how much is
 * left now" (the live balance card above it). */
function SummaryTile({ label, value, unit, color }: { label: string; value: number; unit: string; color: string }) {
  return (
    <div style={{ background: 'var(--bg-subtle)', borderRadius: 10, padding: '9px 11px' }}>
      <div className="muted" style={{ fontSize: 10.5 }}>{label}</div>
      <div style={{ fontSize: 18, fontWeight: 800, color, lineHeight: 1.2 }}>{nf(value)} <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--muted)' }}>{unit}</span></div>
    </div>
  );
}

function Th({ children, w, num }: { children?: ReactNode; w?: number; num?: boolean }) {
  return (
    <th style={{ width: w, textAlign: num ? 'right' : 'left', fontSize: 10, color: 'var(--muted)', fontWeight: 700, padding: '8px 10px', border: '1px solid var(--border-soft)' }}>{children}</th>
  );
}

function Td({ children, num, style }: { children?: ReactNode; num?: boolean; style?: CSSProperties }) {
  return (
    <td style={{ textAlign: num ? 'right' : 'left', fontSize: 12, padding: '7px 10px', border: '1px solid var(--border-soft)', ...style }}>{children}</td>
  );
}
