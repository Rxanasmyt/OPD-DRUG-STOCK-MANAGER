// Regression test for a real request: "ทำ 2 3 4 ให้เกิดประสิทธิภาพที่สุด" (item 3 of the flow-
// diagram audit) — ReconcileScreen's HOSxP daily-dispensing import already has strong safety
// nets (fuzzy-match confirm, single-day confirm, atomic floor+tx writes), but nothing warned
// that today's cut had already run before a re-paste silently double-deducted the floor a
// second time. commitReconcile() now checks lastReconcileDateIso() against today and asks for
// confirmation first — see its own "Bug fix (double-run risk)" comment.
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
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function ReconcileHarness() {
  const { state, setHosxpText, processHosxp, setHosxpConfirmSingleDay, commitReconcile } = useApp();
  useEffect(() => { setHosxpText('Paracetamol 500mg,10'); }, [setHosxpText]);
  useEffect(() => { if (state.hosxpRows) setHosxpConfirmSingleDay(true); }, [state.hosxpRows, setHosxpConfirmSingleDay]);
  return (
    <div>
      <button onClick={processHosxp}>process</button>
      <button onClick={commitReconcile} disabled={!state.hosxpConfirmSingleDay}>commit-reconcile</button>
    </div>
  );
}

describe('commitReconcile — double-run warning regression', () => {
  it('warns before committing when a reconcile_hosxp tx already landed today, and blocks on cancel', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReconcileHarness /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    // Already reconciled today — the exact same risk a re-paste of the same file would hit.
    fireCollection('txs', [{ id: 't1', type: 'reconcile_hosxp', medId: MED.id, ts: Date.now() }]);

    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await screen.findByText(/วันนี้ตัดยอด HOSxP ไปแล้ว/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    expect(getLastTransactionWrites().length).toBe(0);
  });

  it('commits directly with no warning when today has no reconcile_hosxp tx yet', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReconcileHarness /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    // Yesterday's reconcile only — today's hasn't run yet, so no double-run risk.
    fireCollection('txs', [{ id: 't1', type: 'reconcile_hosxp', medId: MED.id, ts: Date.now() - 86400000 }]);

    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(screen.queryByText(/วันนี้ตัดยอด HOSxP ไปแล้ว/)).not.toBeInTheDocument();
  });

  it('proceeds with the double-run once confirmed', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReconcileHarness /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    fireCollection('txs', [{ id: 't1', type: 'reconcile_hosxp', medId: MED.id, ts: Date.now() }]);

    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await screen.findByText(/วันนี้ตัดยอด HOSxP ไปแล้ว/);
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));

    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
  });
});
