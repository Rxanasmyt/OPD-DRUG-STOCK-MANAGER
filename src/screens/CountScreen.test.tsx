// Regression test for a real feature request: "ปรับการนับสต็อคให้เป็นรูปแบบนับกล่องได้ แต่ให้มี
// รายละเอียดว่า 1 กล่อง กี่เม็ด" — someone physically counting a shelf full of boxed stock counts
// "3 กล่อง + 5 เม็ดเศษ", not a pre-multiplied total. The "นับเป็นกล่อง" screen mode swaps the
// single count input for a กล่อง+เศษ pair (for any med with Med.packSize set — the existing
// "units per box" field, see MedsScreen) and multiplies them out into the exact same
// countInputs/subCountInputs value the unit-mode input always wrote, so commitCount/
// commitAllCounts need no changes at all. See CountScreen.tsx's own bug-fix comments.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CountScreen from './CountScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const BOXED_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 0, bin: 'A1', packSize: 10,
  used30: 0, usedPrev30: 0, volatility: 0,
};
const PLAIN_MED = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 0, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('CountScreen — box-counting regression', () => {
  it('multiplies กล่อง+เศษ into the same total the unit input would have needed, for a med with packSize set', async () => {
    const user = userEvent.setup();
    renderWithApp(<CountScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BOXED_MED]);
    fireCollection('lots', []);

    await user.click(screen.getByRole('button', { name: 'นับเป็นกล่อง' }));

    await user.type(screen.getByLabelText('จำนวนกล่องที่นับได้ ' + BOXED_MED.name), '2');
    await user.type(screen.getByLabelText('จำนวนเศษที่นับได้ ' + BOXED_MED.name), '5');

    // 2 กล่อง × packSize 10 + เศษ 5 = 25 เม็ด, against a system floor of 0.
    await screen.findByText('= 25 เม็ด');
    expect(screen.getByText(/มากกว่าระบบ 25 เม็ด/)).toBeInTheDocument();
  });

  it('keeps the plain unit input for a med with no packSize set, even in นับเป็นกล่อง mode', async () => {
    const user = userEvent.setup();
    renderWithApp(<CountScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [PLAIN_MED]);
    fireCollection('lots', []);

    await user.click(screen.getByRole('button', { name: 'นับเป็นกล่อง' }));

    expect(screen.queryByLabelText('จำนวนกล่องที่นับได้ ' + PLAIN_MED.name)).not.toBeInTheDocument();
    const input = screen.getByLabelText('จำนวนที่นับได้ ' + PLAIN_MED.name);
    await user.type(input, '30');
    expect(screen.getByText(/มากกว่าระบบ 30 เม็ด/)).toBeInTheDocument();
  });
});
