#!/usr/bin/env node
// Generic "something failed" alert to the LINE group (used from a workflow step with `if: failure()`).
//   ALERT_TITLE="สำรองข้อมูลล้มเหลว" ALERT_MESSAGE="..." ALERT_RUN_URL="https://github.com/.../runs/1" node scripts/notify-alert.mjs
// Never fails the job itself: a broken notifier must not hide the original failure, so any error here is only logged.
import { alertFlex, sendIfConfigured, inOfficeHours } from './moph-notify.mjs';

export function buildAlert(env = process.env) {
  const title = env.ALERT_TITLE || 'มีงานอัตโนมัติล้มเหลว';
  const lines = [env.ALERT_MESSAGE || 'งานอัตโนมัติของแอปสต็อกยาทำงานไม่สำเร็จ'];
  const url = env.ALERT_RUN_URL;
  if (url) lines.push('ดูรายละเอียด/ลองรันใหม่ได้จากปุ่มด้านล่าง');
  return alertFlex({ icon: '⚠️', tone: 'red', title, lines, buttonLabel: url ? 'เปิดบันทึกการรัน' : 'เปิดแอปสต็อกยา', buttonUri: url || undefined });
}

export async function main(env = process.env) {
  // Office hours only (Mon–Fri 08:30–16:30 Bangkok). A night-time failure is not sent; the in-app backup banner still shows it to admins.
  if (!env.ALERT_IGNORE_HOURS && !inOfficeHours()) { console.log('::warning::Outside office hours — LINE alert not sent.'); return; }
  try { await sendIfConfigured([buildAlert(env)], env); } catch (e) { console.error('alert not sent:', e.message || e); }
}

if (import.meta.url === `file://${process.argv[1]}`) main();
