// Regression test for a real audit finding: "Fill-cart / receive-cart state has zero crash/
// refresh protection" — the เติมหน้างาน cart and the รับเข้า recvItems list could represent
// several minutes of real staff work (walking the shelves deciding quantities) but lived purely
// in memory, lost with no warning on a crash/refresh/accidental navigation before the final
// commit. AppContext.tsx now persists both to localStorage (keyed by uid, so a shared tablet
// never leaks one person's in-progress cart to the next signed-in person) and restores them the
// moment that uid signs back in. See AppContext.tsx's own "crash recovery" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function CartHarness() {
  const { state, setCartQty } = useApp();
  return (
    <div>
      <button onClick={() => setCartQty(MED.id, '7')}>set-qty-7</button>
      <div data-testid="cartQty">{state.cart[MED.id] ?? ''}</div>
    </div>
  );
}

describe('cart/recvItems — crash recovery regression', () => {
  it('restores an in-progress cart after a simulated crash/reload for the SAME uid', async () => {
    const user = userEvent.setup();
    const first = renderWithApp(<CartHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [{ id: 'l1', medId: MED.id, qty: 100, lotNo: 'L1', exp: Date.now() + 30 * 86400000 }]);

    await user.click(screen.getByRole('button', { name: 'set-qty-7' }));
    await waitFor(() => expect(screen.getByTestId('cartQty').textContent).toBe('7'));

    // Simulate a crash/refresh: tear down the whole React tree (AppProvider and all) without
    // ever going through logout — localStorage is the only thing that survives this.
    first.unmount();

    const second = renderWithApp(<><CartHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [{ id: 'l1', medId: MED.id, qty: 100, lotNo: 'L1', exp: Date.now() + 30 * 86400000 }]);

    // Without the fix, this would come back empty — exactly the lost-shelf-walk scenario.
    await waitFor(() => expect(screen.getByTestId('cartQty').textContent).toBe('7'));
    await screen.findByText(/กู้ตะกร้าเติมหน้างาน.*คืนแล้ว/);
    second.unmount();
  });

  it('never shows one uid\'s in-progress cart to a DIFFERENT uid signing in on the same device', async () => {
    const user = userEvent.setup();
    const first = renderWithApp(<CartHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [{ id: 'l1', medId: MED.id, qty: 100, lotNo: 'L1', exp: Date.now() + 30 * 86400000 }]);
    await user.click(screen.getByRole('button', { name: 'set-qty-7' }));
    await waitFor(() => expect(screen.getByTestId('cartQty').textContent).toBe('7'));
    first.unmount();

    // A different person signs in on this same (shared tablet) session — must start clean.
    const second = renderWithApp(<CartHarness />);
    await signInAs('u2', { role: 'tech', name: 'เทค สอง', username: 'tech2' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [{ id: 'l1', medId: MED.id, qty: 100, lotNo: 'L1', exp: Date.now() + 30 * 86400000 }]);

    expect(screen.getByTestId('cartQty').textContent).toBe('');
    second.unmount();
  });

  it('persists immediately on every change (not debounced), and clears on logout so it never resurfaces for the next person', async () => {
    const user = userEvent.setup();
    function LogoutHarness() {
      const { logout } = useApp();
      return <button onClick={logout}>logout</button>;
    }
    const first = renderWithApp(<><CartHarness /><LogoutHarness /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [{ id: 'l1', medId: MED.id, qty: 100, lotNo: 'L1', exp: Date.now() + 30 * 86400000 }]);
    await user.click(screen.getByRole('button', { name: 'set-qty-7' }));
    await waitFor(() => expect(screen.getByTestId('cartQty').textContent).toBe('7'));

    expect(localStorage.getItem('opd-cart-u1')).not.toBeNull();
    const stored = JSON.parse(localStorage.getItem('opd-cart-u1')!);
    expect(stored.value[MED.id]).toBe(7);

    await user.click(screen.getByRole('button', { name: 'logout' }));
    await waitFor(() => {
      const after = JSON.parse(localStorage.getItem('opd-cart-u1')!);
      expect(Object.keys(after.value).length).toBe(0);
    });
    first.unmount();
  });
});
