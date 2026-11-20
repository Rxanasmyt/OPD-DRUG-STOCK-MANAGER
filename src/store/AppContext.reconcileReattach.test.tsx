// Re-attaching a HOSxP file for a range that was already reconciled must never deduct a med twice:
// per med only the part above what that exact range already took is deducted.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { signInAs, fireCollection, hasListener, getLastTransactionWrites, seedDoc, seedCollection } from '../test-utils/firebaseTestDouble';
import { isoDate } from '../utils/format';

const YEST = isoDate(Date.now() - 86400000);
const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 90, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function Harness({ text }: { text: string }) {
  const { state, setHosxpText, processHosxp, commitReconcile, setHosxpCoveredFrom, setHosxpCoveredTo } = useApp();
  useEffect(() => { setHosxpText(text); }, [setHosxpText, text]);
  return (
    <div>
      <button onClick={processHosxp}>process</button>
      <button onClick={() => { setHosxpCoveredFrom(YEST); setHosxpCoveredTo(YEST); }}>set-range</button>
      <button onClick={commitReconcile} disabled={!state.hosxpRows}>commit-reconcile</button>
    </div>
  );
}

async function run(text: string, priorQty: number, opts: { liveWindow?: boolean } = {}) {
  const user = userEvent.setup();
  renderWithApp(<><Harness text={text} /><Toast /><ConfirmDialog /></>);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  await waitFor(() => expect(hasListener('txs')).toBe(true));
  const prior = { id: 't1', type: 'reconcile_hosxp', medId: 'm1', qty: -priorQty, ts: Date.now() - 3600000, coveredFrom: YEST, coveredTo: YEST };
  // liveWindow:false models a busy day where the earlier reconcile has scrolled out of the newest-300 window:
  // only the direct covered-range query (seedCollection) can still see it.
  fireCollection('txs', opts.liveWindow === false ? [] : [prior]);
  seedCollection('txs', [prior]);
  await user.click(screen.getByRole('button', { name: 'process' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
  await user.click(screen.getByRole('button', { name: 'set-range' }));
  seedDoc('meds/m1', { floor: MED.floor });
  await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
  await screen.findByText(/เคยตัดยอด HOSxP ไปแล้ว/);
  await user.click(screen.getByRole('button', { name: /ตกลง|ยืนยัน|ดำเนินการ/ }));
}

describe('commitReconcile — re-attaching the same range', () => {
  it('deducts nothing for a med the range already fully took', async () => {
    await run('Paracetamol 500mg,10', 10);
    await screen.findByText(/เคยตัดครบแล้ว/);
    expect(getLastTransactionWrites().length).toBe(0);
  });
  it('deducts only the difference when the new file reports more', async () => {
    await run('Paracetamol 500mg,25', 10);
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    const w = getLastTransactionWrites();
    const floorWrite = w.find((x) => 'floor' in (x.data as object));
    expect((floorWrite!.data as { floor: number }).floor).toBe(90 - 15);
  });
  it('still never double-deducts when the earlier reconcile has scrolled out of the live 300-row txs window', async () => {
    await run('Paracetamol 500mg,10', 10, { liveWindow: false });
    await screen.findByText(/เคยตัดครบแล้ว/);
    expect(getLastTransactionWrites().length).toBe(0);
  });
});
