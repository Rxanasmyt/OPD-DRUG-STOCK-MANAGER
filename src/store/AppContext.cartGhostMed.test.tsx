// Regression test: a cart entry whose med was deleted on another device is invisible on
// TConfirmScreen (it skips rows whose med no longer resolves), but commitTransfer still threw
// 'missing-med' for it every time — the toast said "go back and remove that item" about a row
// nobody could see, leaving "clear the whole cart" as the only way out. The commit now drops
// just the ghost entry and keeps the rest of the cart.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { asMedId } from '../types';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import { signInAs, fireCollection, hasListener, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';

const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const GHOST = { ...MED, id: asMedId('ghost'), code: 'MED-0002', name: 'Deleted Med' };
const lotFor = (id: string) => ({ id: 'lot-' + id, medId: id, qty: 100, lotNo: 'L1', exp: Date.now() + 90 * 86400000 });

function Harness() {
  const { state, setCartQty, commitTransfer, sub } = useApp();
  const ready = sub(MED.id) > 0 && sub(GHOST.id) > 0;
  useEffect(() => { if (ready) { setCartQty(MED.id, '3'); setCartQty(GHOST.id, '5'); } }, [ready, setCartQty]);
  return (
    <>
      <button onClick={commitTransfer}>commit</button>
      <div data-testid="cart">{JSON.stringify(Object.keys(state.cart).sort())}</div>
    </>
  );
}

describe('commitTransfer — ghost cart entry (deleted med) regression', () => {
  it('drops only the deleted med from the cart instead of leaving an invisible blocker', async () => {
    const user = userEvent.setup();
    renderWithApp(<><Harness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED, GHOST]);
    fireCollection('lots', [lotFor('m1'), lotFor('ghost')]);
    await waitFor(() => expect(screen.getByTestId('cart').textContent).toContain('ghost'));
    // Another device deletes the med after it was already added to this cart.
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'commit' }));

    await screen.findByText(/ตัดรายการนั้นออกให้แล้ว/);
    expect(screen.getByTestId('cart').textContent).not.toContain('ghost');
    expect(getLastTransactionWrites().length).toBe(0);
  });
});
