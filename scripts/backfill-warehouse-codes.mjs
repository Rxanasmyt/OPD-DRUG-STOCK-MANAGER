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
//   5. The hospital's own sheet and the app disagree on a handful of specific spellings for the
//      SAME real drug — "Potassium Chloride KCL" (sheet) vs the app's plain "KCl"; "Human tetanus
//      immunoglobulin" (sheet) vs the app's own name with no "Human"; "Cal.polystyrene(kalimate)"
//      (sheet, the generic name) vs the app's own brand-only "KALIMATE POWDER". Normalized as
//      phrase/word synonyms (see stripNoise and FORM_NOISE below) — each pair names one real drug,
//      so equating them never risks conflating two different ones.
//   6. A number glued directly to its unit with no space ("1gm", "400U") tokenized as ONE word,
//      while the other side's spaced version ("1 gm.", "400 U") tokenized as TWO — split a digit
//      run from an adjacent letter run so both sides agree; "gm" and "g" (the same gram unit)
//      are then normalized to one spelling too (sheet "5gm" vs the app's own "5 g.").
//   7. The app often states a real required quantity INSIDE parentheses ("KCl injection 20 mEq.
//      Amphule (10 ml.)") where the sheet states it in plain text ("20 mEql/10 ml") — parens are
//      now only dropped when they hold no digit (a bare brand/route marker like "(PL)", "(ERIG)",
//      "(TIG)" is still noise); keeping a parenthesized NUMBER only ever adds a word to the app
//      side, so it can only let an already-failing match start succeeding, never break one.
// A sheet row matching more than one app med (or vice versa) after all of the above is reported
// as ambiguous and skipped, never guessed at — except when the sheet's own category (ยาเม็ด/ยาฉีด/
// ยาใช้ภายนอก/ยาน้ำ) can narrow it to exactly one candidate via CATEGORY_HINTS (e.g. two meds
// named "Bactrim" at the same strength, one an oral tablet and one an injection — the sheet row's
// own category picks the right one without guessing at the drug identity itself). Loosening the
// word-subset rule can also newly EXPOSE a real structural ambiguity that a tokenizing accident
// used to hide — real case: "สหัสธารา 500 mg." uniquely matched the app's plain-brand entry only
// because the app's OTHER, "ตราธนัทเฮิร์บ"-branded 500mg entry happened to write its strength
// glued ("500mg.", not matching the sheet's spaced "500 mg." before fix #6 above); once both
// tokenize the same way, the sheet row — which never names either brand — is honestly ambiguous
// between them, and is now correctly reported as such instead of a lucky, unverified guess.
// Also deliberately NOT done, tried once and reverted: stripping "cr"/"sr"/"ir"/"er" release-rate
// markers as noise. It would fix one unmatched row (sheet "Theophylline CR", no competing plain/
// SR sibling), but "Cr." is ALSO this formulary's abbreviation for "Cream" (TRIAMCINOLONE (5g)
// Cr. 0.1%, already uniquely matched) — stripping it collapses the Triamcinolone cream/lotion/
// paste trio (all 0.1%, same ingredient) into a 3-way ambiguity, breaking an already-correct
// match to fix one unmatched row. Left for manual review in MedsScreen instead, same as
// Morphine's SR/IR, which has the identical problem (its own SR/plain siblings would become
// indistinguishable).
//
// A handful of rows in scripts/data/warehouse-codes.csv itself had a plain transcription typo
// that happened to also be the ONLY reason they didn't match a real app med — "Clotrimazale" (->
// Clotrimazole), "PROCTOSEDHYL" (-> PROCTOSEDYL, one extra H), "Whitfieid" (-> Whitfield, l/i
// mixed up), "Activited Chaco" (-> Activated Charcoal), "Glicerine" (-> Glycerine) — corrected
// directly in the data file (each checked by hand against the real app med before correcting),
// plus "กรัม" (Thai for "gram") normalized the same way "gm"/"g" already are, and "supposition"
// (missing the final "y") added alongside the already-handled "suppository". NOT corrected:
// "Tertracaine* 0.5 mg/ml" (probably "tetracaine", which the app has as "tetracaine eye drop
// 0.5%") — 0.5% and 0.5 mg/ml are NOT the same concentration (0.5% = 5 mg/ml), so this one needs
// a human to confirm the real strength before it can be matched, typo or not.
//
// "HCl" and "sulfate"/"sulphate" (salt-form suffixes) joined "sod"/"sodium"/"cal" as dropped
// noise, by the same reasoning: this hospital never stocks the same active ingredient as both a
// salt and a free-base form side by side, so the salt name never has to match (real cases: sheet
// "Hydralazine HCl" vs the app's plain "HYDRALAZINE - PL 20 mg."; sheet "Morphine sulfate" vs
// the app's plain "MORPHINE - PL 10 mg./ml.").
//
// Separately: this script's matching was NEVER filtered by the app med's own active/inactive
// flag — an inactive med has always been a valid match candidate, same as an active one. A real
// user question ("the Morphine/Remdesivir/Pethidine matches I expect are on inactive meds —
// should those still get a warehouse code?") was answered explicitly: yes, every matched row
// gets its whCode regardless of the target med's active state: the hospital may have its own
// reasons for deactivating a med (Morphine's narcotic controls, for one) that have nothing to do
// with whether the historical warehouse code for it is worth keeping on record.
//
// A med that already has a whCode is left untouched (never silently overwritten) — re-running
// this after someone has since hand-corrected a code is always safe. Verified against this
// hospital's real 442-med formulary: 226 of 292 sheet rows matched, 1 ambiguous (the สหัสธารา
// case above), 65 genuinely unmatched — checked by hand, these fall into a few real categories
// rather than a remaining matching bug: the med doesn't exist in the app's formulary at all, even
// inactive (Amikacin, Meropenem, Piperacillin+tazobactam, KY Jelly, a few more), a dose written
// as a different ratio that needs arithmetic to compare (sheet "6 mg/2 ml" vs app "3 mg/ml" —
// same real concentration, deliberately not computed/guessed at here), a dose or pack size that
// is simply DIFFERENT from what the app has on record (sheet "Nystatin BP 12 ml" vs the app's own
// "1 ml.", sheet "Swiff 90 ml" vs the app's own pack in grams — real discrepancies a human needs
// to resolve, not a wording difference this script should paper over), the app's own name has a
// plain typo (confirmed case: "CEFTRIAZONE" should read "CEFTRIAXONE" — a data fix, not a
// matching one), the sheet's own typo above (Tertracaine) where the real strength still needs
// confirming, or the release-rate marker case above.
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

export function loadSheetRows() {
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
export const FORM_NOISE = new Set([
  'tab', 'tablet', 'cap', 'capsule', 'แคปซูล', 'แค็บซูล', 'caplet', 'เม็ด',
  'syrup', 'syr', 'susp', 'suspension', 'solution', 'sol',
  'inj', 'injection', 'cream', 'oint', 'ointment', 'lotion', 'drop', 'drops', 'gel', 'patch',
  'inhaler', 'mdi', 'nebule', 'suppository', 'supposition', 'enema', 'powder', 'douche', 'wash', 'paste',
  'vial', 'amp', 'amphule', 'ampoule', 'ขวด', 'หลอด', 'ซอง', 'ห่อ', 'กล่อง',
  'sod', 'sodium',
  // "Human" is implied for virtually every biologic in this formulary (immunoglobulin, albumin)
  // and the app's own naming is inconsistent about spelling it out (real case: sheet "Human
  // tetanus immunoglobulin (TIG)" vs the app's own "tetanus Immunoglobulin(TIG)-tetagam P", no
  // "Human" at all) — dropping it never risks conflating two different biologics, since the
  // product-specific word (tetagam/erig/hrig/...) still has to match.
  //
  // NOT dropped, deliberately: "cr"/"sr"/"ir"/"er" release-rate markers — tried once, reverted.
  // "Cr." does double duty in this formulary as BOTH "controlled-release" (Theophylline CR, no
  // competing plain/SR sibling, would have been safe alone) AND an abbreviation for "Cream"
  // (TRIAMCINOLONE (5g) Cr. 0.1%, which already uniquely matches today) — stripping it collapses
  // the Triamcinolone cream/lotion/paste trio (all 0.1%, same ingredient) into a 3-way ambiguity,
  // breaking an already-correct match to fix one unmatched row. Left as manual review in
  // MedsScreen instead, same as Morphine's SR/IR.
  'human',
  // "Cal." (real case: sheet "Cal.polystyrene(kalimate)" — calcium polystyrene sulfonate, brand
  // Kalimate) is the same kind of salt/cation abbreviation "sod"/"sodium" above already covers;
  // the app's own brand-only name never spells out the salt form either.
  'cal',
  // "HCl" and "sulfate"/"sulphate" are salt-form suffixes this formulary is inconsistent about
  // including — same reasoning as "sod"/"sodium"/"cal" above (real cases: sheet "Hydralazine
  // HCl" vs the app's plain "HYDRALAZINE - PL 20 mg."; sheet "Morphine sulfate" vs the app's
  // plain "MORPHINE - PL 10 mg./ml."). This hospital never stocks the same active ingredient in
  // both a salt and a free-base form side by side, so dropping the salt name never risks
  // conflating two actually-different drugs — the active ingredient's own name still has to
  // match, and checked against every "hcl"/"sulfate" occurrence in both the app and the sheet,
  // nothing here depends on the salt form itself to tell two different real drugs apart.
  'hcl', 'sulfate', 'sulphate',
  // Full spelled-out "hydrochloride" (real case: the app's own "Terramycin-Oxytetracycline
  // hydrochlorideOINT." vs the sheet's plain "terramycin eye oint") — the same salt-form
  // suffix "hcl" above already drops, just spelled out in full instead of abbreviated; the
  // app's own naming is inconsistent about which form it uses, same as the sod/sodium and
  // cal/calcium pairs already handled.
  'hydrochloride',
]);

// A sheet row's own category, matched against a short list of the FORM_NOISE words that would
// most plausibly appear in the real dosage form for it — used ONLY to break a tie between more
// than one otherwise-matching app med (see CATEGORY_HINTS' own call site), never to accept a
// match that didn't already pass the real word-subset check above.
export const CATEGORY_HINTS = {
  'ยาเม็ด': ['tab', 'tablet', 'เม็ด', 'cap', 'capsule', 'แคปซูล', 'แค็บซูล', 'caplet'],
  'ยาฉีด': ['inj', 'injection', 'vial', 'amp', 'amphule', 'ampoule'],
  'ยาน้ำ': ['syrup', 'syr', 'susp', 'suspension', 'solution', 'sol'],
  'ยาใช้ภายนอก': ['cream', 'oint', 'ointment', 'lotion', 'drop', 'gel', 'patch', 'inhaler', 'mdi', 'nebule', 'suppository', 'enema', 'powder', 'douche', 'wash', 'paste'],
};

export function stripNoise(raw) {
  return (raw || '')
    .toLowerCase()
    // A few specific generic<->brand / spelled-out<->abbreviated phrasings this hospital's sheets
    // and app disagree on (real cases: sheet "Potassium Chloride KCL inj" vs the app's own plain
    // "KCl injection..."; sheet "Cal.polystyrene(kalimate)" vs the app's own "KALIMATE POWDER" —
    // calcium polystyrene sulfonate is Kalimate's generic name). Each pair names the exact same
    // real drug, so normalizing both sides to one spelling only ever equates a drug with itself.
    .replace(/potassium\s*chloride/g, 'kcl')
    .replace(/polystyrene/g, 'kalimate')
    // "SO4" (real case: sheet "Atropine SO4 0.6 mg/1 ml" vs the app's own plain "ATROPINE inj
    // 0.6 mg./ml. Amphule (1 ml.)") is the same kind of salt-form suffix FORM_NOISE's "hcl"/
    // "sulfate"/"sulphate" already drop — written as the chemical formula instead of the word.
    // Stripped HERE (a literal-phrase removal), not added to FORM_NOISE: it contains a digit,
    // so the digit/letter-splitting step further down would otherwise break it into "so"+"4"
    // before FORM_NOISE's token-by-token filter ever saw it as one word. Same safety reasoning
    // as the other salt-form entries: this hospital never stocks the same active ingredient as
    // both a salt and a free-base form side by side, so dropping it never risks conflating two
    // different drugs.
    .replace(/\bso4\b/g, ' ')
    // "กรัม" is the Thai word for "gram" (real case: the app's own "Activated Charcoal 50 กรัม"
    // vs the sheet's "50 g") — the same equivalence "gm"/"g" already gets below, just spelled in
    // Thai instead of abbreviated in English.
    .replace(/กรัม/g, 'g')
    // A trailing "20 mEql" in a sheet strength (real case: "Potassium Chloride KCL inj 20
    // mEql/10 ml") is this hospital's own transcription of "20 mEq" — the app names the exact
    // same 20 mEq / 10 ml amphule as "KCl injection 20 mEq. Amphule (10 ml.)", both the dose and
    // the volume agree, only the extra trailing "l" differs.
    .replace(/\bmeql\b/g, 'meq')
    // A wholesale pack-count suffix like "5gm*100's" ("100 sachets per box") describes how the
    // central warehouse boxes it, not the drug itself, and the app's own med name (one sachet)
    // never carries it — dropped the same way a container word already is.
    .replace(/\d+'s\b/g, ' ')
    // Parenthesized content is dropped UNLESS it holds a number — a bare abbreviation/brand/
    // route marker in parens ("(PL)", "(ERIG)", "(TIG)", "(NPH)") is noise the sheet never
    // repeats, but the app often puts a real required quantity there that the sheet states in
    // plain text (real case: sheet "Potassium Chloride KCL inj 20 mEql/10 ml" vs the app's own
    // "KCl injection 20 mEq. Amphule (10 ml.)" — the "10 ml" volume the row needs only exists
    // inside the app's parens). This only ever ADDS words to the app side, so it can only let a
    // match succeed that previously failed for lacking a word — it never drops a word a match
    // used to depend on.
    .replace(/\(([^)]*)\)/g, (_, inner) => (/\d/.test(inner) ? ` ${inner} ` : ' '))
    .replace(/[-–]\s*(pl|due|ned)\b/g, ' ')
    .replace(/[*#]/g, ' ')
    .replace(/\//g, ' ')
    // A number glued directly to its unit with no space ("1gm", "400U") is one token; the other
    // side often writes the same value with a space ("1 gm.", "400 U") — two tokens. Splitting a
    // digit run from an immediately-following (or preceding) letter run makes both sides tokenize
    // the same way; it can only split a glued token into finer pieces, never merge two already-
    // distinct words into one, so it never risks conflating two different drugs.
    .replace(/(\d)([a-zA-Z])/g, '$1 $2')
    .replace(/([a-zA-Z])(\d)/g, '$1 $2')
    // µg/μg (micro sign U+00B5, or Greek mu U+03BC — sheets use either) and "mcg" are the same
    // unit written differently (real case: sheet "Cytotec tab 200 µg" vs the app's own "Cytotec
    // 200 mcg. เม็ด").
    .replace(/[µμ]g/g, 'mcg')
    .replace(/mg\.?/g, 'mg')
    .replace(/ml\.?/g, 'ml')
    // "gm" and "g" are the same gram unit (real case: sheet "Cal.polystyrene(kalimate) 5gm" vs
    // the app's own "KALIMATE POWDER 5 g."); normalized after the digit-letter split above so
    // "5gm" has already become two tokens ("5", "gm") before this runs.
    .replace(/\bgm\.?\b/g, 'g')
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
    // ";" (real case: sheet "Sodium Bicarbonate 7.5% ; 50 ml" vs the app's own plain "SODIUM
    // BICARBONATE 7.5% 50 ml. Amphule") is this sheet's own stray field-separator punctuation —
    // never meaningful content, same treatment as "."/"," right below.
    .replace(/[.,;]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function rawWords(name) {
  return stripNoise(name).split(' ').filter(Boolean);
}

export function wordSet(parts) {
  const s = new Set();
  for (const p of parts) for (const w of rawWords(p)) if (!FORM_NOISE.has(w)) s.add(w);
  return s;
}

export function isSubset(small, big) {
  for (const w of small) if (!big.has(w)) return false;
  return true;
}

export function matchesCategoryHint(name, category) {
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

// Only run main() (which requires FIREBASE_SERVICE_ACCOUNT_KEY and connects to Firestore) when
// this file is actually run as a script — NOT when it's imported, which lets a verification
// harness (see scripts/ — any offline matcher-logic check) import the pure matching functions
// above (stripNoise/wordSet/isSubset/loadSheetRows/FORM_NOISE/CATEGORY_HINTS, all exported)
// without needing real Firebase credentials or touching production data at all.
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  });
}
