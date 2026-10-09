// Regression tests for floor-lot tracking (see FloorLot in types.ts) — the system previously had
// NO lot/expiry record at all once stock moved from substock onto the ward floor: commitTransfer
// only ever bumped Med.floor as a flat number, and commitReconcile's daily HOSxP dispensing
// deduction had zero batch detail (HOSxP's own source data carries none). This closed the one
// gap with the highest patient-safety impact of anything found in the system review: FEFO/
// expiry-risk tracking silently stopped covering the exact point drugs are actually dispensed.
//
// 1. commitTransfer creates a brand-new floorLots doc (keyed by medId+lotNo) the first time a
//    batch is drawn, carrying over the substock lot's own lotNo/exp.
// 2. commitTransfer MERGES into an existing floorLots doc for the same batch (adds to its qty)
//    rather than overwriting it, when more of the same lot is transferred again later.
// 3. commitReconcile deducts the HOSxP-dispensed qty from floor lots via FEFO (earliest-expiry
//    first) across however many floor-lot docs exist, best-effort — this never has true batch
//    detail from HOSxP itself, so it is a secondary signal layered on top of the authoritative
//    floor number, never a replacement for it.
// 4. scrapFloorLot zeroes a floorLots doc using its live (transaction-read) qty, not a stale
//    client-cached one — same data-integrity shape as scrapLot's own regression test.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  signInAs, fireCollection, hasListener, seedDoc, seedCollection, getLastTransactionWrites,
} from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function SeedCart() {
  const { setCartQty, sub } = useApp();
  const qty = sub(MED.id);
  useEffect(() => { if (qty > 0) setCartQty(MED.id, '4'); }, [setCartQty, qty]);
  return null;
}

function TransferHarness() {
  const { commitTransfer } = useApp();
  return <button onClick={commitTransfer}>confirm-transfer</button>;
}

describe('commitTransfer — floor-lot creation regression', () => {
  it('creates a new floorLots doc carrying the drawn batch\'s own lotNo/exp', async () => {
    const user = userEvent.setup();
    const exp = Date.now() + 30 * 86400000;
    renderWithApp(<><SeedCart /><TransferHarness /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [{ id: 'lotA', medId: MED.id, qty: 10, lotNo: 'LA', exp }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'confirm-transfer' })).toBeInTheDocument());

    seedDoc('meds/m1', { floor: MED.floor });
    seedCollection('lots', [{ id: 'lotA', medId: MED.id, qty: 10, exp }]);
    seedDoc('lots/lotA', { qty: 10, lotNo: 'LA', exp });
    // No existing floorLots doc for this batch yet — trx.get on it resolves to nothing.
    seedCollection('floorLots', []);

    await user.click(screen.getByRole('button', { name: 'confirm-transfer' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    // Path includes exp (not just medId+lotNo) — see floorLotDocId's own doc comment for why.
    const flWrite = writes.find((w) => w.path === 'floorLots/m1__LA__' + exp);
    expect(flWrite?.data).toEqual({ medId: 'm1', lotNo: 'LA', exp, qty: 4 });
  });

  it('merges into an existing floorLots doc for the same batch instead of overwriting it', async () => {
    const user = userEvent.setup();
    const exp = Date.now() + 30 * 86400000;
    renderWithApp(<><SeedCart /><TransferHarness /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [{ id: 'lotA', medId: MED.id, qty: 10, lotNo: 'LA', exp }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'confirm-transfer' })).toBeInTheDocument());

    seedDoc('meds/m1', { floor: MED.floor });
    seedCollection('lots', [{ id: 'lotA', medId: MED.id, qty: 10, exp }]);
    seedDoc('lots/lotA', { qty: 10, lotNo: 'LA', exp });
    // An earlier transfer of the same physical batch (same lotNo AND same exp — a real repeat
    // transfer of the SAME batch) already put 6 units on the floor.
    seedCollection('floorLots', [{ id: 'm1__LA__' + exp, medId: MED.id, qty: 6, lotNo: 'LA', exp }]);
    seedDoc('floorLots/m1__LA__' + exp, { medId: MED.id, lotNo: 'LA', exp, qty: 6 });

    await user.click(screen.getByRole('button', { name: 'confirm-transfer' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    const flWrite = writes.find((w) => w.path === 'floorLots/m1__LA__' + exp);
    // Without the merge fix this would be overwritten back down to just the newly-drawn 4.
    expect(flWrite?.data).toEqual({ medId: 'm1', lotNo: 'LA', exp, qty: 10 });
  });
});

function SeedCart10() {
  const { setCartQty, sub } = useApp();
  const qty = sub(MED.id);
  useEffect(() => { if (qty > 0) setCartQty(MED.id, '10'); }, [setCartQty, qty]);
  return null;
}

// Real-world report: tapping "ยืนยันการเติมหน้างาน" for Atorvastatin failed every single retry
// with a flat "เติมหน้างานไม่สำเร็จ ลองใหม่อีกครั้ง" — the lot it was drawing from was a "ปรับยอด
// (นับสต็อก)" substock-count-surplus lot (commitSubCount/commitAllSubCounts, selectors.ts). Every
// such lot reuses that exact literal lotNo string, but each gets its OWN freshly-computed exp
// (Date.now()+100y) — a med with more than one count-surplus in its history, each later
// transferred to the floor, used to collide onto the SAME floorLots doc id (floorLotDocId was
// keyed by medId+lotNo only), and the second transfer's write tried to silently change that doc's
// already-stored exp — which firestore.rules correctly rejects (exp is immutable once a floorLots
// doc exists, same as `lots`). That permission-denied is exactly this flat, non-specific,
// deterministically-repeating failure toast (not the 'insufficient'/'missing-med' cases, which
// both have their own specific toasts). See floorLotDocId's own doc comment (selectors.ts).
describe('commitTransfer — same-lotNo/different-exp floor-lot collision regression', () => {
  it('gives two batches that share a lotNo but have different real exp their own separate floorLots docs, not one colliding doc', async () => {
    const user = userEvent.setup();
    const expA = Date.now() + 100 * 365 * 86400000; // an earlier count-surplus's "100 years out"
    const expB = expA + 7 * 86400000; // a later count-surplus, computed days afterward — different
    const SHARED_LOT_NO = 'ปรับยอด (นับสต็อก)';
    renderWithApp(<><SeedCart10 /><TransferHarness /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    // FEFO draws the soonest-expiring (lotA, expA) first — 6 units — then spills the remaining
    // 4 of the cart's 10 into lotB (expB), splitting this ONE transfer across both batches.
    fireCollection('lots', [
      { id: 'lotA', medId: MED.id, qty: 6, lotNo: SHARED_LOT_NO, exp: expA },
      { id: 'lotB', medId: MED.id, qty: 10, lotNo: SHARED_LOT_NO, exp: expB },
    ]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'confirm-transfer' })).toBeInTheDocument());

    seedDoc('meds/m1', { floor: MED.floor });
    seedCollection('lots', [
      { id: 'lotA', medId: MED.id, qty: 6, exp: expA },
      { id: 'lotB', medId: MED.id, qty: 10, exp: expB },
    ]);
    seedDoc('lots/lotA', { qty: 6, lotNo: SHARED_LOT_NO, exp: expA });
    seedDoc('lots/lotB', { qty: 10, lotNo: SHARED_LOT_NO, exp: expB });
    seedCollection('floorLots', []);

    await user.click(screen.getByRole('button', { name: 'confirm-transfer' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    const flWrites = writes.filter((w) => w.path.startsWith('floorLots/'));
    // The real bug: these two used to be the SAME doc path (medId+lotNo only), so the second
    // write would try to overwrite the first doc's exp — exactly what firestore.rules blocks.
    expect(new Set(flWrites.map((w) => w.path)).size).toBe(2);
    expect(flWrites.find((w) => (w.data as { exp?: number }).exp === expA)?.data).toEqual({ medId: 'm1', lotNo: SHARED_LOT_NO, exp: expA, qty: 6 });
    expect(flWrites.find((w) => (w.data as { exp?: number }).exp === expB)?.data).toEqual({ medId: 'm1', lotNo: SHARED_LOT_NO, exp: expB, qty: 4 });
  });
});

function ReconcileHarness() {
  const { state, setHosxpText, processHosxp, setHosxpConfirmSingleDay, commitReconcile } = useApp();
  useEffect(() => { setHosxpText('Paracetamol 500mg,7'); }, [setHosxpText]);
  useEffect(() => { if (state.hosxpRows) setHosxpConfirmSingleDay(true); }, [state.hosxpRows, setHosxpConfirmSingleDay]);
  return (
    <div>
      <button onClick={processHosxp}>process</button>
      <button onClick={commitReconcile} disabled={!state.hosxpConfirmSingleDay}>commit-reconcile</button>
    </div>
  );
}

describe('commitReconcile — floor-lot FEFO deduction regression', () => {
  it('deducts the dispensed qty from floor lots earliest-expiry-first, spilling over into the next lot', async () => {
    const user = userEvent.setup();
    const soon = Date.now() + 10 * 86400000;
    const later = Date.now() + 60 * 86400000;
    renderWithApp(<><ReconcileHarness /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    fireCollection('txs', []);

    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
    seedDoc('meds/m1', { floor: MED.floor });
    // Two floor-lot batches: 5 units expiring soon, 5 units expiring later. A 7-unit dispense
    // must drain the soon-expiring one completely (5) then take the remaining 2 from the other.
    seedCollection('floorLots', [
      { id: 'flSoon', medId: MED.id, qty: 5, exp: soon },
      { id: 'flLater', medId: MED.id, qty: 5, exp: later },
    ]);
    seedDoc('floorLots/flSoon', { medId: MED.id, lotNo: 'FS', exp: soon, qty: 5 });
    seedDoc('floorLots/flLater', { medId: MED.id, lotNo: 'FL', exp: later, qty: 5 });

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    expect(writes.find((w) => w.path === 'floorLots/flSoon')?.data).toEqual({ qty: 0 });
    expect(writes.find((w) => w.path === 'floorLots/flLater')?.data).toEqual({ qty: 3 });
    // The real floor deduction (the number that actually matters every day) must still apply in
    // full regardless of floor-lot bookkeeping.
    expect(writes.find((w) => w.path === 'meds/m1')?.data).toEqual({ floor: 33 });
  });

  it('still applies the real floor deduction even when there is no floor-lot data at all', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReconcileHarness /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    fireCollection('txs', []);

    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
    seedDoc('meds/m1', { floor: MED.floor });
    seedCollection('floorLots', []);

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    expect(writes.find((w) => w.path === 'meds/m1')?.data).toEqual({ floor: 33 });
    expect(writes.some((w) => w.path.startsWith('floorLots/'))).toBe(false);
  });
});

function ScrapFloorLotHarness() {
  const { scrapFloorLot, state } = useApp();
  return <button onClick={() => scrapFloorLot('flKnown')} disabled={!state.floorLots.length}>scrap-flKnown</button>;
}

function AutoConfirmYes() {
  const { state, respondConfirm } = useApp();
  useEffect(() => { if (state.confirmDialog) respondConfirm(true); }, [state.confirmDialog, respondConfirm]);
  return null;
}

describe('scrapFloorLot — data-integrity regression', () => {
  it('zeroes the doc using the live (transaction-read) qty, not the stale cached one, and never touches Med.floor', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ScrapFloorLotHarness /><AutoConfirmYes /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('floorLots')).toBe(true));
    // Client cache says 10 — stale.
    fireCollection('floorLots', [{ id: 'flKnown', medId: MED.id, qty: 10, lotNo: 'FK', exp: Date.now() + 86400000 }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'scrap-flKnown' })).not.toBeDisabled());

    // Someone else's reconcile already dropped this to 4 by the time the transaction reads it live.
    seedDoc('floorLots/flKnown', { qty: 4, medId: MED.id, lotNo: 'FK' });

    await user.click(screen.getByRole('button', { name: 'scrap-flKnown' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    expect(writes.find((w) => w.path === 'floorLots/flKnown')?.data).toEqual({ qty: 0 });
    expect(writes.some((w) => w.path === 'meds/m1')).toBe(false);
  });
});
