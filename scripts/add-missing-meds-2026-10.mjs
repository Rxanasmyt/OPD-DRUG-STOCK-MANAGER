#!/usr/bin/env node
// One-time data fix for a real request: "ตรวจสอบรายชื่อยา ว่ายาตัวไหนที่ยังไม่มีในแอพ" followed by
// "เพิ่มยา 7 ตัวที่ยังไม่มีในแอพ" — after hand-checking the 65 sheet rows backfill-warehouse-codes.mjs
// couldn't match against the app's 442-med formulary (see this session's audit report), 7 were
// reported as genuinely absent. The user then pointed out 2 of those 7 (Amoxi/clav inj, B-100
// Complex inj) already exist in the app under names different enough that the matcher's
// word-subset check never had a chance (brand/generic naming, not just a spelling variant) —
// leaving 5 genuinely new meds to add, plus whCode/reqCategory backfilled onto those 2
// already-existing ones.
//
// Adds exactly the 5 named meds below with their known fields (name/unit/dosageForm/route/
// reqCategory/whCode) and PLACEHOLDER operational fields (price 0, bin '', par 0) — those need
// real facility knowledge (shelf location, stocking levels, purchase price) this script has no
// way to know; a pharmacist fills them in via MedsScreen afterward. Placeholder par=0/bin=''
// is safe: it never triggers a false replenishment suggestion (needsWarehouseRequest reads
// parSub/parFloor, both 0) and never collides with a real shelf bin (bin='' is never a real
// code). Code (MED-NNNN) is minted the SAME way addMed() does — an atomic transaction against
// meta/medSeq — so these interleave safely with real app usage happening concurrently.
//
// SAFETY: dry run by default — pass --confirm to actually write.
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/add-missing-meds-2026-10.mjs
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/add-missing-meds-2026-10.mjs --confirm

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const NEW_MEDS = [
  { name: 'Amikacin sulfate 500 mg/2ml', unit: 'Amphule (2 ml.)', dosageForm: 'Injection', route: 'injection', reqCategory: 'injection', whCode: '1400411', had: false },
  { name: 'Bemiparin 5,000 IU', unit: 'Syringe', dosageForm: 'Injection', route: 'injection', reqCategory: 'injection', whCode: '1400433', had: true },
  { name: 'Meropenem 1 g.', unit: 'Vial', dosageForm: 'Injection', route: 'injection', reqCategory: 'injection', whCode: '1400172', had: false },
  { name: 'Piperacillin + Tazobactam (Tazocin) 4.5 g.', unit: 'Vial', dosageForm: 'Injection', route: 'injection', reqCategory: 'injection', whCode: '1400412', had: false },
  { name: 'KY Jelly 50 g.', unit: 'หลอด (50 g.)', dosageForm: 'Jelly', route: 'topical', reqCategory: 'external', whCode: '3000082', had: false },
];

// Already exist in the app under a brand/generic-abbreviation name different enough that
// backfill-warehouse-codes.mjs's word-subset matcher never had a chance — matched here by exact
// (already-verified-by-the-user) name instead of its fuzzy matching.
const EXISTING_MED_UPDATES = [
  { name: 'Amoxi/clav inj  - PL 1+2 g. Vial', whCode: '1400018', reqCategory: 'injection' },
  { name: 'B-100 Complex inj 1 ml. Amphule (1 ml.)', whCode: '1400280', reqCategory: 'injection' },
];

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

  console.log(confirm ? 'WRITING (live)' : 'DRY RUN (pass --confirm to actually write)');
  console.log(`Project: ${serviceAccount.project_id}\n`);

  const medsSnap = await db.collection('meds').get();
  const meds = medsSnap.docs.map((d) => ({ id: d.id, name: d.data().name, code: d.data().code, whCode: d.data().whCode, reqCategory: d.data().reqCategory }));

  console.log('Existing meds to update (whCode/reqCategory):');
  const existingUpdates = [];
  for (const u of EXISTING_MED_UPDATES) {
    const med = meds.find((m) => m.name === u.name);
    if (!med) { console.log(`  ⚠ NOT FOUND (name changed since?): "${u.name}" — skipped`); continue; }
    if (med.whCode) { console.log(`  already has whCode "${med.whCode}" — left untouched: ${med.name}`); continue; }
    console.log(`  ${med.name}  ->  whCode "${u.whCode}", reqCategory "${u.reqCategory}"`);
    existingUpdates.push({ id: med.id, whCode: u.whCode, reqCategory: u.reqCategory });
  }

  console.log('\nNew meds to add:');
  for (const m of NEW_MEDS) console.log(`  ${m.name}  (whCode "${m.whCode}", reqCategory "${m.reqCategory}", route "${m.route}"${m.had ? ', HAD' : ''})`);

  if (!confirm) {
    console.log('\nRe-run with --confirm to actually write these.');
    return;
  }

  for (const u of existingUpdates) {
    await db.collection('meds').doc(u.id).update({ whCode: u.whCode, reqCategory: u.reqCategory });
  }
  console.log(`\nUpdated ${existingUpdates.length} existing med(s).`);

  const seqRef = db.collection('meta').doc('medSeq');
  const addedCodes = [];
  for (const m of NEW_MEDS) {
    const code = await db.runTransaction(async (trx) => {
      const seqSnap = await trx.get(seqRef);
      let next;
      if (seqSnap.exists) {
        next = seqSnap.data().next || 1;
      } else {
        // Same fallback addMed() itself uses: seed from the highest MED-NNNN code already in
        // the formulary. Shouldn't actually trigger here (the counter doc already exists from
        // real app usage) — kept only so this script degrades the same safe way addMed() does
        // if it somehow doesn't.
        let max = 0;
        for (const existing of meds) {
          const mm = /^MED-(\d+)$/.exec(existing.code || '');
          if (mm) max = Math.max(max, parseInt(mm[1], 10));
        }
        next = max + 1;
      }
      trx.set(seqRef, { next: next + 1 }, { merge: true });
      const c = 'MED-' + String(next).padStart(4, '0');
      const newMedRef = db.collection('meds').doc();
      trx.set(newMedRef, {
        code: c, name: m.name, unit: m.unit, dosageForm: m.dosageForm,
        price: 0, had: m.had, active: true,
        parSub: 0, parFloor: 0, floor: 0, floorMin: 0,
        bin: '',
        used30: 0, usedPrev30: 0, volatility: 1.1, lastCountTs: Date.now(),
        ward: 'opd', noSubstock: false,
        route: m.route, reqCategory: m.reqCategory, whCode: m.whCode,
      });
      return c;
    });
    addedCodes.push(`${code}  ${m.name}`);
  }
  console.log(`Added ${NEW_MEDS.length} new med(s):`);
  for (const c of addedCodes) console.log(`  ${c}`);
}

main().catch((err) => {
  console.error('Failed:', err);
  process.exit(1);
});
