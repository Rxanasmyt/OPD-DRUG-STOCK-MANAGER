#!/usr/bin/env node
// Restores a JSON file produced by scripts/backup-firestore.mjs back into Firestore. This is a
// deliberately manual, explicit tool — it is NEVER run by any GitHub Actions workflow, only by
// a person, on purpose, after something has gone wrong.
//
// SAFETY: by default this only PRINTS what it would do (a dry run) — it writes nothing until
// you pass --confirm. Every write is `set()` with merge:false, i.e. it OVERWRITES whatever
// currently exists at that document id with exactly what the backup file has. Restoring into a
// database that already has newer data will destroy that newer data for any doc id present in
// the backup file. Prefer restoring into a fresh/empty database (or a specific collection with
// --only=) over restoring on top of a live one.
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" \
//     node scripts/restore-firestore.mjs backups/firestore-backup-2026-09-14T02-00-00-000Z.json
//
//   Add --confirm to actually write (otherwise it's a dry run that only logs counts).
//   Add --only=meds,lots to restore just those collections instead of everything in the file.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFile } from 'node:fs/promises';

const BATCH_LIMIT = 450; // Firestore's hard cap is 500 writes per batch commit.

async function main() {
  const args = process.argv.slice(2);
  const filePath = args.find((a) => !a.startsWith('--'));
  const confirm = args.includes('--confirm');
  const onlyArg = args.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null;

  if (!filePath) {
    console.error('Usage: node scripts/restore-firestore.mjs <backup-file.json> [--confirm] [--only=meds,lots]');
    process.exit(1);
  }
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set.');
    process.exit(1);
  }

  const data = JSON.parse(await readFile(filePath, 'utf8'));
  const collections = Object.keys(data).filter((c) => !only || only.includes(c));

  if (!collections.length) {
    console.error('Nothing to restore (check --only= against the collections actually in the file).');
    process.exit(1);
  }

  console.log(confirm ? 'RESTORING (writes are live)' : 'DRY RUN (pass --confirm to actually write)');
  console.log(`Source file: ${filePath}\n`);

  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  let totalDocs = 0;
  for (const name of collections) {
    const rows = data[name];
    console.log(`  ${name}: ${rows.length} docs${confirm ? ' — writing...' : ''}`);
    totalDocs += rows.length;
    if (!confirm) continue;

    for (let i = 0; i < rows.length; i += BATCH_LIMIT) {
      const batch = db.batch();
      for (const row of rows.slice(i, i + BATCH_LIMIT)) {
        const { id, ...fields } = row;
        batch.set(db.collection(name).doc(id), fields);
      }
      await batch.commit();
    }
  }

  console.log(`\n${confirm ? 'Restored' : 'Would restore'} ${totalDocs} docs across ${collections.length} collections.`);
  if (!confirm) console.log('Re-run with --confirm to actually write these.');
}

main().catch((err) => {
  console.error('Restore failed:', err);
  process.exit(1);
});
