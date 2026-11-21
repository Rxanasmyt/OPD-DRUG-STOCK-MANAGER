// A file row that needs no daily decision — drug switched OFF in the app, or name marked "not stock-tracked" by an admin —
// is skipped automatically: no red box, no blocking, but it is still listed (never silently hidden) and still never deducted.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, fireDoc, hasListener, getLastBatchWrites } from '../test-utils/firebaseTestDouble';
import { hosxpNameKey } from '../store/selectors';

const med = (o: Record<string, unknown>) => ({ id: 'm1', code: 'MED-0001', name: 'PARACETAMOL', unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true, parSub: 1000, parFloor: 1000, floor: 99999, bin: 'C4-6', used30: 0, usedPrev30: 0, volatility: 0, ...o });

function Harness({ text }: { text: string }) {
  const { state, setHosxpText, processHosxp } = useApp();
  useEffect(() => { if (!state.hosxpText) setHosxpText(text); }, [state.hosxpText, setHosxpText, text]);
  return (<><button onClick={() => void processHosxp()}>process</button><ReconcileScreen /></>);
}
async function boot(text: string, meds: Record<string, unknown>[], role: 'pharm' | 'admin' = 'pharm') {
  const user = userEvent.setup();
  renderWithApp(<Harness text={text} />);
  await signInAs('u1', { role, name: 'ทดสอบ', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', meds);
  return user;
}

describe('ReconcileScreen — auto-skip rows', () => {
  it('a drug that is switched off in the app is skipped automatically (no red warning, still listed)', async () => {
    const user = await boot('PARACETAMOL,10\nMORPHINE 10 mg,50', [med({}), med({ id: 'm2', name: 'MORPHINE 10 mg', active: false })]);
    await user.click(screen.getByRole('button', { name: 'process' }));
    const row = await screen.findByTestId('auto-skip-row');
    expect(row.textContent).toContain('ปิดใช้งาน');
    expect(row.textContent).toContain('50');
    expect(screen.queryByTestId('unmatched-big-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('file-row-fixer')).not.toBeInTheDocument();
  });
  it('a name that resembles NOTHING the app tracks is skipped automatically for a non-admin (no decision, no red box)', async () => {
    const user = await boot('PARACETAMOL,10\nD-5-N (5+0.9) % ถุง (1,000 ml.),8', [med({})], 'pharm');
    await user.click(screen.getByRole('button', { name: 'process' }));
    const row = await screen.findByTestId('auto-skip-row');
    expect(row.textContent).toContain('ไม่มียานี้ในแอพ');
    expect(screen.getByTestId('auto-skip-summary').textContent).toContain('1 รายการ');
    expect(screen.queryByTestId('unmatched-big-warning')).not.toBeInTheDocument();
    expect(screen.queryByTestId('file-row-fixer')).not.toBeInTheDocument();
    // auto-skipped rows are not "ต้องดู" (no attention tab is even offered when nothing else needs a look)
    expect(screen.queryByRole('tab', { name: /ต้องดู/ })).not.toBeInTheDocument();
  });
  it('a name that resembles a TRACKED drug (e.g. other strength) still asks, so stock never drifts silently', async () => {
    const user = await boot('PARACETAMOL,10\nPARACETAMOL 650 mg,1558', [med({ name: 'PARACETAMOL 500 mg' })]);
    await user.click(screen.getByRole('button', { name: 'process' }));
    expect(await screen.findByTestId('unmatched-big-warning')).toBeInTheDocument();
    expect(screen.queryByTestId('auto-skip-row')).not.toBeInTheDocument();
  });
  it('a name an admin marked "ไม่ตามสต็อก" (meta/settings.hosxpIgnoredNames) is skipped automatically', async () => {
    const user = await boot('PARACETAMOL,10\nD-5-N/2 (5+0.45) % ถุง (500 ml.),6', [med({})]);
    await act(async () => { fireDoc('meta/settings', { hosxpIgnoredNames: [hosxpNameKey('D-5-N/2 (5+0.45) % ถุง (500 ml.)')] }); });
    await user.click(screen.getByRole('button', { name: 'process' }));
    const row = await screen.findByTestId('auto-skip-row');
    expect(row.textContent).toContain('ไม่ตามสต็อก');
    expect(screen.queryByTestId('unmatched-big-warning')).not.toBeInTheDocument();
  });
  it('the ignore list can never hide a drug the app DOES track (an exact match wins)', async () => {
    const user = await boot('PARACETAMOL,10', [med({})]);
    await act(async () => { fireDoc('meta/settings', { hosxpIgnoredNames: [hosxpNameKey('PARACETAMOL')] }); });
    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getAllByText(/PARACETAMOL/).length).toBeGreaterThan(0));
    expect(screen.queryByTestId('auto-skip-row')).not.toBeInTheDocument();
  });
  it('admin gets a "skip every day" button on an unknown name; pharm does not', async () => {
    const u1 = await boot('PARACETAMOL,10\nPARACETAMOL 650 mg,1558', [med({ name: 'PARACETAMOL 500 mg' })], 'admin');
    await u1.click(screen.getByRole('button', { name: 'process' }));
    expect(await screen.findByTestId('ignore-forever')).toBeInTheDocument();
  });
  it('pharm has no ignore-forever button', async () => {
    const u = await boot('PARACETAMOL,10\nPARACETAMOL 650 mg,1558', [med({ name: 'PARACETAMOL 500 mg' })], 'pharm');
    await u.click(screen.getByRole('button', { name: 'process' }));
    await screen.findByTestId('file-row-fixer');
    expect(screen.queryByTestId('ignore-forever')).not.toBeInTheDocument();
    void getLastBatchWrites;
  });
});
