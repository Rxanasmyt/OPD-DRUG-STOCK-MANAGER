// Real-world request: "เดิมการปริ้นใบเบิก จะปริ้นจาก gg sheet...อยากให้แอพสามารถปริ้นออกมาโดยข้อมูล
// จากการปริ้นแบบเดิมยังครบ" — single source of truth for the 4 physical requisition-sheet
// categories the hospital's own paper process always used (ใบเบิกยาเม็ด/ยาน้ำ/ยาฉีด/ยาใช้ภายนอก):
// the id stored on Med.reqCategory, the order printed/shown in, and the Thai label. Same pattern
// as data/routes.ts (ROUTES) — adding/renaming a category only ever needs to happen here.
import type { Med } from '../types';

export type ReqCategory = NonNullable<Med['reqCategory']>;

export interface ReqCategoryOption {
  id: ReqCategory;
  label: string;
}

// Labels drop the "ยา" prefix routes.ts's own labels all carry ("ยาฉีด", "ยาทาภายนอก", ...) —
// deliberately, not just for brevity: MedsScreen shows this chip group right under the route
// chip group on the same form, and "ยาฉีด" is the exact, identical label both ROUTES'
// 'injection' and this list's own 'injection' would otherwise share, which breaks any
// accessible-name lookup (getByRole('button', {name: ...})) that can no longer tell the two
// same-labeled buttons apart. The surrounding "หมวดใบเบิกจากคลัง (เม็ด/น้ำ/ฉีด/ภายนอก)" header
// already gives this group's own context, so the shorter label never reads as ambiguous.
export const REQ_CATEGORIES: ReqCategoryOption[] = [
  { id: 'tab', label: '💊 เม็ด' },
  { id: 'liquid', label: '🧪 น้ำ' },
  { id: 'injection', label: '💉 ฉีด' },
  { id: 'external', label: '🧴 ใช้ภายนอก' },
];

const BY_ID: Record<string, ReqCategoryOption> = Object.fromEntries(REQ_CATEGORIES.map((c) => [c.id, c]));

/** `m.reqCategory` is optional — every med with no whCode match yet (or added since the last
 * backfill run) has none; shown as its own "ยังไม่ระบุ" bucket rather than hidden or guessed at. */
export function reqCategoryLabel(id: ReqCategory | undefined): string {
  return (id && BY_ID[id]?.label) || 'ยังไม่ระบุหมวด';
}
