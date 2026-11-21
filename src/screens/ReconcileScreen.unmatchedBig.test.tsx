// A large-quantity file row that matches no drug must never be a quiet skip: the screen shows a
// red warning (ranked by qty) before commit. (A name that resembles NOTHING the app tracks is auto-skipped instead — see
// ReconcileScreen.autoSkip.test.tsx; this one is a different strength of a tracked drug, so it must still ask.)
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'PARACETAMOL 500 mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 1000, parFloor: 1000, floor: 99999, bin: 'C4-6',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function Harness() {
  const { state, setHosxpText, processHosxp } = useApp();
  useEffect(() => { if (!state.hosxpText) setHosxpText('PARACETAMOL 500 mg,10\nPARACETAMOL 650 mg,1558'); }, [state.hosxpText, setHosxpText]);
  return (<><button onClick={() => void processHosxp()}>process</button><ReconcileScreen /></>);
}

describe('ReconcileScreen — unmatched big-qty warning', () => {
  it('warns about an unmatched row with its quantity before commit', async () => {
    const user = userEvent.setup();
    renderWithApp(<Harness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await user.click(screen.getByRole('button', { name: 'process' }));
    const w = await screen.findByTestId('unmatched-big-warning');
    expect(w.textContent).toContain('PARACETAMOL 650 mg');
    expect(w.textContent).toContain('1,558');
  });
});
