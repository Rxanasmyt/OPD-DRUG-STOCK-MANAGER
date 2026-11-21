import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { parseUsageCsvText, parseUsageCsvTextWithSkipped, parseHosxpUsageWorkbook, detectDateRange, detectDateFromFilename } from './usageImport';

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

  // Regression guard: a plain lastIndexOf(',') split (the previous approach) breaks the moment
  // the quantity itself has a Thai-locale thousand-separator comma — splitting between "1" and
  // "234" instead of between the name and "1,234", stapling the stray "1" onto the drug name
  // and truncating the real quantity to 234. A day dispensing 1,000+ units of a common drug is
  // entirely plausible, not an edge case.
  it('does not mis-split when the quantity itself has a thousand-separator comma', () => {
    expect(parseUsageCsvText('Paracetamol 500 mg,1,234')).toEqual([{ name: 'Paracetamol 500 mg', qty: 1234 }]);
  });

  it('still splits on a comma-containing name correctly even alongside a comma-grouped qty', () => {
    expect(parseUsageCsvText('Drug A, Extra Strength,2,500')).toEqual([{ name: 'Drug A, Extra Strength', qty: 2500 }]);
  });

  it('returns an empty array for input with no valid rows at all', () => {
    expect(parseUsageCsvText('')).toEqual([]);
  });
});

describe('parseUsageCsvTextWithSkipped', () => {
  it('reports how many lines did not survive parsing, not just the rows that did', () => {
    const { rows, skipped } = parseUsageCsvTextWithSkipped('Real Drug,10\nZeroQty,0\nBadQty,abc\nNegative,-5\nNoComma');
    expect(rows).toEqual([{ name: 'Real Drug', qty: 10 }]);
    expect(skipped).toBe(4);
  });

  it('reports zero skipped for an all-valid file', () => {
    const { rows, skipped } = parseUsageCsvTextWithSkipped('Drug A,5\nDrug B,10');
    expect(rows).toHaveLength(2);
    expect(skipped).toBe(0);
  });
});

describe('parseHosxpUsageWorkbook', () => {
  it('parses the documented layout: รายการยา / ความแรง / หน่วย / จำนวนใบสั่งยา / จำนวนที่ใช้', async () => {
    const buf = workbookBuffer([
      ['No.', 'รายการยา', 'ความแรง', 'หน่วย', 'จำนวนใบสั่งยา', 'จำนวนที่ใช้', 'มูลค่า(บาท)'],
      [1, 'Paracetamol', '500 mg', 'เม็ด', 20, 100, 500],
    ]);
    expect((await parseHosxpUsageWorkbook(buf)).rows).toEqual([{ name: 'Paracetamol 500 mg เม็ด', qty: 100 }]);
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
    expect((await parseHosxpUsageWorkbook(buf)).rows).toEqual([{ name: 'Amoxicillin 250 mg แคปซูล', qty: 200 }]);
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
    const { rows } = await parseHosxpUsageWorkbook(buf);
    expect(rows).toEqual([{ name: 'Paracetamol 500 mg เม็ด', qty: 500 }]);
  });

  it('reconstructs name from separate name/strength/unit columns, matching Med.name\'s joined form', async () => {
    const buf = workbookBuffer([
      ['รายการยา', 'ความแรง', 'หน่วย', 'จำนวนที่ใช้'],
      ['(HAD) Adenosine', '3 mg/ml', 'Vial', 30],
    ]);
    const { rows, skipped } = await parseHosxpUsageWorkbook(buf);
    expect(rows).toEqual([{ name: '(HAD) Adenosine 3 mg/ml Vial', qty: 30 }]);
    expect(skipped).toBe(0);
  });

  // Bug fix (silent data loss, audit finding): this already asserted which rows SURVIVED, but
  // never checked that the two dropped rows were actually counted as skipped — before the fix,
  // parseHosxpUsageWorkbook had no skipped counter at all (always implicitly 0), so a caller
  // showing "ข้าม N แถว" had no way to know this exact scenario (a drug whose usage cell read
  // 0/blank, and a blank-name row) ever happened.
  it('drops rows with a zero/blank quantity and rows with no name, and counts both as skipped', async () => {
    const buf = workbookBuffer([
      ['รายการยา', 'ความแรง', 'หน่วย', 'จำนวนที่ใช้'],
      ['Drug A', '10 mg', 'เม็ด', 0],
      ['', '', '', 5],
      ['Drug B', '20 mg', 'แคปซูล', 15],
    ]);
    const { rows, skipped, zeroRows } = await parseHosxpUsageWorkbook(buf);
    expect(rows).toEqual([{ name: 'Drug B 20 mg แคปซูล', qty: 15 }]);
    // The explicit 0 is a genuine "listed, dispensed 0" row; only the nameless row is unreadable.
    expect(zeroRows).toBe(1);
    expect(skipped).toBe(1);
  });

  it('reads a real-layout row with a thousands-comma qty and Thai-month title date', async () => {
    const buf = workbookBuffer([
      ['รายงานการใช้ยา 19 พฤศจิกายน 2569 - 19 พฤศจิกายน 2569'],
      ['No.', 'รายการยา', 'ความแรง', 'หน่วย', 'รายการ', 'จำนวน'],
      [1, '10 mg. AMLODIPINE', '10 mg', 'เม็ด', 90, '1,558.00'],
    ]);
    const r = await parseHosxpUsageWorkbook(buf);
    expect(r.rows).toEqual([{ name: '10 mg. AMLODIPINE 10 mg เม็ด', qty: 1558 }]);
    expect(r.dateRange).toEqual({ from: '2026-11-19', to: '2026-11-19' });
  });
});

describe('detectDateRange — the date a HOSxP report states about itself', () => {
  it('reads Thai month names (full and abbreviated, BE year)', () => {
    expect(detectDateRange(['19 พฤศจิกายน 2569 - 21 พ.ย. 2569'])).toEqual({ from: '2026-11-19', to: '2026-11-21' });
  });
  it('reads a Buddhist-era dd/mm/yyyy range and converts it to CE ISO dates', () => {
    expect(detectDateRange(['รายงานการใช้ยา ตั้งแต่วันที่ 18/11/2569 ถึงวันที่ 18/11/2569'])).toEqual({ from: '2026-11-18', to: '2026-11-18' });
  });
  it('returns min..max across several dates and several cells', () => {
    expect(detectDateRange(['วันที่ 14-11-2569', 'ถึง 16.11.2569'])).toEqual({ from: '2026-11-14', to: '2026-11-16' });
  });
  it('accepts ISO and CE dates too', () => {
    expect(detectDateRange(['2026-11-18'])).toEqual({ from: '2026-11-18', to: '2026-11-18' });
    expect(detectDateRange(['18/11/2026'])).toEqual({ from: '2026-11-18', to: '2026-11-18' });
  });
  it('returns null when no date can be read, and ignores impossible dates', () => {
    expect(detectDateRange(['รายงานการใช้ยา', 'หน้า 1/3'])).toBeNull();
    expect(detectDateRange(['31/02/2569'])).toBeNull();
  });
});

describe('parseHosxpUsageWorkbook — reports the date range from its title rows', () => {
  it('finds the range above the header row, and null when the file states none', async () => {
    const header = ['No.', 'รายการยา', 'ความแรง', 'หน่วย', 'จำนวนใบสั่งยา', 'จำนวนที่ใช้'];
    const withDate = await parseHosxpUsageWorkbook(workbookBuffer([['รายงานการใช้ยา'], ['วันที่ 18/11/2569 - 18/11/2569'], header, [1, 'Paracetamol', '500 mg', 'เม็ด', 3, 40]]));
    expect(withDate.dateRange).toEqual({ from: '2026-11-18', to: '2026-11-18' });
    expect(withDate.rows).toHaveLength(1);
    const without = await parseHosxpUsageWorkbook(workbookBuffer([['รายงานการใช้ยา'], header, [1, 'Paracetamol', '500 mg', 'เม็ด', 3, 40]]));
    expect(without.dateRange).toBeNull();
  });
});

function multiSheetBuffer(sheets: (string | number)[][][]): ArrayBuffer {
  const wb = XLSX.utils.book_new();
  sheets.forEach((rows, i) => XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'S' + (i + 1)));
  return XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
}
const HDR = ['No.', 'รายการยา', 'ความแรง', 'หน่วย', 'รายการ', 'จำนวน'];

describe('parseHosxpUsageWorkbook — real-export shapes', () => {
  it('reads EVERY sheet that holds a report table (drugs on later sheets must not vanish)', async () => {
    const r = await parseHosxpUsageWorkbook(multiSheetBuffer([
      [HDR, [1, 'Drug A', '10 mg', 'เม็ด', 3, 5]],
      [HDR, [1, 'Drug B', '20 mg', 'เม็ด', 3, 7]],
      [['หมายเหตุ'], ['ไม่มีตาราง']],
    ]));
    expect(r.rows.map((x) => x.name)).toEqual(['Drug A 10 mg เม็ด', 'Drug B 20 mg เม็ด']);
    expect(r.sheetsRead).toBe(2);
    expect(r.sheetsIgnored).toBe(1);
  });
  it('a multi-page export repeats the column header — counted, not treated as drugs or "unreadable"', async () => {
    const r = await parseHosxpUsageWorkbook(workbookBuffer([
      HDR, [1, 'Drug A', '10 mg', 'เม็ด', 3, 5], HDR, [2, 'Drug B', '20 mg', 'เม็ด', 3, 7],
    ]));
    expect(r.rows).toHaveLength(2);
    expect(r.repeatedHeaders).toBe(1);
    expect(r.skipped).toBe(0);
  });
  it('ignores "รวม" / Total footer rows instead of offering them as a drug', async () => {
    const r = await parseHosxpUsageWorkbook(workbookBuffer([
      HDR, [1, 'Drug A', '10 mg', 'เม็ด', 3, 5], ['', 'รวม', '', '', 3, 5], ['Total', '', '', '', '', 5],
    ]));
    expect(r.rows).toHaveLength(1);
    expect(r.totalsIgnored).toBe(2);
  });
  it('reports rows with a fractional quantity (rounded later) instead of hiding the rounding', async () => {
    const r = await parseHosxpUsageWorkbook(workbookBuffer([HDR, [1, 'Drug A', '10 mg', 'เม็ด', 3, 2.5]]));
    expect(r.fractional).toEqual([{ name: 'Drug A 10 mg เม็ด', qty: 2.5 }]);
  });
});

describe('detectDateFromFilename', () => {
  it('reads dd-mm-yy Buddhist-era file names like the real HOSxP export', () => {
    expect(detectDateFromFilename('รายงานสรุปการใช้เวชภัณฑ์ยา_Report_20-11-69.xls')).toBe('2026-11-20');
  });
  it('reads 4-digit years (BE or CE) and other separators', () => {
    expect(detectDateFromFilename('usage 20.11.2569.xlsx')).toBe('2026-11-20');
    expect(detectDateFromFilename('usage_05-01-2026.xls')).toBe('2026-01-05');
  });
  it('returns null for impossible or absent dates', () => {
    expect(detectDateFromFilename('Report_31-02-69.xls')).toBeNull();
    expect(detectDateFromFilename('report.xls')).toBeNull();
    expect(detectDateFromFilename('Report_v2.1.3.xls')).toBeNull();
  });
});

describe('real HOSxP export shape (no title rows, strength-first names, print footer)', () => {
  it('reads header at row 0, keeps zero rows out, ignores the print-date footer', async () => {
    const buf = workbookBuffer([
      ['No.', 'รายการยา', 'ความแรง', 'หน่วย', 'รายการ', 'จำนวน', 'มูลค่า(บาท)', 'ต้นทุน(บาท)'],
      [1, '(HAD) ADREnaline - PL', '1 mg./ml.', 'Amphule (1 ml.)', '5', 9, 69.75, 54],
      [2, '(HAD) Adenosine', '3 mg/ml', 'Vial', '0', 0, 0, 0],
      [17, '10 mg. AMLODIPINE', '10 mg', 'เม็ด', '4', 121, 121, 38.72],
      ['ผู้พิมพ์ : x', 'พิมพ์จากเครื่อง RX-FRONT3  วันที่พิมพ์ 21 พฤศจิกายน 2569 เวลา 09:48 น.', 'CUSTOM-FORM', 'Page 16 of 16', '', '', '', ''],
    ]);
    const r = await parseHosxpUsageWorkbook(buf);
    expect(r.rows).toEqual([
      { name: '(HAD) ADREnaline - PL 1 mg./ml. Amphule (1 ml.)', qty: 9 },
      { name: '10 mg. AMLODIPINE 10 mg เม็ด', qty: 121 },
    ]);
    expect(r.zeroRows).toBe(1);
    expect(r.dateRange).toBeNull(); // the print date must never be mistaken for the covered day
  });
});
