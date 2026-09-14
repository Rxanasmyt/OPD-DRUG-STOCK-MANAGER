#!/usr/bin/env node
// Restores documents from the app's own IN-FIRESTORE safety net — the `_preResetSnapshots`
// collection that AppContext.tsx's snapshotBeforeDelete() writes automatically, right before
// "รีเซ็ตบัตรสต็อกยาทุกตัว" (resetAllStockLedgers) or "รีเซ็ตจำนวนยาทุกตัวเป็น 0"
// (resetAllQuantities) deletes anything. Use this for "someone hit the reset button by mistake"
// — it's faster and more precise than scripts/restore-firestore.mjs (which restores from a full
// daily export that can be up to ~24h stale). For a broader disaster (the whole project lost,
// corrupted, or these snapshot docs themselves are gone), use restore-firestore.mjs instead.
//
// SAFETY: dry run by default — pass --confirm to actually write. Every write is `set()` with
// merge:false for a deleted doc (txs, lots) or `update()` for the meds floor snapshot (only
// touches the fields that were actually snapshotted: floor/lastCountTs/lastSubCountTs — never
// clobbers name/code/par/bin/price/etc.).
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" \
//     node scripts/restore-preresetsnapshot.mjs --list
//     (shows every snapshot label/timestamp available to restore from)
//
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" \
//     node scripts/restore-preresetsnapshot.mjs --label=txs-1757000000000 --confirm

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const BATCH_LIMIT = 450;
const COLLECTION = '_preResetSnapshots';

// label prefixes written by snapshotBeforeDelete() -> which real collection docs restore to,
// and how (txs/lots docs were about to be DELETED, so restoring them is a plain set(); the
// meds-floor snapshot only ever touched floor/lastCountTs/lastSubCountTs, so restoring it is a
// merge update() of just those fields, never anything else about the med).
const TARGETS = {
  txs: { collection: 'txs', mode: 'set' },
  lots: { collection: 'lots', mode: 'set' },
  'meds-floor': { collection: 'meds', mode: 'merge' },
};

function targetFor(label) {
  const prefix = Object.keys(TARGETS).find((p) => label.startsWith(`${p}-`));
  if (!prefix) throw new Error(`Unrecognized snapshot label "${label}" — expected one of: ${Object.keys(TARGETS).join(', ')}`);
  return TARGETS[prefix];
}

async function main() {
  const args = process.argv.slice(2);
  const confirm = args.includes('--confirm');
  const list = args.includes('--list');
  const labelArg = args.find((a) => a.startsWith('--label='));

  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set.');
    process.exit(1);
  }
  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  const snap = await db.collection(COLLECTION).orderBy('createdAt', 'desc').get();

  if (list || !labelArg) {
    if (!snap.size) {
      console.log('No pre-reset snapshots found — nothing has triggered snapshotBeforeDelete() yet.');
      return;
    }
    console.log('Available snapshot chunks (group by the part before the last "-<index>"):\n');
    for (const d of snap.docs) {
      const data = d.data();
      console.log(`  ${d.id}  —  label=${data.label}  chunk=${data.chunkIndex + 1}/${data.totalChunks}  docs=${data.docs.length}  createdBy=${data.createdBy}  at=${data.createdAt?.toDate?.().toISOString() ?? '?'}`);
    }
    console.log('\nPass --label=<label-timestamp> (the part before "-<chunkIndex>", e.g. "txs-1757000000000") to restore all chunks sharing that label + timestamp.');
    return;
  }

  const label = labelArg.slice('--label='.length);
  const target = targetFor(label);
  const chunks = snap.docs.filter((d) => d.id.startsWith(`${label}-`));
  if (!chunks.length) {
    console.error(`No snapshot chunks found for label "${label}". Run with --list to see what's available.`);
    process.exit(1);
  }

  const allRows = chunks.flatMap((d) => d.data().docs);
  console.log(confirm ? 'RESTORING (writes are live)' : 'DRY RUN (pass --confirm to actually write)');
  console.log(`Label: ${label}  ->  ${target.collection} (${target.mode})  —  ${allRows.length} docs across ${chunks.length} chunk(s)\n`);

  if (!confirm) {
    console.log('Would restore:', allRows.map((r) => r.id).join(', '));
    console.log('\nRe-run with --confirm to actually write these.');
    return;
  }

  for (let i = 0; i < allRows.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const row of allRows.slice(i, i + BATCH_LIMIT)) {
      const ref = db.collection(target.collection).doc(row.id);
      if (target.mode === 'merge') batch.set(ref, row.data, { merge: true });
      else batch.set(ref, row.data);
    }
    await batch.commit();
  }
  console.log(`Restored ${allRows.length} docs into ${target.collection}.`);
}

main().catch((err) => {
  console.error('Restore failed:', err);
  process.exit(1);
});
