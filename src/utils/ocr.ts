// Camera-assisted lot no./expiry-date entry via on-device OCR (Tesseract.js — runs entirely in
// the browser, downloads its own recognition model on first use, no API key, no server, no
// image ever leaves the device). This is explicitly an ASSIST, never a trusted auto-fill: drug
// packaging print is small, inconsistent, and often low-contrast, so real accuracy on a phone
// photo is genuinely mixed. Every call site using this must leave the fields editable and show
// the raw recognized text so a person can correct it before saving — never silently commit an
// OCR guess to a receive record.

export interface OcrLabelResult {
  lotNo: string | null;
  expIso: string | null; // 'YYYY-MM-DD', suitable straight into a <input type="date">
  rawText: string;
}

// Month name → number, covers the English 3-letter abbreviations HOSxP-adjacent drug packaging
// commonly prints (EXP DEC24, EXP 12/2025, etc.) — Thai-language printed dates on Thai-market
// packaging are almost always still Arabic-numeral Gregorian dates, not Thai script, so no Thai
// month-name table is needed here.
const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function toIso(y: number, mo: number, d: number): string | null {
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // 2-digit years on packaging are always "this century" in practice for a drug expiring years
  // from now — a lot printed with a 2-digit year in the 1900s would already be centuries
  // expired, never a real ambiguity worth handling.
  const year = y < 100 ? 2000 + y : y;
  if (year < 2020 || year > 2099) return null;
  return year + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** Best-effort expiry-date extraction from raw OCR text — tries the shapes actually seen on
 * drug packaging, most specific first: DD/MM/YYYY or DD-MM-YYYY, MM/YYYY (day defaults to the
 * last day of that month, matching how a month-only expiry is conventionally treated), and
 * "DD MON YYYY" with an English month abbreviation. Returns null rather than a wrong guess when
 * nothing matches — an empty date field prompting manual entry beats a confidently wrong one. */
function extractExpiry(text: string): string | null {
  const dmy = text.match(/\b(\d{1,2})[.\-/](\d{1,2})[.\-/](\d{2,4})\b/);
  if (dmy) {
    const iso = toIso(parseInt(dmy[3], 10), parseInt(dmy[2], 10), parseInt(dmy[1], 10));
    if (iso) return iso;
  }
  const monthYear = text.match(/\b(\d{1,2})[.\-/](\d{4})\b/);
  if (monthYear) {
    const mo = parseInt(monthYear[1], 10);
    const year = parseInt(monthYear[2], 10);
    if (mo >= 1 && mo <= 12) {
      const lastDay = new Date(year, mo, 0).getDate();
      const iso = toIso(year, mo, lastDay);
      if (iso) return iso;
    }
  }
  const dMonY = text.match(/\b(\d{1,2})\s*([A-Za-z]{3})[A-Za-z]*\s*(\d{2,4})\b/);
  if (dMonY) {
    const mo = MONTHS[dMonY[2].toLowerCase()];
    if (mo) {
      const iso = toIso(parseInt(dMonY[3], 10), mo, parseInt(dMonY[1], 10));
      if (iso) return iso;
    }
  }
  return null;
}

/** Best-effort lot number extraction — looks for "LOT"/"L/N"/"BATCH" (case-insensitive, the
 * three labels actually printed on packaging) followed by an alphanumeric code, falling back to
 * the first bare alphanumeric-with-a-digit token of plausible length so a label that's just the
 * code with no prefix still has a chance of matching. */
function extractLotNo(text: string): string | null {
  const labeled = text.match(/(?:LOT|L\/N|BATCH)[^A-Za-z0-9]{0,4}([A-Z0-9][A-Z0-9\-]{2,14})/i);
  if (labeled) return labeled[1].toUpperCase();
  const bare = text.match(/\b([A-Z0-9]{4,12})\b/i);
  if (bare && /\d/.test(bare[1])) return bare[1].toUpperCase();
  return null;
}

/**
 * Runs OCR on a captured label photo and pulls out a lot number + expiry date guess. Loads
 * tesseract.js lazily (a multi-MB engine + trained-data download only this one optional flow
 * needs — never worth it in the main bundle everyone downloads on every visit).
 */
export async function recognizeLotLabel(image: File | Blob): Promise<OcrLabelResult> {
  const { default: Tesseract } = await import('tesseract.js');
  const { data } = await Tesseract.recognize(image, 'eng');
  const rawText = data.text || '';
  return { lotNo: extractLotNo(rawText), expIso: extractExpiry(rawText), rawText };
}
