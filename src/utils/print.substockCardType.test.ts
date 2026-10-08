// Regression test for a real request: "ตอนนี้ในบัตรสต็อค หรือใบหน้างาน ยังไม่มีรายละเอียดบอกว่าที่
// บอกเพิ่มหรือลบคือเกิดจากอะไร...ให้มีรายละเอียดที่ชัดเจนตรวจสอบย้อนหลังได้" — the printed sheet
// (🖨, the "ใบหน้างาน" staff print and keep at the shelf) used to only ever print วันที่/รับ/จ่าย/
// คงเหลือ/โดย, silently dropping the transaction-type + note detail the on-screen ledger and CSV
// export already showed. See SubstockCardRow's own doc comment (print.ts) for the full story.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { printSubstockCardSheet, type SubstockCardRow } from './print';

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

const MED = { code: 'MED-0001', name: 'Paracetamol 500mg', parSub: 500, unit: 'เม็ด', ward: 'opd' as const };
const ROWS: SubstockCardRow[] = [
  { ts: Date.now() - 86400000, received: 100, dispensed: 0, balance: 100, by: 'ทดสอบ ภก.', typeLabel: 'รับจากคลังใหญ่', note: 'FEFO lot L1' },
  { ts: Date.now(), received: 0, dispensed: 10, balance: 90, by: 'ทดสอบ ภก.', typeLabel: 'นับสต็อก substock ใหม่ (ปรับยอด)', note: 'นับได้น้อยกว่าระบบ 10 เม็ด — ตัดออกจาก lot ที่ใกล้หมดอายุที่สุดก่อน' },
];

afterEach(() => vi.restoreAllMocks());

describe('printSubstockCardSheet — type/note detail column regression', () => {
  it('prints each row\'s type label and note, not just the bare รับ/จ่าย/คงเหลือ numbers', () => {
    const { getHtml } = captureWrittenHtml();
    printSubstockCardSheet(MED, ROWS);
    const html = getHtml();

    expect(html).toContain('ประเภท / รายละเอียด');
    for (const r of ROWS) {
      expect(html).toContain(r.typeLabel);
      expect(html).toContain(r.note);
    }
  });

  it('still renders a blank type cell (not a crash) for the ยอดยกมา opening-balance row', () => {
    const { getHtml } = captureWrittenHtml();
    expect(() => printSubstockCardSheet(MED, ROWS, 'all', { openingBalance: 50 })).not.toThrow();
    const html = getHtml();
    expect(html).toContain('ยอดยกมา');
  });
});
