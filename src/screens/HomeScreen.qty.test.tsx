// Regression test for a real value-mismatch bug: the "+N" quick-add button in the "ต้องเติม
// หน้างาน" list used to show the raw, unrounded deficit (parFloor - floor, capped by substock),
// but tapping it calls bump(m.id, 1), which for an empty cart sets the cart quantity to
// suggestTransferQty() instead — rounding the deficit UP to this med's pack/magnitude step
// (packStep() in selectors.ts). A med whose deficit isn't already a clean multiple of its step
// (e.g. any med with parFloor >= 100, rounding to a step of 10) showed one number on the button
// and landed a DIFFERENT, larger number in the cart on tap — a real, user-visible mismatch
// between what was tapped and what gets committed. See HomeScreen.tsx's own "Bug fix
// (value-mismatch)" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import HomeScreen from './HomeScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// parFloor 120 → floorMinOf() defaults to 60 (half of Max, rounded) — floor 55 sits below that,
// so this med lands in the "ต้องเติมหน้างาน" list. Raw deficit = 120-55 = 65; packStep() rounds
// a parFloor>=100 med's step to 10, so suggestTransferQty() ceils 65 up to 70 (capped by the
// substock qty below, which is well above 70 so the cap never bites).
const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 120, floor: 55, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const LOT = { id: 'l1', medId: 'm1', lotNo: 'LOT-1', qty: 100, exp: Date.now() + 365 * 86400000 };

describe('HomeScreen — quick-add button matches suggestTransferQty regression', () => {
  it('shows the same pack/step-rounded quantity that tapping the button would actually put in the cart', async () => {
    renderWithApp(<HomeScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [LOT]);

    // Without the fix, this would read "+ 65" (the raw, unrounded deficit) instead of "+ 70"
    // (what bump() actually puts in the cart via suggestTransferQty()'s step rounding).
    await screen.findByRole('button', { name: '+ 70' });
    expect(screen.queryByRole('button', { name: '+ 65' })).not.toBeInTheDocument();
  });
});
