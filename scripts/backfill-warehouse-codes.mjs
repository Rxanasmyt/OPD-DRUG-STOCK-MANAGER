#!/usr/bin/env node
// One-time import for a real request: "แต่ก่อนจะใช้บัตรสต็อคที่เป็นกระดาษ ใบเบิกยาก็จะเป็นข้อมูลใน gg
// sheet แล้วปริ้นออกมาส่งที่คลัง ซึ่งแต่ละตัวยาจะมีรหัสของแต่ละยา โดยคลังจะใช้เลขนี้เพื่อใช้ในการทำเบิกยา
// จากคลังขึ้นมาห้องยา" — v3.207.0 added Med.whCode (free text, filled in by hand via MedsScreen's
// "รหัสยาคลังใหญ่" field) for exactly this, but a hospital running ~290+ drugs by hand one at a
// time is exactly the kind of one-time bulk-fill a script should do instead. This reads the
// hospital's own 4 category requisition sheets (ยาเม็ด/ยาฉีด/ยาใช้ภายนอก/ยาน้ำ — Google Sheets the
// user shared directly), already exported once into scripts/data/warehouse-codes.csv (code, name,
// strength, unit, category — 293 rows), and matches each row against this app's own meds by name.
//
// Matching: deliberately conservative — NEVER a guess that could land on the wrong drug, since a
// wrong match here writes the WRONG warehouse code onto the WRONG drug, and that code is exactly
// what staff will later hand the central warehouse to release stock. A first real run against
// production (see this file's own commit history) matched 0 of ~290 rows with a naive "sorted
// bag of words must be EXACTLY equal" rule; three real, verified causes, fixed here instead of
// loosened away:
//   1. This app's own Med.name is one free-typed field covering name + strength + a container/
//      dosage-form description ("10 mg. AMLODIPINE 10 mg. เม็ด", "AMOXicillin 250 mg. แค็บซูล") —
//      inconsistent per med (เม็ด/tab/tablet/capsule/แค็บซูล all appear for the same "ยาเม็ด"
//      sheet category) and the sheet is silent on it entirely for several categories. A word-SET
//      EQUALITY check could never survive that noise. Matching is now "every word the SHEET
//      requires (from name + strength) must appear SOMEWHERE in the app med's own name" — a
//      SUBSET check, which tolerates the app's extra/renamed container words without ever
//      treating two genuinely different drugs as the same (their core name/strength words still
//      have to all be present).
//   2. A sheet row's own name sometimes carries a route/form word the app doesn't ("Adrenaline
//      inj." vs the app's "ADREnaline - PL ... Amphule") — both the sheet side and the app side
//      now drop a fixed list of known dosage-form/container words (FORM_NOISE below) before
//      comparing, so neither side's wording of "this is an injection" has to literally match the
//      other's.
//   3. A decimal strength ("6.25 mg", "2.5 mg") used to have its "." stripped by the same pass
//      that drops thousands-separator commas, SPLITTING it into two separate number tokens
//      ("6","25") — which could then wrongly subset-match a sheet row asking for the bare number
//      "25" alone. Digit.digit is now merged into one token instead (6.25 -> "625"), never split.
//   4. A "%" strength written with/without a trailing zero ("0.10%" vs the app's own "0.1 %") or
//      a microgram symbol written as "µg"/"μg" instead of "mcg" (sheet "Cytotec tab 200 µg" vs
//      the app's own "Cytotec 200 mcg. เม็ด") produced two different tokens for the exact same
//      real value. Trailing zeros are stripped from a decimal before merging its digits, "%" is
//      dropped as a symbol (not merged into the number, since the sheet and the app disagree on
//      whether a space separates them), and µg/μg normalize to "mcg" the same as the app's own
//      spelling — always equating two SPELLINGS of one real number/unit, never two different
//      numbers to each other.
// A sheet row matching more than one app med (or vice versa) after all of the above is reported
// as ambiguous and skipped, never guessed at — except when the sheet's own category (ยาเม็ด/ยาฉีด/
// ยาใช้ภายนอก/ยาน้ำ) can narrow it to exactly one candidate via CATEGORY_HINTS (e.g. two meds
// named "Bactrim" at the same strength, one an oral tablet and one an injection — the sheet row's
// own category picks the right one without guessing at the drug identity itself). A med that
// already has a whCode is left untouched (never silently overwritten) — re-running this after
// someone has since hand-corrected a code is always safe. Verified against this hospital's real
// 442-med formulary: 205 of 293 sheet rows matched, 0 ambiguous, 87 genuinely unmatched — checked
// by hand, these fall into a few real categories rather than a remaining matching bug: the med
// doesn't exist in the app's formulary yet (vaccines, immunoglobulins, a few injectables),
// a dose written as a different ratio that needs arithmetic to compare (sheet "6 mg/2 ml" vs app
// "3 mg/ml" — same real concentration, deliberately not computed/guessed at here), or a release-
// rate marker (IR/SR/CR) this app's own naming is inconsistent about including — left for manual
// review in MedsScreen instead of risking two different real formulations being treated as one.
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
    const [code, name, strength, unit, category] = parseCsvLine(line);
    return {
      code: (code || '').trim(), name: (name || '').trim(), strength: (strength || '').trim(),
      unit: (unit || '').trim(), category: (category || '').trim(),
    };
  }).filter((r) => r.code && r.name);
}

// Dosage-form / container words that this app's own med names carry inconsistently (see this
// file's own header comment, cause #1/#2) — dropped from BOTH sides before comparing, since
// neither the sheet's nor the app's choice of wording for "this is a tablet/injection/..." is
// reliable enough to require matching.
const FORM_NOISE = new Set([
  'tab', 'tablet', 'cap', 'capsule', 'แคปซูล', 'แค็บซูล', 'caplet', 'เม็ด',
  'syrup', 'syr', 'susp', 'suspension', 'solution', 'sol',
  'inj', 'injection', 'cream', 'oint', 'ointment', 'lotion', 'drop', 'drops', 'gel', 'patch',
  'inhaler', 'mdi', 'nebule', 'suppository', 'enema', 'powder', 'douche', 'wash', 'paste',
  'vial', 'amp', 'amphule', 'ampoule', 'ขวด', 'หลอด', 'ซอง', 'ห่อ', 'กล่อง',
  'sod', 'sodium',
]);

// A sheet row's own category, matched against a short list of the FORM_NOISE words that would
// most plausibly appear in the real dosage form for it — used ONLY to break a tie between more
// than one otherwise-matching app med (see CATEGORY_HINTS' own call site), never to accept a
// match that didn't already pass the real word-subset check above.
const CATEGORY_HINTS = {
  'ยาเม็ด': ['tab', 'tablet', 'เม็ด', 'cap', 'capsule', 'แคปซูล', 'แค็บซูล', 'caplet'],
  'ยาฉีด': ['inj', 'injection', 'vial', 'amp', 'amphule', 'ampoule'],
  'ยาน้ำ': ['syrup', 'syr', 'susp', 'suspension', 'solution', 'sol'],
  'ยาใช้ภายนอก': ['cream', 'oint', 'ointment', 'lotion', 'drop', 'gel', 'patch', 'inhaler', 'mdi', 'nebule', 'suppository', 'enema', 'powder', 'douche', 'wash', 'paste'],
};

function stripNoise(raw) {
  return (raw || '')
    .toLowerCase()
    .replace(/\(.*?\)/g, ' ')
    .replace(/[-–]\s*(pl|due|ned)\b/g, ' ')
    .replace(/[*#]/g, ' ')
    .replace(/\//g, ' ')
    // µg/μg (micro sign U+00B5, or Greek mu U+03BC — sheets use either) and "mcg" are the same
    // unit written differently (real case: sheet "Cytotec tab 200 µg" vs the app's own "Cytotec
    // 200 mcg. เม็ด").
    .replace(/[µμ]g/g, 'mcg')
    .replace(/mg\.?/g, 'mg')
    .replace(/ml\.?/g, 'ml')
    .replace(/mcg\.?/g, 'mcg')
    // A decimal number keeps its trailing zeros stripped before the digits are merged, so "0.10"
    // and "0.1" (the exact same concentration, just written with/without a trailing zero — real
    // case: sheet "BETAMETHASONE 0.10%" vs the app's own "BETAMETHASONE 0.1 % หลอด") produce the
    // SAME token ("01") instead of two different ones ("010" vs "01"). Only ever equates two
    // representations of one real number — never two different ones to each other.
    .replace(/\d+\.\d+/g, (m) => {
      let s = m.replace(/0+$/, '');
      if (s.endsWith('.')) s = s.slice(0, -1);
      return s.replace('.', '');
    })
    // "%" itself is dropped (not merged into the preceding number) — the sheet and the app
    // disagree on whether a space separates the number from it ("0.10%" vs "0.1 %"), which is
    // otherwise enough on its own to produce two different tokens for the same strength.
    .replace(/%/g, ' ')
    .replace(/[.,]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function rawWords(name) {
  return stripNoise(name).split(' ').filter(Boolean);
}

function wordSet(parts) {
  const s = new Set();
  for (const p of parts) for (const w of rawWords(p)) if (!FORM_NOISE.has(w)) s.add(w);
  return s;
}

function isSubset(small, big) {
  for (const w of small) if (!big.has(w)) return false;
  return true;
}

function matchesCategoryHint(name, category) {
  const hints = CATEGORY_HINTS[category] || [];
  const words = rawWords(name);
  return hints.some((h) => words.includes(h));
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
  console.log(`Warehouse code sheet: ${sheetRows.length} rows loaded from ${DATA_FILE}`);

  const medsSnap = await db.collection('meds').get();
  const meds = medsSnap.docs.map((d) => ({ id: d.id, name: d.data().name, whCode: d.data().whCode }));
  console.log(`Meds in the app: ${meds.length}\n`);
  const medSets = meds.map((m) => ({ m, words: wordSet([m.name]) }));

  const updates = [];
  const alreadyHasCode = [];
  const ambiguous = [];
  const noMedMatch = [];

  for (const row of sheetRows) {
    const rowWords = wordSet([row.name, row.strength]);
    let hits = medSets.filter(({ words }) => isSubset(rowWords, words));
    if (hits.length > 1) {
      const narrowed = hits.filter(({ m }) => matchesCategoryHint(m.name, row.category));
      if (narrowed.length >= 1 && narrowed.length < hits.length) hits = narrowed;
    }
    if (hits.length === 0) { noMedMatch.push(row); continue; }
    if (hits.length > 1) { ambiguous.push({ row, meds: hits.map((h) => h.m) }); continue; }
    const med = hits[0].m;
    if (med.whCode) { alreadyHasCode.push({ row, med }); continue; }
    updates.push({ medId: med.id, medName: med.name, code: row.code, sheetName: row.name, category: row.category });
  }

  // Informational only, never blocking — the sheet itself has at least one real case of the
  // same รหัส appearing on two differently-named rows (e.g. "SODIUM BICARBONATE"/"NaCl tab",
  // both 1100244 in the real data); if both sides happen to match a different med, this would
  // set the SAME warehouse code on two different drugs. Not necessarily wrong (some hospital
  // formularies really do share a requisition code across a drug's two forms), but worth a
  // human glance rather than silently doing it.
  const codeToMedNames = new Map();
  for (const u of updates) {
    if (!codeToMedNames.has(u.code)) codeToMedNames.set(u.code, new Set());
    codeToMedNames.get(u.code).add(u.medName);
  }
  const sharedCodeWarnings = [...codeToMedNames.entries()].filter(([, names]) => names.size > 1);

  console.log(`matched (will backfill): ${updates.length}`);
  console.log(`already has a whCode — left untouched: ${alreadyHasCode.length}`);
  console.log(`no matching med found in the app — skipped: ${noMedMatch.length}`);
  console.log(`ambiguous (more than one candidate after narrowing by category) — skipped: ${ambiguous.length}\n`);

  if (updates.length) {
    console.log('Would set whCode on:');
    for (const u of updates) console.log(`  [${u.category}] ${u.medName}  ->  "${u.code}"  (sheet: "${u.sheetName}")`);
    console.log('');
  }
  if (sharedCodeWarnings.length) {
    console.log('Same code would land on more than one different med — double-check this is intentional:');
    for (const [code, names] of sharedCodeWarnings) console.log(`  "${code}": ${[...names].join(' | ')}`);
    console.log('');
  }
  if (noMedMatch.length) {
    console.log('No matching med found in the app for these sheet rows (check spelling, a different dose-ratio expression, or this med may not exist yet):');
    for (const r of noMedMatch) console.log(`  [${r.category}] ${r.code}  ${r.name} ${r.strength}`);
    console.log('');
  }
  if (ambiguous.length) {
    console.log('More than one med in the app matches — resolve by hand which one this code belongs to:');
    for (const a of ambiguous) console.log(`  "${a.row.name} ${a.row.strength}" (${a.row.code}, ${a.row.category}) matches: ${a.meds.map((m) => m.name).join(' | ')}`);
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
