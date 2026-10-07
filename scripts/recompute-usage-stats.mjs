#!/usr/bin/env node
// Real-world request: "วิเคราะห์ระบบ Min Max...ให้เหมาะกับการใช้งานหน้างานจริง" — used30/usedPrev30
// (the ONLY inputs suggestPar()'s whole Min/Max/par substock calculation reads — see
// src/store/selectors.ts) used to be recomputed from real HOSxP dispensing history purely by a
// manual "คำนวณสถิติการใช้ใหม่จากประวัติ HOSxP ↺" button in SettingsScreen (AppContext.tsx's
// recomputeUsageStats()) — if nobody remembered to click it, every par suggestion in the app kept
// aging off whatever usage rate happened to be on record, with no signal anywhere that it had
// gone stale. This script is the exact same aggregation, run automatically every day instead of
// depending on a person remembering a button — the manual button still exists (useful right after
// a big HOSxP catch-up import), this just means par suggestions never go more than a day stale on
// their own.
//
// Hand-kept in sync with recomputeUsageStats() (src/store/AppContext.tsx) — same dupNames OPD/IPD
// disambiguation, same 30/60-day bucketing, same "only negative (dispensed) reconcile_hosxp
// entries count" filter. If that function's logic changes, update here too (same convention every
// other script in this directory already follows for its in-app counterpart).
//
// Run automatically every day by .github/workflows/recompute-usage-stats.yml. To run locally:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/recompute-usage-stats.mjs

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const DAY = 24 * 60 * 60 * 1000;

async function main() {
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See this file\'s header comment for how to run it.');
    process.exit(1);
  }
  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  console.log(`Recomputing usage stats (project "${serviceAccount.project_id}")...`);

  const [medsSnap, txSnap] = await Promise.all([
    db.collection('meds').get(),
    db.collection('txs').where('type', '==', 'reconcile_hosxp').get(),
  ]);
  const meds = medsSnap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const now = Date.now();

  // Same OPD/IPD name-twin hazard as the in-app version — aggregating by name alone would sum
  // both wards' dispensing into one number and write that same (wrong) total onto both copies.
  const dupNames = new Set();
  const seenNames = new Set();
  for (const m of meds) {
    if (seenNames.has(m.name)) dupNames.add(m.name);
    seenNames.add(m.name);
  }

  const curByName = {};
  const prevByName = {};
  const curById = {};
  const prevById = {};
  for (const d of txSnap.docs) {
    const x = d.data();
    if (!x.name || typeof x.qty !== 'number' || x.qty >= 0 || typeof x.ts !== 'number') continue; // only dispensed (negative) entries
    const ageDays = (now - x.ts) / DAY;
    if (ageDays < 0) continue;
    const bucket = ageDays <= 30 ? 30 : ageDays <= 60 ? 60 : 0;
    if (!bucket) continue;
    if (dupNames.has(x.name)) {
      if (!x.medId) continue;
      const map = bucket === 30 ? curById : prevById;
      map[x.medId] = (map[x.medId] || 0) + Math.abs(x.qty);
    } else {
      const map = bucket === 30 ? curByName : prevByName;
      map[x.name] = (map[x.name] || 0) + Math.abs(x.qty);
    }
  }

  const targets = meds.filter((m) => m.active);
  let batch = db.batch();
  let opsInBatch = 0;
  let written = 0;
  for (const m of targets) {
    const used30 = dupNames.has(m.name) ? (curById[m.id] || 0) : (curByName[m.name] || 0);
    const usedPrev30 = dupNames.has(m.name) ? (prevById[m.id] || 0) : (prevByName[m.name] || 0);
    batch.update(db.collection('meds').doc(m.id), { used30: Math.round(used30), usedPrev30: Math.round(usedPrev30) });
    opsInBatch++;
    written++;
    if (opsInBatch >= 400) {
      await batch.commit();
      batch = db.batch();
      opsInBatch = 0;
    }
  }
  if (opsInBatch > 0) await batch.commit();

  // Same shared meta/settings doc expiryWarnDays/parFloorCoverDays/parSubCoverDays already live
  // in (see AppContext.tsx) — SettingsScreen reads this to warn when the numbers behind every par
  // suggestion are stale, so it needs updating here too, not just by the in-app manual button.
  await db.collection('meta').doc('settings').set({ usageStatsRecomputedAt: now }, { merge: true });

  console.log(`✓ Recomputed used30/usedPrev30 for ${written} active med(s) from ${txSnap.size} reconcile_hosxp tx row(s).`);
}

main().catch((err) => {
  console.error('Usage stats recompute FAILED:', err);
  process.exit(1);
});
