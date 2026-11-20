// The guided HOSxP flow: stepper, one status card, accept-all-safe, persistent result card with
// clamped warnings, and undo.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { signInAs, fireCollection, hasListener, seedDoc, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'AMLODIPINE 10 mg เม็ด', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 1000, parFloor: 1000, floor: 100, bin: 'C4-6', used30: 0, usedPrev30: 0, volatility: 0,
};

function Harness({ text }: { text: string }) {
  const { state, setHosxpText, processHosxp } = useApp();
  useEffect(() => { if (!state.hosxpText) setHosxpText(text); }, [state.hosxpText, setHosxpText, text]);
  return (<><button onClick={() => void processHosxp()}>process</button><ReconcileScreen /><Toast /><ConfirmDialog /></>);
}

async function setup(text: string, floor = 100) {
  const user = userEvent.setup();
  renderWithApp(<Harness text={text} />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [{ ...MED, floor }]);
  seedDoc('meds/m1', { floor });
  await user.click(screen.getByRole('button', { name: 'process' }));
  return user;
}

describe('ReconcileScreen — guided flow', () => {
  it('shows a stepper and ONE status card: blocked until the safe suggestion is accepted, then ready', async () => {
    const user = await setup('AMLODIPINE 10 mg tablet film,40');
    const status = await screen.findByTestId('reconcile-status');
    expect(status).toHaveAttribute('data-ready', '0');
    expect(status).toHaveTextContent('ยังมี 1 รายการที่ต้องตัดสินใจ');
    expect(screen.getByTestId('reconcile-stepper').querySelector('[aria-current="step"]')).toHaveTextContent('2. แก้รายการที่มีปัญหา');

    await user.click(screen.getByTestId('accept-safe-all'));
    await waitFor(() => expect(screen.getByTestId('reconcile-status')).toHaveAttribute('data-ready', '1'));
    expect(screen.getByTestId('reconcile-status')).toHaveTextContent('พร้อมตัดยอด');
    expect(screen.getByTestId('reconcile-status')).toHaveTextContent('จะตัดรวม 40 หน่วย');
    expect(screen.getByTestId('reconcile-stepper').querySelector('[aria-current="step"]')).toHaveTextContent('3. ตรวจสรุป');
  });

  it('warns BEFORE commit when the floor cannot cover the file, then keeps a persistent result with the clamp and an undo', async () => {
    const user = await setup('AMLODIPINE 10 mg เม็ด,150', 100);
    await screen.findByText(/ยอดหน้างานมีแค่ 100 เม็ด แต่ไฟล์จ่าย 150/);
    expect(screen.getByTestId('reconcile-status')).toHaveTextContent('ยอดหน้างานไม่พอ 1');

    await user.click(screen.getByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ }));
    const result = await screen.findByTestId('reconcile-result');
    expect(result).toHaveTextContent('ตัดยอดเสร็จแล้ว');
    expect(result).toHaveTextContent('ไฟล์จ่าย 150 แต่ตัดได้ 100');
    const floorAfterCommit = getLastTransactionWrites().find((w) => 'floor' in (w.data as object));
    expect((floorAfterCommit!.data as { floor: number }).floor).toBe(0);

    // undo gives back exactly what was taken (100), as a reversal tx with negative reportedQty
    seedDoc('meds/m1', { floor: 0 });
    await user.click(screen.getByRole('button', { name: /ย้อนการตัดยอดครั้งนี้/ }));
    await user.click(await screen.findByRole('button', { name: /ตกลง|ยืนยัน|ดำเนินการ|ใช่/ }));
    await waitFor(() => expect(screen.getByTestId('reconcile-result')).toHaveTextContent('ย้อนการตัดยอดแล้ว'));
    const writes = getLastTransactionWrites();
    expect((writes.find((w) => 'floor' in (w.data as object))!.data as { floor: number }).floor).toBe(100);
    const rev = writes.find((w) => (w.data as { reason?: string }).reason === 'ย้อนการตัดยอด HOSxP')!.data as { qty: number; reportedQty: number };
    expect(rev.qty).toBe(100);
    expect(rev.reportedQty).toBe(-150);
  });
});
