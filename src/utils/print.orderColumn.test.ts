// Regression test for a real request: "การปริ้นใบเบิก ให้ชื่อยาตามลำดับเหมือน gg sheet ให้ครบถ้วน" —
// printPickListSheet's default sort (by `bin`, shelf location) is right for the two floor-fill
// checklists but wrong for printWarehouseRequestByCategory (AppContext.tsx), which must list
// rows in the hospital's own original Google-Sheet row order instead. See PickListRow.order's
// own doc comment for why this is optional/additive, same pattern as par/whCode/carryOver
// before it.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { printPickListSheet, type PickListRow } from './print';

function captureWrittenHtml(): { getHtml: () => string } {
  let html = '';
  const fakeDoc = {
    open: () => {},
    write: (chunk: string) => { html += chunk; },
    close: () => {},
  };
  vi.spyOn(window, 'open').mockReturnValue({ document: fakeDoc } as unknown as Window);
  return { getHtml: () => html };
}

afterEach(() => vi.restoreAllMocks());

// Bins deliberately set in the OPPOSITE order from `order` — a pass just because bin-sort
// happened to agree with sheet order can't hide a real bug.
const ORDERED_ROWS: PickListRow[] = [
  { bin: 'Z9', name: 'ALLOPURINOL', qty: 500, unit: 'เม็ด', order: 2 },
  { bin: 'A1', name: 'Acyclovir/Zocovin - PL', qty: 70, unit: 'เม็ด', order: 0 },
  { bin: 'M5', name: 'ALBENdazole', qty: 50, unit: 'เม็ด', order: 1 },
];

describe('printPickListSheet — sheet-order (whCode) column regression', () => {
  it('sorts rows by `order` (sheet row position), not by bin, when every row sets it', () => {
    const { getHtml } = captureWrittenHtml();
    printPickListSheet(ORDERED_ROWS, 'ใบขอเบิกจากคลังใหญ่ — เม็ด', 'ทดสอบ');
    const html = getHtml();

    const posAcyclovir = html.indexOf('Acyclovir/Zocovin - PL');
    const posAlben = html.indexOf('ALBENdazole');
    const posAllo = html.indexOf('ALLOPURINOL');
    expect(posAcyclovir).toBeGreaterThan(-1);
    expect(posAcyclovir).toBeLessThan(posAlben);
    expect(posAlben).toBeLessThan(posAllo);
  });

  it('puts a row with no `order` set after every row that has one, never guessed into the middle', () => {
    const { getHtml } = captureWrittenHtml();
    const rowsWithOneUnset: PickListRow[] = [
      ...ORDERED_ROWS,
      { bin: 'A0', name: 'Unmatched Drug', qty: 10, unit: 'เม็ด' }, // bin sorts FIRST, order does not
    ];
    printPickListSheet(rowsWithOneUnset, 'ใบขอเบิกจากคลังใหญ่ — เม็ด', 'ทดสอบ');
    const html = getHtml();

    const posAllo = html.indexOf('ALLOPURINOL'); // order: 2, the last of the three ordered rows
    const posUnmatched = html.indexOf('Unmatched Drug');
    expect(posAllo).toBeGreaterThan(-1);
    expect(posUnmatched).toBeGreaterThan(posAllo);
  });

  it('keeps the original bin-only sort, unchanged, when no row sets `order` (the other two pick-list sheets)', () => {
    const { getHtml } = captureWrittenHtml();
    const binOnlyRows: PickListRow[] = [
      { bin: 'Z9', name: 'Zinc oxide', qty: 1, unit: 'เม็ด' },
      { bin: 'A1', name: 'Amoxicillin 500mg', qty: 1, unit: 'เม็ด' },
    ];
    printPickListSheet(binOnlyRows, 'ใบจัดยาเติมชั้น', 'ทดสอบ');
    const html = getHtml();

    expect(html.indexOf('Amoxicillin 500mg')).toBeLessThan(html.indexOf('Zinc oxide'));
  });
});
