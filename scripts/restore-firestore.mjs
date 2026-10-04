#!/usr/bin/env node
// Restores a JSON file produced by scripts/backup-firestore.mjs back into Firestore. Actually
// WRITING with this (passing --confirm) is a deliberately manual, explicit action — that only
// ever happens because a person ran it on purpose, after something has gone wrong, never from a
// GitHub Actions workflow. firestore-backup.yml DOES invoke this script itself every day, but
// always in its default dry-run mode (no --confirm, so zero writes) against that day's own
// backup file — proving the script itself still runs end-to-end (parses the file, validates
// every row's shape, walks every collection) well before anyone needs it for a real restore. See
// verify-backup.mjs for the complementary check (that a sample doc genuinely round-trips through
// Firestore), which this script's own dry run does not attempt on its own.
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
  console.log(`Source file: ${filePath}`);
  // Bug fix (operational safety): this used to print the file path and nothing else about it —
  // an operator who tab-completes or pastes the WRONG dated backup during a real incident (e.g.
  // last week's file instead of today's) got no signal at all that the source is stale, and
  // every write here is set()/overwrite for any doc id the backup shares with live data. Every
  // real backup file this repo's own backup-firestore.mjs produces embeds its UTC creation time
  // in the filename (firestore-backup-<UTC timestamp>.json) — parsing it back out and printing
  // how old it is turns a silent trap into a hard-to-miss warning before any write happens.
  const stampMatch = filePath.match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/);
  if (stampMatch) {
    const [, datePart, hh, mm, ss, ms] = stampMatch;
    const backupTime = new Date(`${datePart}T${hh}:${mm}:${ss}.${ms}Z`);
    const ageHours = (Date.now() - backupTime.getTime()) / 3600000;
    const ageLabel = ageHours < 48 ? `${ageHours.toFixed(1)} hours` : `${(ageHours / 24).toFixed(1)} days`;
    console.log(`Backup age: ${ageLabel} old (created ${backupTime.toISOString()})`);
    if (ageHours > 24) {
      console.log(`\n⚠️  WARNING: this backup is over a day old. Restoring it will OVERWRITE any newer\n`
        + `   live data for every doc id the backup shares with the current database — including\n`
        + `   real transactions/stock changes made since ${backupTime.toISOString()}. Make sure this\n`
        + `   is really the file you meant to restore before passing --confirm.\n`);
    }
  } else {
    console.log('Backup age: unknown (filename doesn\'t match the expected firestore-backup-<UTC timestamp>.json pattern — double-check this is really the intended file).');
  }
  console.log('');

  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  // Bug fix (operational safety): this script had ZERO automated coverage before — a dry run
  // only ever parsed the JSON and printed counts, so a real bug in the actual write logic below
  // (a bad arg, a row shape this version of the Admin SDK rejects, a doc id that isn't a valid
  // Firestore id) would stay invisible until the one day someone runs this for real during an
  // actual incident, --confirm and all. Validating every row's `id` here — unconditionally, dry
  // run included — exercises the exact same `{ id, ...fields } = row` destructuring the real
  // write loop below uses, so a malformed backup file (or a future change to backup-firestore.mjs
  // that stops writing `id`) gets caught by firestore-backup.yml's own daily dry-run step (see
  // that workflow) well before anyone needs this script in anger.
  let totalDocs = 0;
  const malformedRows = [];
  for (const name of collections) {
    const rows = data[name];
    for (const row of rows) {
      if (typeof row.id !== 'string' || !row.id) malformedRows.push(`${name}/${JSON.stringify(row.id)}`);
    }
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

  if (malformedRows.length) {
    throw new Error(`${malformedRows.length} row(s) have no valid string "id" field and cannot be restored (collection/id): ${malformedRows.slice(0, 10).join(', ')}${malformedRows.length > 10 ? ', ...' : ''}`);
  }

  console.log(`\n${confirm ? 'Restored' : 'Would restore'} ${totalDocs} docs across ${collections.length} collections.`);
  if (!confirm) console.log('Re-run with --confirm to actually write these.');
}

main().catch((err) => {
  console.error('Restore failed:', err);
  process.exit(1);
});
