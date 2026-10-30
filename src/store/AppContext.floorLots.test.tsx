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
  signInAs, fireCollection, hasListener, seedDoc, seedCollection, getLastTransactionWrites, getLastTransactionReads,
  getAllTransactionLogs, failNextTransactionCommitWritingPathPrefix,
} from '../test-utils/firebaseTestDouble';
import { asMedId, asFloorLotId } from '../types';

const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
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

function SeedCart3() {
  const { setCartQty, sub } = useApp();
  const qty = sub(MED.id);
  useEffect(() => { if (qty > 0) setCartQty(MED.id, '3'); }, [setCartQty, qty]);
  return null;
}

// Real-world risk (same mechanism as commitReconcile's own FEFO_LOT_CAP fix above, see its doc
// comment for the full Firestore-rules-budget mechanism): commitTransfer used to trx.get() EVERY
// active substock lot a med has, no matter how few are actually needed to cover the cart's qty —
// and because the whole cart commits as ONE transaction (not one per med), that waste compounds
// across every item in the cart, not just one med.
describe('commitTransfer — FEFO-lot-read-cap regression (Firestore read-budget waste)', () => {
  it('only reads as many FEFO-ordered lots as needed to cover the cart qty (plus one margin lot), not every active lot the med has', async () => {
    const user = userEvent.setup();
    // 10 fragmented lots of 2 units each (20 total) — far more than the 3-unit cart line needs.
    const lots = Array.from({ length: 10 }, (_, i) => ({
      id: 'lot' + i, medId: MED.id, qty: 2, lotNo: 'L' + i, exp: Date.now() + (i + 1) * 86400000,
    }));
    renderWithApp(<><SeedCart3 /><TransferHarness /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', lots);
    await waitFor(() => expect(screen.getByRole('button', { name: 'confirm-transfer' })).toBeInTheDocument());

    seedDoc('meds/m1', { floor: MED.floor });
    seedCollection('lots', lots);
    lots.forEach((l) => seedDoc('lots/' + l.id, { qty: l.qty, lotNo: l.lotNo, exp: l.exp }));
    seedCollection('floorLots', []);

    await user.click(screen.getByRole('button', { name: 'confirm-transfer' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    // A 3-unit need is covered by the first 2 lots (2+2=4 >= 3); one extra lot (lot2) is read as
    // a margin against the live snapshot above being stale by the time trx.get() re-reads it —
    // never all 10, however fragmented this med's real substock is.
    const lotReads = getLastTransactionReads().filter((p) => p.startsWith('lots/'));
    expect(lotReads.sort()).toEqual(['lots/lot0', 'lots/lot1', 'lots/lot2']);

    // The real transfer result is completely unaffected by the read cap: 3 units still drawn
    // FEFO (2 from lot0, 1 from lot1), floor still credited the full 3.
    const writes = getLastTransactionWrites();
    expect(writes.find((w) => w.path === 'lots/lot0')?.data).toEqual({ qty: 0 });
    expect(writes.find((w) => w.path === 'lots/lot1')?.data).toEqual({ qty: 1 });
    expect(writes.find((w) => w.path === 'lots/lot2')).toBeUndefined();
    expect(writes.find((w) => w.path === 'meds/m1')?.data).toEqual({ floor: MED.floor + 3 });
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
  const { state, setHosxpText, processHosxp, commitReconcile } = useApp();
  useEffect(() => { setHosxpText('Paracetamol 500mg,7'); }, [setHosxpText]);
  return (
    <div>
      <button onClick={processHosxp}>process</button>
      <button onClick={commitReconcile} disabled={!state.hosxpRows}>commit-reconcile</button>
    </div>
  );
}

// A bigger dispense than ReconcileHarness's fixed 7 — needed so a med fragmented across 10
// small floor lots (2 units each, see the FEFO-cap regression test below) would actually have
// to walk past the 7-lot cap to satisfy it under the OLD uncapped logic; 7 units alone would
// never reach that far regardless of whether the cap existed.
function ReconcileHarnessBigDispense() {
  const { state, setHosxpText, processHosxp, commitReconcile } = useApp();
  useEffect(() => { setHosxpText('Paracetamol 500mg,19'); }, [setHosxpText]);
  return (
    <div>
      <button onClick={processHosxp}>process</button>
      <button onClick={commitReconcile} disabled={!state.hosxpRows}>commit-reconcile</button>
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
    // Two sequential transactions now: the real floor deduction, then the separate, best-effort
    // floor-lot FEFO tracking (see commitReconcile's own "Bug fix (real incident, recurring...)"
    // comment) — wait for both to have landed before asserting on either.
    await waitFor(() => expect(getAllTransactionLogs().length).toBe(2));

    const [deductionLog, floorLotLog] = getAllTransactionLogs();
    expect(floorLotLog.writes.find((w) => w.path === 'floorLots/flSoon')?.data).toEqual({ qty: 0 });
    expect(floorLotLog.writes.find((w) => w.path === 'floorLots/flLater')?.data).toEqual({ qty: 3 });
    // The real floor deduction (the number that actually matters every day) must still apply in
    // full regardless of floor-lot bookkeeping — now its own, separate (and first) transaction.
    expect(deductionLog.writes.find((w) => w.path === 'meds/m1')?.data).toEqual({ floor: 33 });
  });

  // Real-world incident: "ตัดยอดหน้างานไม่ได้" — a live run failed partway through with
  // permission-denied after 3 rows had already applied. Root cause: Firestore caps every
  // transaction at 20 get()/exists() calls made from WITHIN security rules — every trx.get()/
  // trx.update() here evaluates this project's rules, each of which calls myProfile() (an
  // internal get()) to check isActive(). A med whose floor stock happens to be fragmented
  // across MANY small floor-lot docs could walk through enough of them in this best-effort FEFO
  // loop alone to exhaust that budget — and because the REQUIRED writes right after it (the
  // real floor deduction, the tx-log entry) run their OWN rule evaluations too, those then fail
  // with the same permission-denied once the budget is gone, which the loop's own try/catch
  // can't catch (scoped to the loop only) — silently defeating this whole block's "never blocks
  // the real deduction" promise for exactly the meds this best-effort tracking most needs to
  // work for. Fixed by capping how many floor lots one row's transaction will ever examine.
  it('caps how many floor lots it reads/draws from per row, so a med fragmented across many lots can never blow the per-transaction Firestore rules budget', async () => {
    const user = userEvent.setup();
    const lots = Array.from({ length: 10 }, (_, i) => ({
      id: 'fl' + i, medId: MED.id, qty: 2, exp: Date.now() + (i + 1) * 86400000,
    }));
    renderWithApp(<><ReconcileHarnessBigDispense /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('txs')).toBe(true));
    fireCollection('txs', []);

    await user.click(screen.getByRole('button', { name: 'process' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-reconcile' })).not.toBeDisabled());
    seedDoc('meds/m1', { floor: MED.floor });
    // 10 floor-lot docs of 2 units each (20 total) — a 19-unit HOSxP dispense would need ALL 10
    // lots to fully satisfy under the OLD uncapped logic (9×2=18, short by 1); with the cap this
    // row's transaction only ever reads/draws from the first 7 (14 units), 5 units short of the
    // real dispense — exactly the point: the cap can leave `need` unsatisfied, on purpose, in
    // exchange for never risking the transaction's real writes.
    seedCollection('floorLots', lots);
    lots.forEach((l) => seedDoc('floorLots/' + l.id, { medId: l.medId, qty: l.qty, exp: l.exp }));

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    // Two sequential transactions now (see the other test in this describe block for why) —
    // wait for both before asserting.
    await waitFor(() => expect(getAllTransactionLogs().length).toBe(2));

    const [deductionLog, floorLotLog] = getAllTransactionLogs();
    const flWrites = floorLotLog.writes.filter((w) => w.path.startsWith('floorLots/'));
    // Exactly 7 floor-lot docs touched — never more, however fragmented the med's real floor
    // stock is, and never fewer here since `need` (19) stays positive through all 7 of this
    // test's 2-unit lots. The cap is now what keeps this (separate, best-effort) transaction's
    // own rule get() calls (up to 7 reads + up to 7 writes = 14 at most) safely under Firestore's
    // 20-call-per-transaction ceiling, on its own — it no longer shares a budget with the real
    // deduction transaction at all.
    expect(flWrites.length).toBe(7);
    expect(flWrites.every((w) => w.data.qty === 0)).toBe(true); // each 2-unit lot fully drawn
    // The real floor deduction (the number that actually matters every day) applies in full —
    // completely unaffected by the cap on the secondary floor-lot bookkeeping. 40 - 19 = 21.
    expect(deductionLog.writes.find((w) => w.path === 'meds/m1')?.data).toEqual({ floor: 21 });
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

  // Real-world incident (recurring, 2026-10-30 — distinct from the FEFO-budget-cap incident
  // above, same symptom: "ตัดยอดไปแล้ว N รายการก่อนเกิดปัญหา (permission-denied)"): Firestore
  // evaluates security rules for every queued read AND write in a transaction together, all at
  // COMMIT time — not per individual trx.get()/trx.update() call — so a try/catch around only
  // the best-effort floor-lot tracking's READS (the FEFO-cap fix above) could never catch a
  // rejection surfacing from one of its WRITES once the transaction actually tries to commit,
  // and that failure took the real floor deduction down with it, since both were queued in the
  // SAME transaction. Fixed by running the floor-lot tracking as its own, separate transaction,
  // AFTER the real deduction has already committed — this proves that decoupling directly: even
  // when the floor-lot transaction itself fails outright, the real deduction (already landed by
  // then) must stay in place and the row must still count as applied.
  it('does not let a floor-lot tracking transaction failure block or undo the real floor deduction that already committed', async () => {
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
    const exp = Date.now() + 86400000;
    seedCollection('floorLots', [{ id: 'flOnly', medId: MED.id, qty: 10, exp }]);
    seedDoc('floorLots/flOnly', { medId: MED.id, qty: 10, exp });

    // Whichever transaction ends up actually queuing a write to a floorLots/ doc rejects as a
    // whole at commit — same shape as a real firestore.rules rejection (e.g. a malformed
    // historical floor-lot doc), whatever the exact cause. The point under test is WHETHER that
    // failure can still reach the real floor deduction, not what specifically triggered it.
    failNextTransactionCommitWritingPathPrefix('floorLots/');

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));
    // Without the fix, the real deduction and the floor-lot write were queued in the SAME
    // transaction, so this exact failure would have rejected that whole transaction, rolling
    // back the real floor deduction right along with it, and this row would never have counted
    // as applied — the toast below would instead read "ประมวลผลไม่สำเร็จ".
    await screen.findByText('ตัดยอดหน้างานตามไฟล์แล้ว 1 รายการ — บันทึกลง discrepancy log');
    expect(getAllTransactionLogs()[0]?.writes.find((w) => w.path === 'meds/m1')?.data).toEqual({ floor: 33 });
  });

  // Bug fix (debugging gap — real incident, 2026-10-30): when the REAL deduction transaction
  // itself fails (not the separate floor-lot one — see the two regressions above), the error
  // toast used to be a completely anonymous "ประมวลผลไม่สำเร็จ (permission-denied)" — on a ward
  // tablet with no DevTools console, nobody could tell WHICH drug in a 20-150+ line HOSxP file
  // actually triggered it. The toast must name the drug.
  it('names which drug failed in the error toast when the real deduction transaction itself is rejected', async () => {
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

    // This time the real deduction's OWN transaction (the one writing to meds/) is the one
    // rejected — a different failure point than the other two regressions in this block.
    failNextTransactionCommitWritingPathPrefix('meds/');

    await user.click(screen.getByRole('button', { name: 'commit-reconcile' }));

    await screen.findByText('ประมวลผลไม่สำเร็จ (ยา: ' + MED.name + ') ลองใหม่อีกครั้ง (permission-denied)');
  });
});

function ScrapFloorLotHarness() {
  const { scrapFloorLot, state } = useApp();
  return <button onClick={() => scrapFloorLot(asFloorLotId('flKnown'))} disabled={!state.floorLots.length}>scrap-flKnown</button>;
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
