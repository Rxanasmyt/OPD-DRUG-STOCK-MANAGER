// Regression test for the same real, user-reported bug as TransferScreen.stockhold.test.tsx: a
// med flagged "ยาขาดชั่วคราว" (isOnStockHold()) still showed up in HomeScreen's "ต้องเติมหน้างาน"
// list/tile even though nothing here can fix a known supply problem. See HomeScreen.tsx's own
// "Bug fix (user-reported)" comment on the `low`/`lowSub`/`urgent` filters.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import HomeScreen from './HomeScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const NORMAL_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floorMin: 50, floor: 10, bin: 'C7',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const HELD_MED = {
  id: 'm2', code: 'MED-0002', name: 'Cefixime 100mg', unit: 'แคปซูล', dosageForm: 'แคปซูล',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floorMin: 50, floor: 10, bin: 'D8',
  used30: 0, usedPrev30: 0, volatility: 0,
  outOfStockSince: Date.now() - 86400000, outOfStockReason: 'บริษัทเลิกผลิต',
};
const HELD_LOT = { id: 'lot-held-1', medId: HELD_MED.id, code: 'LOT-H1', lotNo: 'H1', qty: 200, exp: Date.now() + 300 * 86400000 };

describe('HomeScreen — stock-hold exclusion regression', () => {
  it('lists a normal below-Min med in "ต้องเติมหน้างาน" but never a held one', async () => {
    renderWithApp(<HomeScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [NORMAL_MED, HELD_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [HELD_LOT]);

    // NORMAL_MED is both below Min and urgent (floor 10 ≤ half of floorMin 50), so it
    // legitimately appears more than once (ต้องเติมหน้างาน list + เร่งด่วนวันนี้ section) —
    // just confirm it rendered at all.
    await screen.findAllByText(NORMAL_MED.name);
    // The held med's name legitimately appears once — in StockHoldBanner, which surfaces it on
    // purpose (see StockHoldBanner.tsx). It must NOT also appear in either of those sections.
    expect(screen.getAllByText(HELD_MED.name)).toHaveLength(1);
  });
});
