// A real multi-page / multi-sheet HOSxP export: both sheets are read, the repeated page header and the
// "รวม" footer are ignored (not offered as drugs), and a fractional quantity is called out.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as XLSX from 'xlsx';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const HDR = ['No.', 'รายการยา', 'ความแรง', 'หน่วย', 'รายการ', 'จำนวน'];
function file(): File {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['รายงานการใช้ยา 19 พฤศจิกายน 2569 - 19 พฤศจิกายน 2569'], HDR,
    [1, 'Drug A', '10 mg', 'เม็ด', 3, 5], HDR, [2, 'Drug C', '5 mg', 'เม็ด', 1, 2.5], ['', 'รวม', '', '', 4, 7.5],
  ]), 'P1');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([HDR, [1, 'Drug B', '20 mg', 'เม็ด', 3, 7]]), 'P2');
  const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
  return new File([buf], 'hosxp.xlsx');
}
const meds = ['Drug A 10 mg เม็ด', 'Drug B 20 mg เม็ด', 'Drug C 5 mg เม็ด'].map((name, i) => ({
  id: 'm' + i, code: 'MED-' + i, name, unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true,
  parSub: 500, parFloor: 100, floor: 500, bin: 'A' + i, used30: 600, usedPrev30: 600, volatility: 0,
}));

function Harness() {
  const { processHosxpFile } = useApp();
  return (<><button onClick={() => processHosxpFile(file())}>attach</button><ReconcileScreen /></>);
}
function Bare() { return <ReconcileScreen />; }

describe('ReconcileScreen — real export shape', () => {
  it('reads both sheets, ignores page headers and the total row, and flags the fractional quantity', async () => {
    const user = userEvent.setup();
    renderWithApp(<Harness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', meds);
    await user.click(screen.getByRole('button', { name: 'attach' }));
    const card = await screen.findByTestId('hosxp-file-verify');
    await waitFor(() => expect(card).toHaveTextContent('3 รายการ')); // A, C, B — not 4/5
    expect(card).toHaveTextContent('ไฟล์มี 2 ชีต');
    expect(card).toHaveTextContent('ข้ามหัวตารางที่ซ้ำทุกหน้า 1 แถว');
    expect(card).toHaveTextContent('ข้ามแถว "รวม" 1 แถว');
    expect(card).toHaveTextContent('1 แถวมีเศษทศนิยม');
    expect(screen.getByTestId('reconcile-status')).toHaveTextContent(/3\s*รายการในไฟล์/);
    expect(screen.queryByTestId('file-row-fixer')).not.toBeInTheDocument();
  });

  it('accepts a file dropped on the drop zone (desktop drag & drop), then collapses to a compact attach bar', async () => {
    renderWithApp(<Bare />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', meds);
    const zone = await screen.findByTestId('hosxp-dropzone');
    fireEvent.drop(zone, { dataTransfer: { files: [file()] } });
    expect(await screen.findByTestId('hosxp-attach-compact')).toHaveTextContent('hosxp.xlsx');
    expect(screen.queryByTestId('hosxp-dropzone')).not.toBeInTheDocument();
  });
});
