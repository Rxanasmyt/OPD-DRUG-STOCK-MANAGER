// Single source of truth for the names people tap, and for "which manual section documents which screen".
// The bottom nav (App.tsx), the "เพิ่มเติม" menu (MoreScreen.tsx) and the user manual / login guide / flow map all
// read these, so renaming a tab here renames it everywhere. SCREEN_MANUAL is typed Record<Screen, …>: adding a
// new Screen to types.ts will not compile until you say which manual section covers it (or null = not user-facing),
// and navLabels.test.ts then checks that section exists. => the manual cannot silently fall behind the app.
import type { Screen } from './types';

export const TAB = {
  home: 'หน้าหลัก',
  transfer: 'เติมหน้างาน',
  reconcile: 'นำเข้า HOSxP',
  receive: 'รับเข้า',
  more: 'เพิ่มเติม',
} as const;

export const MENU = {
  adjust: 'ปรับยอด / คืนยา / ยาหมดอายุ',
  count: 'นับสต็อกหน้างาน',
  meds: 'จัดการรายการยา',
  wardmove: 'ย้ายยาระหว่างชั้นวาง',
  par: 'par อัตโนมัติ & เกณฑ์แจ้งเตือน',
  report: 'รายงานและ Export CSV',
  substockcard: 'บัตรคุมยา',
  labels: 'ระบบฉลาก QR',
  admin: 'จัดการผู้ใช้ & Audit log',
} as const;

/** screen → id of the UserManual section that documents it (null: transient screen, no manual entry needed). */
export const SCREEN_MANUAL: Record<Screen, string | null> = {
  login: 'start', home: 'map', transfer: 'transfer', tconfirm: 'transfer', done: null, receive: 'receive', adjust: 'adjust',
  report: 'cards', labels: 'cards', settings: 'settings', more: 'map', count: 'count', reconcile: 'hosxp', admin: 'admin',
  meds: 'admin', wardmove: 'wardmove', substockcard: 'cards',
};
