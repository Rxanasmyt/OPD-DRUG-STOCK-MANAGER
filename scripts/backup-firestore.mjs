#!/usr/bin/env node
// Firestore backup script — dumps every top-level collection this app uses to a single JSON
// file. This is the free-tier (Spark plan) alternative to Firestore's built-in Scheduled
// Backups feature, which requires the Blaze billing plan. Reads only — never writes anything
// back to Firestore.
//
// Run automatically every day by .github/workflows/firestore-backup.yml (see that file for the
// one-time GitHub secret setup, and its own comment on the separate private repo this script
// reads/writes via --state-dir/--out-dir). To run locally instead:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/backup-firestore.mjs
//
// Output: <outDir>/firestore-backup-<UTC timestamp>.json (outDir defaults to 'backups', see
// --out-dir= below) — one JSON object keyed by collection name, each value an array of
// `{ id, ...fields }`. Firestore Timestamp fields are serialized to ISO 8601 strings so the file
// is plain, portable JSON (no Firestore-specific types). This file is always a COMPLETE,
// self-sufficient snapshot of every collection — restore-firestore.mjs needs no awareness of how
// it was produced, incrementally or not.
//
// Flags (both optional, both unset = old full-backup-into-this-repo behavior):
//   --state-dir=<path>  directory the incremental cursor state for txs/auditLog lives in/is
//                        written to across runs. Without it, every run is a full read of those
//                        two collections too (same as before this flag existed).
//   --out-dir=<path>    directory the final backup JSON file is written into. Defaults to
//                        'backups' (relative to cwd).
//
// To restore a file this script produced, see scripts/restore-firestore.mjs.

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore, Timestamp } from 'firebase-admin/firestore';
import { readFile, writeFile, mkdir, appendFile } from 'node:fs/promises';

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
// Bug fix (found during a Firestore-quota health check — comparing this list against every
// `match /{collection}/{id}` block in firestore.rules, the actual source of truth for what
// collections this app has): FOUR more real, actively-written collections were missing
// entirely — from both FULL_COLLECTIONS and INCREMENTAL_COLLECTIONS below, with nothing in this
// script or verify-backup.mjs ever indicating the gap (same silent-gap shape as the two fixes
// above). A restore from this backup would have come back with each of these simply absent:
//   - 'floorLots' — the per-shelf floor stock lots commitReconcile()/commitTransfer()/
//     scrapFloorLot() read and write (firestore.rules' `match /floorLots/{lotId}`, right
//     alongside `lots`). Mutated in place (qty decrements on every dispense/scrap), not
//     append-only, and its already-FEFO-allocated batch/expiry detail isn't reconstructable
//     from txs the way a med's own floor total is — has to be a full read, like `lots`.
//   - 'parAdjustments' — one row per manual/bulk par-suggestion adjustment (applyOnePar/
//     applyAllSuggested). Create-only in the rules, but its own timestamp field is
//     `adjustedAt`, not `ts` — doesn't fit the generic `ts`-based incremental loop below as-is,
//     and manual par adjustments are infrequent enough that a full read costs nothing.
//   - 'usageHistory' — one row per usage-import action (commitUsageImport). Same shape as
//     parAdjustments: create-only, but keyed by `importedAt` not `ts`, and low-volume (imports
//     happen occasionally, not per-med-per-day) — full read.
//   - 'whRequestRounds' — one doc PER CATEGORY (เม็ด/น้ำ/ฉีด/ภายนอก — see Med.reqCategory),
//     updated in place each time that category's warehouse request round is (re)printed.
//     Mutable and tiny (a handful of docs total) — full read, same as `meta`.
const FULL_COLLECTIONS = ['meds', 'lots', 'floorLots', 'users', 'usernames', 'pendingReceives', 'meta', 'dailyMetrics', '_preResetSnapshots', 'parAdjustments', 'usageHistory', 'whRequestRounds'];

// Bug fix (Firestore quota incident, real-world report: "วันนี้ก็ถึง limit firestore...แก้ยังไงดี
// ครับปัญหาซ้ำซาก" — follow-up after the intraday-metrics.yml cadence fix): Google Cloud's own
// Query Insights showed a plain, unfiltered `/txs` collection read as the single largest and
// still-GROWING read cost in the whole project — this script's full daily `.get()` on `txs`
// (and `auditLog`, same shape). Both collections are genuinely append-only (firestore.rules:
// `allow update: if false` on txs, `allow update, delete: if false` on auditLog — nothing in the
// app ever edits or removes a row once written), which makes them the one case where reading
// "only what changed since last time" is both SAFE (no in-place edits to miss) and valuable (the
// read cost otherwise grows forever with this hospital's lifetime transaction history, unlike
// every other collection here which stays roughly bounded in size). See loadIncrementalState()/
// the main incremental-merge loop below for how; see firestore-backup.yml's own comment for
// where the merged state actually lives across runs (a separate, private backup repo — this
// script itself has no opinion on that, it just reads/writes whatever directory --state-dir
// points at).
//
// Bug fix (same health-check as FULL_COLLECTIONS' comment above): 'returns' — one row per
// patient/ward medication return (commitSingleReturn/commitReturnCart) — was missing from the
// backup entirely, but unlike parAdjustments/usageHistory above, it fits this incremental loop
// with ZERO new code: it's create-only in firestore.rules (`allow update, delete: if false`,
// same guarantee as txs/auditLog) AND already uses the exact same `ts: number` field name this
// loop already filters/tracks on. Returns are routine enough in a hospital (unlike the
// infrequent, human-initiated parAdjustments/usageHistory) that this collection can plausibly
// keep growing for this hospital's whole lifetime the same way txs/auditLog do — worth the
// incremental treatment from day one instead of waiting for its own future quota incident.
const INCREMENTAL_COLLECTIONS = ['txs', 'auditLog', 'returns'];

// A deliberately generous overlap re-read window, not a tight cutoff: `ts` is a CLIENT-set
// timestamp (Date.now() at write time — see firestore.rules' txs/auditLog create rules), not a
// server-assigned one, so it's only ever approximately monotonic with real write order. A device
// with a clock running a few minutes (or, worst case, hours) behind could write a row whose `ts`
// lands BEFORE rows this script already considers "seen" — a plain `where('ts', '>', lastTs)`
// would silently and PERMANENTLY miss that row (it can never satisfy a strictly-increasing cutoff
// in any future run either). Re-reading the last 6 hours of every run instead of just "since last
// run" costs a handful of extra reads (one hospital's worth of transactions in 6h, not its whole
// history) in exchange for closing that gap for any realistic clock skew — rows re-read this way
// simply overwrite their own already-identical entry in the merge below (txs/auditLog rows never
// change after creation, so this is always a no-op in practice, just a safety margin).
const INCREMENTAL_OVERLAP_MS = 6 * 60 * 60 * 1000;

function serialize(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}

// Reads this collection's PREVIOUSLY merged state (every row this script has ever seen for it,
// as of the last run that had a --state-dir to persist into) — or an empty array when there is
// none yet (no --state-dir given, the directory/file doesn't exist yet, or it's unreadable/
// corrupt). An empty result isn't an error case to special-case further down: it just means the
// incremental query below computes lastTs=0, i.e. "read everything" — the exact same one-time
// full read this script always did, correctly establishing the baseline a real --state-dir can
// then build on for every run after.
async function loadIncrementalState(stateDir, name) {
  if (!stateDir) return [];
  try {
    const raw = await readFile(`${stateDir}/${name}.json`, 'utf8');
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

async function main() {
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error(
      'FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See this file\'s header comment for how to run it.'
    );
    process.exit(1);
  }
  const stateDirArg = process.argv.find((a) => a.startsWith('--state-dir='));
  const stateDir = stateDirArg ? stateDirArg.slice('--state-dir='.length) : null;
  // Lets firestore-backup.yml write the final backup file straight into the checked-out
  // private backup repo's working tree (see that workflow for why: backups/txs/auditLog now
  // live there, not as a public-repo Actions artifact — see this file's own header comment).
  // Defaults to 'backups' (this repo) so a local/manual run behaves exactly as before.
  const outDirArg = process.argv.find((a) => a.startsWith('--out-dir='));
  const outDir = outDirArg ? outDirArg.slice('--out-dir='.length) : 'backups';

  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  const allNames = [...FULL_COLLECTIONS, ...INCREMENTAL_COLLECTIONS];
  console.log(`Backing up ${allNames.length} collections from project "${serviceAccount.project_id}"${stateDir ? ' (incremental state: ' + stateDir + ')' : ' (no --state-dir — every run will be a full read)'}...`);

  const out = {};
  let totalDocs = 0;
  for (const name of FULL_COLLECTIONS) {
    const snap = await db.collection(name).get();
    out[name] = snap.docs.map((d) => ({ id: d.id, ...serialize(d.data()) }));
    totalDocs += out[name].length;
    console.log(`  ${name}: ${out[name].length} docs (full read)`);
  }

  for (const name of INCREMENTAL_COLLECTIONS) {
    const existing = await loadIncrementalState(stateDir, name);
    const lastTs = existing.reduce((max, row) => (typeof row.ts === 'number' && row.ts > max ? row.ts : max), 0);
    const cutoff = Math.max(0, lastTs - INCREMENTAL_OVERLAP_MS);
    const snap = await db.collection(name).where('ts', '>=', cutoff).get();
    const byId = new Map(existing.map((row) => [row.id, row]));
    for (const d of snap.docs) byId.set(d.id, { id: d.id, ...serialize(d.data()) });
    const merged = Array.from(byId.values());
    out[name] = merged;
    totalDocs += merged.length;
    console.log(`  ${name}: ${merged.length} docs total (${snap.size} read this run${stateDir ? ', incremental' : ', full — pass --state-dir to make this incremental'})`);
    if (stateDir) {
      await mkdir(stateDir, { recursive: true });
      await writeFile(`${stateDir}/${name}.json`, JSON.stringify(merged), 'utf8');
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await mkdir(outDir, { recursive: true });
  const file = `${outDir}/firestore-backup-${stamp}.json`;
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
