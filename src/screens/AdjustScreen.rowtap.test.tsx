// Regression test for a real flow-clarity gap found by audit: AdjustScreen's med-search-result
// list (used for ปรับยอด/คืนยา/ยาเสีย) never got the "ดูบัตรสต็อก" affordance ReceiveScreen's own
// identical-shaped search-result list already has. Someone reviewing a stock correction before
// committing it would want to check the drug's recent history first — every other "find a med"
// screen in the app already offers this. See AdjustScreen.tsx's own CardPeekButton.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdjustScreen from './AdjustScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

function ScreenProbe() {
  const { state } = useApp();
  return <div data-testid="probe">{state.screen}:{state.substockFocusId ?? ''}</div>;
}

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

async function setup() {
  const user = userEvent.setup();
  renderWithApp(<><AdjustScreen /><ScreenProbe /></>);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  fireCollection('lots', []);
  await user.click(await screen.findByRole('button', { name: /^ปรับยอด/ }));
  const search = await screen.findByPlaceholderText('ค้นหาชื่อยา');
  await user.type(search, 'Paracetamol');
  return user;
}

describe('AdjustScreen — search-result row CardPeekButton regression', () => {
  it('opens the บัตรสต็อก via the small 📋 button, without also picking the med for adjustment', async () => {
    const user = await setup();
    await user.click(await screen.findByLabelText('ดูบัตรสต็อก ' + MED.name));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('substockcard:' + MED.id));
    // Picking the med for adjustment would show the delta-warning summary box — absent here.
    expect(screen.queryByText(/ช่องนี้คือ/)).not.toBeInTheDocument();
  });

  it('tapping the row itself still picks the med for adjustment (the row\'s own primary action still works)', async () => {
    const user = await setup();
    await user.click(await screen.findByText(MED.name));
    await screen.findByText(/ส่วนต่างที่จะลบออกจากยอดระบบ/);
    expect(screen.getByTestId('probe')).not.toHaveTextContent('substockcard');
  });
});
