// UI-polish follow-up: "ช่วยตกแต่ง ui ux animation css ควรปรับอะไรเพิ่มให้แอพดูสวยงามน่าใช้งาน" →
// "จัดการทั้งหมด" — one finding from that review was that several frequent, hands-on-shelf
// commit actions never called hapticSuccess() even though sibling actions in the exact same
// category (commitTransfer, commitReceive, commitAdjust, commitReturnCart/commitSingleReturn,
// scrapLot/scrapFloorLot) already do. Fixed in AppContext.tsx: commitCount, commitAllCounts,
// commitSubCount, commitAllSubCounts, commitWardMove, commitReconcile, and approvePendingReceive
// now all fire it on a real success, matching the app's own existing convention (hapticSuccess
// right before the success toast, never on an error path — see any of the sibling functions'
// own call sites). This file locks that in; nothing elsewhere in the app previously asserted on
// haptic calls at all, so the whole suite mocks ../utils/haptic rather than relying on jsdom's
// navigator.vibrate (undefined in jsdom, so every call was previously a silent, unverifiable
// no-op even when present).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import { signInAs, fireCollection, hasListener, seedDoc, seedCollection, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';

vi.mock('../utils/haptic', () => ({ hapticSuccess: vi.fn(), hapticError: vi.fn() }));
import { hapticSuccess } from '../utils/haptic';

beforeEach(() => { vi.mocked(hapticSuccess).mockClear(); });

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const MED2 = {
  id: 'm2', code: 'MED-0002', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 2, had: false, active: true, parSub: 500, parFloor: 100, floor: 20, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function CountHarness() {
  const { setCountInput, commitCount } = useApp();
  useEffect(() => { setCountInput('m1', '45'); }, [setCountInput]);
  return <button onClick={() => commitCount('m1')}>commit-count</button>;
}

describe('commitCount — hapticSuccess regression', () => {
  it('fires hapticSuccess on a successful (plausible, no-confirm) count commit', async () => {
    const user = userEvent.setup();
    renderWithApp(<CountHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'commit-count' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(hapticSuccess).toHaveBeenCalled();
  });
});

function AllCountsHarness() {
  const { setCountInput, commitAllCounts } = useApp();
  useEffect(() => { setCountInput('m1', '45'); }, [setCountInput]);
  return <button onClick={commitAllCounts}>commit-all-counts</button>;
}

describe('commitAllCounts — hapticSuccess regression', () => {
  it('fires hapticSuccess once at least one row in the batch actually committed', async () => {
    const user = userEvent.setup();
    renderWithApp(<AllCountsHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'commit-all-counts' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(hapticSuccess).toHaveBeenCalled();
  });
});

function SubCountHarness() {
  const { setSubCountInput, commitSubCount } = useApp();
  useEffect(() => { setSubCountInput('m1', '10'); }, [setSubCountInput]);
  return <button onClick={() => commitSubCount('m1')}>commit-subcount</button>;
}

describe('commitSubCount — hapticSuccess regression', () => {
  it('fires hapticSuccess on a successful (plausible, no-confirm) substock count commit', async () => {
    const user = userEvent.setup();
    renderWithApp(<SubCountHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    const lot = { medId: MED.id, lotNo: 'LOT1', exp: Date.now() + 90 * 86400000, qty: 10 };
    fireCollection('lots', [{ id: 'lot1', ...lot }]);
    seedCollection('lots', [{ id: 'lot1', ...lot }]);
    seedDoc('lots/lot1', lot);

    await user.click(screen.getByRole('button', { name: 'commit-subcount' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(hapticSuccess).toHaveBeenCalled();
  });
});

function AllSubCountsHarness() {
  const { setSubCountInput, commitAllSubCounts } = useApp();
  useEffect(() => { setSubCountInput('m1', '10'); }, [setSubCountInput]);
  return <button onClick={commitAllSubCounts}>commit-all-subcounts</button>;
}

describe('commitAllSubCounts — hapticSuccess regression', () => {
  it('fires hapticSuccess once at least one row in the batch actually committed', async () => {
    const user = userEvent.setup();
    renderWithApp(<AllSubCountsHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    const lot = { medId: MED.id, lotNo: 'LOT1', exp: Date.now() + 90 * 86400000, qty: 10 };
    fireCollection('lots', [{ id: 'lot1', ...lot }]);
    seedCollection('lots', [{ id: 'lot1', ...lot }]);
    seedDoc('lots/lot1', lot);

    await user.click(screen.getByRole('button', { name: 'commit-all-subcounts' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(hapticSuccess).toHaveBeenCalled();
  });
});

function WardMoveHarness() {
  const { state, pickWmFromMed, pickWmToMed, setWmQty, setWmReason, commitWardMove } = useApp();
  useEffect(() => { if (!state.wmFromMed) pickWmFromMed(MED.id); }, [state.wmFromMed, pickWmFromMed]);
  useEffect(() => { if (!state.wmToMed) pickWmToMed(MED2.id); }, [state.wmToMed, pickWmToMed]);
  useEffect(() => { if (!state.wmQty) setWmQty('5'); }, [state.wmQty, setWmQty]);
  useEffect(() => { if (!state.wmReason) setWmReason('เติม stat drawer'); }, [state.wmReason, setWmReason]);
  return <button onClick={commitWardMove}>commit-wardmove</button>;
}

describe('commitWardMove — hapticSuccess regression', () => {
  it('fires hapticSuccess on a successful move between two meds sharing the same unit', async () => {
    const user = userEvent.setup();
    renderWithApp(<WardMoveHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED, MED2]);

    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-wardmove' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'commit-wardmove' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(hapticSuccess).toHaveBeenCalled();
  });
});

function ApproveReceiveHarness() {
  const { approvePendingReceive } = useApp();
  return <button onClick={() => approvePendingReceive('pr1')}>approve-pr1</button>;
}

describe('approvePendingReceive — hapticSuccess regression', () => {
  it('fires hapticSuccess on a successful approval', async () => {
    const user = userEvent.setup();
    renderWithApp(<ApproveReceiveHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });

    seedDoc('pendingReceives/pr1', {
      recvNo: 'RX1', medId: MED.id, name: MED.name, unit: MED.unit, lotNo: 'LOT1',
      exp: new Date('2027-01-01').getTime(), qty: 10, requestedBy: 'เทค หนึ่ง', requestedByUid: 'tech1',
      ts: Date.now(), status: 'pending',
    });
    seedDoc('meds/m1', {});

    await user.click(screen.getByRole('button', { name: 'approve-pr1' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(hapticSuccess).toHaveBeenCalled();
  });
});

function HosxpReconcileHarness() {
  const { state, setHosxpText, processHosxp, setHosxpConfirmSingleDay, commitReconcile } = useApp();
  return (
    <>
      <button onClick={() => setHosxpText('Paracetamol 500mg,5')}>paste</button>
      <button onClick={processHosxp}>process</button>
      <button onClick={() => setHosxpConfirmSingleDay(true)}>confirm-single-day</button>
      <button onClick={commitReconcile}>commit-reconcile</button>
      <div data-testid="rowCount">{state.hosxpRows?.length ?? 'none'}</div>
    </>
  );
}

describe('commitReconcile — hapticSuccess regression', () => {
  it('fires hapticSuccess when at least one row applies', async () => {
    const user = userEvent.setup();
    renderWithApp(<><HosxpReconcileHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'paste' }));
    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getByTestId('rowCount').textContent).toBe('1'));
    await user.click(screen.getByRole('button', { name: 'confirm-single-day' }));

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(hapticSuccess).toHaveBeenCalled();
  });
});
