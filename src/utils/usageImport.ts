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
export async function parseHosxpUsageWorkbook(buf: ArrayBuffer): Promise<{ rows: RawUsageRow[]; skipped: number }> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return { rows: [], skipped: 0 };
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' });

  // Find the header row and its columns by matching label substrings — searched in this
  // priority order per role so a header that happens to contain more than one candidate
  // phrase (e.g. "จำนวนใบสั่งยา" containing "จำนวน") resolves to the right column, not just
  // whichever appears first left-to-right.
  let headerIdx = -1, nameCol = -1, strengthCol = -1, unitCol = -1, qtyCol = -1;
  for (let r = 0; r < Math.min(rows.length, 15); r++) {
    const row = rows[r] || [];
    const texts = row.map((c) => cellText(c));
    const nc = texts.findIndex((t) => t.includes('รายการยา'));
    // Bug fix (found testing a real exported file): some HOSxP report configurations label
    // this column plainly "จำนวน" instead of "จำนวนที่ใช้", with the order-count column
    // labeled "รายการ" instead of "จำนวนใบสั่งยา" — neither the "จำนวนที่ใช้" phrase nor the
    // fallback layout below matched that file's actual header row at all, so it silently fell
    // through to the fallback and only worked because that file's column order happened to
    // agree with it by coincidence. Try "จำนวนที่ใช้" first (unambiguous, matched before the
    // more generic "จำนวน" so it never collides with a genuine "จำนวนใบสั่งยา" column on the
    // same row); only when that's absent, accept a column whose text is EXACTLY "จำนวน" and
    // nothing else — an exact match (not .includes()) so it can never also match
    // "จำนวนใบสั่งยา" (which contains "จำนวน" as a substring but is never literally just that).
    let qc = texts.findIndex((t) => t.includes('จำนวนที่ใช้'));
    if (qc < 0) qc = texts.findIndex((t) => t === 'จำนวน');
    if (nc >= 0 && qc >= 0) {
      headerIdx = r; nameCol = nc; qtyCol = qc;
      strengthCol = texts.findIndex((t) => t.includes('ความแรง'));
      unitCol = texts.findIndex((t) => t.includes('หน่วย') && !t.includes('ใบสั่ง'));
      break;
    }
  }
  // Fall back to the exact layout this parser was written against if no header row matched
  // (a differently-shaped export) — still better than refusing to import anything.
  if (headerIdx < 0) { headerIdx = 0; nameCol = 1; strengthCol = 2; unitCol = 3; qtyCol = 5; }

  // Bug fix (silent data loss): this used to just `continue` on an empty name or an
  // unparseable/zero qty cell, exactly like the CSV path's own equivalent before
  // parseUsageCsvTextWithSkipped's fix — but unlike that fix, it was never carried over here,
  // even though this .xlsx path is the one actually used in daily practice (the CSV textarea
  // is the fallback). For processHosxpFile specifically, a row dropped here means that drug's
  // floor is never debited for the day at all — a silent divergence from the real shelf that
  // nothing else catches until either a physical count or the next day's check-stock-drift.mjs
  // run, with no indication of WHICH drug or WHY. Tracked the same way the CSV path already
  // does, so the caller can show the same "ข้าม N แถว" warning for both file types.
  const out: RawUsageRow[] = [];
  let skipped = 0;
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue; // a genuinely blank row (not a drug row at all) — not a parse failure
    const name = [nameCol, strengthCol, unitCol]
      .filter((c) => c >= 0)
      .map((c) => cellText(row[c]))
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!name) { skipped++; continue; }
    const qty = parseCellNumber(row[qtyCol]);
    // Same convention as parseUsageCsvLines: HOSxP's own usage report only ever lists a row for
    // a drug that was actually dispensed, so qty<=0 here means the cell was blank/dash/
    // unparseable, not a genuine "dispensed zero" — counted as skipped, not silently dropped.
    if (qty <= 0) { skipped++; continue; }
    out.push({ name, qty });
  }
  return { rows: out, skipped };
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
