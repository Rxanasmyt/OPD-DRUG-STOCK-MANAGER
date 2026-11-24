// Meds with NO substock stage must still show up on the เติมหน้างาน screen with the same usage / Min-Max info — but as a
// "รับเข้า" action (they are restocked by receiving straight onto the floor), never as a cart line.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferScreen from './TransferScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const base = { code: 'MED-0001', unit: 'ขวด', dosageForm: 'น้ำ', price: 1, had: false, active: true, parSub: 50, parFloor: 100, bin: 'C7', used30: 300, usedPrev30: 300, volatility: 0 };
const SUBMED = { ...base, id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', floor: 10 };
const NOSUB = { ...base, id: 'm2', code: 'MED-0002', name: 'CPM Syrup 2 mg./5ml.', floor: 20, noSubstock: true };

function Probe() { const { state, goReceiveFor } = useApp(); return <><div data-testid="cart">{Object.keys(state.cart).join(',')}</div><div data-testid="screen">{state.screen}</div><span data-testid="recv">{state.recvMed ?? ''}</span><button onClick={() => goReceiveFor('m2' as never)} hidden>x</button></>; }

async function boot() {
  const user = userEvent.setup();
  renderWithApp(<><TransferScreen /><Probe /></>);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [SUBMED, NOSUB]);
  fireCollection('lots', [{ id: 'l1', medId: 'm1', lotNo: 'L1', qty: 20, exp: Date.now() + 400 * 86400000 }]);
  return user;
}

describe('TransferScreen — meds without substock', () => {
  it('lists them with the usual info and a รับเข้า button instead of a cart stepper', async () => {
    await boot();
    await screen.findByText(NOSUB.name);
    expect(screen.getByText(/ไม่มี substock \(รับเข้าขึ้นหน้างานตรง\)/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'รับเข้า ' + NOSUB.name })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'เพิ่มจำนวน ' + NOSUB.name })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'เพิ่มจำนวน ' + SUBMED.name })).toBeInTheDocument(); // normal med unchanged
  });
  it('counts them under "ต่ำกว่า Min" but "เติมตาม par" never puts them in the cart', async () => {
    const user = await boot();
    await screen.findByText(NOSUB.name);
    await screen.findByText(/ต่ำกว่า Min \(2\)/);
    await user.click(screen.getByRole('button', { name: /เติมตาม p/ }));
    await waitFor(() => expect(screen.getByTestId('cart').textContent).toContain('m1'));
    expect(screen.getByTestId('cart').textContent).not.toContain('m2');
  });
  it('the รับเข้า button opens the receive screen for that med', async () => {
    const user = await boot();
    await user.click(await screen.findByRole('button', { name: 'รับเข้า ' + NOSUB.name }));
    await waitFor(() => expect(screen.getByTestId('screen').textContent).toBe('receive'));
    expect(screen.getByTestId('recv').textContent).toBe('m2');
  });
});
