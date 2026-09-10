import type { AppState, HosxpMatch, Med, Role, Ward, Tx } from '../types';
import { DAY, daysUntil, isoDate } from '../utils/format';
import { UNCATEGORIZED, DRUG_CATEGORIES, categoryLabel } from '../data/categories';

/** Pure, stateless helpers derived from AppState — no mutation, safe to call during render. */

/** `ward` is optional on Med — every drug seeded before wards existed has none. Default to
 * 'opd' rather than requiring a one-time migration write: this whole formulary was OPD-only
 * before IPD support existed, so that default is also just... correct. Always go through
 * this instead of reading `m.ward` directly. */
export function wardOf(m: Med): Ward {
  return m.ward === 'ipd' ? 'ipd' : 'opd';
}

export function wardLabel(w: Ward): string {
  return w === 'ipd' ? 'ผู้ป่วยใน (IPD)' : 'ผู้ป่วยนอก (OPD)';
}

/** Same optional-field-with-a-default pattern as wardOf() — most meds do have a substock
 * stage between the central warehouse and the shelf; only liquids/inhalers/sprays skip it. */
export function usesSubstock(m: Med): boolean {
  return !m.noSubstock;
}

/** True once a med's OPD and IPD stock have been merged into one pooled record (see
 * mergeWardMeds() in AppContext.tsx and Med.binIpd in types.ts) — the real workflow for most
 * one-day-dose drugs, where IPD just pulls off the OPD shelf rather than keeping its own. */
export function isSharedMed(m: Med): boolean {
  return !!m.shared;
}

/** Whether `m` belongs under ward tab/filter `filter` — a shared med always matches every
 * filter (both wards draw from the same floor/par), everything else uses its single ward. */
export function matchesWard(m: Med, filter: 'all' | Ward): boolean {
  return filter === 'all' || isSharedMed(m) || wardOf(m) === filter;
}

/** Same optional-field-with-a-default pattern as wardOf()/usesSubstock() — every med added
 * before drug categories existed (and any doc whose stored category no longer matches the
 * fixed list in data/categories.ts) falls back to the same "ยังไม่ระบุหมวด" bucket instead of
 * silently vanishing from a category filter/group. */
export function categoryOf(m: Med): string {
  return m.category || UNCATEGORIZED;
}

/** Shelf/bin code to display for `m` when looking at it from ward `w` — the IPD-side code on
 * a shared med when `w` is 'ipd', its one `bin` otherwise (including for a shared med viewed
 * from OPD, since `bin` IS its OPD-side code). */
export function binFor(m: Med, w: Ward): string {
  return w === 'ipd' && m.binIpd ? m.binIpd : m.bin;
}

/** Every real shelf-bin code `m` actually sits in, combined into one string for a context
 * (like a pick list) that isn't tied to one ward's view — "A1" for a normal med, "A1/B2" for a
 * shared med with a genuinely distinct IPD-side spot. Bug fix: printPickList/
 * printTodayReplenishList used to pick ONE side via a ward filter that, since the OPD/IPD tab
 * UI was removed, could never actually resolve to 'ipd' any more — silently always showing the
 * OPD-side code and never mentioning a shared med's separate IPD shelf spot existed at all. */
export function binDisplayAll(m: Med): string {
  return isSharedMed(m) && m.binIpd && m.binIpd !== m.bin ? m.bin + '/' + m.binIpd : m.bin;
}

/** Real min-max par: `parFloor` is the shelf's capacity ("Max" — fill up TO this), `floorMin`
 * is the separate reorder point ("Min" — BELOW this is when it actually needs refilling).
 * Every med added before Min-Max existed has no floorMin — default it to 30% of Max, a
 * conventional reorder-point ratio, rather than requiring a one-time migration write. */
export function floorMinOf(m: Med): number {
  if (typeof m.floorMin === 'number') return m.floorMin;
  // ปัดค่า default ให้เป็นเลขลงตัว (หลักเดียว/หลักสิบ/หลักร้อยตามขนาด) เหมือน roundStep ที่ใช้กับ
  // Max — กัน Min โผล่มาเป็นเลขเศษแปลกๆ เช่น 27, 13 จาก Math.round(parFloor*0.3) ตรงๆ
  const raw = m.parFloor * 0.3;
  if (raw <= 0) return 0;
  const step = raw >= 500 ? 100 : raw >= 100 ? 10 : raw >= 10 ? 5 : 1;
  return Math.round(raw / step) * step;
}

/** A shelf already at/below half of its own reorder point (Min) — not just "below Min" in
 * general, but genuinely close to running out. Used to split "ต่ำกว่า Min" (needs refilling
 * at some point today/this week) from "เร่งด่วนวันนี้" (needs refilling before anything else) on
 * TransferScreen, so a short-staffed team can knock out just the truly urgent subset on a busy
 * day instead of either doing everything below Min at once or guessing which ones matter most.
 * Same threshold DeficitBadge's `urgent` prop already used inline — pulled out here so the
 * chip filter, the fillUrgent() bulk action, and the badge all agree on one definition. */
export function isUrgentLow(m: Med): boolean {
  return m.floor < floorMinOf(m) * 0.5;
}

/** Whether `m` belongs on the "ควรเบิกจากคลังใหญ่" central-warehouse request — same rule
 * printWarehouseRequestList() (AppContext.tsx) and ReceiveScreen's needsReceive list use, and
 * why: a med with a real substock stage is judged against substock/parSub; one without
 * (noSubstock — see usesSubstock()) has no substock number to be low in, so its shelf
 * (floor/parFloor) stands in for it instead — its shelf effectively IS its substock for
 * requisitioning purposes (see suggestPar()'s doc comment). Pulled out as one function so the
 * print sheet, the on-screen list, and any summary count (HomeScreen) can't drift apart on the
 * definition of "needs requesting". `curSub` is the caller's already-computed subQty(state, m.id)
 * — passed in rather than recomputed here so this stays a pure, state-independent function. */
export function needsWarehouseRequest(m: Med, curSub: number): boolean {
  return usesSubstock(m) ? curSub < m.parSub : m.floor < m.parFloor;
}

/** ISO date (YYYY-MM-DD) of the most recent 'reconcile_hosxp' transaction, or null if there
 * isn't one in `txs` at all (a brand-new deployment, or one that's never used "นำเข้า HOSxP" —
 * see ReconcileScreen). `txs` is expected already sorted newest-first (the same order the
 * live onSnapshot query — AppContext.tsx — already delivers it in), so this is just the first
 * match, not a full scan-and-compare. Used to show "ยังไม่ได้ตัดยอด HOSxP วันนี้" on HomeScreen —
 * a real, recurring risk for a short-staffed team: skip a day's reconcile and the app's floor
 * numbers silently drift from what's actually on the shelf, with nothing else to catch it. */
export function lastReconcileDateIso(txs: Tx[]): string | null {
  const last = txs.find((t) => t.type === 'reconcile_hosxp');
  return last ? isoDate(last.ts) : null;
}

export function subQty(state: AppState, medId: string): number {
  let sum = 0;
  for (const l of state.lots) if (l.medId === medId) sum += l.qty;
  return sum;
}

export interface UsageAnomaly { med: Med; changePct: number; direction: 'up' | 'down' }

/** Flags a drug whose usage rate this 30-day window (used30) has swung sharply from the
 * previous one (usedPrev30) — a real, cheap "smart insight" computed entirely from data
 * already synced (recomputeUsageStats/commitUsageImport), no AI API or network call needed.
 * A genuine ±40%+ swing is worth a pharmacist's attention either direction: up could mean a
 * real outbreak/seasonal spike (par needs raising before it runs out), down could mean a
 * protocol changed or dispensing moved elsewhere (par is now oversized, tying up shelf space
 * and expiry risk for no reason). Requires a real previous-period baseline (usedPrev30 > 0) —
 * a drug with nothing to compare against isn't an "anomaly", it's just new/rare usage data,
 * and flagging it would just be noise.
 */
export function usageAnomalies(meds: Med[], threshold = 0.4): UsageAnomaly[] {
  return meds
    .filter((m) => m.active && m.usedPrev30 > 0)
    .map((m) => ({ med: m, changePct: (m.used30 - m.usedPrev30) / m.usedPrev30 }))
    .filter((x) => Math.abs(x.changePct) >= threshold)
    .map((x) => ({ med: x.med, changePct: x.changePct, direction: (x.changePct > 0 ? 'up' : 'down') as 'up' | 'down' }))
    .sort((a, b) => Math.abs(b.changePct) - Math.abs(a.changePct));
}

/** One row of the "แยกตามหมวด" report — everything that matters about a therapeutic group at
 * a glance: how much of the formulary it is, what it's worth sitting on the shelf right now,
 * and how much of it is in trouble (below Min, or expiring soon). Pure and state-derived, so
 * it's unit-testable and identical between the on-screen table and the CSV export. */
export interface CategoryStat {
  id: string;
  label: string;
  meds: number;
  /** Meds in this group currently below their reorder point (Min) — the "needs attention" number. */
  low: number;
  /** Stock value on hand = (floor + substock) × unit price, in baht. */
  value: number;
  /** Value of lots in this group expiring within `expiryWarnDays` (including already expired). */
  atRisk: number;
  /** Units dispensed in the last 30 days across the group — how "busy" the group is, which is
   * the thing that separates a big-but-idle group from a small-but-constantly-moving one. */
  used30: number;
}

export function categoryStats(state: AppState, meds: Med[], expiryWarnDays: number): CategoryStat[] {
  const byCat = new Map<string, CategoryStat>();
  const rowFor = (id: string) => {
    let r = byCat.get(id);
    if (!r) { r = { id, label: categoryLabel(id), meds: 0, low: 0, value: 0, atRisk: 0, used30: 0 }; byCat.set(id, r); }
    return r;
  };
  meds.forEach((m) => {
    const r = rowFor(categoryOf(m));
    r.meds++;
    if (m.floor < floorMinOf(m)) r.low++;
    r.value += (m.floor + subQty(state, m.id)) * (m.price || 0);
    r.used30 += m.used30 || 0;
  });
  // At-risk value comes from real lots, not from the med's own floor number: only substock
  // lots carry an expiry date at all, so this is deliberately lot-derived rather than a
  // fraction of the value above.
  const medById = new Map(meds.map((m) => [m.id, m]));
  state.lots.forEach((l) => {
    const m = medById.get(l.medId);
    if (!m || l.qty <= 0) return;
    if (daysUntil(l.exp) <= expiryWarnDays) rowFor(categoryOf(m)).atRisk += l.qty * (m.price || 0);
  });
  // Fixed display order (DRUG_CATEGORIES' own order, "ยังไม่ระบุหมวด" last as listed there)
  // rather than sorted by value — a report someone reads every week shouldn't reshuffle its
  // rows just because one group's stock moved.
  const order = DRUG_CATEGORIES.map((c) => c.id);
  return order.filter((id) => byCat.has(id)).map((id) => byCat.get(id)!);
}

// Bug fix: every "daily usage rate" in this app used to be a flat `used30 / 30` — used30 is a
// 30-calendar-day dispensing total, but this is an OPD/IPD hospital pharmacy that dispenses on
// weekdays, not evenly across the week; Saturday/Sunday usage is noticeably lower than a normal
// weekday's. Dividing by all 30 calendar days blends those quiet weekend days into the average,
// underestimating the rate that actually matters — how fast a shelf empties DURING the working
// week it has to survive. A par (Max) sized off that diluted average can run out mid-week even
// though it "covered" its nominal number of days, since the days that emptied it fastest were
// weighted the same as the slow weekend ones that barely used anything.
// Fix: divide by the number of WEEKDAYS in a 30-day window instead of all 30 days — this
// hospital has no per-day usage breakdown to compute an exact split (used30 is a single
// imported period total, see usageImport.ts), so this assumes the standard 5/7 weekday
// fraction and that weekend dispensing is small enough to treat as part of that same weekday
// total, which is the conservative (safer, not smaller) direction: it raises the daily rate
// used for every par/runway calculation below, rather than lowering it.
const WEEKDAYS_PER_30_DAYS = 30 * (5 / 7); // ≈ 21.43
export function dailyUsageRate(m: Med): number {
  return m.used30 / WEEKDAYS_PER_30_DAYS;
}

/** Whole-number days until a drug's combined on-hand (floor + substock) runs out at its
 * current weekday-adjusted daily usage rate (see dailyUsageRate()) — null when there's no real
 * usage rate to project from (used30 <= 0), rather than the misleading Infinity a raw division
 * would give. Same "how much runway is left" math already used in ReportScreen's turnover tab,
 * factored out so the insights tab (and anything else) can reuse it without duplicating the
 * divide-by-zero guard. */
export function daysOfStockLeft(state: AppState, m: Med): number | null {
  if (!(m.used30 > 0)) return null;
  const onHand = m.floor + subQty(state, m.id);
  return Math.round(onHand / dailyUsageRate(m));
}

export function fefoLot(state: AppState, medId: string) {
  return state.lots
    .filter((l) => l.medId === medId && l.qty > 0)
    .sort((a, b) => a.exp - b.exp)[0];
}

export function userNameFor(role: Role | null): string {
  return role === 'pharm' ? 'ภญ.นูรฮายาตี ส.' : role === 'tech' ? 'อับดุลเลาะ ม.' : role === 'admin' ? 'ผู้ดูแลระบบ' : '';
}

export function roleLabelFor(role: Role | null): string {
  return role === 'pharm' ? 'เภสัชกร' : role === 'tech' ? 'จพ.เภสัชกรรม' : role === 'admin' ? 'Admin' : '';
}

// CSS custom properties, not literal hex — these feed straight into inline `background`/
// `color` styles (see HomeScreen/TransferScreen), so a literal hex here would show the
// light-mode color even in dark mode, unlike every other themed color in the app.
export function toneFor(m: Med): string {
  const r = m.floor / Math.max(1, m.parFloor);
  return r < 0.34 ? 'var(--red)' : r < 0.75 ? 'var(--amber)' : 'var(--green)';
}

export function expTone(d: number, warnDays: number): string {
  return d < 0 ? 'var(--red)' : d < 30 ? 'var(--red)' : d < warnDays ? 'var(--amber)' : 'var(--green)';
}

export function roundStep(v: number): number {
  const step = v >= 500 ? 100 : v >= 100 ? 10 : 1;
  return Math.max(step, Math.ceil(v / step) * step);
}

export function suggestTransferQty(state: AppState, m: Med): number {
  const need = Math.max(0, m.parFloor - m.floor);
  const step = m.parFloor >= 500 ? 100 : m.parFloor >= 100 ? 10 : 1;
  return Math.min(subQty(state, m.id), Math.ceil(need / step) * step);
}

/**
 * Resolves one HOSxP file row's drug name against the active formulary. Prefers an exact
 * (case-insensitive) name match; only falls back to a substring match when there's exactly
 * one candidate — a substring match against *two or more* drugs (e.g. a file listing
 * "Amoxicillin 250" when both "Amoxicillin 250 mg" and "Amoxicillin 500 mg" exist) is
 * reported as ambiguous rather than silently picking the first one Array.find() happens to
 * hit, since guessing wrong here means deducting stock from the wrong drug.
 */
export function matchHosxpMed(meds: Med[], rawName: string): HosxpMatch {
  const active = meds.filter((m) => m.active);
  const n = rawName.trim().toLowerCase();
  if (!n) return { kind: 'none' };

  // A name is no longer guaranteed unique across the whole formulary — OPD and IPD versions
  // of the same drug are deliberately separate records that can share an identical name (see
  // wardOf/Ward). .find() alone would silently always pick whichever one happens to be first
  // in the array, deducting HOSxP-reported dispensing from the wrong ward's shelf every time
  // that drug is reconciled. Treat two-or-more exact matches the same as the fuzzy branch
  // below already does: 'ambiguous', not a silent guess.
  const exactMatches = active.filter((m) => m.name.trim().toLowerCase() === n);
  if (exactMatches.length === 1) return { kind: 'exact', medId: exactMatches[0].id };
  if (exactMatches.length > 1) return { kind: 'ambiguous', candidateIds: exactMatches.map((m) => m.id) };

  const candidates = active.filter((m) => {
    const mn = m.name.toLowerCase();
    return mn.indexOf(n) >= 0 || n.indexOf(mn) >= 0;
  });
  if (candidates.length === 1) return { kind: 'fuzzy', medId: candidates[0].id };
  if (candidates.length > 1) return { kind: 'ambiguous', candidateIds: candidates.map((m) => m.id) };
  return { kind: 'none' };
}

export function suggestPar(m: Med, floorCoverDays: number, subCoverDays: number): { floor: number; sub: number } | null {
  if (!(m.used30 > 0)) return null; // ไม่มีสถิติการใช้จริง ห้ามแนะนำ par (roundStep(0) จะได้ 1 เสมอ ทำให้ค่าแนะนำผิดเพี้ยน)
  const daily = dailyUsageRate(m);
  // Bug fix: a med with no substock stage (usesSubstock() false — see Med.noSubstock) skips
  // straight from the central-warehouse to the OPD/IPD shelf; its shelf stock has to survive
  // the full ~2-week central-warehouse refill cycle (subCoverDays) on its own, not the short
  // few-day substock-to-shelf top-up cycle (floorCoverDays) that assumes a substock room is
  // right there to refill it quickly. Sizing its floor par off floorCoverDays (as every med
  // with a real substock buffer correctly does) chronically undersized it — there's no buffer
  // behind it to absorb the difference. Give it the same cover-days basis a substock par would
  // get, since its shelf effectively *is* its substock for stocking purposes.
  const floorDays = usesSubstock(m) ? floorCoverDays : subCoverDays;
  return {
    floor: roundStep(daily * floorDays * m.volatility),
    sub: roundStep(daily * subCoverDays * m.volatility),
  };
}

export { daysUntil, DAY };
