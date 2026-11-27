#!/usr/bin/env node
// Afternoon reminder (Mon–Fri) when nobody has done "นำเข้า HOSxP" (ตัดยอด) today. A skipped day lets every shelf number in the
// app drift from the real shelf silently — and every alert (Min / par / emergency) is computed from those numbers.
// Rule = same as the app's Home screen: any `reconcile_hosxp` transaction dated today (Bangkok time) counts as done.
// Reads only today's transactions (single-field `ts` range — no composite index needed; `type` is filtered here).
// Public holidays: there is no calendar in the app — list them in the repo variable HOLIDAYS (comma-separated YYYY-MM-DD).
//   FIREBASE_SERVICE_ACCOUNT_KEY=... MOPH_NOTIFY_CLIENT_KEY=... MOPH_NOTIFY_SECRET_KEY=... node scripts/notify-hosxp-missing.mjs [--dry-run]
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { alertFlex, sendIfConfigured, waitUntilBangkokTime, stampRun } from './moph-notify.mjs';

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
  // Defence in depth (real case: a reminder arrived at 00:51): "not reconciled TODAY" means nothing at the very start or end of the day.
  const hour = new Date(now + BKK).getUTCHours();
  if (hour < 9 || hour >= 18) return { remind: false, reason: 'off-hours' };
  // A malformed tx without a numeric ts must not crash the check (new Date(NaN).toISOString() throws).
  const done = txs.some((t) => t.type === 'reconcile_hosxp' && Number.isFinite(t.ts) && bkkDay(t.ts) === today);
  return done ? { remind: false, reason: 'already-reconciled' } : { remind: true, reason: 'not-reconciled' };
}

const TH_SHORT = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
const thShort = (iso) => { const [, m, d] = iso.split('-').map(Number); return `${d} ${TH_SHORT[m - 1]}`; };
const REVERSAL_PREFIX = '↩ ยกเลิกรายการคืน · ';

/** Working days (Mon–Fri, minus listed holidays) between the day after the last covered date and YESTERDAY — the same rule as the app's
 * reconcileReminder() (src/store/selectors.ts). `lastCoveredTo` = newest `coveredTo` of any reconcile row (YYYY-MM-DD). */
export function missingWorkdays(lastCoveredTo, now = Date.now(), holidays = []) {
  const none = { n: 0, first: null, last: null };
  if (!lastCoveredTo) return none;
  const yesterday = bkkDay(now - 86400000);
  if (lastCoveredTo >= yesterday) return none;
  let n = 0, first = null, last = null;
  for (let d = Date.parse(lastCoveredTo + 'T00:00:00Z') + 86400000; d <= Date.parse(yesterday + 'T00:00:00Z'); d += 86400000) {
    const iso = new Date(d).toISOString().slice(0, 10);
    const wd = new Date(d).getUTCDay();
    if (wd === 0 || wd === 6 || holidays.includes(iso)) continue;
    n++; first = first ?? iso; last = iso;
  }
  return { n, first, last };
}

/** round 1 = the 15:00 reminder; round 2 = the 16:30 follow-up. `missing` = missingWorkdays(); n >= 2 is escalated (red, with the dates). */
export function reminderMessage(now = Date.now(), { round = 1, missing = { n: 0, first: null, last: null } } = {}) {
  const time = new Date(now + BKK).toISOString().slice(11, 16);
  const long = missing.n >= 2;
  const title = round === 2 ? `เตือนครั้งที่ 2 · ยังไม่ได้ตัดยอด HOSxP${long ? ' ' + missing.n + ' วันทำการ' : ''}`
    : long ? `ยังไม่ได้ตัดยอด HOSxP ${missing.n} วันทำการ` : 'วันนี้ยังไม่ได้ตัดยอด HOSxP';
  return alertFlex({
    icon: round === 2 || long ? '🚨' : '🧾', tone: round === 2 || long ? 'red' : 'orange', title,
    lines: [
      round === 2 ? `ถึงเวลา ${time} น. — เตือนครั้งแรกเมื่อ 15:00 ยังไม่มีการนำเข้าไฟล์ HOSxP` : `ถึงเวลา ${time} น. ยังไม่มีการนำเข้าไฟล์ HOSxP ของวันนี้`,
      ...(long ? [`ค้างตัดยอด ${missing.n} วันทำการ (${thShort(missing.first)} – ${thShort(missing.last)})`] : []),
      'ถ้าข้ามไป ยอดหน้างานในแอปจะคลาดจากของจริง และการแจ้งเตือนยาต่ำ/ยาจะหมดจะคำนวณจากเลขที่ไม่ตรง',
      'เมนู “นำเข้า HOSxP” → แนบไฟล์ → ตรวจ → ตัดยอด',
    ],
    buttonLabel: 'ไปที่นำเข้า HOSxP',
    footnote: 'ถ้าวันนี้เป็นวันหยุดราชการ ให้เพิ่มวันที่ในตัวแปร HOLIDAYS ของ GitHub repo เพื่อไม่ให้เตือน',
  });
}

export async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set.'); process.exit(1); }
  const round = process.env.REMINDER_ROUND === '2' ? 2 : 1;
  const w = await waitUntilBangkokTime(process.env.TARGET_TIME_BKK); // start early, send on the exact Bangkok minute
  if (w.skip) { console.log('::warning::Skipped — the scheduled run was not on time, nothing was sent.'); return; }
  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const db = getFirestore();
  try {
    const now = Date.now();
    const snap = await db.collection('txs').where('ts', '>=', bkkDayStart(now)).get();
    const txs = snap.docs.map((d) => d.data());
    const holidays = (process.env.HOLIDAYS || '').split(',').map((x) => x.trim()).filter(Boolean);
    const verdict = needsReminder({ txs, now, holidays });
    console.log(`Today's txs: ${txs.length} · verdict: ${verdict.reason} · round ${round}`);
    if (!verdict.remind) { if (!dryRun) await stampRun(db, 'hosxp', 'nothing', { why: verdict.reason }); return; }
    // How many working days are outstanding? ONE read (single-field index on coveredTo). A newest row that is a reversal is "uncertain" → say nothing about the count.
    let missing = { n: 0, first: null, last: null };
    try {
      const latest = await db.collection('txs').orderBy('coveredTo', 'desc').limit(1).get();
      const row = latest.docs[0]?.data();
      if (row && typeof row.coveredTo === 'string' && !String(row.reason || '').startsWith(REVERSAL_PREFIX)) missing = missingWorkdays(row.coveredTo, now, holidays);
    } catch (e) { console.error('could not read the last covered date:', e.message || e); }
    console.log(`Outstanding working days: ${missing.n}`);
    if (dryRun) { console.log('(--dry-run — would send reminder)'); return; }
    await sendIfConfigured([reminderMessage(now, { round, missing })], process.env, { required: true });
    await stampRun(db, 'hosxp', 'sent', { round, missingDays: missing.n });
  } catch (e) {
    if (!dryRun) await stampRun(db, 'hosxp', 'failed', { error: String(e.message || e).slice(0, 200) });
    throw e;
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => { console.error('HOSxP reminder failed:', err); process.exit(1); });
}
