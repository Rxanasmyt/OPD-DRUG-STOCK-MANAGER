// Integration test for the real bug fix this session made to TConfirmScreen: removing the
// last row in the cart used to leave a blank screen — no button, no message — since both
// action buttons are gated on a non-empty cart. Locks in the explicit "ตะกร้าว่างแล้ว" empty
// state + way back, through the REAL AppProvider/useApp() plumbing via renderWithApp +
// firebaseTestDouble — see those files' own doc comments for how/why.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TConfirmScreen from './TConfirmScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

// TConfirmScreen only ever reads/mutates the cart — nothing in the real app puts something
// into it except TransferScreen's own +/- buttons, which this test doesn't need to drive.
// Seeding it directly via the same setCartQty() the real screen uses is the equivalent of
// having arrived here with one item already in the cart.
function SeedCart() {
  const { setCartQty, sub } = useApp();
  // setCartQty() caps the requested amount at real substock (see setup()'s own comment) —
  // this only actually lands once that substock is more than 0, so the effect has to re-run
  // as it changes (0 while `lots` hasn't arrived yet, then whatever fireCollection('lots', …)
  // provides), not just once on mount.
  const qty = sub(MED.id);
  useEffect(() => { if (qty > 0) setCartQty(MED.id, '5'); }, [setCartQty, qty]);
  return null;
}

async function setup() {
  const user = userEvent.setup();
  renderWithApp(<><SeedCart /><TConfirmScreen /></>);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  // setCartQty() (AppContext.tsx) caps the requested quantity at real substock (sum of this
  // med's lots) — with none fired yet that cap is 0, and SeedCart's setCartQty(id, '5') would
  // silently clamp to nothing. A real lot to transfer from.
  await waitFor(() => expect(hasListener('lots')).toBe(true));
  fireCollection('lots', [{ id: 'l1', medId: MED.id, qty: 100, lotNo: 'L1', exp: Date.now() + 90 * 86400000 }]);
  await screen.findByText(MED.name);
  return user;
}

describe('TConfirmScreen — empty-cart dead end', () => {
  it('shows the cart row and confirm button while the cart has an item', async () => {
    await setup();
    expect(screen.getByRole('button', { name: /ยืนยันการเติมหน้างาน/ })).toBeInTheDocument();
  });

  it('shows an explicit empty state (not a blank screen) once the last item is removed', async () => {
    const user = await setup();
    await user.click(screen.getByRole('button', { name: 'ลบ' }));
    expect(screen.getByText('ตะกร้าว่างแล้ว')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /กลับไปเลือกยา/ })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /ยืนยันการเติมหน้างาน/ })).not.toBeInTheDocument();
  });
});
