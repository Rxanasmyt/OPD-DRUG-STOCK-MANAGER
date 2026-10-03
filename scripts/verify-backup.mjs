#!/usr/bin/env node
// Proves — every single day, automatically — that the backup this workflow just produced is
// actually restorable, not just producible. A backup script that runs fine but silently writes
// unusable JSON (wrong field types, permission just enough to read but not write, etc.) would
// otherwise only be discovered the day someone actually needs it — the worst possible time.
//
// What it does: takes ONE real document from EVERY non-empty collection in the backup file (not
// just one collection overall — a round-trip bug specific to, say, `users` or `meta`'s own field
// shapes would never show up if only `meds` ever got sampled), writes a copy of each into a
// scratch collection (`_backupSelfTest`, never touched by the app or by real data), reads every
// one back, and deep-compares every field. If anything doesn't round-trip byte-for-byte, or the
// write/read itself fails (e.g. the service account's write permission was revoked), this exits
// non-zero — which fails the whole GitHub Actions run, which GitHub emails on by default for a
// scheduled workflow. Always cleans up every scratch doc it created, confirm or fail.
//
// Usage: node scripts/verify-backup.mjs <backup-file.json>  (same env var as the other scripts)

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';

function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (typeof a !== 'object') return false;
  const ak = Object.keys(a), bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  return ak.every((k) => deepEqual(a[k], b[k]));
}

async function main() {
  const filePath = process.argv[2];
  if (!filePath) {
    console.error('Usage: node scripts/verify-backup.mjs <backup-file.json>');
    process.exit(1);
  }
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set.');
    process.exit(1);
  }

  const data = JSON.parse(await readFile(filePath, 'utf8'));
  const sampleCollections = Object.keys(data).filter((c) => data[c].length > 0);
  if (!sampleCollections.length) {
    console.log('Backup is entirely empty (no collection has any docs) — nothing to verify a restore of. Not failing on this alone, but check the source project is right.');
    return;
  }
  console.log(`Verifying restorability using 1 sample doc from each of ${sampleCollections.length} non-empty collection(s): ${sampleCollections.join(', ')}...`);

  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  const testRunId = Date.now();
  const refs = [];
  const failures = [];
  try {
    for (const collectionName of sampleCollections) {
      const sample = data[collectionName][0];
      const ref = db.collection('_backupSelfTest').doc(`verify-${testRunId}-${collectionName}`);
      refs.push(ref);
      const { id, ...fields } = sample;
      try {
        await ref.set(fields);
        const readBack = await ref.get();
        if (!readBack.exists) throw new Error('Wrote the test doc but a read-back immediately after found nothing.');
        const roundTripped = readBack.data();
        // Firestore Admin SDK returns Timestamp instances for any ISO string we didn't
        // explicitly convert — our backup file already stores those as plain ISO strings (see
        // backup-firestore.mjs's serialize()), so a straight write of those strings back
        // round-trips as strings too; deepEqual against the original field values is a fair
        // comparison.
        if (!deepEqual(fields, roundTripped)) {
          throw new Error('Round-tripped data does not match the original backup content.\n'
            + `Original:     ${JSON.stringify(fields)}\n`
            + `Round-tripped: ${JSON.stringify(roundTripped)}`);
        }
        console.log(`  ✓ ${collectionName} (id: ${sample.id})`);
      } catch (err) {
        failures.push(`${collectionName}: ${err.message ?? err}`);
        console.log(`  ✗ ${collectionName} (id: ${sample.id})`);
      }
    }
  } finally {
    // Best-effort cleanup — never leave test junk behind, whether every collection passed or not.
    await Promise.all(refs.map((ref) => ref.delete().catch(() => {})));
  }

  if (failures.length) {
    throw new Error(`${failures.length} of ${sampleCollections.length} collection(s) failed to round-trip:\n` + failures.join('\n'));
  }
  console.log(`\n✓ Restore verified: wrote, read back, and byte-for-byte matched 1 real document from all ${sampleCollections.length} non-empty collection(s).`);
}

main().catch((err) => {
  console.error('Backup verification FAILED:', err.message ?? err);
  process.exit(1);
});
