// Regression test for a real flow-clarity gap: every med row in HomeScreen's three lists
// (ต้องเติมหน้างาน / ควรเบิกจากคลังยาใหญ่ / ใกล้หมดอายุ) already carries the "row-interactive"
// class — the same hover-highlight + press-scale styling ReportScreen's own tap-to-
// goSubstockCardFor() rows use to signal "tap me" — but the row itself had no onClick at all;
// only the small action button inside it did anything. Someone scanning the dashboard's most-
// used lists could tap a drug's name expecting its บัตรสต็อก (exactly what the identical
// styling elsewhere in the app already does) and get nothing. See HomeScreen.tsx's own
// "Bug fix (flow clarity)" comment on rowToCard/stopRowNav.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HomeScreen from './HomeScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

function ScreenProbe() {
  const { state } = useApp();
  return <div data-testid="probe">{state.screen}:{state.substockFocusId ?? ''}</div>;
}

// parFloor 120 → floorMinOf() defaults to 60 — floor 55 sits below that, landing this med in
// the "ต้องเติมหน้างาน" list. Its own substock lot (below) covers parSub exactly, so it does
// NOT also land in "ควรเบิกจากคลังยาใหญ่" — this test only needs it in ONE list, or getByText
// would (correctly) complain about matching more than one row.
const LOW_FLOOR_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 120, floor: 55, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const LOT_FULL_SUB = { id: 'l0', medId: 'm1', lotNo: 'LOT-0', qty: 500, exp: Date.now() + 365 * 86400000 };
// parSub 500, sub qty (from LOT below) well under that → lands in "ควรเบิกจากคลังยาใหญ่".
const LOW_SUB_MED = {
  id: 'm2', code: 'MED-0002', name: 'Warfarin 2mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 90, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const LOT_LOW_SUB = { id: 'l1', medId: 'm2', lotNo: 'LOT-1', qty: 10, exp: Date.now() + 365 * 86400000 };
// Near-expiry lot for the same LOW_SUB_MED (already active, so no extra med needed) — lands
// in "ใกล้หมดอายุ" too since expiryWarnDays defaults to 90 and this is 10 days out.
const LOT_NEAR_EXP = { id: 'l2', medId: 'm2', lotNo: 'LOT-2', qty: 5, exp: Date.now() + 10 * 86400000 };

async function setup() {
  const user = userEvent.setup();
  renderWithApp(<><HomeScreen /><ScreenProbe /></>);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [LOW_FLOOR_MED, LOW_SUB_MED]);
  fireCollection('lots', [LOT_FULL_SUB, LOT_LOW_SUB, LOT_NEAR_EXP]);
  return user;
}

describe('HomeScreen — row-tap-to-substock-card regression', () => {
  it('opens the บัตรสต็อก for the tapped med in the "ต้องเติมหน้างาน" list, without also triggering the row\'s own action button', async () => {
    const user = await setup();
    await user.click(await screen.findByText(LOW_FLOOR_MED.name));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('substockcard:' + LOW_FLOOR_MED.id));
  });

  it('opens the บัตรสต็อก for the tapped med in the "ควรเบิกจากคลังยาใหญ่" list', async () => {
    const user = await setup();
    const rows = await screen.findAllByText(LOW_SUB_MED.name);
    // LOW_SUB_MED appears in both the "ควรเบิกจากคลังยาใหญ่" and "ใกล้หมดอายุ" lists — either
    // instance resolves to the same med, so the first is enough to prove the row itself (not
    // just its action button) is now tappable.
    await user.click(rows[0]);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('substockcard:' + LOW_SUB_MED.id));
  });
});
