// "Do the next job for THIS drug" shortcuts: stock-card action bar, auto-return after a shortcut count, HOSxP short-floor rows.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import SubstockCardScreen from './SubstockCardScreen';
import TransferScreen from './TransferScreen';
import CountScreen from './CountScreen';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

const base = { unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true, parSub: 100, parFloor: 100, bin: 'A1', used30: 60, usedPrev30: 0, volatility: 0 };
const A = { ...base, id: 'a1', code: 'MED-0001', name: 'ALPHA DRUG 5 mg', floor: 10 };
const B = { ...base, id: 'b1', code: 'MED-0002', name: 'BRAVO DRUG 5 mg', floor: 20 };

function Screens() {
  const { state } = useApp();
  return <><div data-testid="screen">{state.screen}</div>{state.screen === 'count' ? <CountScreen /> : state.screen === 'substockcard' ? <SubstockCardScreen /> : <TransferScreen />}</>;
}
async function boot(ui: React.ReactElement, meds: Record<string, unknown>[]) {
  renderWithApp(ui);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', meds);
  fireCollection('lots', []);
  seedCollection('txs', []);
}

describe('stock-card action bar', () => {
  it('offers นับ / เติม / รับเข้า / ปรับยอด for a substock med, and jumps to the count screen for that med', async () => {
    const user = userEvent.setup();
    await boot(<Screens />, [A, B]);
    await screen.findByText(A.name);
    // open B's card from the transfer list row
    const rows = await screen.findAllByTitle('ดูบัตรสต็อกยานี้');
    await user.click(rows[rows.length - 1]);
    await waitFor(() => expect(screen.getByTestId('screen').textContent).toBe('substockcard'));
    const bar = await screen.findByTestId('card-actions');
    expect(bar.textContent).toContain('เติมหน้างาน');
    expect(bar.textContent).toContain('รับเข้า');
    expect(bar.textContent).toContain('ปรับยอด');
    await user.click(screen.getByRole('button', { name: /นับหน้างาน/ }));
    await waitFor(() => expect(screen.getByTestId('screen').textContent).toBe('count'));
  });
  it('hides เติมหน้างาน for a med with no substock stage', async () => {
    const user = userEvent.setup();
    await boot(<Screens />, [{ ...A, noSubstock: true }]);
    const rows = await screen.findAllByTitle('ดูบัตรสต็อกยานี้');
    await user.click(rows[0]);
    const bar = await screen.findByTestId('card-actions');
    expect(bar.textContent).not.toContain('เติมหน้างาน');
    expect(bar.textContent).toContain('รับเข้า');
  });
});

describe('count shortcut returns to the list once the count is saved', () => {
  it('goes back (leaves the count screen) when that med\'s count has been recorded', async () => {
    const user = userEvent.setup();
    await boot(<Screens />, [A, B]);
    await screen.findByText(B.name);
    await user.click(screen.getByRole('button', { name: 'นับหน้างาน ' + B.name }));
    await screen.findByLabelText('จำนวนที่นับได้ ' + B.name);
    expect(screen.getByTestId('screen').textContent).toBe('count');
    await act(async () => { fireCollection('meds', [A, { ...B, lastCountTs: Date.now() + 1000 }]); });
    // (this harness renders the list without navigating to it, so "back" lands on the app's initial screen)
    await waitFor(() => expect(screen.getByTestId('screen').textContent).not.toBe('count'));
  });
  it('does NOT auto-return when counting a med that was not opened from a shortcut', async () => {
    renderWithApp(<><CountScreen /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [A]);
    fireCollection('lots', []);
    await screen.findByLabelText('จำนวนที่นับได้ ' + A.name);
    await act(async () => { fireCollection('meds', [{ ...A, lastCountTs: Date.now() + 1000 }]); });
    expect(screen.getByLabelText('จำนวนที่นับได้ ' + A.name)).toBeInTheDocument();
  });
});

function RecHarness() {
  const { state, setHosxpText, processHosxp } = useApp();
  useEffect(() => { if (!state.hosxpText) setHosxpText('ALPHA DRUG 5 mg,500'); }, [state.hosxpText, setHosxpText]);
  return <><div data-testid="screen">{state.screen}</div><button onClick={() => void processHosxp()}>process</button>{state.screen === 'count' ? <CountScreen /> : <ReconcileScreen />}</>;
}
describe('HOSxP short-floor row', () => {
  it('has a นับหน้างาน button that opens the count screen for that med', async () => {
    const user = userEvent.setup();
    await boot(<RecHarness />, [A]);
    await user.click(screen.getByRole('button', { name: 'process' }));
    await user.click(await screen.findByTestId('count-shortcut'));
    await waitFor(() => expect(screen.getByTestId('screen').textContent).toBe('count'));
    await screen.findByLabelText('จำนวนที่นับได้ ' + A.name);
  });
});
