// Grouping for the returns (คืนยา) report: "all", by drug category, or by return reason. Pure and shared by the report screen;
// scripts/notify-monthly-returns.mjs keeps an identical copy for the LINE monthly report (parity is tested).
// Counts use LIVE originals (a cancelled return and its reversal row cancel out); qty/value use the NET rows (reversal = negative).
import type { DrugReturnRecord } from '../types';
import { categoryLabel } from '../data/categories';
import { RETURN_REASON_GROUPS, REVERSAL_PREFIX, isReversalReason, liveReturnRecords, netReturnRecords } from './returnReasons';

export type ReturnsView = 'all' | 'cat' | 'reason';

export interface ReturnGroup {
  key: string;
  label: string;
  icon?: string;
  /** live (not cancelled) returns */
  count: number;
  qty: number;
  value: number;
  /** newest first; reversal rows excluded, cancelled originals excluded */
  records: DrugReturnRecord[];
  /** for the reason view: the individual reasons inside this group */
  children?: { label: string; count: number; value: number }[] | undefined;
}

const UNKNOWN_REASON = 'ไม่ระบุเหตุผล (รายการเก่า)';
const OTHER_REASON = 'อื่น ๆ (ระบุเอง)';

/** The reason a row counts under: a reversal row counts against the ORIGINAL reason it cancels. */
export function baseReason(r: Pick<DrugReturnRecord, 'reason'>): string {
  const reason = r.reason ?? '';
  return isReversalReason(reason) ? reason.slice(REVERSAL_PREFIX.length) : reason;
}

const GROUP_OF_REASON = new Map<string, { key: string; icon: string; label: string }>(
  RETURN_REASON_GROUPS.flatMap((g) => g.reasons.map((x) => [x, { key: g.key, icon: g.icon, label: g.label }] as const)),
);
export function reasonGroupOf(reason: string): { key: string; icon: string; label: string } {
  if (!reason) return { key: 'unknown', icon: '❔', label: UNKNOWN_REASON };
  return GROUP_OF_REASON.get(reason) ?? { key: 'other', icon: '📝', label: OTHER_REASON };
}

export function groupReturns(records: DrugReturnRecord[], by: 'cat' | 'reason'): ReturnGroup[] {
  const net = netReturnRecords(records);
  const live = liveReturnRecords(records);
  const map = new Map<string, ReturnGroup>();
  const keyOf = (r: DrugReturnRecord) => by === 'cat' ? { key: r.category || 'other', label: categoryLabel(r.category), icon: undefined as string | undefined } : (() => { const g = reasonGroupOf(baseReason(r)); return { key: g.key, label: g.label, icon: g.icon }; })();
  const get = (r: DrugReturnRecord): ReturnGroup => {
    const k = keyOf(r);
    const found = map.get(k.key);
    if (found) return found;
    const g: ReturnGroup = { key: k.key, label: k.label, ...(k.icon ? { icon: k.icon } : {}), count: 0, qty: 0, value: 0, records: [], children: by === 'reason' ? [] : undefined };
    map.set(k.key, g);
    return g;
  };
  const childOf = (g: ReturnGroup, label: string) => {
    const list = g.children ?? (g.children = []);
    const found = list.find((x) => x.label === label);
    if (found) return found;
    const c = { label, count: 0, value: 0 };
    list.push(c);
    return c;
  };
  const childLabel = (r: DrugReturnRecord) => { const b = baseReason(r); return b ? (GROUP_OF_REASON.has(b) ? b : 'อื่น ๆ: ' + b) : UNKNOWN_REASON; };
  for (const r of net) {
    const g = get(r);
    g.qty += r.qty; g.value += Math.round(r.value);
    if (g.children) childOf(g, childLabel(r)).value += Math.round(r.value);
  }
  for (const r of live) {
    const g = get(r);
    g.count++; g.records.push(r);
    if (g.children) childOf(g, childLabel(r)).count++;
  }
  const out = [...map.values()];
  for (const g of out) { g.records.sort((a, b) => b.ts - a.ts); g.children?.sort((a, b) => b.value - a.value); }
  return out.sort((a, b) => b.value - a.value || b.count - a.count);
}

/** Month helpers (ISO YYYY-MM) */
export function monthRange(ym: string): { from: string; to: string } {
  const [y, m] = ym.split('-').map(Number) as [number, number];
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${ym}-01`, to: `${ym}-${String(last).padStart(2, '0')}` };
}
export function previousMonth(ms: number = Date.now()): string {
  const d = new Date(ms + 7 * 3600000); // Bangkok
  d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1);
  return d.toISOString().slice(0, 7);
}
