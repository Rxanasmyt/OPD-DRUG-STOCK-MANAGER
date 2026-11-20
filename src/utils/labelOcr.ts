/**
 * Parses the text OCR read off a drug box / blister label into the two fields the receive form
 * needs: Lot no. and expiry date. Pure and deterministic (all OCR itself lives in ocrEngine.ts) so
 * the accuracy rules are unit-tested. Deliberately conservative: a value is only offered as a
 * candidate when it is anchored to a keyword (EXP / LOT / BATCH …) or is an unambiguous date, and
 * the UI always shows the candidates for the pharmacist to confirm — a wrong lot/expiry must never
 * be saved silently.
 */
export interface ExpiryCandidate { iso: string; raw: string; plausible: boolean; anchored: boolean }
export interface LotCandidate { value: string; raw: string; anchored: boolean }
export interface LabelParse { expiries: ExpiryCandidate[]; lots: LotCandidate[]; words: string[] }

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, JUNE: 6, JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
};

const EXP_SRC = /(?:EXP(?:IRY|IRE|IRES)?\.?\s*(?:DATE|DT)?|E\.?D\.?|USE\s*BY|USE\s*BEFORE|BEST\s*BEFORE|BB|หมดอายุ|วันหมดอายุ|ควรใช้ก่อน)/;
const MFG_SRC = /(?:MFG|MFD|MANUF(?:ACTURED)?|PROD(?:UCTION)?|DOM|วันผลิต|ผลิต)/;
const LOT_SRC = /(?:LOT\s*(?:NO|NUMBER|#)?|BATCH\s*(?:NO|NUMBER|#)?|B\s*\.\s*NO|B\/N|BN|เลขที่ผลิต|ล็อต|ลอท)/;
// Short keywords (ED, BB, BN, DOM) must not fire inside ordinary words ("MED", "SLOT").
const wrap = (r: RegExp) => new RegExp('(?<![A-Z])' + r.source + '(?![A-Z])');
const EXP_KEY = wrap(EXP_SRC);
const MFG_KEY = wrap(MFG_SRC);
const LOT_KEY = wrap(LOT_SRC);

/** Fix classic OCR digit confusions, but only inside tokens that otherwise look like a number/date. */
export function fixDigitTokens(text: string): string {
  return text.replace(/[^\s]+/g, (tok) => {
    if (!/^[\dOQIl|SB/\-.]+$/.test(tok)) return tok;
    if ((tok.match(/\d/g) || []).length < 2) return tok;
    return tok.replace(/[OQ]/g, '0').replace(/[Il|]/g, '1').replace(/S/g, '5').replace(/B/g, '8');
  });
}

function iso(y: number, m: number, d: number | null): string | null {
  const year = y > 2400 ? y - 543 : y < 100 ? 2000 + y : y;
  if (year < 2000 || year > 2100 || m < 1 || m > 12) return null;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const day = d == null ? last : d;
  if (day < 1 || day > last) return null;
  return year + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

interface RawDate { iso: string; raw: string; index: number }

function findDates(s: string): RawDate[] {
  const out: RawDate[] = [];
  const seen: Array<[number, number]> = [];
  const take = (m: RegExpMatchArray, v: string | null) => {
    if (!v || m.index == null) return;
    const a = m.index, b = a + m[0].length;
    if (seen.some(([x, y]) => a < y && b > x)) return;
    seen.push([a, b]);
    out.push({ iso: v, raw: m[0].trim(), index: a });
  };
  const monRe = '(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUNE?|JULY?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)';
  // DD MON YYYY / DD-MON-YY
  for (const m of s.matchAll(new RegExp('(?<!\\d)(\\d{1,2})\\s*[-./ ]?\\s*' + monRe + '\\s*[-./,]?\\s*(\\d{4}|\\d{2})(?!\\d)', 'g'))) take(m, iso(+m[3], MONTHS[m[2]], +m[1]));
  // MON YYYY / MON-YY
  for (const m of s.matchAll(new RegExp('(?<![A-Z])' + monRe + '\\s*[-./,]?\\s*(\\d{4}|\\d{2})(?!\\d)', 'g'))) take(m, iso(+m[2], MONTHS[m[1]], null));
  // yyyy-mm-dd / yyyy/mm/dd
  for (const m of s.matchAll(/(?<!\d)(\d{4})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{1,2})(?!\d)/g)) take(m, iso(+m[1], +m[2], +m[3]));
  // dd/mm/yyyy (also 2-digit year)
  for (const m of s.matchAll(/(?<!\d)(\d{1,2})\s*[-/.]\s*(\d{1,2})\s*[-/.]\s*(\d{4}|\d{2})(?!\d)/g)) take(m, iso(+m[3], +m[2], +m[1]));
  // yyyy-mm / yyyy/mm
  for (const m of s.matchAll(/(?<!\d)(\d{4})\s*[-/.]\s*(\d{1,2})(?![\d/.-])/g)) take(m, iso(+m[1], +m[2], null));
  // mm/yyyy, mm-yy
  for (const m of s.matchAll(/(?<![\d/.-])(\d{1,2})\s*[-/.]\s*(\d{4}|\d{2})(?![\d/.-])/g)) take(m, iso(+m[2], +m[1], null));
  return out.sort((a, b) => a.index - b.index);
}

function plausible(isoDate: string, now: number): boolean {
  const t = Date.parse(isoDate + 'T00:00:00Z');
  return t > now - 365 * 864e5 && t < now + 12 * 365 * 864e5;
}

export function parseLabelText(textRaw: string, now = Date.now()): LabelParse {
  const lines = textRaw.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const exp: ExpiryCandidate[] = [];
  const lots: LotCandidate[] = [];
  const addExp = (d: RawDate, anchored: boolean) => {
    const ex = exp.find((e) => e.iso === d.iso);
    if (ex) { ex.anchored = ex.anchored || anchored; return; }
    exp.push({ iso: d.iso, raw: d.raw, plausible: plausible(d.iso, now), anchored });
  };
  for (let i = 0; i < lines.length; i++) {
    const up = lines[i].toUpperCase();
    const fixed = fixDigitTokens(up);
    // The text window an expiry keyword governs: the rest of its line, or the next line when the
    // keyword sits alone ("EXP" / newline / "11/2027").
    const em = fixed.match(EXP_KEY);
    const mfgMatch = fixed.match(MFG_KEY);
    const dates = findDates(fixed);
    if (em && em.index != null) {
      const after = em.index + em[0].length;
      let hit = false;
      for (const d of dates) {
        if (d.index < after - 1) continue;
        // a date introduced by MFG (and before any EXP) is a manufacture date, not an expiry
        if (mfgMatch && mfgMatch.index != null && mfgMatch.index < d.index && mfgMatch.index > em.index) continue;
        addExp(d, true); hit = true;
      }
      if (!hit && i + 1 < lines.length) {
        for (const d of findDates(fixDigitTokens(lines[i + 1].toUpperCase()))) addExp(d, true);
      }
    } else if (!mfgMatch) {
      for (const d of dates) addExp(d, false);
    } else if (mfgMatch && mfgMatch.index != null) {
      // line carries MFG first then maybe an unlabeled second date (e.g. "MFG 01/2025 12/2027")
      const ds = dates.filter((d) => d.index > mfgMatch.index!);
      if (ds.length >= 2) addExp(ds[ds.length - 1], false);
    }
    // Lot
    const lm = up.match(new RegExp(LOT_KEY.source + '[\\s:.#\\-]{0,5}([A-Z0-9][A-Z0-9\\-/.]{2,19})', ''));
    if (lm) {
      const v = lm[1].replace(/[.\-/]+$/, '');
      if (/\d/.test(v) && v.length >= 3 && !findDates(v).some((d) => d.raw.length === v.length) && !/^(NO|NUMBER)$/.test(v)) {
        if (!lots.some((l) => l.value === v)) lots.push({ value: v, raw: lm[0].trim(), anchored: true });
      }
    } else if (LOT_KEY.test(up) && i + 1 < lines.length) {
      const nx = lines[i + 1].toUpperCase().match(/^([A-Z0-9][A-Z0-9\-/.]{2,19})/);
      if (nx && /\d/.test(nx[1]) && !lots.some((l) => l.value === nx[1])) lots.push({ value: nx[1], raw: nx[0], anchored: true });
    }
  }
  // anchored first, then plausible, then by date ascending (nearest expiry — the one that matters)
  exp.sort((a, b) => Number(b.anchored) - Number(a.anchored) || Number(b.plausible) - Number(a.plausible) || a.iso.localeCompare(b.iso));
  const words: string[] = [];
  for (const w of textRaw.toUpperCase().split(/[\s,;|]+/)) {
    const t = w.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
    if (t.length >= 4 && t.length <= 20 && /\d/.test(t) && /^[A-Z0-9\-/.]+$/.test(t) && !words.includes(t)) words.push(t);
  }
  return { expiries: exp, lots, words: words.slice(0, 12) };
}
