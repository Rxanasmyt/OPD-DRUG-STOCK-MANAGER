#!/usr/bin/env node
// Real-world request: "ระบบตัวชี้วัดอัตโนมัติ เก็บข้อมูล ดึงเป็นรายงานได้ทุกช่วง" — an automatic
// daily KPI snapshot so the app's "ตัวชี้วัดย้อนหลัง" report tab can show a real trend over any
// custom date range, not just "right now". Firestore only ever holds CURRENT meds/lots state —
// there's no built-in history — so a real trend needs each day's numbers captured as they
// happen and stored somewhere, which is exactly what this script does. Same free-tier
// "GitHub Actions IS the server" pattern as backup-firestore.mjs/notify-low-stock.mjs (see
// those files' own doc comments for why: this is a static site with no backend of its own to
// run a schedule on).
//
// Run automatically every day by .github/workflows/daily-metrics.yml, shortly after midnight
// Asia/Bangkok, computing the day that JUST ended. To run locally (or backfill a specific past
// date):
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/collect-daily-metrics.mjs [--date=YYYY-MM-DD]
//
// IMPORTANT LIMITATION (documented rather than hidden): the "คงคลัง" section (totalFloorQty,
// totalStockValue, lowStockCount, ...) reads meds/lots as they are RIGHT NOW, at the moment
// this script runs — there is no way to ask Firestore "what was the stock on 2026-01-15"
// after the fact. For the automatic daily run (computing "yesterday" right after midnight)
// that's an accurate end-of-day snapshot. Backfilling an OLDER date via --date will still label
// the row with that date, but the stock-snapshot fields will reflect TODAY's stock, not that
// day's — only the transaction-derived fields (dispensing/receiving/accuracy/staff-activity,
// all read from `txs`/`auditLog` filtered to that day's real timestamps) are accurate for any
// past date, since those are genuine historical records. The report screen surfaces this same
// caveat next to the stock-value chart.
//
// Idempotent: writes with .set() (full overwrite) keyed by date, so re-running for the same
// date (a backfill, or a retried workflow run) just recomputes and replaces that one day —
// never creates a duplicate or double-counts.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';

const DAY = 86400000;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000; // Asia/Bangkok is a fixed UTC+7, no DST

// ---- kept in sync BY HAND with src/store/selectors.ts (same convention notify-low-stock.mjs
// already uses — this script runs outside the TS/Vite build, so it can't import those
// directly). If floorMinOf/usesSubstock/suggestPar/roundStep change there, update here too. ----
function usesSubstock(m) { return !m.noSubstock; }
function halfOfMaxRounded(parFloor) {
  const raw = parFloor * 0.5;
  if (raw <= 0) return 0;
  const step = raw >= 500 ? 100 : raw >= 100 ? 10 : raw >= 10 ? 5 : 1;
  return Math.round(raw / step) * step;
}
function floorMinOf(m) {
  return typeof m.floorMin === 'number' ? m.floorMin : halfOfMaxRounded(m.parFloor);
}
function roundStep(v) {
  const step = v >= 500 ? 100 : v >= 100 ? 10 : 1;
  return Math.max(step, Math.ceil(v / step) * step);
}
function suggestPar(m, floorCoverDays, subCoverDays) {
  if (!(m.used30 > 0)) return null;
  const daily = m.used30 / (30 * (5 / 7));
  const floorDays = usesSubstock(m) ? floorCoverDays : subCoverDays;
  return { floor: roundStep(daily * floorDays * m.volatility), sub: roundStep(daily * subCoverDays * m.volatility) };
}
function parAnomalyCounts(meds, floorCoverDays, subCoverDays) {
  let errors = 0, reviews = 0;
  for (const m of meds) {
    if (!m.active) continue;
    const min = floorMinOf(m);
    if (m.parFloor > 0 && min >= m.parFloor) errors++;
    if (usesSubstock(m) && m.parFloor > 0 && m.parSub > 0 && m.parSub < m.parFloor) errors++;
    if (m.used30 > 0 && m.parFloor === 0) errors++;
    if (usesSubstock(m) && m.used30 > 0 && m.parSub === 0) errors++;
    const suggested = suggestPar(m, floorCoverDays, subCoverDays);
    if (suggested) {
      if (m.parFloor > 0 && (suggested.floor >= m.parFloor * 3 || suggested.floor * 3 <= m.parFloor)) reviews++;
      if (usesSubstock(m) && m.parSub > 0 && (suggested.sub >= m.parSub * 3 || suggested.sub * 3 <= m.parSub)) reviews++;
    }
  }
  return { errors, reviews };
}

function bangkokIsoDate(ms) {
  return new Date(ms + BANGKOK_OFFSET_MS).toISOString().slice(0, 10);
}
/** Start of the given Asia/Bangkok calendar day, as a real UTC ms timestamp. */
function bangkokDayStartMs(isoDate) {
  return Date.parse(isoDate + 'T00:00:00.000Z') - BANGKOK_OFFSET_MS;
}

async function main() {
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See this file\'s header comment for how to run it.');
    process.exit(1);
  }
  const dateArg = process.argv.find((a) => a.startsWith('--date='));
  const targetDate = dateArg ? dateArg.slice('--date='.length) : bangkokIsoDate(Date.now() - DAY);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    console.error('--date must be YYYY-MM-DD, got:', targetDate);
    process.exit(1);
  }
  const dayStart = bangkokDayStartMs(targetDate);
  const dayEnd = dayStart + DAY;

  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  console.log(`Collecting KPI snapshot for ${targetDate} (project "${serviceAccount.project_id}")...`);

  const [medsSnap, lotsSnap, settingsSnap] = await Promise.all([
    db.collection('meds').get(),
    db.collection('lots').get(),
    db.collection('meta').doc('settings').get(),
  ]);
  const meds = medsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const lots = lotsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const settings = settingsSnap.exists ? settingsSnap.data() : {};
  const expiryWarnDays = typeof settings.expiryWarnDays === 'number' ? settings.expiryWarnDays : 30;
  const floorCoverDays = typeof settings.parFloorCoverDays === 'number' ? settings.parFloorCoverDays : 4;
  const subCoverDays = typeof settings.parSubCoverDays === 'number' ? settings.parSubCoverDays : 28;

  // ---- คงคลัง (see this file's header comment on the "as of script run time" limitation) ----
  const activeMeds = meds.filter((m) => m.active);
  const activeIds = new Set(activeMeds.map((m) => m.id));
  const subByMed = new Map();
  for (const l of lots) subByMed.set(l.medId, (subByMed.get(l.medId) || 0) + (l.qty || 0));

  let totalFloorQty = 0, totalSubQty = 0, totalStockValue = 0, lowStockCount = 0, urgentLowCount = 0;
  let stockoutCount = 0, usedMedCount = 0;
  for (const m of activeMeds) {
    const floor = m.floor || 0;
    const sub = subByMed.get(m.id) || 0;
    totalFloorQty += floor;
    totalSubQty += sub;
    totalStockValue += (floor + sub) * (m.price || 0);
    const min = floorMinOf(m);
    if (floor < min) lowStockCount++;
    if (floor < min * 0.5) urgentLowCount++;
    // "อัตราขาดสต็อกจริง" — genuinely out (not just below its reorder point) while actually in
    // real use, see DailyMetrics.stockoutCount's own doc comment for why this is distinct from
    // lowStockCount/urgentLowCount above.
    if (m.used30 > 0) {
      usedMedCount++;
      if (floor === 0) stockoutCount++;
    }
  }
  const now = Date.now();
  // Calendar-day difference in Asia/Bangkok time, not a raw 24h-window count — mirrors
  // src/utils/format.ts's daysUntil(), which was fixed for exactly this reason (a raw
  // floor((exp-now)/DAY) ticks over 24h after the exact instant this runs, not at local
  // midnight, so this cron — scheduled ~00:05 Bangkok — could flag/miss a lot expiring "today"
  // depending on the runner's UTC clock rather than the hospital's own calendar day).
  const todayStartMs = bangkokDayStartMs(bangkokIsoDate(now));
  let nearExpiryValue = 0, expiredValue = 0;
  for (const l of lots) {
    if (!activeIds.has(l.medId) || !(l.qty > 0)) continue;
    const m = meds.find((x) => x.id === l.medId);
    if (!m) continue;
    const expStartMs = bangkokDayStartMs(bangkokIsoDate(l.exp || 0));
    const daysLeft = Math.round((expStartMs - todayStartMs) / DAY);
    const value = l.qty * (m.price || 0);
    if (daysLeft < 0) expiredValue += value;
    else if (daysLeft < expiryWarnDays) nearExpiryValue += value;
  }

  // ---- อัตราการจ่าย/เบิก + กิจกรรมผู้ใช้งาน (real historical records — accurate for any date) ----
  const txSnap = await db.collection('txs')
    .where('ts', '>=', dayStart).where('ts', '<', dayEnd)
    .get();
  const txs = txSnap.docs.map((d) => d.data());
  let receivedQty = 0, receivedCount = 0, transferredQty = 0, dispensedQty = 0, adjustQty = 0;
  let countDiscrepancyCount = 0, reconciledToday = false;
  const txByUser = {};
  for (const t of txs) {
    if (t.by) txByUser[t.by] = (txByUser[t.by] || 0) + 1;
    if (t.type === 'receive_from_central') { receivedQty += t.qty || 0; receivedCount++; }
    else if (t.type === 'transfer_to_floor') { transferredQty += t.qty || 0; }
    else if (t.type === 'reconcile_hosxp') { dispensedQty += Math.abs(t.qty || 0); reconciledToday = true; }
    else if (['adjust', 'damaged', 'return', 'expired', 'ward_move_out', 'ward_move_in'].includes(t.type)) {
      adjustQty += Math.abs(t.qty || 0);
    } else if (t.type === 'count' && (t.qty || 0) !== 0) {
      countDiscrepancyCount++;
    }
  }

  // ---- ความแม่นยำข้อมูล ----
  const { errors: parErrorCount, reviews: parReviewCount } = parAnomalyCounts(meds, floorCoverDays, subCoverDays);
  // Filters `type` client-side rather than adding it as a second `.where()` — combining an
  // equality clause with the `ts` range clause above would need a composite index created by
  // hand in the Firebase console first; reading one day's worth of audit rows and filtering in
  // JS avoids that entirely, and the volume (one hospital pharmacy's daily audit log) is trivial.
  const auditSnap = await db.collection('auditLog')
    .where('ts', '>=', dayStart).where('ts', '<', dayEnd)
    .get();
  let hosxpUnmatchedCount = 0;
  for (const d of auditSnap.docs) {
    const data = d.data();
    if (data.type !== 'hosxp_unmatched') continue;
    const m = (data.note || '').match(/จับคู่ไม่ได้ (\d+) รายการ/);
    if (m) hosxpUnmatchedCount += parseInt(m[1], 10);
  }

  // ---- เวลารอเบิกยา (เบิก→อนุมัติ, see DailyMetrics.receiveLeadTimeAvgHours's own doc comment
  // for why this only ever measures the tech-submitted/pharm-approved flow) ----
  const pendingSnap = await db.collection('pendingReceives').get();
  let leadTimeSumHours = 0, receiveApprovedCount = 0, receivePendingBacklog = 0;
  for (const d of pendingSnap.docs) {
    const p = d.data();
    if (p.status === 'pending') { receivePendingBacklog++; continue; }
    if (p.status !== 'approved' || typeof p.resolvedTs !== 'number') continue;
    if (p.resolvedTs < dayStart || p.resolvedTs >= dayEnd) continue; // resolved ON this target day
    leadTimeSumHours += (p.resolvedTs - p.ts) / (60 * 60 * 1000);
    receiveApprovedCount++;
  }
  const receiveLeadTimeAvgHours = receiveApprovedCount > 0 ? leadTimeSumHours / receiveApprovedCount : null;

  const metrics = {
    date: targetDate,
    generatedAt: now,
    activeMedCount: activeMeds.length,
    totalFloorQty, totalSubQty, totalStockValue, lowStockCount, urgentLowCount,
    nearExpiryValue, expiredValue,
    receivedQty, receivedCount, transferredQty, dispensedQty, adjustQty, txCount: txs.length,
    receiveLeadTimeAvgHours, receiveApprovedCount, receivePendingBacklog,
    parErrorCount, parReviewCount, countDiscrepancyCount, hosxpUnmatchedCount, reconciledToday,
    activeUserCount: Object.keys(txByUser).length,
    txByUser,
    stockoutCount, usedMedCount,
  };

  await db.collection('dailyMetrics').doc(targetDate).set(metrics);
  console.log(`Wrote dailyMetrics/${targetDate}:`, JSON.stringify(metrics, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
