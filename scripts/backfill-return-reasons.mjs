#!/usr/bin/env node
// One-time migration for a real request: "ช่วยทำให้เลย" (ตามคำขอก่อนหน้า: "ดึงรายงานการคืนยา
// ยังไม่มีข้อมูลเหตุผลในการคืนยา"). v3.131.0 fixed commitAdjust (AppContext.tsx) to start saving
// the selected return reason onto the durable `returns` collection doc the report actually reads
// from — but every `returns` doc written BEFORE that fix has no `reason` field at all, even for a
// return where a reason really was picked at the time. That selection was never lost though: it
// was always written to the generic `txs` audit log (Tx.reason) in the SAME transaction as the
// `returns` doc, just never copied onto the returns record itself. This script recovers it from
// there.
//
// Matching: a `returns` doc and its sibling `txs` row (type:'return') are written inside the
// exact same Firestore transaction, so they share an identical medId + ts (millisecond-precision)
// + qty + by — a very low collision-risk composite key. Only applies a backfill when that key
// matches EXACTLY ONE txs row and EXACTLY ONE returns doc; anything ambiguous (more than one
// candidate either direction) is skipped and reported rather than guessed at.
//
// `returns` docs disallow client-side update/delete entirely (firestore.rules) — only the Admin
// SDK (which bypasses rules) can write this backfill, hence a script here rather than an in-app
// admin action.
//
// SAFETY: dry run by default — pass --confirm to actually write.
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/backfill-return-reasons.mjs
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/backfill-return-reasons.mjs --confirm

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const BATCH_LIMIT = 450;

function matchKey(d) {
  return [d.medId, d.ts, d.qty, d.by].join('|');
}

async function main() {
  const confirm = process.argv.includes('--confirm');

  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See this file\'s header comment for how to run it.');
    process.exit(1);
  }
  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  console.log(confirm ? 'BACKFILLING (writes are live)' : 'DRY RUN (pass --confirm to actually write)');
  console.log(`Project: ${serviceAccount.project_id}\n`);

  const [returnsSnap, txsSnap] = await Promise.all([
    db.collection('returns').get(),
    db.collection('txs').where('type', '==', 'return').get(),
  ]);

  // Group txs candidates by key so an ambiguous match (more than one txs row sharing the exact
  // same medId+ts+qty+by) is detectable rather than silently picking one.
  const txsByKey = new Map();
  for (const doc of txsSnap.docs) {
    const d = doc.data();
    if (!d.medId || typeof d.reason !== 'string' || !d.reason) continue; // nothing usable to backfill from
    const key = matchKey(d);
    if (!txsByKey.has(key)) txsByKey.set(key, []);
    txsByKey.get(key).push(d);
  }

  // Same ambiguity check the other direction: more than one `returns` doc sharing the exact
  // same key must also be skipped (ties broken by reading no further context is worse than no
  // backfill at all for either of them).
  const returnsByKey = new Map();
  const missingReason = [];
  for (const doc of returnsSnap.docs) {
    const d = doc.data();
    if (typeof d.reason === 'string' && d.reason) continue; // already has one — nothing to do
    missingReason.push(doc);
    const key = matchKey(d);
    if (!returnsByKey.has(key)) returnsByKey.set(key, []);
    returnsByKey.get(key).push(doc);
  }

  console.log(`returns docs missing a reason: ${missingReason.length} (of ${returnsSnap.size} total)`);

  let updates = [];
  let skippedNoMatch = 0;
  let skippedAmbiguous = 0;
  for (const doc of missingReason) {
    const d = doc.data();
    const key = matchKey(d);
    const txCandidates = txsByKey.get(key) || [];
    const returnCandidatesAtKey = returnsByKey.get(key) || [];
    if (txCandidates.length === 0) { skippedNoMatch++; continue; }
    if (txCandidates.length > 1 || returnCandidatesAtKey.length > 1) { skippedAmbiguous++; continue; }
    updates.push({ id: doc.id, reason: txCandidates[0].reason, medName: d.medName, date: d.date });
  }

  console.log(`  matched (will backfill): ${updates.length}`);
  console.log(`  no matching txs row found: ${skippedNoMatch}`);
  console.log(`  ambiguous (more than one candidate either direction) — skipped: ${skippedAmbiguous}\n`);

  if (!updates.length) {
    console.log('Nothing to backfill.');
    return;
  }

  if (!confirm) {
    console.log('Would update:');
    for (const u of updates) console.log(`  returns/${u.id}  (${u.date}  ${u.medName})  ->  reason: "${u.reason}"`);
    console.log('\nRe-run with --confirm to actually write these.');
    return;
  }

  for (let i = 0; i < updates.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + BATCH_LIMIT)) {
      batch.update(db.collection('returns').doc(u.id), { reason: u.reason });
    }
    await batch.commit();
  }
  console.log(`Backfilled ${updates.length} returns doc(s).`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
