// A "นับหน้างาน" button on every เติมหน้างาน row jumps straight to counting that one med's floor stock.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferScreen from './TransferScreen';
import CountScreen from './CountScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, seedCollection, seedDoc, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';

const base = { unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true, parSub: 100, parFloor: 100, bin: 'A1', used30: 60, usedPrev30: 0, volatility: 0 };
const A = { ...base, id: 'a1', code: 'MED-0001', name: 'ALPHA DRUG 5 mg', floor: 10 };
const B = { ...base, id: 'b1', code: 'MED-0002', name: 'BRAVO DRUG 5 mg', floor: 20 };

function Switch() { const { state } = useApp(); return <><div data-testid="scr">{state.screen}</div>{state.screen === 'count' ? <CountScreen /> : <TransferScreen />}</>; }

describe('เติมหน้างาน → นับหน้างาน shortcut', () => {
  it('opens the count screen on the floor tab showing only that med, with its count box focused', async () => {
    const user = userEvent.setup();
    renderWithApp(<Switch />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [A, B]);
    fireCollection('lots', []);
    await screen.findByText(B.name);
    await user.click(screen.getByRole('button', { name: 'นับหน้างาน ' + B.name }));
    const box = await screen.findByLabelText('จำนวนที่นับได้ ' + B.name);
    await waitFor(() => expect(screen.queryByLabelText('จำนวนที่นับได้ ' + A.name)).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(box));
  });
});

describe('เติมหน้างาน → นับ substock shortcut (ทวนสอบ substock ตอนไปหยิบยา)', () => {
  const LOT = { id: 'lotB', medId: 'b1', qty: 80, lotNo: 'LB', exp: Date.now() + 200 * 86400000 };
  async function boot() {
    const user = userEvent.setup();
    renderWithApp(<Switch />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [A, B]);
    fireCollection('lots', [LOT]);
    await screen.findByText(B.name);
    return user;
  }

  it('every row has a นับ substock button; it opens the substock tab with only that med and its box focused', async () => {
    const user = await boot();
    expect(screen.getByRole('button', { name: 'นับ substock ' + A.name })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'นับ substock ' + B.name }));
    const box = await screen.findByLabelText('จำนวนที่นับได้ ' + B.name);
    await waitFor(() => expect(screen.queryByLabelText('จำนวนที่นับได้ ' + A.name)).not.toBeInTheDocument());
    await waitFor(() => expect(document.activeElement).toBe(box));
    // the substock tab (not the floor tab) is the active one
    expect(screen.getByRole('button', { name: 'นับ substock' })).toBeInTheDocument();
    expect(screen.getByText(/กำลังนับ/)).toHaveTextContent(/substock/i);
  });

  it('saving the substock count takes you back to where you came from', async () => {
    const user = await boot();
    seedDoc('meds/b1', { floor: 20 });
    seedCollection('lots', [{ id: 'lotB', medId: 'b1', qty: 80, exp: LOT.exp }]);
    seedDoc('lots/lotB', { qty: 80, lotNo: 'LB', exp: LOT.exp });
    await user.click(screen.getByRole('button', { name: 'นับ substock ' + B.name }));
    const box = await screen.findByLabelText('จำนวนที่นับได้ ' + B.name);
    await user.type(box, '80'); // matches the system → no confirm needed
    await user.click(await screen.findByRole('button', { name: 'บันทึก' }));
    // the live listener delivers the med with its new lastSubCountTs (the test double does not echo writes back)
    await waitFor(() => expect(getLastTransactionWrites().some((w) => w.path === 'meds/b1' && 'lastSubCountTs' in (w.data ?? {}))).toBe(true));
    fireCollection('meds', [A, { ...B, lastSubCountTs: Date.now() }]);
    await waitFor(() => expect(screen.getByTestId('scr')).not.toHaveTextContent('count'), { timeout: 4000 }); // back to where it came from
  });
});
