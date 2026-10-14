// Regression test for a real request: "อยากให้มีรายละเอียดของ par stock แต่ละตัว จำนวนที่ต้องเบิก
// เป็นจำนวนกล่อง มีรายละเอียดจำนวนเป็นเม็ดข้างล่าง และยอดคงเหลือ ณ ปัจจุบันที่ทำใบเบิก" —
// printWarehouseRequestList (AppContext.tsx) now sets par/curBalance/boxes on its rows; this
// locks in that printPickListSheet renders them as described AND that the other two pick-list
// sheets (ใบจัดยาเติมชั้น/ใบเติมหน้างานประจำวัน, which never set these) keep their original layout —
// see PickListRow.par's own doc comment for why this is optional/additive, same pattern as
// pickBin/route before it.
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

const WAREHOUSE_ROWS: PickListRow[] = [
  // Boxed med — primary display is the box count, with the exact unit qty as a secondary detail.
  { bin: 'A1', name: 'Amoxicillin 500mg', qty: 510, unit: 'เม็ด', par: 500, curBalance: 0, boxes: 17 },
  // Not a boxed med (no real packSize) — falls back to the plain qty/unit the other two sheets
  // already show, same as before this round.
  { bin: 'B2', name: 'Insulin NPH', qty: 12, unit: 'ขวด', par: 30, curBalance: 18, boxes: 0 },
];

const PLAIN_ROWS: PickListRow[] = [
  { bin: 'A1', name: 'Amoxicillin 500mg', qty: 30, unit: 'เม็ด' },
];

describe('printPickListSheet — par/คงเหลือ columns regression', () => {
  it('shows Par and คงเหลือ columns, and a box-primary/unit-secondary qty cell, when rows set them', () => {
    const { getHtml } = captureWrittenHtml();
    printPickListSheet(WAREHOUSE_ROWS, 'ใบขอเบิกจากคลังใหญ่', 'ทดสอบ', { bin: 'ชั้นวาง substock', qty: 'จำนวนที่ควรเบิก' });
    const html = getHtml();

    expect(html).toContain('<th class="par">Par</th>');
    expect(html).toContain('<th class="curbal">คงเหลือ</th>');
    // Boxed row: box count is the PRIMARY figure, exact unit qty is the secondary detail line.
    expect(html).toContain('<div class="qtybox">17 กล่อง</div>');
    expect(html).toContain('<div class="qtysub">510 เม็ด</div>');
    // Par/balance values printed for both rows.
    expect(html).toContain('<td class="par">500</td>');
    expect(html).toContain('<td class="curbal">0</td>');
    expect(html).toContain('<td class="par">30</td>');
    expect(html).toContain('<td class="curbal">18</td>');
  });

  it('falls back to a plain qty/unit cell for a row with no real box size (boxes: 0)', () => {
    const { getHtml } = captureWrittenHtml();
    printPickListSheet(WAREHOUSE_ROWS, 'ใบขอเบิกจากคลังใหญ่', 'ทดสอบ');
    const html = getHtml();

    // Insulin NPH (boxes: 0) must print as a plain "12 ขวด" cell, never a "0 กล่อง" line.
    expect(html).toContain('<td class="qty">12 ขวด</td>');
    expect(html).not.toContain('0 กล่อง');
  });

  it('never shows the Par/คงเหลือ columns or box-primary layout when no row sets par (the other two pick-list sheets)', () => {
    const { getHtml } = captureWrittenHtml();
    printPickListSheet(PLAIN_ROWS, 'ใบเติมหน้างานประจำวัน', 'ทดสอบ');
    const html = getHtml();

    expect(html).not.toContain('class="par"');
    expect(html).not.toContain('class="curbal"');
    expect(html).not.toContain('class="qtybox"');
    expect(html).toContain('<td class="qty">30 เม็ด</td>');
  });
});
