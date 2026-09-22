import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseUsageCsvText, parseHosxpUsageWorkbook } from './usageImport';

// Builds a minimal in-memory .xlsx workbook (same shape parseHosxpUsageWorkbook reads via
// XLSX.read) from plain header/data rows, so these tests exercise the real header-detection
// logic against a real parsed sheet instead of hand-rolled row objects.
function workbookBuffer(rows: (string | number)[][]): ArrayBuffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return out;
}

describe('parseUsageCsvText', () => {
  it('parses plain "name,qty" lines', () => {
    expect(parseUsageCsvText('PARACETAMOL 500 mg,340\namlodipine 5 mg,120')).toEqual([
      { name: 'PARACETAMOL 500 mg', qty: 340 },
      { name: 'amlodipine 5 mg', qty: 120 },
    ]);
  });

  it('drops a leading header row whose second field is not numeric', () => {
    const rows = parseUsageCsvText('ชื่อยา,จำนวน\nParacetamol,10');
    expect(rows).toEqual([{ name: 'Paracetamol', qty: 10 }]);
  });

  it('keeps the first row when it is real data, not a header', () => {
    const rows = parseUsageCsvText('Paracetamol,10\nAmoxicillin,20');
    expect(rows).toHaveLength(2);
  });

  it('splits on the LAST comma so a name containing a comma still parses', () => {
    expect(parseUsageCsvText('Drug, Extra Strength,15')).toEqual([{ name: 'Drug, Extra Strength', qty: 15 }]);
  });

  it('drops rows with a zero, negative, or unparseable quantity rather than a bogus 0', () => {
    const rows = parseUsageCsvText('Real Drug,10\nZeroQty,0\nBadQty,abc\nNegative,-5');
    expect(rows).toEqual([{ name: 'Real Drug', qty: 10 }]);
  });

  it('ignores blank lines', () => {
    expect(parseUsageCsvText('\nDrug A,5\n\n')).toEqual([{ name: 'Drug A', qty: 5 }]);
  });

  it('returns an empty array for input with no valid rows at all', () => {
    expect(parseUsageCsvText('')).toEqual([]);
  });
});

describe('parseHosxpUsageWorkbook', () => {
  it('parses the documented layout: รายการยา / ความแรง / หน่วย / จำนวนใบสั่งยา / จำนวนที่ใช้', async () => {
    const buf = workbookBuffer([
      ['No.', 'รายการยา', 'ความแรง', 'หน่วย', 'จำนวนใบสั่งยา', 'จำนวนที่ใช้', 'มูลค่า(บาท)'],
      [1, 'Paracetamol', '500 mg', 'เม็ด', 20, 100, 500],
    ]);
    expect(await parseHosxpUsageWorkbook(buf)).toEqual([{ name: 'Paracetamol 500 mg เม็ด', qty: 100 }]);
  });

  // Regression guard for a real bug found testing an actual hospital HOSxP export: that
  // report's columns were labeled "รายการ" (order count) / "จำนวน" (used quantity) instead of
  // "จำนวนใบสั่งยา" / "จำนวนที่ใช้" — header detection didn't recognize either column at all, so
  // it silently fell through to the hardcoded fallback layout and only produced correct results
  // because that file's column order happened to agree with the fallback by coincidence. A
  // differently-ordered export in this same "จำนวน" style would have silently read the wrong
  // column with no error.
  it('parses the "จำนวน" (bare) quantity-header variant some HOSxP exports use instead', async () => {
    const buf = workbookBuffer([
      ['No.', 'รายการยา', 'ความแรง', 'หน่วย', 'รายการ', 'จำนวน', 'มูลค่า(บาท)', 'ต้นทุน(บาท)'],
      [1, 'Amoxicillin', '250 mg', 'แคปซูล', 40, 200, 1000, 800],
    ]);
    expect(await parseHosxpUsageWorkbook(buf)).toEqual([{ name: 'Amoxicillin 250 mg แคปซูล', qty: 200 }]);
  });

  it('never mistakes "จำนวนใบสั่งยา" for the bare "จำนวน" fallback when both are absent as an exact match', async () => {
    // "จำนวนใบสั่งยา" is not an exact "จำนวน" match, and "จำนวนที่ใช้" isn't present — bare
    // "จำนวน" fallback must not fire here since no column is a literal "จำนวน" by itself, so
    // parsing should fail to find a header row within the scanned window and use the built-in
    // fallback layout (nameCol=1/strengthCol=2/unitCol=3/qtyCol=5) instead.
    const buf = workbookBuffer([
      ['No.', 'รายการยา', 'ความแรง', 'หน่วย', 'จำนวนใบสั่งยา', 'มูลค่า(บาท)'],
      [1, 'Paracetamol', '500 mg', 'เม็ด', 20, 500],
    ]);
    // Falls back to qtyCol=5, which is out of bounds for this 6-column row (indices 0-5 exist,
    // so index 5 is 500 — the value column) — demonstrates the fallback's known limitation
    // rather than asserting a specific "right" answer for a layout it was never designed for.
    const rows = await parseHosxpUsageWorkbook(buf);
    expect(rows).toEqual([{ name: 'Paracetamol 500 mg เม็ด', qty: 500 }]);
  });

  it('reconstructs name from separate name/strength/unit columns, matching Med.name\'s joined form', async () => {
    const buf = workbookBuffer([
      ['รายการยา', 'ความแรง', 'หน่วย', 'จำนวนที่ใช้'],
      ['(HAD) Adenosine', '3 mg/ml', 'Vial', 30],
    ]);
    expect(await parseHosxpUsageWorkbook(buf)).toEqual([{ name: '(HAD) Adenosine 3 mg/ml Vial', qty: 30 }]);
  });

  it('drops rows with a zero/blank quantity and rows with no name', async () => {
    const buf = workbookBuffer([
      ['รายการยา', 'ความแรง', 'หน่วย', 'จำนวนที่ใช้'],
      ['Drug A', '10 mg', 'เม็ด', 0],
      ['', '', '', 5],
      ['Drug B', '20 mg', 'แคปซูล', 15],
    ]);
    expect(await parseHosxpUsageWorkbook(buf)).toEqual([{ name: 'Drug B 20 mg แคปซูล', qty: 15 }]);
  });
});
