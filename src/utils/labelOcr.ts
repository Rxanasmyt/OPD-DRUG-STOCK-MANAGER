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

const EXP_SRC = /(?:EXP(?:IRY|IRE|IRES)?\.?\s*(?:DATE|DT)?|E\.?D\.?|USE\s*BY|USE\s*BEFORE|BEST\s*BEFORE|BB|หมดอายุ|วันหมดอายุ|ควรใช้ก่อน)/;
const MFG_SRC = /(?:MFG|MFD|MANUF(?:ACTURED)?|PROD(?:UCTION)?|DOM|วันผลิต|ผลิต)/;
const LOT_SRC = /(?:LOT\s*(?:NO|NUMBER|#)?|BATCH\s*(?:NO|NUMBER|#)?|B\s*\.\s*NO|B\/N|BN|L\s*[/.]?\s*[CG]|เลขที่ผลิต|ล็อต|ลอท)/;
// Short keywords (ED, BB, BN, DOM) must not fire inside ordinary words ("MED", "SLOT").
// No regex lookbehind anywhere in this app: Safari/iOS < 16.4 throws a SyntaxError on it and the whole bundle
// fails to load. "Not preceded by X" is emulated by findFrom()/findKey() below.
const wrap = (r: RegExp) => new RegExp(r.source + '(?![A-Z])', 'g');
/** All matches of `re` (global) in `s` whose start is not immediately preceded by a char matching `forbidPrev`. */
function findAll(re: RegExp, s: string, forbidPrev?: RegExp): RegExpMatchArray[] {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  const out: RegExpMatchArray[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(s))) {
    if (forbidPrev && m.index > 0 && forbidPrev.test(s[m.index - 1])) { g.lastIndex = m.index + 1; continue; }
    out.push(m);
    if (m[0].length === 0) g.lastIndex++;
  }
  return out;
}
function findKey(re: RegExp, s: string): RegExpMatchArray | null {
  return findAll(re, s, /[A-Z]/)[0] || null;
}
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

const MON = '(JAN(?:UARY)?|FEB(?:RUARY)?|MAR(?:CH)?|APR(?:IL)?|MAY|JUNE?|JULY?|AUG(?:UST)?|SEP(?:T(?:EMBER)?)?|OCT(?:OBER)?|NOV(?:EMBER)?|DEC(?:EMBER)?)';
const MON_ORDER = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
const monNum = (name: string) => MON_ORDER.indexOf(name.slice(0, 3)) + 1;

// Thai month names (full + abbreviated, with or without the dots OCR often drops) → English 3-letter.
const THAI_MON: Array<[RegExp, string]> = [
  [/มกราคม|ม\.?\s?ค\.?/g, ' JAN '], [/กุมภาพันธ์|ก\.?\s?พ\.?/g, ' FEB '], [/มีนาคม|มี\.?\s?ค\.?/g, ' MAR '],
  [/เมษายน|เม\.?\s?ย\.?/g, ' APR '], [/พฤษภาคม|พ\.?\s?ค\.?/g, ' MAY '], [/มิถุนายน|มิ\.?\s?ย\.?/g, ' JUN '],
  [/กรกฎาคม|ก\.?\s?ค\.?/g, ' JUL '], [/สิงหาคม|ส\.?\s?ค\.?/g, ' AUG '], [/กันยายน|ก\.?\s?ย\.?/g, ' SEP '],
  [/ตุลาคม|ต\.?\s?ค\.?/g, ' OCT '], [/พฤศจิกายน|พ\.?\s?ย\.?/g, ' NOV '], [/ธันวาคม|ธ\.?\s?ค\.?/g, ' DEC '],
];

/** Normalise a line before date-hunting: Thai digits → Arabic, Thai month names → English, drop the
 * พ.ศ./ค.ศ. era tags. Applied to every line so one set of patterns covers Thai and English. */
export function prepDateText(raw: string): string {
  let t = raw.replace(/[๐-๙]/g, (ch) => String(ch.charCodeAt(0) - 0x0E50));
  t = t.replace(/พ\.\s?ศ\.?|ค\.\s?ศ\.?/g, ' ');
  // "ผลิต/หมดอายุ" must survive; only month tokens that are followed by/preceded by digits are rewritten
  for (const [re, en] of THAI_MON) {
    t = t.replace(new RegExp(re.source, 'g'), (m: string, off: number, str: string) =>
      (/\d\s?$/.test(str.slice(0, off)) || /^\s?\d/.test(str.slice(off + m.length))) ? en : m);
  }
  return t;
}

/** Four- or two-digit year → CE. 2-digit: ≤62 is 20yy, ≥63 is Buddhist-era 25yy (e.g. 70 → 2570 → 2027). */
function yearOf(str: string): number {
  const n = +str;
  if (str.length === 4) return n > 2400 ? n - 543 : n;
  return n <= 62 ? 2000 + n : 1957 + n;
}

function iso(year: number, m: number, d: number | null): string | null {
  if (year < 2000 || year > 2100 || m < 1 || m > 12) return null;
  const last = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const day = d == null ? last : d;
  if (day < 1 || day > last) return null;
  return year + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
}

/** dd/mm vs mm/dd: day-first (Thai/EU) unless only month-first is possible (second part > 12). */
function dmy(a: number, b: number, year: number): string | null {
  if (a > 12) return iso(year, b, a);
  if (b > 12) return iso(year, a, b);
  return iso(year, b, a);
}

interface RawDate { iso: string; raw: string; index: number }

function findDates(sIn: string): RawDate[] {
  const s = prepDateText(sIn);
  const out: RawDate[] = [];
  const seen: Array<[number, number]> = [];
  const take = (m: RegExpMatchArray, v: string | null) => {
    if (!v || m.index == null) return;
    const a = m.index, b = a + m[0].length;
    if (seen.some(([x, y]) => a < y && b > x)) return;
    seen.push([a, b]);
    out.push({ iso: v, raw: m[0].trim(), index: a });
  };
  const all = (re: RegExp, forbidPrev?: RegExp) => findAll(re, s, forbidPrev);
  const SEPS = '[-/.,\\s]*';
  // 1. day month-name year: 31 DEC 2027, 31-Dec-27, 31DEC2027
  for (const m of all(new RegExp('(\\d{1,2})' + SEPS + MON + SEPS + '(\\d{4}|\\d{2})(?!\\d)', 'g'), /\d/)) take(m, iso(yearOf(m[3]), monNum(m[2]), +m[1]));
  // 2. month-name day year: DEC 31 2027, Dec-31-2027, DEC 31, 27
  for (const m of all(new RegExp('' + MON + '[-/.,\\s]*(\\d{1,2})(?!\\d)[-/.,\\s]+(\\d{4}|\\d{2})(?!\\d)', 'g'), /[A-Z]/)) take(m, iso(yearOf(m[3]), monNum(m[1]), +m[2]));
  // 3. year month-name day: 2027 DEC 31
  for (const m of all(new RegExp('(\\d{4})' + SEPS + MON + SEPS + '(\\d{1,2})(?!\\d)', 'g'), /\d/)) take(m, iso(yearOf(m[1]), monNum(m[2]), +m[3]));
  // 4. month-name year (month only): DEC 2027, DEC-27
  for (const m of all(new RegExp('' + MON + '[-/.,\\s]*(\\d{4}|\\d{2})(?!\\d)', 'g'), /[A-Z]/)) take(m, iso(yearOf(m[2]), monNum(m[1]), null));
  // 5. year-first numeric: 2027-12-31, 2027/12/31, 2027 12 31
  for (const m of all(/(\d{4})\s*[-/.\s]\s*(\d{1,2})\s*[-/.\s]\s*(\d{1,2})(?!\d)/g, /\d/)) take(m, iso(yearOf(m[1]), +m[2], +m[3]));
  // 6. day-first numeric: 31/12/2027, 31-12-27, 31.12.70, 31 12 2570, 12/31/2027
  for (const m of all(/(\d{1,2})\s*[-/.\s]\s*(\d{1,2})\s*[-/.\s]\s*(\d{4}|\d{2})(?!\d)/g, /\d/)) {
    // a two-digit year separated only by spaces ("26 02 26") must look like a CE year 20–45,
    // else lot numbers / barcodes split by spaces would pass as dates
    if (m[3].length === 2 && !/[-/.]/.test(m[0]) && !(+m[3] >= 20 && +m[3] <= 45)) continue;
    take(m, dmy(+m[1], +m[2], yearOf(m[3])));
  }
  // 6b. ddmm + year split by a gap ("3112 2027")
  for (const m of all(/(\d{2})(\d{2})\s(\d{4})(?!\d)/g, /\d/)) take(m, dmy(+m[1], +m[2], yearOf(m[3])));
  // 7. year-month: 2027/12, 2027-12
  for (const m of all(/(\d{4})\s*[-/.]\s*(\d{1,2})(?![\d/.-])/g, /\d/)) take(m, iso(yearOf(m[1]), +m[2], null));
  // 8. compact 8 digits: yyyymmdd, ddmmyyyy, and a slashed font whose "/" OCR read as 7 or 1
  for (const m of all(/(\d{8})(?!\d)/g, /\d/)) {
    const t = m[1];
    const a = /^(19|20)/.test(t) ? iso(+t.slice(0, 4), +t.slice(4, 6), +t.slice(6, 8)) : null;
    const b = iso(yearOf(t.slice(4)), +t.slice(2, 4), +t.slice(0, 2));
    const sl = /^(\d{2})[17](\d{2})[17](\d{2})$/.exec(t);
    const c = sl && +sl[3] >= 20 && +sl[3] <= 45 ? iso(2000 + +sl[3], +sl[2], +sl[1]) : null;
    take(m, a || b || c);
  }
  // 9. compact 6 digits: ddmmyy (year 20–45 only — 6-digit lots are common), else mmyyyy
  for (const m of all(/(\d{6})(?!\d)/g, /\d/)) {
    const t = m[1];
    const yy = +t.slice(4);
    const v = yy >= 20 && yy <= 45 ? iso(2000 + yy, +t.slice(2, 4), +t.slice(0, 2)) : null;
    take(m, v || (+t.slice(0, 2) <= 12 ? iso(yearOf(t.slice(2)), +t.slice(0, 2), null) : null));
  }
  // 10. month-year numeric: 12/2027, 12-27, 12 2027
  for (const m of all(/(\d{1,2})\s*[-/.\s]\s*(\d{4}|\d{2})(?![\d/.-])/g, /[\d/.-]/)) {
    if (m[2].length === 2 && !/[-/.]/.test(m[0]) && !(+m[2] >= 20 && +m[2] <= 45)) continue;
    take(m, iso(yearOf(m[2]), +m[1], null));
  }
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
    const em = findKey(EXP_KEY, fixed);
    const mfgMatch = findKey(MFG_KEY, fixed);
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
    const km = findKey(LOT_KEY, up);
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
