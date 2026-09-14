#!/usr/bin/env node
// Firestore backup script — dumps every top-level collection this app uses to a single JSON
// file. This is the free-tier (Spark plan) alternative to Firestore's built-in Scheduled
// Backups feature, which requires the Blaze billing plan. Reads only — never writes anything
// back to Firestore. The read cost is trivial (a handful of reads per collection per run) and
// stays well inside Spark's free 50,000-reads/day quota for an app this size.
//
// Run automatically every day by .github/workflows/firestore-backup.yml (see that file for the
// one-time GitHub secret setup). To run locally instead:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/backup-firestore.mjs
//
// Output: backups/firestore-backup-<UTC timestamp>.json — one JSON object keyed by collection
// name, each value an array of `{ id, ...fields }`. Firestore Timestamp fields are serialized
// to ISO 8601 strings so the file is plain, portable JSON (no Firestore-specific types).
//
// To restore a file this script produced, see scripts/restore-firestore.mjs.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { writeFile, mkdir } from 'node:fs/promises';

// Every top-level collection this app reads/writes — see firestore.rules for the same list.
const COLLECTIONS = ['meds', 'lots', 'txs', 'auditLog', 'users', 'usernames', 'pendingReceives', 'meta'];

function serialize(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

async function main() {
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error(
      'FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See this file\'s header comment for how to run it.'
    );
    process.exit(1);
  }

  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  console.log(`Backing up ${COLLECTIONS.length} collections from project "${serviceAccount.project_id}"...`);

  const out = {};
  let totalDocs = 0;
  for (const name of COLLECTIONS) {
    const snap = await db.collection(name).get();
    out[name] = snap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) }));
    totalDocs += out[name].length;
    console.log(`  ${name}: ${out[name].length} docs`);
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir('backups', { recursive: true });
  const file = `backups/firestore-backup-${stamp}.json`;
  await writeFile(file, JSON.stringify(out, null, 2), 'utf8');
  console.log(`\nWrote ${file} (${totalDocs} docs total).`);
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
