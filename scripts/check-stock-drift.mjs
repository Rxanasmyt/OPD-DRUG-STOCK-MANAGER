#!/usr/bin/env node
// Real-world request: "ทำอย่างไรให้แอพมีความเสถียรที่สามารถใช้งานจริงในรพ.ได้ เหมือนระบบ hosxp" —
// one real risk this app has no automatic check for at all: live floor/substock quietly
// drifting away from what the tx log actually accounts for (a bug nobody's noticed yet, a slip
// of the finger, a manual Firestore console edit, a write that landed but its tx-log row
// didn't). Today the only way anyone finds out is a physical count turning up a surprise
// mismatch — this script closes that gap by checking EVERY active med, every day, automatically.
//
// How it works: keeps a running snapshot (_stockDriftSnapshots/latest — one scratch doc, never
// touched by the app or by real users) of every med's live floor/substock as of the last time
// this ran. Each run: reads that snapshot, reads every tx logged since, and computes what
// today's live value SHOULD be (snapshot + every logged delta) — same FLOOR_LEDGER_TYPES/
// SUBSTOCK_LEDGER_TYPES classification AppContext.tsx's own fetchFloorLedger/fetchSubstockLedger/
// fetchStockAsOf already use for exactly this "which tx types affect which stock stage, and with
// which sign" question (see those functions' own comments) — then compares that to the live
// value RIGHT NOW. A med that doesn't match has had some stock-affecting event in that window
// that never got logged as a tx. Then moves the snapshot forward to today's value regardless of
// whether drift was found, so tomorrow's check always compares against a fresh baseline instead
// of an increasingly stale one (a real, already-reported drift re-appearing every day forever
// would be noise, not help).
//
// Deliberately NOT per-med absolute reconstruction from the dawn of time (that's fetchStockAsOf's
// job, and it already documents why "walk back from the live value" beats "walk forward from an
// assumed zero baseline this app has no record of") — this only ever needs ONE day's worth of
// tx log to check, which is both cheap and immune to that same unknown-baseline problem.
//
// Run automatically every day by .github/workflows/stock-drift-check.yml, shortly after
// collect-daily-metrics.mjs. To run locally:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/check-stock-drift.mjs
//
// Exits non-zero (fails the whole GitHub Actions run — GitHub emails the repo owner by default
// on a failed scheduled workflow, same convention verify-backup.mjs already uses) when drift is
// found, and also writes an auditLog entry (type: 'stock_drift_detected') so it's visible inside
// the app itself (AdminScreen's audit log, "สต็อก/ธุรกรรม" filter), not just in an email.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

// Hand-kept in sync with AppContext.tsx's own FLOOR_LEDGER_TYPES/SUBSTOCK_LEDGER_TYPES and the
// disambiguating guards right next to them (same convention collect-daily-metrics.mjs/
// notify-low-stock.mjs already follow — this script runs outside the TS/Vite build, so it can't
// import those directly). If any of those change there, update here too.
const FLOOR_LEDGER_TYPES = new Set(['receive_from_central', 'transfer_to_floor', 'reconcile_hosxp', 'adjust', 'return', 'damaged', 'ward_move_in', 'ward_move_out', 'count']);
const SUBSTOCK_LEDGER_TYPES = new Set(['receive_from_central', 'transfer_to_floor', 'expired', 'count']);

function floorDeltaOf(x) {
  if (!FLOOR_LEDGER_TYPES.has(x.type)) return 0;
  if (x.type === 'receive_from_central' && x.to !== 'floor') return 0; // substock-bound receive, not floor
  if (x.type === 'count' && x.loc !== 'floor') return 0; // a substock count, not a floor one
  return x.qty || 0;
}
function subDeltaOf(x) {
  if (!SUBSTOCK_LEDGER_TYPES.has(x.type)) return 0;
  // Bug fix (false-positive drift): a noSubstock med's receive_from_central always has
  // to:'floor' (commitReceive credits its floor directly — see AppContext.tsx's own comment on
  // why noSubstock meds never get a substock lot at all), but nothing here excluded that case —
  // every such receive would still count toward expectedSub even though current[m.id].sub stays
  // permanently 0 for a med with no lots, manufacturing a drift report on every single noSubstock
  // receive. floorDeltaOf has the symmetric guard the other way (excluding a substock-bound
  // receive from the floor side) — this is the other half of that same pairing.
  if (x.type === 'receive_from_central' && x.to !== 'substock') return 0;
  if (x.type === 'expired' && x.loc !== 'substock') return 0;
  if (x.type === 'count' && x.loc !== 'substock') return 0;
  return x.type === 'transfer_to_floor' ? -Math.abs(x.qty || 0) : (x.qty || 0);
}

const SNAPSHOT_PATH = ['_stockDriftSnapshots', 'latest'];

async function main() {
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See this file\'s header comment for how to run it.');
    process.exit(1);
  }
  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();
  const snapshotRef = db.collection(SNAPSHOT_PATH[0]).doc(SNAPSHOT_PATH[1]);

  console.log(`Checking stock drift (project "${serviceAccount.project_id}")...`);

  const [medsSnap, lotsSnap, prevSnapDoc] = await Promise.all([
    db.collection('meds').get(),
    db.collection('lots').get(),
    snapshotRef.get(),
  ]);
  const meds = medsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const subByMed = new Map();
  for (const d of lotsSnap.docs) {
    const l = d.data();
    if (l.medId) subByMed.set(l.medId, (subByMed.get(l.medId) || 0) + (l.qty || 0));
  }
  const nowMs = Date.now();
  const current = {};
  // `active`/`shared` ride along with every snapshot purely to detect a ward merge (see below) —
  // never compared against the tx log themselves.
  for (const m of meds) current[m.id] = { floor: m.floor || 0, sub: subByMed.get(m.id) || 0, active: !!m.active, shared: !!m.shared };

  if (!prevSnapDoc.exists) {
    console.log('No previous snapshot found (first run, or snapshot was reset) — writing today\'s baseline, nothing to compare yet.');
    await snapshotRef.set({ takenAtMs: nowMs, perMed: current });
    console.log(`Baseline written for ${meds.length} meds.`);
    return;
  }

  const prev = prevSnapDoc.data();
  const prevPerMed = prev.perMed || {};
  const sinceMs = prev.takenAtMs;

  const txSnap = await db.collection('txs').where('ts', '>', sinceMs).where('ts', '<=', nowMs).get();
  const floorDeltaByMed = new Map();
  const subDeltaByMed = new Map();
  let untaggedCount = 0;
  for (const d of txSnap.docs) {
    const x = d.data();
    if (!x.medId) { untaggedCount++; continue; } // can't attribute — see note below if this is ever >0
    const fd = floorDeltaOf(x);
    if (fd) floorDeltaByMed.set(x.medId, (floorDeltaByMed.get(x.medId) || 0) + fd);
    const sd = subDeltaOf(x);
    if (sd) subDeltaByMed.set(x.medId, (subDeltaByMed.get(x.medId) || 0) + sd);
  }

  const driftRows = [];
  let mergeSkippedCount = 0;
  for (const m of meds) {
    const prevM = prevPerMed[m.id];
    if (!prevM) continue; // new med since the last snapshot — no baseline to compare against yet
    // Bug fix (false-positive drift): mergeWardMeds()/mergeAllWardPairs() (AppContext.tsx,
    // MedsScreen's "รวมสต็อก OPD+IPD") deliberately moves floor between two meds' docs directly
    // inside a transaction — a real, routine, admin-confirmed formulary action, not a bug — and
    // logs it only to auditLog (type 'med_edited'), never as a txs row, so there's no delta for
    // this script to see at all. Without this guard, EVERY merge would be reported as drift on
    // BOTH meds involved, every single time. A med whose `shared` flag just turned on (the
    // winning OPD side, floor increased) or whose `active` flag just turned off (the losing IPD
    // side, floor zeroed) this cycle just went through exactly that — skip checking it for this
    // one cycle rather than false-alarm on a change that was never meant to be in the tx ledger.
    if ((m.shared && !prevM.shared) || (prevM.active && !m.active)) { mergeSkippedCount++; continue; }
    const expectedFloor = prevM.floor + (floorDeltaByMed.get(m.id) || 0);
    const expectedSub = prevM.sub + (subDeltaByMed.get(m.id) || 0);
    const actualFloor = current[m.id].floor;
    const actualSub = current[m.id].sub;
    const floorDiff = actualFloor - expectedFloor;
    const subDiff = actualSub - expectedSub;
    if (floorDiff !== 0 || subDiff !== 0) {
      driftRows.push({ medId: m.id, name: m.name, floorDiff, subDiff, expectedFloor, actualFloor, expectedSub, actualSub });
    }
  }

  // Move the baseline forward regardless of whether drift was found — comparing against an
  // increasingly stale snapshot would only make a real, already-reported drift look bigger
  // every day it goes uninvestigated, without this check becoming any more likely to catch a
  // NEW one. Today's live value is itself ground truth for tomorrow's comparison.
  await snapshotRef.set({ takenAtMs: nowMs, perMed: current });

  if (untaggedCount > 0) {
    // Every tx this app writes has tagged `medId` for a long time now (see the name-twin
    // disambiguation comments in AppContext.tsx) — a same-day window should never see an
    // untagged row. Worth a visible note (not a failure on its own) if it ever happens, since
    // it would mean this check silently skipped checking whatever that row actually affected.
    console.log(`Note: ${untaggedCount} tx row(s) in this window had no medId tag and could not be attributed to any med (unexpected for same-day data — investigate if this is ever non-zero).`);
  }
  if (mergeSkippedCount > 0) {
    console.log(`Note: ${mergeSkippedCount} med(s) skipped this cycle (a ward merge — รวมสต็อก OPD+IPD — moved floor outside the tx log, as designed; see auditLog's own 'med_edited' entry for the real record of it).`);
  }

  if (!driftRows.length) {
    console.log(`✓ No drift: all ${meds.length - mergeSkippedCount} checked med(s) (of ${meds.length} total) have live floor/substock matching the tx log exactly for ${new Date(sinceMs).toISOString()} → ${new Date(nowMs).toISOString()}.`);
    return;
  }

  console.log(`\n⚠ DRIFT DETECTED in ${driftRows.length} of ${meds.length} med(s) — live stock does not match what the tx log accounts for:\n`);
  for (const r of driftRows) {
    console.log(`  ${r.name} (${r.medId}): floor ${r.expectedFloor} expected -> ${r.actualFloor} actual (${r.floorDiff > 0 ? '+' : ''}${r.floorDiff}), substock ${r.expectedSub} expected -> ${r.actualSub} actual (${r.subDiff > 0 ? '+' : ''}${r.subDiff})`);
  }

  const note = `ตรวจพบความเพี้ยนของยอดคงคลัง ${driftRows.length} รายการ (ยอดจริงไม่ตรงกับที่บันทึกไว้ใน tx log):\n`
    + driftRows.map((r) => `${r.name}: หน้างาน ${r.expectedFloor}→${r.actualFloor} (${r.floorDiff > 0 ? '+' : ''}${r.floorDiff}), substock ${r.expectedSub}→${r.actualSub} (${r.subDiff > 0 ? '+' : ''}${r.subDiff})`).join('\n');
  await db.collection('auditLog').add({ type: 'stock_drift_detected', by: 'ระบบ (ตรวจสอบอัตโนมัติ)', ts: nowMs, note });

  console.error(`\n${driftRows.length} med(s) show unexplained stock drift — see above. Logged to auditLog (visible in AdminScreen's audit log, "สต็อก/ธุรกรรม" filter).`);
  process.exit(1);
}

main().catch((err) => {
  console.error('Stock drift check FAILED:', err);
  process.exit(1);
});
