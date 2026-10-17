// Regression test for a real request: "merge อยากให้รันอัตโนมัติหลักจากแนบไฟล์การใช้ยาจาก hosxp"
// followed by "ให้ admin และเภสัชกรเป็นคนตัดยอด" — recomputeUsageStats()/analyzeWeekdayUsage() used
// to need someone to click a manual button in SettingsScreen (scripts/recompute-usage-stats.mjs's
// daily cron covers "doesn't rely on someone remembering", but still means par suggestions can
// lag a real day behind the HOSxP file a pharmacist just attached). commitReconcile() now fires
// both functions itself, silently, right after a successful reconcile, for whichever role
// actually performs it — admin OR pharm (canRecomputeUsageStats/isPharmOrAdmin — see both doc
// comments in AppContext.tsx/firestore.rules) — and still correctly no-ops for a tech-performed
// reconcile rather than erroring.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import { signInAs, fireCollection, hasListener, seedDoc, seedCollection, getLastTransactionWrites, getLastBatchWrites } from '../test-utils/firebaseTestDouble';

const DAY = 24 * 60 * 60 * 1000;
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

describe('commitReconcile — auto-trigger usage-stats recompute regression', () => {
  it.each([
    ['admin', 'ทดสอบ Admin'] as const,
    ['pharm', 'ทดสอบ ภก.'] as const,
  ])('silently recomputes used30 right after a %s-performed reconcile, with no progress/success toast', async (role, name) => {
    const user = userEvent.setup();
    renderWithApp(<><ReconcileHarness /><Toast /></>);
    await signInAs('u1', { role, name, username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    fireCollection('txs', []); // nothing reconciled today yet — no double-run warning
    // Pre-existing real dispensing history (independent of whatever commitReconcile itself is
    // about to write — the test double's transaction writes don't feed back into getDocs()) for
    // the auto-triggered recomputeUsageStats() to find.
    seedCollection('txs', [
      { type: 'reconcile_hosxp', name: MED.name, medId: MED.id, qty: -8, unit: 'เม็ด', by: 'u1', ts: Date.now() - 2 * DAY },
    ]);

    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0)); // the reconcile itself landed

    await waitFor(() => {
      const medWrite = getLastBatchWrites().find((w) => w.path === 'meds/m1' && w.data && 'used30' in w.data);
      expect(medWrite?.data?.used30).toBe(8);
    });

    // Silent — no progress/success toast from either auto-triggered function, even though the
    // main reconcile's own "ตัดยอดหน้างานตามไฟล์แล้ว" toast did show.
    await screen.findByText(/ตัดยอดหน้างานตามไฟล์แล้ว/);
    expect(screen.queryByText(/กำลังคำนวณสถิติการใช้ยาใหม่/)).not.toBeInTheDocument();
    expect(screen.queryByText(/คำนวณสถิติใหม่แล้ว/)).not.toBeInTheDocument();
    expect(screen.queryByText(/กำลังวิเคราะห์รูปแบบการใช้ยา/)).not.toBeInTheDocument();
  });

  it('does nothing extra when a tech performs the reconcile — no permission error, just the ordinary reconcile', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReconcileHarness /><Toast /></>);
    await signInAs('u1', { role: 'tech', name: 'ทดสอบ จพ.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    fireCollection('txs', []);
    seedCollection('txs', [
      { type: 'reconcile_hosxp', name: MED.name, medId: MED.id, qty: -8, unit: 'เม็ด', by: 'u1', ts: Date.now() - 2 * DAY },
    ]);

    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await screen.findByText(/ตัดยอดหน้างานตามไฟล์แล้ว/);

    expect(getLastBatchWrites().length).toBe(0);
    expect(screen.queryByText(/resource-exhausted|permission|เกินขีดจำกัด/)).not.toBeInTheDocument();
  });
});
