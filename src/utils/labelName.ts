/**
 * Shortens a drug's full master-data name down to just "generic name + strength" for the
 * shelf label, where the whole point is reading it in one glance while shelving — everything
 * else on the master-data name (dosage form, route, packaging/container, this hospital's own
 * "PL" formulary-list marker, a brand name tucked in parentheses) is display noise for that
 * purpose, not something that helps identify the drug or how much of it there is. Trimming it
 * out is also what buys back room for titleSizeStep() to render the remaining name+strength
 * bigger — a shorter effective string naturally lands on an earlier (larger-font) step.
 * Display-only — never touches the underlying Med.name.
 */
// \b is a \w (ASCII word-char) boundary in JS regex, which never matches next to Thai
// script — so the English and Thai word lists need separate patterns, not one combined
// \b(...|...)\b, or the Thai half silently never matches.
//
// Every dosage-form/route/container/administrative-code word gets stripped from ANYWHERE in
// the name (not just the end) — "Amiodarone injection 150 mg/3ml" has "injection" in the
// middle, "MORPHINE - PL 10 mg./ml" has this hospital's "PL" list-code in the middle, and
// neither would be caught by a trailing-only pattern. \b right after the alternation (before
// the optional period) requires a genuine whole-word match — "cap" never matches inside
// "Captopril" — the period is then allowed to follow without re-anchoring on it, since "." is
// already a non-word character and a second \b there behaves inconsistently across engines.
const NOISE_WORDS_EN =
  /\b(?:injection|inj|tablets?|tabs?|capsules?|caps?|cream|ointment|oint|syrup|suspension|susp|solution|sol|drops?|spray|patch|suppository|powder|gel|lotion|elixir|pl|vial|amphule|ampoules?|ampules?|amph?|tube|syringe|bag|bottle|sachet|inhaler|aerosol|cartridge|pen)\b\.?/gi;
const NOISE_WORDS_TH =
  /(?:เม็ด|แคปซูล|ยาฉีด|ฉีด|ครีม|ยาน้ำ|น้ำเชื่อม|ยาพ่น|ผง|เจล|ขี้ผึ้ง|ยาหยอด|ยาทา|ซอง|ขวด|หลอด|แผง|ชุด)/g;
const TRAILING_PUNCT = /[.,;:\-–]+\s*$/;
const LEADING_PUNCT = /^[.,;:\-–]+\s*/;

/** ALL-CAPS Latin text (common in this formulary, e.g. "MAGNESIUM SULFATE") runs noticeably
 * wider per character than mixed case — weight the length estimate up when a name has no
 * lowercase letter at all, so it doesn't get sized as if it were narrower than it renders. */
function effectiveLength(title: string): number {
  return /[a-z]/.test(title) ? title.length : title.length * 1.15;
}

/** Picks the largest size step (as a 0–7 index, smaller is bigger) that still has a real
 * chance of fitting a shortened drug name on the shelf strip — used to derive both the print
 * pt size and the on-screen preview px size from the same thresholds, so the preview shows
 * what will actually print. The strip title wraps up to 2 lines (see print.ts's
 * -webkit-line-clamp), so this only has to pick a size that keeps a name from truncating
 * across those two lines, not one that crams everything onto a single line.
 *
 * Bug fix: this used to stop at step 5 (a flat 9pt floor for anything over 34 chars) with the
 * title CSS forced to one line — a genuinely long name (common on HIGH ALERT drugs, which
 * tend to carry both a brand name in parentheses and a strength, e.g. "Norepinephrine
 * (Levophed) 1 mg./ml") still overflowed that single line at 9pt and printed truncated with
 * "…", on exactly the drugs where misreading the name on a shelf label matters most. Two more
 * steps (down to 7pt) plus the 2-line wrap give a 60+ character name real room instead of
 * being cut off mid-name. */
export function titleSizeStep(title: string): number {
  const n = effectiveLength(title);
  if (n <= 12) return 0;
  if (n <= 16) return 1;
  if (n <= 20) return 2;
  if (n <= 26) return 3;
  if (n <= 34) return 4;
  if (n <= 46) return 5;
  if (n <= 60) return 6;
  return 7;
}

export function shortLabelName(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  // Every parenthetical aside first — a brand name ("(Levophed)"), a packaging note
  // ("(2 mL.)"), whatever's inside — replaced with a space (not deleted outright) so
  // "Name(Brand) 5 mg" doesn't glue into "Name5 mg" once it's gone.
  s = s.replace(/\s*\([^()]*\)\s*/g, ' ');
  // Then every dosage-form/route/packaging/admin-code noise word, wherever it falls.
  s = s.replace(NOISE_WORDS_EN, ' ');
  s = s.replace(NOISE_WORDS_TH, ' ');
  // A leftover bare "-" that used to separate a now-removed word from the rest (e.g.
  // "MORPHINE - PL 10 mg./ml" → "MORPHINE -  10 mg./ml" once "PL" is gone) reads as an odd
  // dangling dash, not a real part of the name — collapse it along with the run of
  // whitespace around it. A hyphen genuinely inside a word (Co-trimoxazole) is untouched,
  // since there's no whitespace on both sides of it there.
  s = s.replace(/\s+-\s+/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(TRAILING_PUNCT, '').replace(LEADING_PUNCT, '').trim();
  // Don't return an empty/near-empty string for a name that's nothing but noise words once
  // trimmed — the original (however long) is still more useful on the shelf than nothing.
  return s.length >= 3 ? s : raw.trim();
}
