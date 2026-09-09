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

/** Runs the noise-word strip + dash/whitespace/punctuation cleanup shared by both the normal
 * (parens deleted) and fallback (parens unwrapped) passes below — kept as one function so the
 * two passes can't drift apart on anything but how they treat parentheses. */
function stripNoiseAndClean(s: string): string {
  s = s.replace(NOISE_WORDS_EN, ' ');
  s = s.replace(NOISE_WORDS_TH, ' ');
  s = s.replace(/\s+-\s+/g, ' ');
  s = s.replace(/\s{2,}/g, ' ').trim();
  s = s.replace(TRAILING_PUNCT, '').replace(LEADING_PUNCT, '').trim();
  return s;
}

/** Reference font size (px) the auto-fit measurement below renders at before scaling — large
 * enough that canvas sub-pixel rounding doesn't meaningfully skew the measured width. */
const FIT_REFERENCE_PX = 200;

/**
 * Finds the largest font size (px) that renders `text` within `maxWidthPx` on a single line,
 * for the given font weight/family — used to guarantee the shelf-strip title (see print.ts's
 * `.strip .title` and LabelsScreen's matching preview) always ends in one line, per what was
 * asked, instead of the old character-count heuristic (titleSizeStep/TITLE_PT_BY_STEP) that
 * only ever picked from a handful of discrete steps and was calibrated for a name that could
 * wrap onto a *second* line if it ran long — half the usable width once a name has to fit on
 * one line only. A fixed step table recalibrated for one line would still just be a guess
 * about average character width; real names mix narrow lowercase Latin, wide ALL-CAPS Latin,
 * and Thai script in every proportion, so guessing is exactly what causes the "some drug names
 * still don't feel proportioned right" complaint this exists to fix. Measuring the *actual*
 * glyphs with a canvas at a large reference size, then scaling that measured width down to fit,
 * is correct for any string instead of merely usually-close.
 *
 * Returns `maxPx` unscaled for an empty string (nothing to measure), and clamps the result to
 * `minPx` (a name that's too dense to render legibly at any size that fits ends up ellipsis-
 * truncated by the CSS `text-overflow: ellipsis` on the caller's single-line box, rather than
 * shrunk down to unreadable). Falls back to `maxPx` if canvas measurement isn't available at
 * all (e.g. a non-browser test/SSR context) — same as never having auto-fit, not a crash.
 */
export function fitSingleLineFontSizePx(
  text: string,
  maxWidthPx: number,
  maxPx: number,
  minPx: number,
  fontWeight = 800,
  fontFamily = "'Noto Sans Thai', system-ui, -apple-system, sans-serif",
): number {
  const trimmed = text.trim();
  if (!trimmed || maxWidthPx <= 0) return maxPx;
  let ctx: CanvasRenderingContext2D | null = null;
  try {
    if (typeof document !== 'undefined') {
      ctx = document.createElement('canvas').getContext('2d');
    }
  } catch {
    ctx = null;
  }
  if (!ctx) return maxPx;
  ctx.font = `${fontWeight} ${FIT_REFERENCE_PX}px ${fontFamily}`;
  const naturalWidth = ctx.measureText(trimmed).width;
  if (naturalWidth <= 0) return maxPx;
  // Bug fix: fitting to exactly maxWidthPx left zero margin — a canvas's advance-width sum
  // (measureText) isn't pixel-identical to how the same browser lays out that text in a real
  // box (hinting/rounding differences of ~1px), so a "perfectly" fitted title routinely came
  // out a hair wider than its box once actually rendered, silently tripping the CSS
  // text-overflow: ellipsis backstop on the caller's box — every title looked truncated,
  // including ones with room to spare. Target 97% of the real width so the fitted size always
  // lands comfortably inside it.
  const fitted = (maxWidthPx * 0.97 / naturalWidth) * FIT_REFERENCE_PX;
  return Math.min(maxPx, Math.max(minPx, fitted));
}

export function shortLabelName(raw: string): string {
  const trimmedRaw = raw.trim();
  if (!trimmedRaw) return trimmedRaw;
  // Every parenthetical aside first — a brand name ("(Levophed)"), a packaging note
  // ("(2 mL.)"), whatever's inside — replaced with a space (not deleted outright) so
  // "Name(Brand) 5 mg" doesn't glue into "Name5 mg" once it's gone.
  let s = trimmedRaw.replace(/\s*\([^()]*\)\s*/g, ' ');
  // Then every dosage-form/route/packaging/admin-code noise word, wherever it falls, plus
  // dash/whitespace/punctuation cleanup.
  s = stripNoiseAndClean(s);
  // Bug fix: a name whose only digit/strength lives inside parentheses — e.g. "Aspirin (81
  // mg)" — used to come out as bare "Aspirin" once the paren-deletion pass above threw the
  // strength away with it, silently dropping the dose from the printed shelf label (exactly
  // what this function exists to always keep — see the module doc). Detect that: if the raw
  // name had a digit anywhere but the aggressively-stripped result has none left, redo the
  // strip with parentheses only unwrapped (kept, not deleted) so a strength written inside
  // them survives; still runs through the same noise-word/cleanup pass, so a packaging note
  // like "(2 mL.)" is still trimmed down to "2 mL." rather than surviving verbatim.
  if (/\d/.test(trimmedRaw) && !/\d/.test(s)) {
    s = stripNoiseAndClean(trimmedRaw.replace(/[()]/g, ' '));
  }
  // Don't return an empty/near-empty string for a name that's nothing but noise words once
  // trimmed — the original (however long) is still more useful on the shelf than nothing.
  return s.length >= 3 ? s : trimmedRaw;
}
