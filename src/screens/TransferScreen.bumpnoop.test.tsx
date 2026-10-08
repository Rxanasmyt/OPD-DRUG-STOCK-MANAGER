// Regression tests for bump()'s silent-no-op fix, and its own follow-up: a real-device report
// (screenshot) found tapping + on a med whose floor already sits at/above its own Max did
// absolutely nothing, with zero on-screen explanation — read as "the button is broken" rather
// than "nothing to add here". The follow-up request then asked for more than just an
// explanation: "ยาบางตัวอาจจะต้องเบิกมาก่อนเพื่อมาทำ pre-pack ยา...ให้ขึ้นเตือนมาและกดยอมรับถึงจะ
// เพิ่มได้" — floor already at/above Max isn't always "truly nothing to do"; confirming lets the
// add through anyway. Substock being genuinely empty (cap 0) is a hard physical limit no
// confirmation can override, so that case still just toasts and blocks. See AppContext.tsx's
// bump() own "Bug fix (silent no-op, reported live)" / "Real-world request (follow-up)" comments.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferScreen from './TransferScreen';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// Matches the real-world screenshot: floor (250) already above parFloor/Max (150) — a real,
// observed "over-full shelf" state, not a contrived edge case. No packSize set, so packStep()
// falls back to the generic magnitude step for parFloor 150 (>= 100) — 10.
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

async function openOverfullMed(user: ReturnType<typeof userEvent.setup>) {
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [OVERFULL_MED]);
  fireCollection('lots', [{ id: 'l1', code: 'L1', medId: OVERFULL_MED.id, lotNo: '1', exp: Date.now() + 300 * 86400000, qty: 500, loc: 'x' }]);

  // Default filter is "ต่ำกว่า Min" — an already-overfull med (floor > Max) never shows up
  // there, so switch to "ทั้งหมด" to find it, same as a real user would have to.
  await user.click(screen.getByRole('button', { name: 'ทั้งหมด' }));
  await user.click(await screen.findByLabelText('เพิ่มจำนวน ' + OVERFULL_MED.name));
  await screen.findByText(/ถึงหรือเกิน Max แล้ว/);
}

describe('TransferScreen — bump() silent-no-op / pre-pack-override regression', () => {
  it('asks for confirmation instead of silently no-opping when floor is already at/above Max', async () => {
    const user = userEvent.setup();
    renderWithApp(<><TransferScreen /><ConfirmDialog /></>);
    await openOverfullMed(user);
    // The cart must genuinely stay empty until a choice is actually made.
    expect(screen.getByLabelText('จำนวน ' + OVERFULL_MED.name)).toHaveValue('');
  });

  it('cancelling the confirmation leaves the cart empty', async () => {
    const user = userEvent.setup();
    renderWithApp(<><TransferScreen /><ConfirmDialog /></>);
    await openOverfullMed(user);

    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(screen.getByLabelText('จำนวน ' + OVERFULL_MED.name)).toHaveValue('');
  });

  it('confirming adds one whole step to the cart (pre-pack override)', async () => {
    const user = userEvent.setup();
    renderWithApp(<><TransferScreen /><ConfirmDialog /></>);
    await openOverfullMed(user);

    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(screen.getByLabelText('จำนวน ' + OVERFULL_MED.name)).toHaveValue('10'));
  });

  it('toasts why + does nothing when substock is genuinely empty — never asks to confirm an impossible add', async () => {
    const user = userEvent.setup();
    renderWithApp(<><TransferScreen /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [EMPTY_SUBSTOCK_MED]);
    fireCollection('lots', []);

    await user.click(await screen.findByLabelText('เพิ่มจำนวน ' + EMPTY_SUBSTOCK_MED.name));

    await screen.findByText(/substock ไม่มี.*เหลือให้เติม/);
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });
});
