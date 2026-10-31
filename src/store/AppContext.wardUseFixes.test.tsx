// Regression tests for 4 bugs found auditing "หน้างานจริง" (real ward/field use): QR scanning,
// bulk counting, and the typo-safety-net gap in commitWardMove/commitAdjust.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { asMedId } from '../types';
import { encodeQr } from '../utils/qr';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  signInAs, fireCollection, hasListener, seedDoc, seedCollection,
  getLastTransactionWrites, failNextTransactionCommitWritingPathPrefix,
} from '../test-utils/firebaseTestDouble';

const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 1000, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

// ---------- 1. QR scan on a deactivated med ----------

function ScanToTransferHarness() {
  const { state, openScanSearch, qrDecoded } = useApp();
  return (
    <>
      <button onClick={() => openScanSearch('transfer')}>open-scanner</button>
      <button disabled={state.qrPurpose !== 'transfer'} onClick={() => qrDecoded(encodeQr('med', MED.code))}>decode-scan</button>
      <div data-testid="cart">{JSON.stringify(state.cart)}</div>
    </>
  );
}

describe('qrDecodedImpl — deactivated-med QR scan regression', () => {
  it('blocks scanning a still-printed label for a deactivated med instead of silently adding it to the cart', async () => {
    const user = userEvent.setup();
    const inactiveMed = { ...MED, active: false };
    renderWithApp(<><ScanToTransferHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [inactiveMed]);

    await user.click(screen.getByRole('button', { name: 'open-scanner' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'decode-scan' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'decode-scan' }));

    // Without the fix, this scan would silently resolve the med (resolveMed has no `.active`
    // filter) and add real stock to the cart for a med every active-filtered screen now hides.
    await screen.findByText(MED.name + ' ถูกปิดใช้งานแล้ว — ติดต่อแอดมินก่อนรับ/เติมยานี้');
    expect(screen.getByTestId('cart').textContent).toBe('{}');
  });
});

// ---------- 2. Bulk count/subcount failure diagnosability ----------

function CountAllHarness() {
  const { setCountInput, commitAllCounts } = useApp();
  // 960 vs MED's floor of 1000 — a small enough delta (40) to stay under the pre-existing
  // implausible-count confirm threshold (Math.max(parFloor=100, 20) * 8 = 800), so this test
  // isolates the NEW diagnosability fix instead of also exercising that unrelated confirm step.
  useEffect(() => { setCountInput(MED.id, '960'); }, [setCountInput]);
  return <button onClick={commitAllCounts}>commit-all-counts</button>;
}

describe('commitAllCounts — bulk failure diagnosability regression', () => {
  it('names the failing med and its error code in the toast instead of a bare failure count', async () => {
    const user = userEvent.setup();
    renderWithApp(<><CountAllHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', { floor: MED.floor });

    failNextTransactionCommitWritingPathPrefix('meds/');

    await user.click(screen.getByRole('button', { name: 'commit-all-counts' }));

    // Without the fix, this would read only "บันทึกแล้ว 0 รายการ · ไม่สำเร็จ 1 รายการ (ยังค้างอยู่
    // ในหน้าจอ ลองกดบันทึกอีกครั้ง)" — no med name, no error code.
    await screen.findByText(
      'บันทึกแล้ว 0 รายการ · ไม่สำเร็จ 1 รายการ: ' + MED.name + ' (permission-denied) (ยังค้างอยู่ในหน้าจอ ลองกดบันทึกอีกครั้ง)'
    );
  });
});

// ---------- 3. commitWardMove typo-safety-net ----------

const MED_TO = { ...MED, id: asMedId('m2'), code: 'MED-0002', name: 'Amoxicillin 250mg', floor: 0 };

function WardMoveHarness() {
  const { pickWmFromMed, pickWmToMed, setWmQty, setWmReason, commitWardMove } = useApp();
  return (
    <>
      <button onClick={() => pickWmFromMed(MED.id)}>pick-from</button>
      <button onClick={() => pickWmToMed(MED_TO.id)}>pick-to</button>
      {/* 900 > Math.max(parFloor=100, 20) * 8 = 800 — implausible relative to par, but still well
          within MED's floor (1000), so it would never hit the existing "insufficient" guard. */}
      <button onClick={() => { setWmQty('900'); setWmReason('เติม stat drawer'); }}>fill-form</button>
      <button onClick={commitWardMove}>commit-wardmove</button>
    </>
  );
}

describe('commitWardMove — typo-safety-net regression', () => {
  it('asks for confirmation before moving an implausibly large quantity relative to par', async () => {
    const user = userEvent.setup();
    renderWithApp(<><WardMoveHarness /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED, MED_TO]);
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'pick-from' }));
    await user.click(screen.getByRole('button', { name: 'pick-to' }));
    await user.click(screen.getByRole('button', { name: 'fill-form' }));
    await user.click(screen.getByRole('button', { name: 'commit-wardmove' }));

    // Without the fix, this would commit immediately with zero confirmation.
    await screen.findByText(/มากผิดปกติเมื่อเทียบกับ par/);
    expect(getLastTransactionWrites().length).toBe(0);

    await user.click(await screen.findByRole('button', { name: 'ยกเลิก' }));
    expect(getLastTransactionWrites().length).toBe(0);
  });

  it('still commits once the implausible-quantity confirm is accepted', async () => {
    const user = userEvent.setup();
    renderWithApp(<><WardMoveHarness /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED, MED_TO]);
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'pick-from' }));
    await user.click(screen.getByRole('button', { name: 'pick-to' }));
    await user.click(screen.getByRole('button', { name: 'fill-form' }));
    await user.click(screen.getByRole('button', { name: 'commit-wardmove' }));
    await user.click(await screen.findByRole('button', { name: 'ยืนยัน' }));

    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(getLastTransactionWrites().find((w) => w.path === 'meds/m1')?.data).toEqual({ floor: 100 });
  });
});

// ---------- 4. commitAdjust typo-safety-net ----------

function AdjustHarness() {
  const { pickAdjType, pickAdjMed, setAdjQty, setAdjReason, commitAdjust } = useApp();
  return (
    <>
      <button onClick={() => pickAdjType('damaged')}>pick-type</button>
      <button onClick={() => pickAdjMed(MED.id)}>pick-med</button>
      {/* Same 900-vs-800-threshold shape as the wardMove case above. */}
      <button onClick={() => { setAdjQty('900'); setAdjReason('ยาเสีย'); }}>fill-form</button>
      <button onClick={commitAdjust}>commit-adjust</button>
    </>
  );
}

describe('commitAdjust — typo-safety-net regression', () => {
  it('asks for confirmation before writing off an implausibly large quantity relative to par', async () => {
    const user = userEvent.setup();
    renderWithApp(<><AdjustHarness /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'pick-type' }));
    await user.click(screen.getByRole('button', { name: 'pick-med' }));
    await user.click(screen.getByRole('button', { name: 'fill-form' }));
    await user.click(screen.getByRole('button', { name: 'commit-adjust' }));

    // Without the fix, a fat-fingered "900" instead of "90" would silently clamp the floor with
    // zero warning.
    await screen.findByText(/มากผิดปกติเมื่อเทียบกับ par/);
    expect(getLastTransactionWrites().length).toBe(0);
  });

  it('still commits once the implausible-quantity confirm is accepted', async () => {
    const user = userEvent.setup();
    renderWithApp(<><AdjustHarness /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'pick-type' }));
    await user.click(screen.getByRole('button', { name: 'pick-med' }));
    await user.click(screen.getByRole('button', { name: 'fill-form' }));
    await user.click(screen.getByRole('button', { name: 'commit-adjust' }));
    await user.click(await screen.findByRole('button', { name: 'ยืนยัน' }));

    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(getLastTransactionWrites().find((w) => w.path === 'meds/m1')?.data).toEqual({ floor: 100 });
  });
});
