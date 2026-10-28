// Regression test for a real bug found during a systematic codebase audit: commitReconcile()
// (AppContext.tsx) clamps the live floor at 0 (a med can't go negative) — correct for the floor
// balance itself, but the tx-log `qty` it wrote used to be that SAME clamped delta, silently
// understating how much HOSxP actually reported dispensing whenever today's floor couldn't
// cover it (a stale/lagging count, or a big multi-day Monday catch-up file against a fast-
// moving drug). recomputeUsageStats()/scripts/recompute-usage-stats.mjs (used30/usedPrev30,
// feeding suggestPar()) and scripts/collect-daily-metrics.mjs's daily dispensed-qty KPI both
// summed that same understated `qty` directly — quietly suppressing the par-increase suggestion
// on exactly the meds running low enough to hit this clamp. Fixed by keeping `qty` as the real
// floor delta (scripts/check-stock-drift.mjs replays it to verify against the live floor, so it
// has to keep meaning "what actually happened to floor") and adding `reportedQty` to carry the
// true HOSxP number when it differs — see Tx.reportedQty's own doc comment (types.ts).
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { signInAs, fireCollection, hasListener, getLastTransactionWrites, seedDoc } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 5, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function ReconcileHarness({ hosxpQty }: { hosxpQty: number }) {
  const { state, setHosxpText, processHosxp, commitReconcile } = useApp();
  useEffect(() => { setHosxpText('Paracetamol 500mg,' + hosxpQty); }, [setHosxpText, hosxpQty]);
  return (
    <div>
      <button onClick={processHosxp}>process</button>
      <button onClick={commitReconcile} disabled={!state.hosxpRows}>commit-reconcile</button>
    </div>
  );
}

function findTxSet() {
  return getLastTransactionWrites().find((w) => w.kind === 'set' && w.path.startsWith('txs/'));
}

describe('commitReconcile — reportedQty regression (floor-clamp data integrity)', () => {
  it('when HOSxP reports more than the floor can cover, logs qty as the real (clamped) floor delta but reportedQty as the true HOSxP amount', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReconcileHarness hosxpQty={20} /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    fireCollection('txs', []);
    seedDoc('meds/m1', { floor: MED.floor }); // live floor (5) is less than HOSxP's reported 20

    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await waitFor(() => expect(findTxSet()).toBeDefined());

    const txWrite = findTxSet();
    // qty is the real floor delta (5 -> 0, clamped), never the raw -20 that would drive floor negative.
    expect(txWrite?.data.qty).toBe(-5);
    // reportedQty carries the true HOSxP-reported amount for usage-stats/KPI readers to prefer.
    expect(txWrite?.data.reportedQty).toBe(20);

    const floorUpdate = getLastTransactionWrites().find((w) => w.kind === 'update' && w.path === 'meds/m1');
    expect(floorUpdate?.data.floor).toBe(0);
  });

  it('when the floor comfortably covers it, omits reportedQty entirely (never writes it as undefined)', async () => {
    const user = userEvent.setup();
    const med = { ...MED, floor: 40 };
    renderWithApp(<><ReconcileHarness hosxpQty={10} /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [med]);
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    fireCollection('txs', []);
    seedDoc('meds/m1', { floor: med.floor });

    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await waitFor(() => expect(findTxSet()).toBeDefined());

    const txWrite = findTxSet();
    expect(txWrite?.data.qty).toBe(-10);
    expect('reportedQty' in (txWrite?.data ?? {})).toBe(false);
  });
});
