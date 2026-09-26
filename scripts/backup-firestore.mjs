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
import { writeFile, mkdir, appendFile } from 'node:fs/promises';

// Every top-level collection this app reads/writes — see firestore.rules for the same list.
// Bug fix: 'dailyMetrics' (one doc/day, written by collect-daily-metrics.mjs, read by the
// "📅 ตัวชี้วัดย้อนหลัง" KPI report tab) was missing from this list. Unlike meds/lots/txs —
// which can all be reconstructed from txs history — a dailyMetrics doc's stock-snapshot
// fields are computed "as of script run time" and can never be recomputed for a past date
// once that day is gone, so a gap here meant months of KPI trend history had no backup at
// all, with nothing in this script or verify-backup.mjs ever indicating the gap.
// Bug fix: same class of gap as dailyMetrics before it — _preResetSnapshots (AppContext.tsx's
// snapshotBeforeDelete(), the last-resort recovery layer resetAllStockLedgers()/
// resetAllQuantities() write before wiping data) was missing from this list, meaning the one
// safety net a go-live reset relies on wasn't in the daily backup either.
const COLLECTIONS = ['meds', 'lots', 'txs', 'auditLog', 'users', 'usernames', 'pendingReceives', 'meta', 'dailyMetrics', '_preResetSnapshots'];

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

  // Lets the calling workflow step reference this exact file without guessing/globbing the
  // timestamp back apart (see .github/workflows/firestore-backup.yml's "verify" step).
  if (process.env.GITHUB_OUTPUT) {
    await appendFile(process.env.GITHUB_OUTPUT, `file=${file}\n`, 'utf8');
  }
}

main().catch((err) => {
  console.error('Backup failed:', err);
  process.exit(1);
});
