/**
 * Parses the text OCR read off a drug box / blister label into the two fields the receive form
 * needs: Lot no. and expiry date. Pure and deterministic (all OCR itself lives in ocrEngine.ts) so
 * the accuracy rules are unit-tested. Deliberately conservative: a value is only offered as a
 * candidate when it is anchored to a keyword (EXP / LOT / BATCH …) or is an unambiguous date, and
 * the UI always shows the candidates for the pharmacist to confirm — a wrong lot/expiry must never
 * be saved silently.
 */
export interface ExpiryCandidate { iso: string; raw: string; plausible: boolean; anchored: boolean; votes?: number }
export interface LotCandidate { value: string; raw: string; anchored: boolean; votes?: number }
export interface LabelParse {
  expiries: ExpiryCandidate[]; lots: LotCandidate[]; words: string[];
  /** true when the top expiry is trustworthy enough to pre-fill: keyword-anchored, or the latest of 2+ plausible dates (expiry is always after manufacture). */
  expiryConfident: boolean;
}

const MONTHS: Record<string, number> = {
  JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, JUN: 6, JUL: 7, AUG: 8, SEP: 9, SEPT: 9, OCT: 10, NOV: 11, DEC: 12,
  JANUARY: 1, FEBRUARY: 2, MARCH: 3, APRIL: 4, JUNE: 6, JULY: 7, AUGUST: 8, SEPTEMBER: 9, OCTOBER: 10, NOVEMBER: 11, DECEMBER: 12,
  'ม.ค.': 1, 'ก.พ.': 2, 'มี.ค.': 3, 'เม.ย.': 4, 'พ.ค.': 5, 'มิ.ย.': 6, 'ก.ค.': 7, 'ส.ค.': 8, 'ก.ย.': 9, 'ต.ค.': 10, 'พ.ย.': 11, 'ธ.ค.': 12,
};

const EXP_SRC = /(?:EXP(?:IRY|IRE|IRES)?\.?\s*(?:DATE|DT)?|E\.?D\.?|USE\s*BY|USE\s*BEFORE|BEST\s*BEFORE|BB|หมดอายุ|วันหมดอายุ|ควรใช้ก่อน)/;
const MFG_SRC = /(?:MFG|MFD|MANUF(?:ACTURED)?|PROD(?:UCTION)?|DOM|วันผลิต|ผลิต)/;
const LOT_SRC = /(?:LOT\s*(?:NO|NUMBER|#)?|BATCH\s*(?:NO|NUMBER|#)?|B\s*\.\s*NO|B\/N|BN|L\s*[/.]?\s*[CG]|เลขที่ผลิต|ล็อต|ลอท)/;
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
  // Printed/stamped dates without punctuation. Inkjet boxes print "30 10 28", "301028", or a slashed
  // font OCR reads as a digit ("27/02/26" → "27702726"). Year must be a plausible 2-digit year.
  const yy = (v: number) => (v >= 20 && v <= 45 ? v : -1);
  for (const m of s.matchAll(/(?<!\d)(\d{1,2}) {1,3}(\d{2}) {1,3}(\d{2})(?!\d)/g)) if (yy(+m[3]) > 0) take(m, iso(+m[3], +m[2], +m[1]));
  for (const m of s.matchAll(/(?<!\d)(\d{2})[17](\d{2})[17](\d{2})(?!\d)/g)) if (yy(+m[3]) > 0) take(m, iso(+m[3], +m[2], +m[1]));
  for (const m of s.matchAll(/(?<!\d)(\d{2})(\d{2})(\d{2})(?!\d)/g)) if (yy(+m[3]) > 0) take(m, iso(+m[3], +m[2], +m[1]));
  // mm/yyyy, mm-yy
  for (const m of s.matchAll(/(?<![\d/.-])(\d{1,2})\s*[-/.]\s*(\d{4}|\d{2})(?![\d/.-])/g)) take(m, iso(+m[2], +m[1], null));
  return out.sort((a, b) => a.index - b.index);
}

function plausible(isoDate: string, now: number): boolean {
  const t = Date.parse(isoDate + 'T00:00:00Z');
  return t > now - 365 * 864e5 && t < now + 12 * 365 * 864e5;
}

/** Top (latest) date is trustworthy when keyword-anchored, or when another date 0.5–8 years earlier
 * exists — the manufacture/expiry pair every box prints — so a lone stray date never auto-fills. */
function isConfident(sorted: ExpiryCandidate[]): boolean {
  const top = sorted[0];
  if (!top || !top.plausible) return false;
  // Another plausible reading in the same month with at least as many votes (e.g. 27 vs 28 Feb) —
  // OCR itself is unsure of the day, so don't pre-fill; show both and let the pharmacist pick.
  if (sorted.slice(1).some((o) => o.plausible && o.iso.slice(0, 7) === top.iso.slice(0, 7) && (o.votes || 1) >= (top.votes || 1))) return false;
  if (top.anchored) return true;
  const t = Date.parse(top.iso + 'T00:00:00Z');
  return sorted.slice(1).some((o) => {
    const yrs = (t - Date.parse(o.iso + 'T00:00:00Z')) / (365 * 864e5);
    return yrs >= 0.5 && yrs <= 8;
  });
}

const LOT_SHAPES = [
  /^[A-Z]{1,3}\s?\d{3,9}[A-Z]?$/, // "A 690092", "VS 649", "L690301"
  /^\d{2}[A-Z]\d{3,5}$/, // "26D171"
  /^\d{6,10}$/, // "26111189", "9715021"
  /^[A-Z0-9][A-Z0-9\-/.]{2,19}$/,
];
function lotShape(v: string, strict: boolean): boolean {
  if (!/\d/.test(v) || v.length < 3) return false;
  if (findDates(fixDigitTokens(v)).some((d) => d.raw.replace(/\s/g, '').length >= v.replace(/\s/g, '').length - 1)) return false;
  return (strict ? LOT_SHAPES.slice(0, 3) : LOT_SHAPES).some((r) => r.test(v));
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
  const addLot = (v: string, raw: string, anchored: boolean) => {
    const value = v.replace(/[.\-/]+$/, '').replace(/\s+/g, ' ').trim();
    const ex = lots.find((l) => l.value === value);
    if (ex) { ex.anchored = ex.anchored || anchored; return; }
    lots.push({ value, raw, anchored });
  };
  const LOT_VAL = '([A-Z]{1,3}\\s?\\d{3,9}[A-Z]?|[A-Z0-9][A-Z0-9\\-/.]{2,19})';
  let firstDateLine = -1;
  for (let i = 0; i < lines.length; i++) {
    const up = lines[i].toUpperCase();
    const fixed = fixDigitTokens(up);
    const em = fixed.match(EXP_KEY);
    const mfgMatch = fixed.match(MFG_KEY);
    const dates = findDates(fixed);
    if (dates.length && firstDateLine < 0) firstDateLine = i;
    if (em && em.index != null) {
      const after = em.index + em[0].length;
      let hit = false;
      for (const d of dates) {
        if (d.index < after - 1) continue;
        if (mfgMatch && mfgMatch.index != null && mfgMatch.index < d.index && mfgMatch.index > em.index) continue;
        addExp(d, true); hit = true;
      }
      if (!hit && i + 1 < lines.length) {
        for (const d of findDates(fixDigitTokens(lines[i + 1].toUpperCase()))) addExp(d, true);
      }
    } else if (!mfgMatch) {
      for (const d of dates) addExp(d, false);
    } else if (mfgMatch.index != null) {
      // "MFG 01/2025 12/2027": MFG first then an unlabeled second date
      for (const d of dates.filter((x) => x.index > mfgMatch.index!)) addExp(d, false);
    }
    // Lot: keyword + value on the same line, else the next line, else the previous line
    // ("26111189 / L/C" — value printed above its label).
    const km = up.match(LOT_KEY);
    if (km && km.index != null) {
      const rest = up.slice(km.index + km[0].length);
      const lm = rest.match(new RegExp('^[\\s:.#\\-]{0,5}' + LOT_VAL));
      let got = false;
      if (lm && lotShape(lm[1], false) && !/^(NO|NUMBER)$/.test(lm[1])) { addLot(lm[1], lm[0].trim(), true); got = true; }
      // next line — skipping OCR junk lines of 1–2 characters ("<", "|") between label and value
      for (let j = i + 1; j < Math.min(lines.length, i + 4) && !got; j++) {
        if (lines[j].length < 3) continue;
        const nx = lines[j].toUpperCase().match(new RegExp('^' + LOT_VAL));
        if (nx && lotShape(nx[1], false)) { addLot(nx[1], nx[0], true); got = true; }
        break;
      }
      if (!got && i > 0) {
        const pv = lines[i - 1].toUpperCase().trim();
        if (lotShape(pv, true)) addLot(pv, pv, true);
      }
    }
  }
  // Structural fallback: no LOT keyword survived OCR — the stamped lot sits right above the first date.
  if (!lots.length && firstDateLine > 0) {
    const pv = lines[firstDateLine - 1].toUpperCase().trim();
    if (lotShape(pv, true)) addLot(pv, pv, false);
  }
  // Expiry is always the LATEST of the label's dates (manufacture comes first), so rank plausible
  // dates latest-first; confident when keyword-anchored or when 2+ plausible dates agree on that order.
  exp.sort((a, b) => Number(b.plausible) - Number(a.plausible) || b.iso.localeCompare(a.iso));
  const expiryConfident = isConfident(exp);
  lots.sort((a, b) => Number(b.anchored) - Number(a.anchored));
  const words: string[] = [];
  for (const w of textRaw.toUpperCase().split(/[\s,;|]+/)) {
    const t = w.replace(/^[^A-Z0-9]+|[^A-Z0-9]+$/g, '');
    if (t.length >= 4 && t.length <= 20 && /\d/.test(t) && /^[A-Z0-9\-/.]+$/.test(t) && !words.includes(t)) words.push(t);
  }
  return { expiries: exp, lots, words: words.slice(0, 12), expiryConfident };
}

/** OCR reads the letter D/O/Q as digit 0 (and I/L as 1) far more often than the reverse, so between
 * two equally-voted readings that differ only by that confusion, the one WITH the letter wins. */
function confusableRank(a: string, b: string): number {
  const key = (v: string) => v.replace(/[ODQ]/g, '0').replace(/[IL]/g, '1');
  if (key(a) !== key(b)) return 0;
  const letters = (v: string) => (v.match(/[A-Z]/g) || []).length;
  return letters(b) - letters(a);
}

/** Combine several OCR passes over the same photo: a value two independent passes agree on ranks
 * above one seen once (`votes`), which is the strongest accuracy signal available without a human. */
export function mergeParses(parses: LabelParse[], now = Date.now()): LabelParse {
  const exp = new Map<string, ExpiryCandidate>();
  const lots = new Map<string, LotCandidate>();
  const words: string[] = [];
  for (const p of parses) {
    for (const e of p.expiries) {
      const ex = exp.get(e.iso);
      if (ex) { ex.votes = (ex.votes || 1) + 1; ex.anchored = ex.anchored || e.anchored; } else exp.set(e.iso, { ...e, votes: 1 });
    }
    for (const l of p.lots) {
      const ex = lots.get(l.value);
      if (ex) { ex.votes = (ex.votes || 1) + 1; ex.anchored = ex.anchored || l.anchored; } else lots.set(l.value, { ...l, votes: 1 });
    }
    for (const w of p.words) if (!words.includes(w)) words.push(w);
  }
  const ex = [...exp.values()].sort((a, b) => Number(b.plausible) - Number(a.plausible) || b.iso.localeCompare(a.iso));
  void now;
  return {
    expiries: ex,
    lots: [...lots.values()].sort((a, b) => Number(b.anchored) - Number(a.anchored) || (b.votes || 0) - (a.votes || 0) || confusableRank(a.value, b.value)),
    words: words.slice(0, 12),
    expiryConfident: isConfident(ex),
  };
}
