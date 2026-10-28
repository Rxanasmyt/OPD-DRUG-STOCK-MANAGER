#!/usr/bin/env node
// One-time import for a real request: "เดิมการปริ้นใบเบิก จะปริ้นจาก gg sheet...อยากให้แอพสามารถ
// ปริ้นออกมาโดยข้อมูลจากการปริ้นแบบเดิมยังครบ" — the hospital's own printed requisition always
// came as 4 SEPARATE physical sheets (ใบเบิกยาเม็ด/ยาน้ำ/ยาฉีด/ยาใช้ภายนอก), a different cut than
// this app's existing Med.route ('oral' covers both tablets AND oral liquids/syrups — see
// Med.reqCategory's own doc comment, types.ts). Asked directly how to split it, the user said
// "แยกประเภทยาตามข้อมูลที่ผมส่งให้เลยครับ" — use the sheets' own category, never a new guess from
// dosageForm/unit.
//
// Unlike backfill-warehouse-codes.mjs (which had to fuzzy-match sheet row names against app med
// names), this backfill needs NO fuzzy matching at all: every row in scripts/data/warehouse-
// codes.csv already carries the exact code (รหัส) that backfill-warehouse-codes.mjs already
// verified and wrote onto the matching med's own Med.whCode. This script just joins the two
// lists on that one already-verified code — a med whose whCode isn't in the CSV (never matched,
// or hand-typed) is left alone, same "never guess" posture.
//
// A med that already has a reqCategory is left untouched (never silently overwritten) — re-running
// this after someone has since hand-corrected one via MedsScreen's chips is always safe.
//
// SAFETY: dry run by default — pass --confirm to actually write.
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/backfill-req-categories.mjs
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/backfill-req-categories.mjs --confirm

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data', 'warehouse-codes.csv');
const BATCH_LIMIT = 450;

// Same category labels the hospital's own 4 sheets use -> Med.reqCategory's 4 stored values
// (data/reqCategories.ts is the single source of truth for the stored side).
const CATEGORY_TO_REQ_CATEGORY = {
  'ยาเม็ด': 'tab',
  'ยาน้ำ': 'liquid',
  'ยาฉีด': 'injection',
  'ยาใช้ภายนอก': 'external',
};

// Same minimal quoted-CSV parser as backfill-warehouse-codes.mjs (one data file, no library
// dependency needed for it).
function parseCsvLine(line) {
  const out = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else inQuotes = false; }
      else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ',') { out.push(cur); cur = ''; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}

function loadCodeToCategory() {
  const text = readFileSync(DATA_FILE, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  const map = new Map();
  for (const line of lines.slice(1)) {
    const [code, , , , category] = parseCsvLine(line);
    const trimmedCode = (code || '').trim();
    const reqCategory = CATEGORY_TO_REQ_CATEGORY[(category || '').trim()];
    if (trimmedCode && reqCategory) map.set(trimmedCode, reqCategory);
  }
  return map;
}

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

  console.log(confirm ? 'BACKFILLING (writes are live)' : 'DRY RUN (pass --confirm to actually write)');
  console.log(`Project: ${serviceAccount.project_id}\n`);

  const codeToCategory = loadCodeToCategory();
  console.log(`Warehouse code -> category map: ${codeToCategory.size} codes loaded from ${DATA_FILE}`);

  const medsSnap = await db.collection('meds').get();
  const meds = medsSnap.docs.map((d) => ({ id: d.id, name: d.data().name, whCode: d.data().whCode, reqCategory: d.data().reqCategory }));
  console.log(`Meds in the app: ${meds.length}\n`);

  const updates = [];
  const alreadyHasCategory = [];
  const noWhCode = [];
  const whCodeNotInSheet = [];

  for (const med of meds) {
    if (!med.whCode) { noWhCode.push(med); continue; }
    const reqCategory = codeToCategory.get(med.whCode);
    if (!reqCategory) { whCodeNotInSheet.push(med); continue; }
    if (med.reqCategory) { alreadyHasCategory.push({ med, reqCategory }); continue; }
    updates.push({ medId: med.id, medName: med.name, whCode: med.whCode, reqCategory });
  }

  console.log(`matched (will backfill): ${updates.length}`);
  console.log(`already has a reqCategory — left untouched: ${alreadyHasCategory.length}`);
  console.log(`no whCode set yet — skipped: ${noWhCode.length}`);
  console.log(`has a whCode, but it's not in warehouse-codes.csv — skipped: ${whCodeNotInSheet.length}\n`);

  if (updates.length) {
    console.log('Would set reqCategory on:');
    for (const u of updates) console.log(`  ${u.medName}  (whCode "${u.whCode}")  ->  "${u.reqCategory}"`);
    console.log('');
  }
  if (whCodeNotInSheet.length) {
    console.log('Has a whCode not found in warehouse-codes.csv (hand-typed, or the code changed since the sheet export) — check by hand:');
    for (const m of whCodeNotInSheet) console.log(`  ${m.name}  (whCode "${m.whCode}")`);
    console.log('');
  }

  if (!updates.length) {
    console.log('Nothing to backfill.');
    return;
  }

  if (!confirm) {
    console.log('Re-run with --confirm to actually write these.');
    return;
  }

  for (let i = 0; i < updates.length; i += BATCH_LIMIT) {
    const batch = db.batch();
    for (const u of updates.slice(i, i + BATCH_LIMIT)) {
      batch.update(db.collection('meds').doc(u.medId), { reqCategory: u.reqCategory });
    }
    await batch.commit();
  }
  console.log(`Backfilled reqCategory onto ${updates.length} med(s).`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
