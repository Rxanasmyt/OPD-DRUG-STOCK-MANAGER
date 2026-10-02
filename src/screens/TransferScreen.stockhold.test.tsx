// Regression test for a real, user-reported bug: a med flagged "ยาขาดชั่วคราว"
// (isOnStockHold(), see MedsScreen's "ยาขาดชั่วคราว" action) still showed up in this screen's
// เติมหน้างาน list even though nothing here can fix a known supply problem — the user reported
// seeing it with "ยาติดสถานะขาดชั่วคราวแล้ว แต่ยังขึ้นในยาที่เติมหน้างานครับ". TransferScreen's
// own `meds` filter (its own "Bug fix (user-reported)" comment) now excludes it, same as a
// noSubstock med already was.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import TransferScreen from './TransferScreen';
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
// Leftover substock on purpose — proves exclusion holds even when there's real stock that
// COULD be transferred, not just for a fully-depleted held med.
const HELD_LOT = { id: 'lot-held-1', medId: HELD_MED.id, code: 'LOT-H1', lotNo: 'H1', qty: 200, exp: Date.now() + 300 * 86400000 };

describe('TransferScreen — stock-hold exclusion regression', () => {
  it('shows a normal below-Min med but never a held one, even with leftover substock', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [NORMAL_MED, HELD_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [HELD_LOT]);

    await screen.findByText(NORMAL_MED.name);
    // The held med's name legitimately appears once — in StockHoldBanner, which surfaces it on
    // purpose (see StockHoldBanner.tsx). It must NOT also appear a second time as a row in the
    // เติมหน้างาน list itself.
    expect(screen.getAllByText(HELD_MED.name)).toHaveLength(1);
  });
});
