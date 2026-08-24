import type { AppState, Med, Role } from '../types';
import { DAY, daysUntil } from '../utils/format';

/** Pure, stateless helpers derived from AppState — no mutation, safe to call during render. */

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

export function suggestPar(m: Med, floorCoverDays: number, subCoverDays: number) {
  const daily = m.used30 / 30;
  return {
    floor: roundStep(daily * floorCoverDays * m.volatility),
    sub: roundStep(daily * subCoverDays * m.volatility),
  };
}

export { daysUntil, DAY };
