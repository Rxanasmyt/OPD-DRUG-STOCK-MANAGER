#!/usr/bin/env node
// One-off diagnostic — NOT run on a schedule, no scheduled workflow owns this (unlike every
// other script in this directory). Added live, 2026-10-30, to investigate a real recurring
// production incident: commitReconcile() (src/store/AppContext.tsx) throwing permission-denied
// on its real floor-deduction transaction itself — the one that should always be safe (~3-5
// Firestore rules get()-budget units, nowhere near the 20-per-transaction ceiling; see
// commitReconcile's own FEFO_LOT_CAP comment for that mechanism) — on a DIFFERENT, seemingly
// unrelated drug almost every retry (10 mg. AMLODIPINE, Adenosine 3 mg/ml Vial, 20 mg.ENALAPRIL
// 20 MG เม็ด, all reported live by the hospital pharmacist running this app). v3.228.0/v3.235.0
// already closed the two budget/write-rejection-coupling mechanisms found so far; this keeps
// recurring, on different meds each time, which doesn't fit either of those triggers.
//
// No live access to this project's real Firestore data exists inside the coding session that
// found this bug (network-restricted sandbox) — this script is how that session gets real
// evidence instead of guessing again. Dumps the RAW stored document for each named med (every
// field, its actual JS type, not just what the app's own TypeScript types assume it is) so a
// genuine data-integrity mismatch against what firestore.rules' update rule for `meds` requires
// (see its own `isNonNegNum`/`is number`/`is string` checks) would be visible directly, plus a
// couple of auth/project sanity checks that could explain a RANDOM (not document-specific)
// failure instead.
//
// Usage: FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node
//   scripts/diagnose-reconcile-failure.mjs "10 mg. AMLODIPINE" "Adenosine" "20 mg.ENALAPRIL"
// (partial, case-insensitive name match against every med's `name` field — the exact strings
// from the error toasts work directly, no need to find the medId first.)

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

function describeValue(v) {
  if (v === undefined) return '(field absent)';
  if (v === null) return 'null';
  if (v && typeof v === 'object' && typeof v.toDate === 'function') return `Firestore Timestamp (${v.toDate().toISOString()}) — NOT a plain number!`;
  if (Array.isArray(v)) return `array[${v.length}]`;
  return `${typeof v} = ${JSON.stringify(v)}`;
}

async function main() {
  const names = process.argv.slice(2);
  if (!names.length) {
    console.error('Usage: node scripts/diagnose-reconcile-failure.mjs "<drug name or partial name>" [more names...]');
    process.exit(1);
  }
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See this file\'s header comment for how to run it.');
    process.exit(1);
  }
  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  console.log(`Diagnosing reconcile-failure meds (project "${serviceAccount.project_id}")...\n`);

  const medsSnap = await db.collection('meds').get();
  const allMeds = medsSnap.docs.map((d) => ({ id: d.id, ref: d.ref, data: d.data() }));
  console.log(`Loaded ${allMeds.length} meds total.\n`);

  for (const needle of names) {
    const lower = needle.toLowerCase();
    const matches = allMeds.filter((m) => (m.data.name || '').toLowerCase().includes(lower));
    console.log(`=== Searching for "${needle}" — ${matches.length} match(es) ===`);
    if (!matches.length) {
      console.log('  (no med name contains this string — check spelling/encoding, or it may have been renamed/deleted since the error.)\n');
      continue;
    }
    for (const m of matches) {
      console.log(`  medId: ${m.id}`);
      console.log(`  name: ${m.data.name}`);
      // The exact fields firestore.rules' `allow update` floor-only branch for `meds` checks —
      // see firestore.rules lines ~175-230 (the `isActive() && diff(...).affectedKeys().hasOnly(
      // ['floor','lastCountTs','lastSubCountTs']) && isNonNegNum(floor) && ...` branch
      // commitReconcile's `trx.update(ref, {floor: after})` must satisfy). A field present with
      // the WRONG type (most plausibly a Firestore Timestamp instead of a plain number, from
      // some historical write path predating a type-safety fix) would make this exact check fail
      // with permission-denied, for ONLY that one med, regardless of budget.
      console.log(`  floor: ${describeValue(m.data.floor)}`);
      console.log(`  lastCountTs: ${describeValue(m.data.lastCountTs)}`);
      console.log(`  lastSubCountTs: ${describeValue(m.data.lastSubCountTs)}`);
      console.log(`  active: ${describeValue(m.data.active)}`);
      console.log(`  mergedInto: ${describeValue(m.data.mergedInto)}`);
      // Every other field, so nothing stored on this doc is invisible to this report.
      const known = new Set(['name', 'floor', 'lastCountTs', 'lastSubCountTs', 'active', 'mergedInto']);
      const extraKeys = Object.keys(m.data).filter((k) => !known.has(k));
      console.log(`  other fields: ${extraKeys.map((k) => `${k}=${describeValue(m.data[k])}`).join(', ') || '(none)'}`);
      console.log('');
    }
  }

  // Sanity-checks unrelated to any one med's data — a RANDOM-seeming failure (a different drug
  // each retry, as reported) fits a project-wide or auth-related cause at least as well as a
  // per-document one, so rule those out too rather than assuming the per-med data dump above is
  // the whole story.
  console.log('=== Project-level sanity checks ===');
  try {
    const usersSnap = await db.collection('users').get();
    console.log(`users collection: ${usersSnap.size} doc(s) total.`);
    for (const d of usersSnap.docs) {
      const u = d.data();
      console.log(`  ${d.id}: active=${describeValue(u.active)}, role=${describeValue(u.role)}, name=${describeValue(u.name)}`);
    }
  } catch (e) {
    console.log(`Could not read users collection: ${e.message}`);
  }
}

main().catch((err) => {
  console.error('Diagnostic script FAILED:', err);
  process.exit(1);
});
