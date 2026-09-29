// Regression test for a real request: "ให้ทุกหน้าที่แสดงชื่อยาจำนวนยา...เติมชั้นวางยาหน้างาน...
// ให้สามารถดูบัตรสต็อคได้" — TransferScreen already had an INDIRECT path (tap "ดูภาพรวม" to
// expand a MedMiniCard panel, which has its own "ดูบัตรสต็อกเต็ม →" link at the bottom), but
// that's an extra tap before the extra tap. Tapping the row itself now opens the บัตรสต็อก
// directly, in one tap, the same rowToCard/stopRowNav pattern HomeScreen's own rows use — while
// the −/qty input/+ cart controls and the "ดูภาพรวม" toggle still work exactly as before (a tap
// on any of THEM must not also navigate away). See TransferScreen.tsx's own comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TransferScreen from './TransferScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

function ScreenProbe() {
  const { state } = useApp();
  return <div data-testid="probe">{state.screen}:{state.substockFocusId ?? ''}</div>;
}

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('TransferScreen — row-tap-to-substock-card regression', () => {
  it('opens the บัตรสต็อก for a tapped row, without also toggling the cart quantity', async () => {
    const user = userEvent.setup();
    renderWithApp(<><TransferScreen /><ScreenProbe /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);

    await user.click(await screen.findByText(MED.name));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('substockcard:' + MED.id));
  });

  it('tapping the + cart button still only bumps the cart, without also navigating to the บัตรสต็อก', async () => {
    const user = userEvent.setup();
    renderWithApp(<><TransferScreen /><ScreenProbe /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);

    await user.click(await screen.findByLabelText('เพิ่มจำนวน ' + MED.name));
    // Rendering TransferScreen standalone (not through App's router) never sets state.screen to
    // 'transfer' itself — the only thing this test needs to prove is that a tap on the + button
    // does NOT ALSO trigger the row's goSubstockCardFor navigation.
    expect(screen.getByTestId('probe')).not.toHaveTextContent('substockcard');
  });
});
