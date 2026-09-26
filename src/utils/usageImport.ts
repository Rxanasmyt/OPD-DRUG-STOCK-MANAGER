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
export async function parseHosxpUsageWorkbook(buf: ArrayBuffer): Promise<RawUsageRow[]> {
  const XLSX = await import('xlsx');
  const wb = XLSX.read(buf, { type: 'array' });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
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

  const out: RawUsageRow[] = [];
  for (let r = headerIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || !row.length) continue;
    const name = [nameCol, strengthCol, unitCol]
      .filter((c) => c >= 0)
      .map((c) => cellText(row[c]))
      .filter(Boolean)
      .join(' ')
      .trim();
    if (!name) continue;
    const qty = parseCellNumber(row[qtyCol]);
    if (qty <= 0) continue; // a 0-qty or unparseable row contributes nothing either way
    out.push({ name, qty });
  }
  return out;
}

/** Same lenient "name,qty" line parser processHosxp already uses — last comma splits name
 * from qty (works even if the name itself contains a comma) — plus a header-row sniff: a
 * plain CSV export routinely leads with a column-title row like "ชื่อยา,จำนวน" whose second
 * field isn't a number, dropped rather than parsed into a bogus 0-qty row. */
function parseUsageCsvLines(text: string): { rows: RawUsageRow[]; skipped: number } {
  let lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines.length) {
    const firstIdx = lines[0].lastIndexOf(',');
    const firstQty = firstIdx >= 0 ? lines[0].slice(firstIdx + 1).trim() : '';
    if (!/^-?\d+(\.\d+)?$/.test(firstQty)) lines = lines.slice(1);
  }
  let skipped = 0;
  const rows = lines
    .map((l) => {
      const idx = l.lastIndexOf(',');
      if (idx < 0) { skipped++; return null; }
      const name = l.slice(0, idx).trim().replace(/^"|"$/g, '');
      const qty = parseCellNumber(l.slice(idx + 1));
      if (qty > 0) return { name, qty };
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
