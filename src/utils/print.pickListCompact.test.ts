// Regression test for a real request: "ใบปริ้นใบเติมหน้างาน หรือเบิกจากคลัง ใช้พื้นที่เยอะทำให้
// เปลืองกระดาษ ช่วยลดพื้นที่การใช้แต่ข้อมูลยังครบถ้วนเหมือนเดิมครับ" — printPickListSheet (shared by
// ใบจัดยาเติมชั้น/ใบเติมหน้างานประจำวัน/ใบขอเบิกจากคลังใหญ่, the exact three documents named) got a
// tighter @page margin and table/letterhead/signoff padding. This only checks the two things that
// actually matter for the request: the page uses noticeably less space, and every row/column of
// real data is still printed — nothing dropped to get there.
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

const ROWS: PickListRow[] = [
  { bin: 'A1', name: 'Amoxicillin 500mg', qty: 30, unit: 'เม็ด' },
  { bin: 'B2', name: 'Cefazolin 1g', qty: 10, unit: 'Vial', pickBin: 'S20' },
];

const ROUTE_ROWS: PickListRow[] = [
  { bin: 'A1', name: 'Amoxicillin 500mg', qty: 30, unit: 'เม็ด', route: 'oral' },
  { bin: 'B2', name: 'Cefazolin 1g', qty: 10, unit: 'Vial', route: 'injection' },
  { bin: 'C3', name: 'Hydrocortisone Cream', qty: 2, unit: 'หลอด', route: 'other' },
];

afterEach(() => vi.restoreAllMocks());

describe('printPickListSheet — compact-layout regression', () => {
  it('uses a smaller @page margin and tighter table/letterhead padding than the old spacious layout', () => {
    const { getHtml } = captureWrittenHtml();
    printPickListSheet(ROWS, 'ใบเติมหน้างานประจำวัน', 'ทดสอบ');
    const html = getHtml();

    expect(html).toContain('@page { size: A4; margin: 10mm; }');
    // The old layout's own values must be gone, not just a new rule added alongside them.
    expect(html).not.toContain('margin: 16mm 14mm');
    expect(html).toContain('table.rows td { padding: 1.5mm 2.5mm;');
    expect(html).not.toContain('padding: 2.4mm 3mm');
  });

  it('still prints every row and column of real data — bin, pick-from bin, name, qty, unit', () => {
    const { getHtml } = captureWrittenHtml();
    printPickListSheet(ROWS, 'ใบเติมหน้างานประจำวัน', 'ทดสอบ');
    const html = getHtml();

    for (const r of ROWS) {
      expect(html).toContain(r.bin);
      expect(html).toContain(r.name);
      expect(html).toContain(r.unit);
    }
    expect(html).toContain('S20'); // the pick-from substock bin column
    expect(html).toContain('2 รายการ'); // row-count summary in the meta box
  });
});

// Regression test for a real request: "ใบเติมหน้างานประจำ และใบเบิกจากคลังให้แยกประเภทยากิน ยาฉีด
// ด้วยครับ" — printPickListSheet now groups by route the same way TransferScreen's own screen
// list already does, but ONLY when the caller's rows actually set `route` (printPickList, the
// cart-based ใบจัดยาเติมชั้น, never does — see its own doc comment on PickListRow.route).
describe('printPickListSheet — route-grouping regression', () => {
  it('groups rows under 💊/💉/📦 headers, in one continuous numbered table, when rows set route', () => {
    const { getHtml } = captureWrittenHtml();
    printPickListSheet(ROUTE_ROWS, 'ใบเติมหน้างานประจำวัน', 'ทดสอบ');
    const html = getHtml();

    expect(html).toContain('💊 ยากิน (1 รายการ)');
    expect(html).toContain('💉 ยาฉีด (1 รายการ)');
    expect(html).toContain('📦 อื่นๆ / ยังไม่ระบุประเภท (1 รายการ)');

    // Groups must stay intact (not interleaved) — oral header before its row, before the
    // injection header, before its row, before the unclassified header, before its row.
    const oralHeaderIdx = html.indexOf('💊 ยากิน');
    const oralRowIdx = html.indexOf(ROUTE_ROWS[0].name);
    const injHeaderIdx = html.indexOf('💉 ยาฉีด');
    const injRowIdx = html.indexOf(ROUTE_ROWS[1].name);
    const otherHeaderIdx = html.indexOf('📦 อื่นๆ');
    const otherRowIdx = html.indexOf(ROUTE_ROWS[2].name);
    expect(oralHeaderIdx).toBeLessThan(oralRowIdx);
    expect(oralRowIdx).toBeLessThan(injHeaderIdx);
    expect(injHeaderIdx).toBeLessThan(injRowIdx);
    expect(injRowIdx).toBeLessThan(otherHeaderIdx);
    expect(otherHeaderIdx).toBeLessThan(otherRowIdx);

    // Row numbering stays one continuous sequence across groups (1, 2, 3 — never restarting).
    expect(html).toMatch(/class="n">1<\/td>/);
    expect(html).toMatch(/class="n">2<\/td>/);
    expect(html).toMatch(/class="n">3<\/td>/);
  });

  it('never groups or shows a route header when no row sets route (the cart-based ใบจัดยาเติมชั้น)', () => {
    const { getHtml } = captureWrittenHtml();
    printPickListSheet(ROWS, 'ใบจัดยาเติมชั้น', 'ทดสอบ');
    const html = getHtml();

    expect(html).not.toContain('class="grouphead"');
    expect(html).not.toContain('ยากิน');
    expect(html).not.toContain('ยาฉีด');
  });

  it('suppresses the route headers when every row shares the same route', () => {
    const { getHtml } = captureWrittenHtml();
    printPickListSheet(
      [{ bin: 'B2', name: 'Cefazolin 1g', qty: 10, unit: 'Vial', route: 'injection' }],
      'ใบเติมหน้างานประจำวัน', 'ทดสอบ',
    );
    const html = getHtml();
    expect(html).not.toContain('class="grouphead"');
    expect(html).toContain('Cefazolin 1g');
  });
});
