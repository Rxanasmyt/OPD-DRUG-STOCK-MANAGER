#!/usr/bin/env node
// Afternoon reminder (Mon–Fri) when nobody has done "นำเข้า HOSxP" (ตัดยอด) today. A skipped day lets every shelf number in the
// app drift from the real shelf silently — and every alert (Min / par / emergency) is computed from those numbers.
// Rule = same as the app's Home screen: any `reconcile_hosxp` transaction dated today (Bangkok time) counts as done.
// Reads only today's transactions (single-field `ts` range — no composite index needed; `type` is filtered here).
// Public holidays: there is no calendar in the app — list them in the repo variable HOLIDAYS (comma-separated YYYY-MM-DD).
//   FIREBASE_SERVICE_ACCOUNT_KEY=... MOPH_NOTIFY_CLIENT_KEY=... MOPH_NOTIFY_SECRET_KEY=... node scripts/notify-hosxp-missing.mjs [--dry-run]
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { alertFlex, sendIfConfigured } from './moph-notify.mjs';

const BKK = 7 * 3600000;
const bkkDay = (ms) => new Date(ms + BKK).toISOString().slice(0, 10);
/** Start of the Bangkok calendar day containing `ms`, as epoch ms. */
export const bkkDayStart = (ms) => Date.parse(bkkDay(ms) + 'T00:00:00+07:00');

/** Pure decision: should we remind? `txs` = today's transactions. */
export function needsReminder({ txs, now = Date.now(), holidays = [] }) {
  const today = bkkDay(now);
  const dow = new Date(now + BKK).getUTCDay(); // 0 = Sunday … 6 = Saturday (Bangkok)
  if (dow === 0 || dow === 6) return { remind: false, reason: 'weekend' };
  if (holidays.includes(today)) return { remind: false, reason: 'holiday' };
  const done = txs.some((t) => t.type === 'reconcile_hosxp' && bkkDay(t.ts) === today);
  return done ? { remind: false, reason: 'already-reconciled' } : { remind: true, reason: 'not-reconciled' };
}

export function reminderMessage(now = Date.now()) {
  const time = new Date(now + BKK).toISOString().slice(11, 16);
  return alertFlex({
    icon: '🧾', tone: 'orange', title: 'วันนี้ยังไม่ได้ตัดยอด HOSxP',
    lines: [
      `ถึงเวลา ${time} น. ยังไม่มีการนำเข้าไฟล์ HOSxP ของวันนี้`,
      'ถ้าข้ามไป ยอดหน้างานในแอปจะคลาดจากของจริง และการแจ้งเตือนยาต่ำ/ยาจะหมดจะคำนวณจากเลขที่ไม่ตรง',
      'เมนู “นำเข้า HOSxP” → แนบไฟล์ → ตรวจ → ตัดยอด',
    ],
    buttonLabel: 'เปิดแอป · นำเข้า HOSxP',
    footnote: 'ถ้าวันนี้เป็นวันหยุดราชการ ให้เพิ่มวันที่ในตัวแปร HOLIDAYS ของ GitHub repo เพื่อไม่ให้เตือน',
  });
}

export async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set.'); process.exit(1); }
  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const db = getFirestore();
  const now = Date.now();
  const snap = await db.collection('txs').where('ts', '>=', bkkDayStart(now)).get();
  const txs = snap.docs.map((d) => d.data());
  const holidays = (process.env.HOLIDAYS || '').split(',').map((x) => x.trim()).filter(Boolean);
  const verdict = needsReminder({ txs, now, holidays });
  console.log(`Today's txs: ${txs.length} · verdict: ${verdict.reason}`);
  if (!verdict.remind) return;
  if (dryRun) { console.log('(--dry-run — would send reminder)'); return; }
  await sendIfConfigured([reminderMessage(now)]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('HOSxP reminder failed:', err); process.exit(1); });
}
