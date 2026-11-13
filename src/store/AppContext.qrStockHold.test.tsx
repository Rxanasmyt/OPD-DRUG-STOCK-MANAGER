// Regression test for a real, user-reported-pattern bug: a med flagged isOnStockHold()
// ("ยาขาดชั่วคราว" — see MedsScreen's own action) is excluded from TransferScreen's med list,
// HomeScreen's low-stock lists, and fillAll() (each with its own "Bug fix (user-reported)"
// comment in AppContext.tsx), but scanning that med's shelf/med-label QR during a transfer
// resolved it independently of those filtered lists and added it straight to the cart via
// bump() with no isOnStockHold() check at all — silently bypassing the one rule every other
// cart-building path already enforces.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { asMedId } from '../types';
import { encodeQr } from '../utils/qr';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 1, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
  outOfStockSince: Date.now(), outOfStockReason: 'ผู้ผลิตแจ้งส่งล่าช้า',
};

// Real substock on hand (not just an empty shelf) — without this, bump() rejects the scan on
// its own pre-existing "substock ไม่มี...เหลือให้เติม" guard regardless of the fix under test,
// which would mask whether the isOnStockHold() check actually ran.
const LOT = { id: 'l1', medId: MED.id, qty: 100, lotNo: 'L1', exp: Date.now() + 90 * 86400000 };

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

describe('qrDecodedImpl — held-med ("ยาขาดชั่วคราว") QR scan regression', () => {
  it('blocks scanning a held med into the transfer cart instead of silently adding it', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ScanToTransferHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [LOT]);

    await user.click(screen.getByRole('button', { name: 'open-scanner' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'decode-scan' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'decode-scan' }));

    // Without the fix, this scan would resolve the med and call bump(med.id, 1) with no
    // isOnStockHold() check, silently adding real floor-transfer stock for a med every other
    // cart-building path (TransferScreen's list, HomeScreen's quick-add, fillAll) already hides.
    await screen.findByText(MED.name + ' ถูกทำเครื่องหมายขาดชั่วคราว — ยกเลิกสถานะที่หน้ายา (เมนูยา) ก่อนเติมหน้างานรายการนี้');
    expect(screen.getByTestId('cart').textContent).toBe('{}');
  });
});
