// Regression test for a real staleness gap: DaysLeftBadge on this screen used to always project
// off the stale LIVE floor (state.meds), even for a row whose count has already been typed —
// right at the moment the operator is deciding whether to escalate before tapping "บันทึก", the
// badge could disagree with the number they just typed. The fix substitutes the just-typed
// (not-yet-committed) count into daysOfStockLeft()'s new onHandOverride param. See
// CountScreen.tsx's own "Bug fix" comment right above the DaysLeftBadge call site.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CountScreen from './CountScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// floor 10, used30 300 → dailyUsageRate ≈ 14/day → daysOfStockLeft(untyped) = round(10/14) = 1.
const FAST_MOVING_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 300, usedPrev30: 0, volatility: 0,
};

describe('CountScreen — days-left badge reflects the just-typed count regression', () => {
  it('projects runway off the typed count, not the stale live floor, the moment something is typed', async () => {
    const user = userEvent.setup();
    renderWithApp(<CountScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [FAST_MOVING_MED]);
    fireCollection('lots', []);

    // Before typing anything, the badge reflects the stale live floor (10 → ~1 วัน).
    await screen.findByText(/เหลือใช้ ~1 วัน/);

    // Physically counted 100 on the shelf — far more real runway than the live floor implies.
    // 100 / 14 ≈ 7 วัน.
    await user.type(screen.getByLabelText('จำนวนที่นับได้ ' + FAST_MOVING_MED.name), '100');

    await screen.findByText(/เหลือใช้ ~7 วัน/);
    expect(screen.queryByText(/เหลือใช้ ~1 วัน/)).not.toBeInTheDocument();
  });
});
