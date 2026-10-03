// Regression test for a real flow-clarity gap found by audit: CountScreen never got the
// "tap a med row → open its stock card" pattern that HomeScreen/TransferScreen/ReceiveScreen/
// ReportScreen already share. Hitting a row with "มากกว่าระบบ"/"น้อยกว่าระบบ" during a cycle
// count is exactly when someone would want to sanity-check that discrepancy against recent
// transaction history before committing — every other screen already trained them on "tap the
// row to see the stock card". See CountScreen.tsx's own "Real-world request" comment on
// rowToCard above.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CountScreen from './CountScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

function ScreenProbe() {
  const { state } = useApp();
  return <div data-testid="probe">{state.screen}:{state.substockFocusId ?? ''}</div>;
}

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

async function setup() {
  const user = userEvent.setup();
  renderWithApp(<><CountScreen /><ScreenProbe /></>);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  fireCollection('lots', []);
  return user;
}

describe('CountScreen — row-tap-to-substock-card regression', () => {
  it('opens the บัตรสต็อก for a tapped row, without also focusing the count input', async () => {
    const user = await setup();
    await user.click(await screen.findByText(MED.name));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('substockcard:' + MED.id));
  });

  // Real-world request ("ui UX animation" audit): a role="button" DIV never picks up the
  // global `button:active { transform: scale(.96) }` feedback a real <button> gets automatically
  // (that CSS rule only matches real <button> elements) — without this class explicitly, tapping
  // this row during a cycle count gave zero visual confirmation the tap registered.
  it('gives tap feedback via the row-interactive class (a role="button" div gets no feedback otherwise)', async () => {
    await setup();
    const row = (await screen.findByText(MED.name)).closest('div[role="button"]') as HTMLElement;
    expect(row).toHaveClass('row-interactive');
  });

  it('typing into the count input does not also navigate to the stock card', async () => {
    const user = await setup();
    const input = await screen.findByLabelText('จำนวนที่นับได้ ' + MED.name);
    await user.type(input, '45');
    expect(input).toHaveValue('45');
    expect(screen.getByTestId('probe')).not.toHaveTextContent('substockcard');
  });

  it('tapping the commit button does not also navigate to the stock card', async () => {
    const user = await setup();
    const input = await screen.findByLabelText('จำนวนที่นับได้ ' + MED.name);
    await user.type(input, '45');
    const row = input.closest('div[role="button"]') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'บันทึก' }));
    expect(screen.getByTestId('probe')).not.toHaveTextContent('substockcard');
  });
});
