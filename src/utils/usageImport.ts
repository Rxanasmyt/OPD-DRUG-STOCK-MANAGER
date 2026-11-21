export interface RawUsageRow {
  name: string;
  qty: number;
}

/** Loose numeric parse for a cell that might be a real number, a comma-grouped string
 * ("1,234.5"), or empty/dash — never throws, just contributes 0 when it can't make sense of
 * the cell rather than corrupting the row's total. */
function parseCellNumber(v: unknown): number {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  const n = parseFloat(String(v ?? '').replace(/,/g, '').trim());
  return isNaN(n) ? 0 : n;
}

function cellText(v: unknown): string {
  return String(v ?? '').trim();
}

/** The date range a HOSxP report states in its own title rows (above the column header), as ISO
 * 'YYYY-MM-DD' strings, or null when no date could be read. Accepts dd/mm/yyyy, dd-mm-yyyy and
 * dd.mm.yyyy (Buddhist-era years like 2569 are converted to CE) and ISO yyyy-mm-dd. With several
 * distinct dates the range is min..max; a single date means from === to. Used to cross-check the
 * file against the covered date range the pharmacist chose, so a file from the wrong day is caught
 * before it deducts stock for the wrong day. */
export function detectDateRange(texts: string[]): { from: string; to: string } | null {
  const found = new Set<string>();
  // Thai month names ("19 พฤศจิกายน 2569", abbreviations too) — what a real HOSxP title row prints.
  const THAI_MONTHS: string[][] = [
    ['มกราคม', 'ม.ค.'], ['กุมภาพันธ์', 'ก.พ.'], ['มีนาคม', 'มี.ค.'], ['เมษายน', 'เม.ย.'], ['พฤษภาคม', 'พ.ค.'], ['มิถุนายน', 'มิ.ย.'],
    ['กรกฎาคม', 'ก.ค.'], ['สิงหาคม', 'ส.ค.'], ['กันยายน', 'ก.ย.'], ['ตุลาคม', 'ต.ค.'], ['พฤศจิกายน', 'พ.ย.'], ['ธันวาคม', 'ธ.ค.'],
  ];
  const re = /(\d{4})-(\d{1,2})-(\d{1,2})|(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/g;
  const norm = (y: number, mo: number, d: number): string | null => {
    const year = y > 2400 ? y - 543 : y;
    if (year < 2000 || year > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    const dt = new Date(Date.UTC(year, mo - 1, d));
    if (dt.getUTCMonth() !== mo - 1) return null;
    return year + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
  };
  for (const t0 of texts) {
    const t = t0.replace(/[๐-๙]/g, (ch) => String(ch.charCodeAt(0) - 0x0E50));
    for (let mi = 0; mi < 12; mi++) {
      for (const name of THAI_MONTHS[mi]) {
        const esc = name.replace(/\./g, '\\.');
        for (const m of t.matchAll(new RegExp('(\\d{1,2})\\s*' + esc + '\\s*(\\d{4})', 'g'))) {
          const iso = norm(+m[2], mi + 1, +m[1]);
          if (iso) found.add(iso);
        }
      }
    }
    for (const m of t.matchAll(re)) {
      const iso = m[1] ? norm(+m[1], +m[2], +m[3]) : norm(+m[6], +m[5], +m[4]);
      if (iso) found.add(iso);
    }
  }
  if (!found.size) return null;
  const sorted = [...found].sort();
  return { from: sorted[0], to: sorted[sorted.length - 1] };
}

/**
 * Parses a real HOSxP "รายงานการใช้ยา" export (.xls/.xlsx) — the report a pharmacist actually
 * pulls from HOSxP, not a hand-built CSV. Columns observed in practice: No. / รายการยา /
 * ความแรง / หน่วย / จำนวนใบสั่งยา / จำนวนที่ใช้ / มูลค่า(บาท) — critically, the drug's name and
 * its strength are in SEPARATE columns there, while this app's own Med.name is always the
 * two joined together with the unit (e.g. "(HAD) Adenosine 3 mg/ml Vial" — see med_list.csv,
 * itself sourced from the same HOSxP export format), so a name-only match against just the
 * "รายการยา" column would miss almost everything. Reconstructs the same joined form before
 * matching.
 *
 * Column positions aren't hardcoded — the header row (wherever it actually lands; HOSxP
 * exports sometimes carry a title row or two above it) is located by matching known Thai
 * column headers, so a slightly different export layout (columns reordered, an extra column
 * inserted) still resolves correctly instead of silently reading the wrong column.
 *
 * `xlsx` (SheetJS) is a genuinely large library (~100kB gzipped) that only this one, rarely-
 * used import path needs — dynamically imported here instead of at module scope, so it's a
 * separate lazily-fetched chunk rather than weight every single page load pays up front.
 */
export interface HosxpParseResult {
  rows: RawUsageRow[];
  /** unreadable rows (no name / unparseable qty) */
  skipped: number;
  /** rows the file itself lists with a genuine 0 (= not dispensed) */
  zeroRows: number;
  dateRange: { from: string; to: string } | null;
  /** sheets that contained a recognisable report table and were read */
  sheetsRead: number;
  /** sheets skipped because they held no recognisable table (never silently — the caller warns) */
  sheetsIgnored: number;
  /** a multi-page export repeats its column header on every page — counted, not treated as drug rows */
  repeatedHeaders: number;
  /** "รวม / Total" footer rows ignored so they never masquerade as a drug */
  totalsIgnored: number;
  /** rows whose qty has a fractional part (rounded to whole units by the caller) */
  fractional: { name: string; qty: number }[];
}

// Thai labels must be the WHOLE cell (a drug could legitimately start with "รวม…"); English ones end at a word boundary.
const TOTAL_ROW = /^\s*(?:(?:รวมทั้งสิ้น|รวมทั้งหมด|ยอดรวม|รวม)\s*[:：]?\s*$|(?:grand\s*total|sub\s*-?\s*total|total|sum)\b)/i;

function parseSheetRows(rows: unknown[][], allowFallback: boolean): (Omit<HosxpParseResult, 'sheetsRead' | 'sheetsIgnored'> & { hadHeader: boolean }) | null {
  let headerIdx = -1, nameCol = -1, strengthCol = -1, unitCol = -1, qtyCol = -1;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const texts = (rows[r] || []).map((c) => cellText(c));
    const nc = texts.findIndex((t) => t.includes('รายการยา'));
    // Some report configurations label the qty column plainly "จำนวน" (exact match, never the
    // "จำนวนใบสั่งยา" order-count column), others "จำนวนที่ใช้" — tried in that priority order.
    let qc = texts.findIndex((t) => t.includes('จำนวนที่ใช้'));
    if (qc < 0) qc = texts.findIndex((t) => t === 'จำนวน');
    if (nc >= 0 && qc >= 0) {
      headerIdx = r; nameCol = nc; qtyCol = qc;
      strengthCol = texts.findIndex((t) => t.includes('ความแรง'));
      unitCol = texts.findIndex((t) => t.includes('หน่วย') && !t.includes('ใบสั่ง'));
      break;
    }
  }
  const hadHeader = headerIdx >= 0;
  if (!hadHeader) {
    // The first sheet keeps the legacy fixed layout as a last resort; later sheets must prove they are a table.
    if (!allowFallback) return null;
    headerIdx = 0; nameCol = 1; strengthCol = 2; unitCol = 3; qtyCol = 5;
  }
  // Title rows above the header (a real HOSxP report states its own date range there).
  const dateRange = detectDateRange(rows.slice(0, headerIdx).flatMap((r) => (r || []).map((c) => cellText(c))));

  const out: RawUsageRow[] = [];
  const fractional: { name: string; qty: number }[] = [];
  let skipped = 0, zeroRows = 0, repeatedHeaders = 0, totalsIgnored = 0;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue; // genuinely blank row
    const nameCell = cellText(row[nameCol]);
    const qtyText = cellText(row[qtyCol]);
    // A multi-page export repeats the column header on every page.
    if (nameCell.includes('รายการยา') && (qtyText === '' || qtyText.includes('จำนวน'))) { repeatedHeaders++; continue; }
    // "รวม / Total" footer rows (the label may sit in the No. column or the name column).
    if (TOTAL_ROW.test(nameCell) || (!nameCell && TOTAL_ROW.test(cellText(row[0])))) { totalsIgnored++; continue; }
    const name = [nameCol, strengthCol, unitCol]
      .filter((c) => c >= 0)
      .map((c) => cellText(row[c]))
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!name) { skipped++; continue; }
    const qty = parseCellNumber(row[qtyCol]);
    // qty<=0: a literal number 0 is a genuine "listed, dispensed 0"; blank/dash/unparseable is unreadable.
    if (qty <= 0) { if (qty === 0 && qtyText !== '' && !isNaN(parseFloat(String(row[qtyCol]).replace(/,/g, '')))) zeroRows++; else skipped++; continue; }
    if (!Number.isInteger(qty)) fractional.push({ name, qty });
    out.push({ name, qty });
  }
  return { rows: out, skipped, zeroRows, dateRange, repeatedHeaders, totalsIgnored, fractional, hadHeader };
}

/** A real HOSxP "รายงานสรุปการใช้เวชภัณฑ์ยา" export carries NO date in its own rows (only a print date in the
 * footer, which is the day it was printed, not the day it covers) — the pharmacist's habit is to put the covered
 * day in the file name, e.g. "..._Report_20-11-69.xls" (dd-mm-yy, Buddhist-era two-digit year). Returns that day as
 * ISO 'YYYY-MM-DD', or null. Only ever used to PRE-FILL the covered date; the pharmacist must still confirm it. */
export function detectDateFromFilename(fileName: string): string | null {
  const base = fileName.replace(/\.[A-Za-z0-9]+$/, '');
  const m = /(?:^|[^0-9])(\d{1,2})[-_.](\d{1,2})[-_.](\d{4}|\d{2})(?![0-9])/.exec(base);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  let y = +m[3];
  if (m[3].length === 2) y = y >= 40 ? 2500 + y : 2000 + y; // 69 → 2569 BE; 26 → 2026 CE
  const year = y > 2400 ? y - 543 : y;
  if (year < 2000 || year > 2100 || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  const dt = new Date(Date.UTC(year, mo - 1, d));
  if (dt.getUTCMonth() !== mo - 1) return null;
  return year + '-' + String(mo).padStart(2, '0') + '-' + String(d).padStart(2, '0');
}

/** Reads EVERY sheet of the workbook that holds a recognisable report table (the old version read only the
 * first sheet, so drugs on later sheets vanished silently), ignores repeated page headers and "รวม" rows. */
export async function parseHosxpUsageWorkbook(buf: ArrayBuffer): Promise<HosxpParseResult> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const empty: HosxpParseResult = { rows: [], skipped: 0, zeroRows: 0, dateRange: null, sheetsRead: 0, sheetsIgnored: 0, repeatedHeaders: 0, totalsIgnored: 0, fractional: [] };
  const names = wb.SheetNames;
  if (!names.length) return empty;
  const res: HosxpParseResult = { ...empty, rows: [], fractional: [] };
  const ranges: { from: string; to: string }[] = [];
  names.forEach((nm, i) => {
    const sheet = wb.Sheets[nm];
    if (!sheet) { res.sheetsIgnored++; return; }
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });
    const p = parseSheetRows(rows, i === 0);
    if (!p) { res.sheetsIgnored++; return; }
    res.sheetsRead++;
    res.rows.push(...p.rows);
    res.skipped += p.skipped; res.zeroRows += p.zeroRows; res.repeatedHeaders += p.repeatedHeaders; res.totalsIgnored += p.totalsIgnored;
    res.fractional.push(...p.fractional);
    if (p.dateRange) ranges.push(p.dateRange);
  });
  if (ranges.length) {
    res.dateRange = { from: ranges.map((r) => r.from).sort()[0], to: ranges.map((r) => r.to).sort().slice(-1)[0] };
  }
  return res;
}

// Bug fix (data integrity): a plain `lastIndexOf(',')` split (the previous approach here and
// in processHosxp's matching textarea parser in AppContext.tsx) breaks the moment the quantity
// itself has a Thai-locale thousand-separator comma — a real, plausible cell for any drug
// dispensed 1,000+ units in a day. "Paracetamol 500 mg,1,234" would split at the LAST comma
// (between "1" and "234"), stapling the stray "1" onto the drug name and truncating the qty to
// 234 — silently wrong, not just malformed. Matches from the end instead: the trailing run of
// digits/commas/decimal-point (optionally quoted) IS the quantity, however many commas it has
// inside it, and everything before the comma that introduces it is the name (which may itself
// still legitimately contain commas, e.g. "Drug A, formulation B,50" — regex backtracking finds
// the correct split by requiring the SUFFIX after it to be a complete, valid number to end of
// line, which "50" alone satisfies but " formulation B,50" does not).
export function splitNameQty(line: string): { name: string; qtyStr: string } | null {
  // Lazy (not greedy) on the name group — tries the SHORTEST possible name first, so it finds
  // the EARLIEST comma whose remainder is a complete, valid number to end-of-line. A greedy
  // `.*` here would do the opposite (prefer the longest name, i.e. the LAST comma), which is
  // exactly the bug this function exists to avoid — see the file-level comment above.
  const m = line.match(/^(.*?),\s*"?(-?[\d][\d,]*(?:\.\d+)?)"?\s*$/);
  if (!m) return null;
  return { name: m[1].trim().replace(/^"|"$/g, ''), qtyStr: m[2] };
}

/** Same lenient "name,qty" line parser processHosxp already uses — see splitNameQty() for how
 * the split itself works — plus a header-row sniff: a plain CSV export routinely leads with a
 * column-title row like "ชื่อยา,จำนวน" whose second field isn't a number, dropped rather than
 * parsed into a bogus 0-qty row. */
function parseUsageCsvLines(text: string): { rows: RawUsageRow[]; skipped: number } {
  let lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length) {
    const first = splitNameQty(lines[0]);
    if (!first || !/^-?[\d,]+(\.\d+)?$/.test(first.qtyStr)) lines = lines.slice(1);
  }
  let skipped = 0;
  const rows = lines
    .map((l) => {
      const split = splitNameQty(l);
      if (!split) { skipped++; return null; }
      const qty = parseCellNumber(split.qtyStr);
      if (qty > 0) return { name: split.name, qty };
      skipped++;
      return null;
    })
    .filter((x): x is RawUsageRow => !!x);
  return { rows, skipped };
}

export function parseUsageCsvText(text: string): RawUsageRow[] {
  return parseUsageCsvLines(text).rows;
}

// Bug fix (silent data loss): a malformed row (no comma, empty/unparseable qty cell) used to be
// dropped with zero trace — the caller only ever saw the surviving rows, with no way to tell
// "this file had 40 usable rows" apart from "this file had 40 usable rows AND we silently
// dropped 12 broken ones". A pharmacist importing a usage file for par suggestions had no way
// to know some of it never made it in. Same parsing logic as parseUsageCsvText, just also
// reporting how many lines didn't survive.
export function parseUsageCsvTextWithSkipped(text: string): { rows: RawUsageRow[]; skipped: number } {
  return parseUsageCsvLines(text);
}
