// Regression tests for named historical bug fixes deep inside AppContext.tsx's commit
// functions that, until now, had zero test coverage of their own — every fix here is undone by
// a one-line revert, so nothing would have caught a regression before this file existed.
//
// 1. commitTransfer's FEFO fix: a lot doc with no `exp` field must sort LAST (treated as "no
//    known urgency"), never first — see the `?? Infinity` comment at its call site.
// 2. lastAdminGuardedWrite's fix: the last-admin headcount must re-check each OTHER admin's
//    live `role`, not just `active` — an admin concurrently demoted (still active, no longer
//    role:'admin') must not count toward the "at least one other admin" total.
// 3. commitAdjust's ledger-accuracy fix: the tx-log entry must record the applied delta
//    (after - before, clamped at 0 floor), not the raw typed amount — see its own "Bug fix
//    (ledger accuracy)" comment.
// 4. scrapLot's data-integrity fix: the write-off qty logged must come from the lot's live
//    (transaction-read) qty, not the stale client-cached one — see its own "Bug fix (data
//    integrity)" comment.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TConfirmScreen from '../screens/TConfirmScreen';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
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
  useEffect(() => { if (qty > 0) setCartQty(MED.id, '3'); }, [setCartQty, qty]);
  return null;
}

describe('commitTransfer — FEFO regression', () => {
  it('draws from the lot with a real exp date first, leaving the no-exp lot untouched', async () => {
    const user = userEvent.setup();
    renderWithApp(<><SeedCart /><TConfirmScreen /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    // Client-cache copy (drives the cart's substock cap) — same two lots as the "live" seed
    // below, just via the onSnapshot path instead of getDocs/trx.get.
    fireCollection('lots', [
      { id: 'lotKnown', medId: MED.id, qty: 5, lotNo: 'LK', exp: Date.now() + 30 * 86400000 },
      { id: 'lotUnknown', medId: MED.id, qty: 10, lotNo: 'LU' },
    ]);
    await screen.findByText(MED.name);

    // "Live" seed — what commitTransfer's getDocs()/trx.get() calls actually read from.
    seedDoc('meds/m1', { floor: MED.floor });
    seedCollection('lots', [
      { id: 'lotKnown', medId: MED.id, qty: 5, exp: Date.now() + 30 * 86400000 },
      { id: 'lotUnknown', medId: MED.id, qty: 10 },
    ]);
    seedDoc('lots/lotKnown', { qty: 5, lotNo: 'LK', exp: Date.now() + 30 * 86400000 });
    seedDoc('lots/lotUnknown', { qty: 10, lotNo: 'LU' });

    await user.click(screen.getByRole('button', { name: /ยืนยันการเติมหน้างาน/ }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    const lotKnownWrite = writes.find((w) => w.path === 'lots/lotKnown');
    const lotUnknownWrite = writes.find((w) => w.path === 'lots/lotUnknown');
    expect(lotKnownWrite?.data).toEqual({ qty: 2 });
    expect(lotUnknownWrite).toBeUndefined();
  });
});

function AdminActions() {
  const { toggleUserActive } = useApp();
  return <button onClick={() => toggleUserActive('adminX')}>disable-adminX</button>;
}

describe('lastAdminGuardedWrite — role re-check regression', () => {
  it('blocks disabling an admin when the only other "admin" was concurrently demoted', async () => {
    const user = userEvent.setup();
    renderWithApp(<><AdminActions /><Toast /></>);
    // Acting user must be an admin: toggleUserActive gates on state.role === 'admin', and the
    // 'users' collection listener (needed for state.users, which toggleUserActive reads its
    // target from) only subscribes when myProfile.role === 'admin'.
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('users')).toBe(true));
    fireCollection('users', [
      { id: 'admin0', role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0', active: true },
      { id: 'adminX', role: 'admin', name: 'แอดมิน สอง', username: 'adminx', active: true, lastLogin: Date.now() },
    ]);

    // The live getDocs() query for role=='admin' returns the OTHER two admins as of query
    // time (deliberately excluding the actor, admin0, so the count below isolates exactly
    // what's under test) — a plain pre-transaction query that can be stale by the time the
    // transaction actually runs.
    seedCollection('users', [{ id: 'adminX' }, { id: 'adminY' }]);
    // adminX (the target) is still genuinely an active admin as of the live trx.get() read.
    seedDoc('users/adminX', { role: 'admin', active: true });
    // But adminY — the only OTHER admin in that list — was already demoted to 'tech' in the
    // gap between the query above and this transaction, while still active:true.
    seedDoc('users/adminY', { role: 'tech', active: true });

    await user.click(screen.getByRole('button', { name: 'disable-adminX' }));

    // Without the role re-check fix, adminX (still active:true) would be miscounted as a
    // second live admin and this disable would silently succeed instead of being blocked.
    await screen.findByText('ปิดใช้งานไม่ได้ — นี่คือ Admin ที่ใช้งานอยู่คนสุดท้าย ต้องมี Admin อย่างน้อย 1 คนเสมอ');
  });
});

// Drives the whole pick-type/pick-med/qty/reason sequence one state update at a time (each
// setter is a separate patch(); calling them back-to-back in one handler would have
// commitAdjust close over the pre-update state — see the FEFO test's SeedCart for the same
// "wait for the effect that consumes the previous state update" shape) then exposes a single
// enabled button once the form is actually ready to commit, same as a real user filling it in.
function AdjustHarness() {
  const { state, pickAdjType, pickAdjMed, setAdjQty, setAdjReason, commitAdjust } = useApp();
  useEffect(() => { if (!state.adjType) pickAdjType('damaged'); }, [state.adjType, pickAdjType]);
  useEffect(() => { if (state.adjType && !state.adjMed) pickAdjMed(MED.id); }, [state.adjType, state.adjMed, pickAdjMed]);
  useEffect(() => { if (state.adjMed && !state.adjQty) setAdjQty('10'); }, [state.adjMed, state.adjQty, setAdjQty]);
  useEffect(() => { if (state.adjQty && !state.adjReason) setAdjReason('ชำรุด'); }, [state.adjQty, state.adjReason, setAdjReason]);
  return <button disabled={!state.adjReason} onClick={commitAdjust}>commit-adjust</button>;
}

describe('commitAdjust — ledger-accuracy regression', () => {
  it('logs the actual applied delta (clamped at floor 0), not the raw typed amount', async () => {
    const user = userEvent.setup();
    renderWithApp(<AdjustHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    // Live floor is only 3 — already partly dispensed since the last sync — while the form
    // above types "damaged 10" for what was physically found on the shelf.
    seedDoc('meds/m1', { floor: 3 });

    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-adjust' })).not.toBeDisabled());
    await user.click(screen.getByRole('button', { name: 'commit-adjust' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    const medWrite = writes.find((w) => w.path === 'meds/m1');
    const txWrite = writes.find((w) => w.path === '');
    // floor clamps at 0 (3 - 10 would go negative), so the real applied delta is -3, not -10.
    expect(medWrite?.data).toEqual({ floor: 0 });
    expect(txWrite?.data.qty).toBe(-3);
  });
});

function ScrapHarness() {
  const { scrapLot, state } = useApp();
  return <button onClick={() => scrapLot('lotKnown')} disabled={!state.lots.length}>scrap-lotKnown</button>;
}

// scrapLot's confirmAsync() shows an in-app dialog (ConfirmDialog.tsx) rather than a real
// window.confirm() — nothing here renders that dialog, so this answers it directly the same way
// ConfirmDialog's own onClick would, via the same respondConfirm() the real UI calls.
function AutoConfirmYes() {
  const { state, respondConfirm } = useApp();
  useEffect(() => { if (state.confirmDialog) respondConfirm(true); }, [state.confirmDialog, respondConfirm]);
  return null;
}

describe('scrapLot — data-integrity regression', () => {
  it('logs the write-off using the live (transaction-read) qty, not the stale cached one', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ScrapHarness /><AutoConfirmYes /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    // Client cache (l.qty scrapLot's closure reads before the transaction) says 10 — stale.
    fireCollection('lots', [{ id: 'lotKnown', medId: MED.id, qty: 10, lotNo: 'LK', exp: Date.now() + 86400000 }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'scrap-lotKnown' })).not.toBeDisabled());

    // Someone else's count/transfer already dropped this lot to 4 by the time the transaction
    // actually reads it live — the logged write-off must reflect that, not the stale cache's 10.
    seedDoc('lots/lotKnown', { qty: 4, lotNo: 'LK' });

    await user.click(screen.getByRole('button', { name: 'scrap-lotKnown' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    const lotWrite = writes.find((w) => w.path === 'lots/lotKnown');
    const txWrite = writes.find((w) => w.path === '');
    expect(lotWrite?.data).toEqual({ qty: 0 });
    expect(txWrite?.data.qty).toBe(-4);
  });
});
