import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';
import { isoDate } from '../utils/format';

const YEST = isoDate(Date.now() - 86400000);
const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 90, bin: 'A1', used30: 0, usedPrev30: 0, volatility: 0,
};
function Harness() {
  const { state, setHosxpText, processHosxp, setHosxpCoveredFrom, setHosxpCoveredTo } = useApp();
  useEffect(() => { if (!state.hosxpText) setHosxpText('Paracetamol 500mg,25'); }, [state.hosxpText, setHosxpText]);
  return (<><button onClick={async () => { await processHosxp(); setHosxpCoveredFrom(YEST); setHosxpCoveredTo(YEST); }}>process</button><ReconcileScreen /></>);
}
describe('ReconcileScreen preview — same range already reconciled', () => {
  it('shows what was already taken and only the difference to be deducted', async () => {
    const user = userEvent.setup();
    renderWithApp(<Harness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('txs', [{ id: 't1', type: 'reconcile_hosxp', medId: 'm1', qty: -10, ts: Date.now() - 3600000, coveredFrom: YEST, coveredTo: YEST }]);
    await user.click(screen.getByRole('button', { name: 'process' }));
    expect(await screen.findByText(/เคยตัดไปแล้ว 10 จากไฟล์ 25 — ตัดเพิ่มเฉพาะส่วนต่าง 15/)).toBeInTheDocument();
    expect(screen.getByText('−15')).toBeInTheDocument();
  });
});
