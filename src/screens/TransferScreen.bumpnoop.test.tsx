// Regression test for a real-device report (screenshot): tapping + on a med whose floor already
// sits at/above its own Max did absolutely nothing — bump() seeds an empty cart with
// suggestTransferQty(), which correctly returns 0 when there's no real deficit, but the tap
// itself gave zero on-screen explanation, reading as "the button is broken" rather than "nothing
// to add here". Same class of gap ScanConfirmSheet's NumberStepper already closed for its own
// +/- pair (disabled with a reason) — see AppContext.tsx's bump() "Bug fix (silent no-op,
// reported live)" comment for why this screen needed its own fix (plain button pair, not that
// shared component).
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferScreen from './TransferScreen';
import Toast from '../components/Toast';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// Matches the real-world screenshot: floor (250) already above parFloor/Max (150) — a real,
// observed "over-full shelf" state, not a contrived edge case.
const OVERFULL_MED = {
  id: 'm1', code: 'MED-0001', name: 'Benzhexol 5 mg. เม็ด', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 800, parFloor: 150, floor: 250, bin: 'C4-1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const EMPTY_SUBSTOCK_MED = {
  id: 'm2', code: 'MED-0002', name: 'Clonazepam 0.5mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('TransferScreen — bump() silent-no-op regression', () => {
  it('toasts why + does nothing when floor is already at/above Max, instead of silently no-opping', async () => {
    const user = userEvent.setup();
    renderWithApp(<><TransferScreen /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [OVERFULL_MED]);
    fireCollection('lots', [{ id: 'l1', code: 'L1', medId: OVERFULL_MED.id, lotNo: '1', exp: Date.now() + 300 * 86400000, qty: 500, loc: 'x' }]);

    // Default filter is "ต่ำกว่า Min" — an already-overfull med (floor > Max) never shows up
    // there, so switch to "ทั้งหมด" to find it, same as a real user would have to.
    await user.click(screen.getByRole('button', { name: 'ทั้งหมด' }));
    await user.click(await screen.findByLabelText('เพิ่มจำนวน ' + OVERFULL_MED.name));

    await screen.findByText(/ถึงหรือเกิน Max แล้ว/);
    // The cart must genuinely stay empty, not just show a toast alongside a real add.
    expect(screen.queryByText('ในรายการ')).not.toBeInTheDocument();
  });

  it('toasts why + does nothing when substock is genuinely empty', async () => {
    const user = userEvent.setup();
    renderWithApp(<><TransferScreen /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [EMPTY_SUBSTOCK_MED]);
    fireCollection('lots', []);

    await user.click(await screen.findByLabelText('เพิ่มจำนวน ' + EMPTY_SUBSTOCK_MED.name));

    await screen.findByText(/substock ไม่มี.*เหลือให้เติม/);
  });
});
