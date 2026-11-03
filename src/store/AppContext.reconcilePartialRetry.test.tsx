// Regression tests for a real, confirmed gap: "แนบไฟล์ไปแล้ว ยืนยันตัดจ่าย แต่เหมือนมีข้อผิดพลาด แล้ว
// จะมีความมั่นใจได้อย่างไรว่าจำนวนถูกตัดไปแล้วหรือยัง หรือถ้ายาถูกตัดไปแล้ว มียาบางตัวที่ยังไม่ถูกตัด แล้ว
// แนบไฟล์เพื่อตัดอีกครั้ง แล้วยาที่ถูกตัดไปแล้ว จะถูกตัดซ้ำมั้ย" —
//
// commitReconcile() processes hosxpRows sequentially, one Firestore transaction per row. A
// failure partway through (confirmed real incidents: 2026-10-30, permission-denied on one
// specific drug) leaves every EARLIER row already deducted for real, but hosxpRows itself was
// never updated to reflect that — clicking the same commit button again to retry used to re-run
// EVERY row from the top, double-deducting every row that had already succeeded. Fixed via
// state.hosxpAppliedRowIndexes (types.ts) — tracks which row INDEXES of the current batch already
// landed for real; a retry skips those (still counting them toward the final summary) and only
// processes what's left, with the double-run/continuity confirms also skipped since a resume is
// unambiguously a continuation, not a second reconcile.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import ReconcileScreen from '../screens/ReconcileScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  signInAs, fireCollection, hasListener, seedDoc, getAllTransactionLogs,
  failNextTransactionCommitWritingPathPrefix,
} from '../test-utils/firebaseTestDouble';

const MED_A = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 100, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const MED_B = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 100, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function ReconcileHarness() {
  const { state, setHosxpText, processHosxp, commitReconcile } = useApp();
  useEffect(() => { setHosxpText('Amoxicillin 500mg,10\nParacetamol 500mg,5'); }, [setHosxpText]);
  return (
    <div>
      <div data-testid="applied">{JSON.stringify(state.hosxpAppliedRowIndexes)}</div>
      <button onClick={processHosxp}>process</button>
      <button onClick={commitReconcile} disabled={!state.hosxpRows}>commit-reconcile</button>
    </div>
  );
}

async function setup(user: ReturnType<typeof userEvent.setup>) {
  renderWithApp(<><ReconcileHarness /><Toast /><ConfirmDialog /></>);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED_A, MED_B]);
  await waitFor(() => expect(hasListener('txs')).toBe(true));
  fireCollection('txs', []);
  await user.click(screen.getByRole('button', { name: 'process' }));
  await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
  seedDoc('meds/m1', { floor: MED_A.floor });
  seedDoc('meds/m2', { floor: MED_B.floor });
}

describe('commitReconcile — partial-failure retry regression (no double-deduction)', () => {
  it('skips an already-applied row on retry instead of re-running its transaction a second time', async () => {
    const user = userEvent.setup();
    await setup(user);

    // MED_A (row 0) will succeed; MED_B (row 1) is made to fail, simulating the real incident
    // where a failure partway through a file leaves the earlier rows already committed.
    failNextTransactionCommitWritingPathPrefix('meds/m2');
    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await screen.findByText(/ตัดยอดไปแล้ว 1 รายการก่อนเกิดปัญหา/);

    // Exactly one transaction touched meds/m1 so far — the one that succeeded.
    expect(getAllTransactionLogs().filter((l) => l.writes.some((w) => w.path === 'meds/m1')).length).toBe(1);
    expect(screen.getByTestId('applied').textContent).toBe('[0]');

    // Retry — no failure injected this time. Without the fix, this would re-run row 0 (MED_A)
    // too, double-deducting it; with the fix it's skipped and only row 1 (MED_B) runs.
    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await screen.findByText('ตัดยอดหน้างานตามไฟล์แล้ว 2 รายการ — บันทึกลง discrepancy log');

    // Still exactly ONE transaction ever touched meds/m1 — the retry did not reprocess it.
    expect(getAllTransactionLogs().filter((l) => l.writes.some((w) => w.path === 'meds/m1')).length).toBe(1);

    // No confirm dialog needed on the resume — it's unambiguously a continuation, not a second
    // reconcile asking "are you sure you want to double-deduct today's work again?".
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
  });

  it('does not ask the double-run/continuity confirm again when resuming an interrupted batch', async () => {
    const user = userEvent.setup();
    await setup(user);
    failNextTransactionCommitWritingPathPrefix('meds/m2');
    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await screen.findByText(/ตัดยอดไปแล้ว 1 รายการก่อนเกิดปัญหา/);

    // Simulate what a real retry would actually see: the successful MED_A row's own tx now
    // sitting in today's txs collection (the live onSnapshot listener would have picked this up
    // for real; this test double doesn't auto-reflect transaction writes back into it).
    fireCollection('txs', [{ id: 't1', type: 'reconcile_hosxp', medId: MED_A.id, ts: Date.now() }]);

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    // Without the isResuming skip, this would show "วันนี้ตัดยอด HOSxP ไปแล้ว..." and block on a
    // confirm dialog instead of completing directly.
    await screen.findByText('ตัดยอดหน้างานตามไฟล์แล้ว 2 รายการ — บันทึกลง discrepancy log');
    expect(screen.queryByText(/วันนี้ตัดยอด HOSxP ไปแล้ว/)).not.toBeInTheDocument();
  });
});

describe('ReconcileScreen — already-applied row indicator regression', () => {
  it('shows "✓ ตัดยอดแล้ว" for the row that already succeeded, and the normal preview for the one still pending', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReconcileScreen /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_A, MED_B]);
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    fireCollection('txs', []);

    const textarea = screen.getByPlaceholderText(/วางข้อมูลจากไฟล์ HOSxP/);
    await user.type(textarea, 'Amoxicillin 500mg,10{Enter}Paracetamol 500mg,5');
    await user.click(screen.getByRole('button', { name: 'ประมวลผล' }));
    await screen.findByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ });
    seedDoc('meds/m1', { floor: MED_A.floor });
    seedDoc('meds/m2', { floor: MED_B.floor });

    failNextTransactionCommitWritingPathPrefix('meds/m2');
    await user.click(screen.getByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ }));
    await screen.findByText(/ตัดยอดไปแล้ว 1 รายการก่อนเกิดปัญหา/);

    await screen.findByText('✓ ตัดยอดแล้ว');
    // The resume banner names exactly how many of the total are already done.
    await screen.findByText(/ตัดยอดไปแล้ว 1 จาก 2 รายการ/);
    // The button label switches to the resume-specific phrasing with the remaining count.
    await screen.findByRole('button', { name: 'ตัดยอดส่วนที่เหลือต่อ (1 รายการ)' });
  });
});
