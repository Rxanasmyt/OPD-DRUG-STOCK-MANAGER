/**
 * Shortens a drug's full master-data name down to "generic name + strength" for the shelf
 * label, where the point is reading it in one glance while shelving — trims packaging/
 * container detail (e.g. "(2 mL.)", "Vial", "Amphule", "ซอง") that's still on the master data
 * (used for search, matching HOSxP lines, etc.) but doesn't need to be on the printed label.
 * Display-only — never touches the underlying Med.name.
 */
// \b is a \w (ASCII word-char) boundary in JS regex, which never matches next to Thai
// script — so the English and Thai word lists need separate patterns, not one combined
// \b(...|...)\b, or the Thai half silently never matches.
const TRAILING_PACKAGING_EN =
  /\s*\b(vial|amphule|ampoule|ampule|tube|syringe|bag|bottle|sachet|inhaler|aerosol|suppository|cartridge|pen)\.?\s*$/i;
const TRAILING_PACKAGING_TH = /\s*(ซอง|ขวด|หลอด|แผง|ชุด)\s*$/;
const TRAILING_PAREN = /\s*\([^()]*\)\s*$/;
const TRAILING_PUNCT = /[.,;:\-–]+\s*$/;

/** ALL-CAPS Latin text (common in this formulary, e.g. "MAGNESIUM SULFATE") runs noticeably
 * wider per character than mixed case — weight the length estimate up when a name has no
 * lowercase letter at all, so it doesn't get sized as if it were narrower than it renders. */
function effectiveLength(title: string): number {
  return /[a-z]/.test(title) ? title.length : title.length * 1.15;
}

/** Picks the largest size step (as a 0–5 index, smaller is bigger) that still has a real
 * chance of fitting a shortened drug name on the shelf strip's one line — used to derive
 * both the print pt size and the on-screen preview px size from the same thresholds, so the
 * preview shows what will actually print. */
export function titleSizeStep(title: string): number {
  const n = effectiveLength(title);
  if (n <= 12) return 0;
  if (n <= 16) return 1;
  if (n <= 20) return 2;
  if (n <= 26) return 3;
  if (n <= 34) return 4;
  return 5;
}

export function shortLabelName(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  // A name can end in "... Amphule (2 mL.)" — parenthetical packaging note, then the bare
  // packaging word before it — so strip both, in both possible orders, a couple of passes.
  for (let i = 0; i < 2; i++) {
    const before = s;
    s = s.replace(TRAILING_PAREN, '').trim();
    s = s.replace(TRAILING_PACKAGING_EN, '').trim();
    s = s.replace(TRAILING_PACKAGING_TH, '').trim();
    if (s === before) break;
  }
  s = s.replace(TRAILING_PUNCT, '').trim();
  // Don't return an empty/near-empty string for a name that's nothing but packaging words
  return s.length >= 3 ? s : raw.trim();
}
