// Real-world request: "ตอนนี้หน้าจัดการรายการยา ประเภทยามีเพียงยากิน ยาฉีด และอื่นๆ แต่ยังไม่มี
// ยาพ่น ยาทาภายนอก ยาหยอดตา ยาป้าย ยาหยอดหู" — single source of truth for the full list of
// "ประเภทการให้ยา" (route) options: the id stored on Med.route, the order they're shown in, and
// the Thai label (with emoji) shown wherever a route appears. Shared by MedsScreen's chips,
// TransferScreen's route-grouped list, print.ts's printed pick-list grouping, and
// routeSuggest.ts's auto-detection — adding or renaming a route only ever needs to happen here.
import type { Med } from '../types';

export type RouteType = NonNullable<Med['route']>;

export interface RouteOption {
  id: RouteType;
  /** Short label (emoji + Thai) — used on the add/edit form's and the list row's chip buttons. */
  label: string;
  /** Longer label for a route-GROUP header (TransferScreen, the printed pick-list) — only
   * 'other' needs one; every other route's group header is identical to its chip label. */
  groupLabel?: string;
}

export const ROUTES: RouteOption[] = [
  { id: 'oral', label: '💊 ยากิน' },
  { id: 'injection', label: '💉 ยาฉีด' },
  { id: 'inhaled', label: '🌬️ ยาพ่น' },
  { id: 'topical', label: '🧴 ยาทาภายนอก' },
  { id: 'eye', label: '👁️ ยาหยอดตา' },
  { id: 'ear', label: '👂 ยาหยอดหู' },
  { id: 'paint', label: '🖌️ ยาป้าย' },
  { id: 'other', label: '📦 อื่นๆ', groupLabel: '📦 อื่นๆ / ยังไม่ระบุประเภท' },
];

const BY_ID: Record<string, RouteOption> = Object.fromEntries(ROUTES.map((r) => [r.id, r]));

/** `m.route` is optional — every med added before this feature existed (or any route since
 * removed from ROUTES) has none; both fall back to 'other'. */
export function routeLabel(id: RouteType | undefined): string {
  return (id && BY_ID[id]?.label) || (BY_ID.other as RouteOption).label;
}

export function routeGroupLabel(id: RouteType): string {
  const r = BY_ID[id];
  return r?.groupLabel || r?.label || (BY_ID.other as RouteOption).label;
}
