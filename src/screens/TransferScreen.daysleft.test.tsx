// Regression test for a real request: "ควรปรับปรุงอะไรเพิ่มเติมอีกมั้ยครับในการเติมยาหน้างาน..."
// — TransferScreen showed Min/Max/par (fixed targets) but never the real-usage-based
// daysOfStockLeft() (selectors.ts) already computed elsewhere in the app (ReportScreen's
// turnover/insights tabs) — a fast-moving drug just above Min can have only days of real
// runway left while a slow-moving one below Min can have weeks; Min/Max alone can't tell those
// apart. See Qty.tsx's DaysLeftBadge and TransferScreen.tsx's own comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import TransferScreen from './TransferScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// floor 10 < floorMinOf(100)=50 → lands in the list. onHand = floor(10) + substock(0, no lots)
// = 10; used30 300 → dailyUsageRate = 300 / WEEKDAYS_PER_30_DAYS ≈ 15 units/weekday (see
// selectors.ts's own doc comment) → daysOfStockLeft = round(10 / 15) = 1 day — comfortably
// inside the "≤3 days" critical band.
const FAST_MOVING_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 300, usedPrev30: 0, volatility: 0,
};
// No usage recorded at all (used30 = 0) — daysOfStockLeft() must return null (not a misleading
// Infinity/0), so the badge should render nothing for this row.
const NO_USAGE_MED = {
  id: 'm2', code: 'MED-0002', name: 'Warfarin 2mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('TransferScreen — days-of-stock-left badge regression', () => {
  it('shows the real-usage-based days-left badge for a fast-moving drug, and nothing for one with no usage data', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [FAST_MOVING_MED, NO_USAGE_MED]);
    fireCollection('lots', []);

    await screen.findByText(/เหลือใช้ ~1 วัน/);
    // NO_USAGE_MED's row must not show any days-left badge at all — daysOfStockLeft() returns
    // null for it, and DaysLeftBadge renders nothing for null (not "~0 วัน" or similar). Exactly
    // one badge on the whole screen (FAST_MOVING_MED's) proves NO_USAGE_MED's row has none.
    expect(screen.queryAllByText(/เหลือใช้/)).toHaveLength(1);
  });
});

// Regression test for the FEFO-line fix: expTone() (selectors.ts) existed but had zero call
// sites before this fix — the FEFO line always rendered flat green regardless of how urgent the
// soonest-expiring lot actually was. See TransferScreen.tsx's own "Bug fix (patient safety)"
// comment right above the FEFO line's IIFE.
const EXPIRED_MED = {
  id: 'm3', code: 'MED-0003', name: 'Cefixime 400mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A3',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const NEAR_EXPIRY_MED = {
  id: 'm4', code: 'MED-0004', name: 'Domperidone 10mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A4',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const HEALTHY_MED = {
  id: 'm5', code: 'MED-0005', name: 'Metformin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A5',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('TransferScreen — FEFO expiry-urgency regression', () => {
  it('flags an already-expired lot and a near-expiry lot, and stays quiet for a healthy one', async () => {
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [EXPIRED_MED, NEAR_EXPIRY_MED, HEALTHY_MED]);
    fireCollection('lots', [
      { id: 'l3', medId: EXPIRED_MED.id, qty: 5, lotNo: 'LE', exp: Date.now() - 5 * 86400000 },
      { id: 'l4', medId: NEAR_EXPIRY_MED.id, qty: 5, lotNo: 'LN', exp: Date.now() + 10 * 86400000 },
      { id: 'l5', medId: HEALTHY_MED.id, qty: 5, lotNo: 'LH', exp: Date.now() + 200 * 86400000 },
    ]);

    await screen.findByText(/หมดอายุแล้ว ควรตัดออกก่อนเติม/);
    expect(screen.getAllByText(/หมดอายุแล้ว ควรตัดออกก่อนเติม/)).toHaveLength(1);
    expect(screen.getAllByText(/ใกล้หมดอายุมาก/)).toHaveLength(1);
  });
});
