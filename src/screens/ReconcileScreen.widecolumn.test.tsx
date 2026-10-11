// Regression test for an audit finding: the จ่ายจริง / ก่อน→หลัง columns used a fixed
// width: 70 — fine for a typical 2-3 digit quantity, but a large dispense (common once a
// formulary's been running a while) would get clipped on a narrow phone instead of the column
// growing to fit. See ReconcileScreen.tsx's own "Bug fix (audit finding)" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'PARACETAMOL', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 1000, parFloor: 1000, floor: 99999, bin: 'C4-6',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function Harness() {
  const { state, setHosxpText, processHosxp } = useApp();
  useEffect(() => { if (!state.hosxpText) setHosxpText('PARACETAMOL,12345'); }, [state.hosxpText, setHosxpText]);
  return (
    <>
      <button onClick={() => void processHosxp()}>process</button>
      <ReconcileScreen />
    </>
  );
}

describe('ReconcileScreen — wide numeric column regression', () => {
  it('lets a large quantity grow the จ่ายจริง column (minWidth) instead of clipping it (width)', async () => {
    const user = userEvent.setup();
    renderWithApp(<Harness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'process' }));

    const qtyEl = await screen.findByText('−12,345');
    // Without the fix this is a fixed `width`, which clips rather than growing for a wide number.
    expect(qtyEl.style.width).toBe('');
    expect(qtyEl.style.minWidth).toBe('70px');
    expect(qtyEl.style.whiteSpace).toBe('nowrap');
  });
});
