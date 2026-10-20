#!/usr/bin/env node
// One-time import for a real request: "แต่ก่อนจะใช้บัตรสต็อคที่เป็นกระดาษ ใบเบิกยาก็จะเป็นข้อมูลใน gg
// sheet แล้วปริ้นออกมาส่งที่คลัง ซึ่งแต่ละตัวยาจะมีรหัสของแต่ละยา โดยคลังจะใช้เลขนี้เพื่อใช้ในการทำเบิกยา
// จากคลังขึ้นมาห้องยา" — v3.207.0 added Med.whCode (free text, filled in by hand via MedsScreen's
// "รหัสยาคลังใหญ่" field) for exactly this, but a hospital running ~290+ drugs by hand one at a
// time is exactly the kind of one-time bulk-fill a script should do instead. This reads the
// hospital's own 4 category requisition sheets (ยาเม็ด/ยาฉีด/ยาใช้ภายนอก/ยาน้ำ — Google Sheets the
// user shared directly), already exported once into scripts/data/warehouse-codes.csv (code, name,
// strength, category — 293 rows), and matches each row against this app's own meds by name.
//
// Matching: deliberately conservative, same philosophy as matchHosxpMed() (selectors.ts) and
// backfill-return-reasons.mjs's own composite-key match — NEVER a fuzzy/substring guess, since a
// wrong match here writes the WRONG warehouse code onto the WRONG drug, and that code is exactly
// what staff will later hand the central warehouse to release stock. Both the sheet's name and
// this app's med name are normalized (lowercased, common supplier/batch tags like "- PL"/"- DUE"/
// "- NED" stripped, punctuation collapsed) and compared as a SORTED BAG OF WORDS — this tolerates
// the sheet's inconsistent word order (e.g. "10 mg. AMLODIPINE" vs this app's likely "Amlodipine
// 10 mg") without ever treating two genuinely different word sets as equal. A sheet row or an app
// med matching MORE than once (either direction) is reported as ambiguous and skipped, never
// guessed at. A med that already has a whCode is left untouched (never silently overwritten) —
// re-running this after someone has since hand-corrected a code is always safe.
//
// SAFETY: dry run by default — pass --confirm to actually write.
//
// Usage:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/backfill-warehouse-codes.mjs
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/backfill-warehouse-codes.mjs --confirm

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_FILE = join(__dirname, 'data', 'warehouse-codes.csv');
const BATCH_LIMIT = 450;

// Minimal CSV line parser — handles quoted fields with embedded commas (e.g. "2,500"), which is
// all this fixed, hand-exported data file ever needs; no library dependency for one data file.
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

function loadSheetRows() {
  const text = readFileSync(DATA_FILE, 'utf8');
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  return lines.slice(1).map((line) => {
    const [code, name, strength, category] = parseCsvLine(line);
    return { code: (code || '').trim(), name: (name || '').trim(), strength: (strength || '').trim(), category: (category || '').trim() };
  }).filter((r) => r.code && r.name);
}

// Strips the noise that differs between the sheet's own spelling and this app's own med name
// without ever guessing at a DIFFERENT drug — same conservative spirit as selectors.ts's own
// normalizeMedName(), just with a few more known patterns this specific sheet uses (supplier/
// batch tags, parenthetical brand asides).
function stripNoise(raw) {
  return (raw || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[-–]\s*(pl|due|ned)\b/g, ' ')
    .replace(/[*#]/g, ' ')
    .replace(/\//g, ' ')
    .replace(/mg\.?/g, 'mg')
    .replace(/ml\.?/g, 'ml')
    .replace(/mcg\.?/g, 'mcg')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

// Sorted bag-of-words so word-order differences (dose-before-name vs dose-after-name) still
// match, while two genuinely different word sets never do. Skips re-appending `strength` when
// it's already embedded in `name` (several sheet rows duplicate it, e.g. "10 mg. AMLODIPINE" +
// "10 mg." in the separate column) so it isn't double-counted against a name that has it once.
function matchKey(name, strength) {
  const n = stripNoise(name);
  const s = stripNoise(strength);
  const combined = s && n.indexOf(s) === -1 ? n + ' ' + s : n;
  return combined.split(' ').filter(Boolean).sort().join(' ');
}

function groupByKey(items, keyFn) {
  const map = new Map();
  for (const item of items) {
    const key = keyFn(item);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
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

  const sheetRows = loadSheetRows();
  console.log(`Warehouse code sheet: ${sheetRows.length} rows loaded from ${DATA_FILE}\n`);

  const sheetByKey = groupByKey(sheetRows, (r) => matchKey(r.name, r.strength));

  const medsSnap = await db.collection('meds').get();
  const meds = medsSnap.docs.map((d) => ({ id: d.id, name: d.data().name, whCode: d.data().whCode }));
  const medByKey = groupByKey(meds, (m) => matchKey(m.name, ''));

  const updates = [];
  const alreadyHasCode = [];
  const ambiguousSheet = [];
  const ambiguousMed = [];
  const noMedMatch = [];

  for (const [key, sheetMatches] of sheetByKey) {
    if (sheetMatches.length > 1) { ambiguousSheet.push({ key, rows: sheetMatches }); continue; }
    const row = sheetMatches[0];
    const medMatches = medByKey.get(key) || [];
    if (medMatches.length === 0) { noMedMatch.push(row); continue; }
    if (medMatches.length > 1) { ambiguousMed.push({ key, row, meds: medMatches }); continue; }
    const med = medMatches[0];
    if (med.whCode) { alreadyHasCode.push({ row, med }); continue; }
    updates.push({ medId: med.id, medName: med.name, code: row.code, sheetName: row.name, category: row.category });
  }

  console.log(`matched (will backfill): ${updates.length}`);
  console.log(`already has a whCode — left untouched: ${alreadyHasCode.length}`);
  console.log(`no matching med found in the app — skipped: ${noMedMatch.length}`);
  console.log(`ambiguous (more than one sheet row with the same name+strength) — skipped: ${ambiguousSheet.length}`);
  console.log(`ambiguous (more than one med in the app with the same name) — skipped: ${ambiguousMed.length}\n`);

  if (updates.length) {
    console.log('Would set whCode on:');
    for (const u of updates) console.log(`  [${u.category}] ${u.medName}  ->  "${u.code}"  (sheet: "${u.sheetName}")`);
    console.log('');
  }
  if (noMedMatch.length) {
    console.log('No matching med found in the app for these sheet rows (check spelling, or this med may not exist yet):');
    for (const r of noMedMatch) console.log(`  [${r.category}] ${r.code}  ${r.name} ${r.strength}`);
    console.log('');
  }
  if (ambiguousMed.length) {
    console.log('More than one med in the app shares a name — resolve by hand which one this code belongs to:');
    for (const a of ambiguousMed) console.log(`  "${a.row.name} ${a.row.strength}" (${a.row.code}) matches: ${a.meds.map((m) => m.name).join(' | ')}`);
    console.log('');
  }
  if (ambiguousSheet.length) {
    console.log('More than one sheet row shares the same name+strength — resolve by hand:');
    for (const a of ambiguousSheet) console.log(`  ${a.rows.map((r) => `${r.code} (${r.category})`).join(' | ')}`);
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
      batch.update(db.collection('meds').doc(u.medId), { whCode: u.code });
    }
    await batch.commit();
  }
  console.log(`Backfilled whCode onto ${updates.length} med(s).`);
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
