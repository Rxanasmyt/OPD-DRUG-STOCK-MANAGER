import type { AppState, HosxpMatch, Med, Role, Ward } from '../types';
import { DAY, daysUntil } from '../utils/format';

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

/** Real min-max par: `parFloor` is the shelf's capacity ("Max" — fill up TO this), `floorMin`
 * is the separate reorder point ("Min" — BELOW this is when it actually needs refilling).
 * Every med added before Min-Max existed has no floorMin — default it to 30% of Max, a
 * conventional reorder-point ratio, rather than requiring a one-time migration write. */
export function floorMinOf(m: Med): number {
  return typeof m.floorMin === 'number' ? m.floorMin : Math.round(m.parFloor * 0.3);
}

export function subQty(state: AppState, medId: string): number {
  let sum = 0;
  for (const l of state.lots) if (l.medId === medId) sum += l.qty;
  return sum;
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
  return role === 'pharm' ? 'เภสัชกร' : role === 'tech' ? 'ผู้ช่วยเภสัชกร' : role === 'admin' ? 'Admin' : '';
}

export function toneFor(m: Med): string {
  const r = m.floor / Math.max(1, m.parFloor);
  return r < 0.34 ? '#a32b22' : r < 0.75 ? '#b8710f' : '#17552f';
}

export function expTone(d: number, warnDays: number): string {
  return d < 0 ? '#a32b22' : d < 30 ? '#a32b22' : d < warnDays ? '#b8710f' : '#17552f';
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

export function suggestPar(m: Med, floorCoverDays: number, subCoverDays: number) {
  const daily = m.used30 / 30;
  return {
    floor: roundStep(daily * floorCoverDays * m.volatility),
    sub: roundStep(daily * subCoverDays * m.volatility),
  };
}

export { daysUntil, DAY };
