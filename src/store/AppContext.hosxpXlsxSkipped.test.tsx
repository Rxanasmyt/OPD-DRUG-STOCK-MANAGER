// Regression test for a real audit finding: parseHosxpUsageWorkbook (the .xlsx/.xls parser —
// the file type actually pulled from HOSxP in daily practice, not the CSV textarea fallback)
// used to silently drop an unparseable/blank row with NO skipped-row count at all, while the
// CSV path already had one (parseUsageCsvTextWithSkipped). Both processHosxpFile (today's floor
// deduction) and importUsageFile (par-suggestion usage import) in AppContext.tsx hardcoded
// `skipped = 0` on the xlsx branch and always showed "0 rows skipped" worth of nothing — so a
// row that failed to parse from a real HOSxP export vanished with zero trace, silently
// under-deducting that drug's floor for the day. See usageImport.ts's own fix comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as XLSX from 'xlsx';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Drug B 20 mg แคปซูล', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 1,
};

// Same in-memory workbook builder usageImport.test.ts uses, wrapped as a real .xlsx File so it
// goes through processHosxpFile/importUsageFile's real FileReader.readAsArrayBuffer path.
function xlsxFile(name: string, rows: (string | number)[][]): File {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Report');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], name, { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}

// One row that parses fine, two that don't (a 0/blank qty cell and a blank name) — exactly the
// usageImport.test.ts scenario, run through the real AppContext file-reading path this time.
const ROWS: (string | number)[][] = [
  ['รายการยา', 'ความแรง', 'หน่วย', 'จำนวนที่ใช้'],
  ['Drug A', '10 mg', 'เม็ด', 0],
  ['', '', '', 5],
  ['Drug B', '20 mg', 'แคปซูล', 15],
];

describe('processHosxpFile / importUsageFile — xlsx skipped-row regression', () => {
  it('processHosxpFile reports skipped rows for a real .xlsx file, not just .csv', async () => {
    const user = userEvent.setup();
    function Harness() {
      const { processHosxpFile } = useApp();
      return <button onClick={() => processHosxpFile(xlsxFile('hosxp.xlsx', ROWS))}>process</button>;
    }
    renderWithApp(<><Harness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'process' }));
    // Without the fix, this would read "...แล้ว 1 รายการ — ตรวจสอบ..." with no "ข้าม" clause
    // at all — the two malformed rows (blank qty, blank name) vanishing with zero trace.
    await screen.findByText(/ข้าม 2 แถวที่อ่านไม่ได้/);
  });

  it('importUsageFile reports skipped rows for a real .xlsx file too', async () => {
    const user = userEvent.setup();
    function Harness() {
      const { importUsageFile } = useApp();
      return <button onClick={() => importUsageFile(xlsxFile('usage.xlsx', ROWS))}>import</button>;
    }
    renderWithApp(<><Harness /><Toast /></>);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'import' }));
    await screen.findByText(/ข้าม 2 แถวที่อ่านไม่ได้/);
  });
});
