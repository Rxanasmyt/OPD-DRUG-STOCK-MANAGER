// Regression test for a real request: "กด + แล้วยังขึ้นเป็นจำนวนเม็ด ไม่ใช่จำนวนกล่องที่เราคุยกันไว้"
// — the cart qty field (between the −/+ buttons) always showed the raw tablet total, even for a
// box-only med. See TransferScreen.tsx's own CartQtyInput component.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferScreen from './TransferScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const BOXED_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 25, bin: 'A1', packSize: 60,
  used30: 0, usedPrev30: 0, volatility: 0,
};
const PLAIN_MED = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 25, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const BOXED_LOT = { id: 'lotB', medId: BOXED_MED.id, qty: 999, lotNo: 'B1', exp: Date.now() + 300 * 86400000 };
const PLAIN_LOT = { id: 'lotP', medId: PLAIN_MED.id, qty: 999, lotNo: 'P1', exp: Date.now() + 300 * 86400000 };

describe('TransferScreen — CartQtyInput box notation regression', () => {
  it('shows the compact "NxSIZE" form after tapping +, for a box-only med', async () => {
    const user = userEvent.setup();
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BOXED_MED]);
    fireCollection('lots', [BOXED_LOT]);

    const input = await screen.findByLabelText('จำนวน ' + BOXED_MED.name);
    await user.click(screen.getByLabelText('เพิ่มจำนวน ' + BOXED_MED.name));
    // bump() on an empty cart seeds suggestTransferQty() (deficit 75 = parFloor 100 - floor 25,
    // packSize 60 — always rounds UP now, ceil(75/60)=2 boxes), not a single packStep from 0.
    expect(input).toHaveValue('2x60');

    await user.click(screen.getByLabelText('เพิ่มจำนวน ' + BOXED_MED.name));
    expect(input).toHaveValue('3x60');
  });

  it('switches to the plain raw number while the field is focused for typing, and back to the box form on blur', async () => {
    const user = userEvent.setup();
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BOXED_MED]);
    fireCollection('lots', [BOXED_LOT]);

    const input = await screen.findByLabelText('จำนวน ' + BOXED_MED.name);
    await user.click(screen.getByLabelText('เพิ่มจำนวน ' + BOXED_MED.name));
    // Same suggestTransferQty() seed as the test above — ceil(75/60)=2 boxes.
    expect(input).toHaveValue('2x60');

    fireEvent.focus(input);
    expect(input).toHaveValue('120');

    fireEvent.blur(input);
    expect(input).toHaveValue('2x60');
  });

  it('shows the remainder compactly ("1x60+5", no spaces/unit word) when typed by hand', async () => {
    const user = userEvent.setup();
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BOXED_MED]);
    fireCollection('lots', [BOXED_LOT]);

    const input = await screen.findByLabelText('จำนวน ' + BOXED_MED.name);
    fireEvent.focus(input);
    await user.type(input, '65');
    fireEvent.blur(input);
    expect(input).toHaveValue('1x60+5');
  });

  it('leaves a non-boxed med\'s field as a plain number always', async () => {
    const user = userEvent.setup();
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [PLAIN_MED]);
    fireCollection('lots', [PLAIN_LOT]);

    const input = await screen.findByLabelText('จำนวน ' + PLAIN_MED.name);
    await user.click(screen.getByLabelText('เพิ่มจำนวน ' + PLAIN_MED.name));
    // suggestTransferQty() rounds the raw 75 deficit up to the generic 10-unit step (80) for a
    // med with no real box size — this field must show that plain number, never an "x" notation.
    expect(input).toHaveValue('80');
    expect(input.getAttribute('value')).not.toMatch(/x/);
  });
});
