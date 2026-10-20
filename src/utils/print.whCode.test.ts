// Regression test for a real request: ใบเบิกยาเดิม (ก่อนใช้แอพนี้) มาจาก Google Sheet ที่มีรหัสยา
// ของคลังยาใหญ่เอง — "คลังจะใช้เลขนี้เพื่อใช้ในการทำเบิกยาจากคลังขึ้นมาห้องยา". printWarehouseRequestList
// (AppContext.tsx) now sets whCode on its rows; this locks in that printPickListSheet renders it
// as its own column AND that the other two pick-list sheets (which never set it) keep their
// current layout — see PickListRow.whCode's own doc comment for why this is optional/additive,
// same pattern as pickBin/par/route before it.
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
  { bin: 'A1', name: 'Amoxicillin 500mg', qty: 510, unit: 'เม็ด', whCode: 'WH-0042' },
  // A med nobody has entered a warehouse code for yet — falls back to '—', never an empty cell.
  { bin: 'B2', name: 'Insulin NPH', qty: 12, unit: 'ขวด', whCode: undefined },
];

const PLAIN_ROWS: PickListRow[] = [
  { bin: 'A1', name: 'Amoxicillin 500mg', qty: 30, unit: 'เม็ด' },
];

describe('printPickListSheet — รหัสยาคลัง column regression', () => {
  it('shows the รหัสยาคลัง column, falling back to "—" for a row with no code, when at least one row sets it', () => {
    const { getHtml } = captureWrittenHtml();
    printPickListSheet(WAREHOUSE_ROWS, 'ใบขอเบิกจากคลังใหญ่', 'ทดสอบ', { bin: 'ชั้นวาง substock', qty: 'จำนวนที่ควรเบิก' });
    const html = getHtml();

    expect(html).toContain('<th class="whcode">รหัสยาคลัง</th>');
    expect(html).toContain('<td class="whcode">WH-0042</td>');
    expect(html).toContain('<td class="whcode">—</td>');
  });

  it('never shows the รหัสยาคลัง column when no row sets it (the other two pick-list sheets)', () => {
    const { getHtml } = captureWrittenHtml();
    printPickListSheet(PLAIN_ROWS, 'ใบเติมหน้างานประจำวัน', 'ทดสอบ');
    const html = getHtml();

    expect(html).not.toContain('class="whcode"');
  });
});
