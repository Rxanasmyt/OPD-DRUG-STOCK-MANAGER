// Regression test for a real cross-screen consistency bug: a lot expiring TODAY
// (daysUntil===0) is already unsafe to dispense, and the aging/turnover report's own
// "หมดอายุแล้ว" bucket already counts day-0 as expired (its `<= hi` bound with hi=0) — but
// HomeScreen's "หมดแล้ว" tile/quick-action used a strict `< 0` test, so the SAME lot read as
// "already expired" on the Report screen while HomeScreen funneled it into the "ใช้ก่อน"
// (use-first/transfer) flow instead of the "ตัดออก" (scrap/write-off) flow the report already
// counted it under. See HomeScreen.tsx's own "Bug fix (consistency)" comments.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import HomeScreen from './HomeScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
// exp = right now → daysUntil() compares CALENDAR dates, so this lands on d===0 (expires today),
// the exact boundary day the old `< 0` check misclassified as "not yet expired".
const LOT_TODAY = { id: 'l1', medId: 'm1', lotNo: 'LOT-TODAY', qty: 20, exp: Date.now() };

describe('HomeScreen — expiry day-0 classification regression', () => {
  it('counts a lot expiring today as already expired, with the scrap ("ตัดออก") action, not the transfer one', async () => {
    renderWithApp(<HomeScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [LOT_TODAY]);

    // Without the fix, this would read "0" (expLots.length - expiredCount) under "ใกล้ครบ"
    // instead of counting toward "หมดแล้ว".
    await screen.findByText('● หมดแล้ว 1');
    expect(screen.queryByText(/ใกล้ครบ/)).not.toBeInTheDocument();

    // The quick action for this row must be the scrap flow, not "ใช้ก่อน" (transfer).
    await screen.findByRole('button', { name: 'ตัดออก' });
    expect(screen.queryByRole('button', { name: 'ใช้ก่อน' })).not.toBeInTheDocument();
  });
});
