// Reversible attach + provable file date: discard the file, undo a manual mapping, and the identity gate.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as XLSX from 'xlsx';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import ConfirmDialog from '../components/ConfirmDialog';
import { signInAs, fireCollection, hasListener, seedDoc } from '../test-utils/firebaseTestDouble';
import { isoDate } from '../utils/format';

const YEST = isoDate(Date.now() - 86400000);
const HDR = ['No.', 'รายการยา', 'ความแรง', 'หน่วย', 'รายการ', 'จำนวน'];
function file(withTitle: boolean): File {
  const rows: (string | number)[][] = [];
  if (withTitle) { const [y, m, d] = YEST.split('-'); rows.push(['รายงานการใช้ยา ' + d + '/' + m + '/' + (+y + 543) + ' - ' + d + '/' + m + '/' + (+y + 543)]); }
  rows.push(HDR, [1, 'AMLODIPINE', '10 mg tablet film', 'เม็ด', 3, 40]);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), 'P1');
  return new File([XLSX.write(wb, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer], 'hosxp.xlsx');
}
const MED = { id: 'm1', code: 'MED-1', name: 'AMLODIPINE 10 mg เม็ด', unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 500, bin: 'A1', used30: 3000, usedPrev30: 3000, volatility: 0 };

function Harness({ titled }: { titled: boolean }) {
  const { processHosxpFile } = useApp();
  return (<><button onClick={() => processHosxpFile(file(titled))}>attach</button><ReconcileScreen /><ConfirmDialog /></>);
}
async function setup(titled: boolean) {
  const user = userEvent.setup();
  renderWithApp(<Harness titled={titled} />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  seedDoc('meds/m1', { floor: 500 });
  await user.click(screen.getByRole('button', { name: 'attach' }));
  return user;
}

describe('provable file date', () => {
  it('a file whose own date equals the due day is verified with weekday shown, and needs no extra confirmation', async () => {
    const user = await setup(true);
    const line = await screen.findByTestId('date-line');
    expect(line).toHaveTextContent('ตรงกับวันที่ควรตัด ✓');
    expect(line).toHaveTextContent(/\((อา\.|จ\.|อ\.|พ\.|พฤ\.|ศ\.|ส\.)\)/);
    expect(screen.queryByTestId('ack-date')).not.toBeInTheDocument();
    await user.click(await screen.findByTestId('accept-safe-all'));
    await waitFor(() => expect(screen.getByTestId('reconcile-status')).toHaveAttribute('data-ready', '1'));
  });

  it('an undated file locks the commit: no assumed range, pick it, tick the confirmation, then it is ready', async () => {
    const user = await setup(false);
    expect(await screen.findByTestId('date-line')).toHaveTextContent('ไม่ระบุ');
    await user.click(await screen.findByTestId('accept-safe-all'));
    expect(screen.getByTestId('reconcile-status')).toHaveAttribute('data-ready', '0');
    expect(screen.getByTestId('reconcile-status')).toHaveTextContent('ยืนยันวันที่ของไฟล์ก่อน');
    expect(screen.getByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ })).toBeDisabled();
    expect(screen.getByTestId('ack-date')).toBeDisabled(); // nothing to confirm until a date is chosen
    await user.click(screen.getByTestId('use-due-range'));
    await user.click(screen.getByTestId('ack-date'));
    await waitFor(() => expect(screen.getByTestId('reconcile-status')).toHaveAttribute('data-ready', '1'));
    // editing the date drops the confirmation again
    const dates = document.querySelectorAll('input[type="date"]');
    await user.clear(dates[0] as HTMLInputElement);
    await waitFor(() => expect(screen.getByTestId('reconcile-status')).toHaveAttribute('data-ready', '0'));
  });
});

describe('reversible attach', () => {
  it('"ลบไฟล์" asks first, then clears everything back to step 1 (drop zone returns)', async () => {
    const user = await setup(true);
    await screen.findByTestId('hosxp-attach-compact');
    await user.click(screen.getByTestId('hosxp-discard'));
    await user.click(await screen.findByRole('button', { name: 'ยืนยัน' }));
    expect(await screen.findByTestId('hosxp-dropzone')).toBeInTheDocument();
    expect(screen.queryByTestId('reconcile-status')).not.toBeInTheDocument();
  });

  it('cancelling the discard confirmation keeps the file', async () => {
    const user = await setup(true);
    await user.click(await screen.findByTestId('hosxp-discard'));
    await user.click(await screen.findByRole('button', { name: 'ยกเลิก' }));
    expect(screen.getByTestId('hosxp-attach-compact')).toBeInTheDocument();
    expect(screen.getByTestId('reconcile-status')).toBeInTheDocument();
  });

  it('a manual mapping can be undone (row returns to "unmatched") without discarding the file', async () => {
    const user = await setup(true);
    await user.click(await screen.findByTestId('accept-safe-all'));
    await waitFor(() => expect(screen.getByTestId('reconcile-status')).toHaveAttribute('data-ready', '1'));
    await user.click(await screen.findByTestId('unresolve-row'));
    await waitFor(() => expect(screen.getByTestId('reconcile-status')).toHaveAttribute('data-ready', '0'));
    expect(screen.getByTestId('hosxp-attach-compact')).toBeInTheDocument();
    expect(within(screen.getByTestId('reconcile-status')).getByText(/ยังมี 1 รายการที่ต้องตัดสินใจ/)).toBeInTheDocument();
  });

  it('the file check survives a reload (persisted with the draft)', async () => {
    const user = await setup(true);
    await screen.findByTestId('date-line');
    const raw = Object.entries(localStorage).find(([k]) => k.startsWith('opd-hosxp-') && !k.includes('result'));
    expect(raw).toBeTruthy();
    expect(JSON.parse(raw![1]).value.hosxpFileInfo.name).toBe('hosxp.xlsx');
    void user;
  });
});
