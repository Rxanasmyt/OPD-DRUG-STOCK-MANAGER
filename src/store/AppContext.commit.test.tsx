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
// 5. deleteMed's real-stock-deletion-risk fix: a live re-check of floor/lot qty right before
//    the actual delete must block it if real stock arrived during the confirm dialog — see its
//    own "Bug fix (real stock deletion risk)" comment.
// 6. mergeWardMeds's lost-update-race fix: the merged floor must use each side's LIVE
//    (transaction-read) floor, not the stale client-cached one — see its own "Bug fix
//    (lost-update race)" comment.
// 7. commitReceive's phantom-stock fix: a live re-fetch of each item's med doc, right before
//    the batch write, must catch a med deleted after the (stale) cache-based guard already
//    passed — see its own "Bug fix (phantom stock)" comment.
// 8. approvePendingReceive's data-integrity fix: the med doc read must be inside the
//    transaction (trx.get), so a concurrent delete is caught instead of silently approving a
//    request for a med that no longer exists — see its own "Bug fix (data integrity)" comment.
// 9. commitCount/commitSubCount's silent-no-op fix: a deleted med must produce a clear toast,
//    not a silent do-nothing — see their own "Bug fix (silent no-op)" comments.
// 10. logout's shared-device data-leak fix: every in-progress form field (not just cart) must
//     reset on logout, or the next person signing in on the same shared tablet can find the
//     previous person's half-entered lot/qty/reason still sitting there — see logout's own
//     "Bug fix (shared-device data leak)" comment.
// 11. commitCount/commitSubCount's typo-safety-net fix: a wildly implausible count (relative to
//     the med's own par level) must ask for confirmation before committing — see their own "Bug
//     fix (typo safety net)" comments.
// 12. processHosxp's paste-mistake safety net: an exact doubled-paste or a suspiciously large
//     row count must ask for confirmation before staging rows for reconcile — see its own "Bug
//     fix (paste-mistake safety net)" comment.
// 13. guardOnce's double-submit-on-timeout fix: after a TimeoutError, guardOnce must ask for
//     confirmation before letting that same guarded action fire again within the retry window,
//     since the original write may still land on the server — see guardOnce's own "Bug fix
//     (double-submit on network timeout)" comment.
// 14. commitReceive's lot-duplication fix: receiving the same physical batch (same lotNo + exp
//     for the same med) as an existing ACTIVE lot must merge into it (increment qty), never
//     create a second lot doc for what's one real stack on the shelf — see its own "Bug fix
//     (lot duplication)" comment.
import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { runTransaction } from 'firebase/firestore';
import TConfirmScreen from '../screens/TConfirmScreen';
import AdjustScreen from '../screens/AdjustScreen';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { TimeoutError } from '../utils/timeout';
import {
  signInAs, fireCollection, hasListener, seedDoc, seedCollection, getLastTransactionWrites,
  getLastBatchWrites,
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
    const txWrite = writes.find((w) => w.path.startsWith('txs/'));
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
    const txWrite = writes.find((w) => w.path.startsWith('txs/'));
    expect(lotWrite?.data).toEqual({ qty: 0 });
    expect(txWrite?.data.qty).toBe(-4);
  });
});

function DeleteMedHarness() {
  const { deleteMed } = useApp();
  return <button onClick={() => deleteMed(MED.id)}>delete-med</button>;
}

describe('deleteMed — real-stock-deletion-risk regression', () => {
  it('blocks the delete when live stock arrived during the confirm dialog', async () => {
    const user = userEvent.setup();
    renderWithApp(<><DeleteMedHarness /><AutoConfirmYes /><Toast /></>);
    // deleteMed gates on canEditMeds (myProfile.role === 'admin').
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [{ ...MED, floor: 0 }]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', []);

    // The cached-state gate (floor === 0, no substock) passes and the confirm dialog opens —
    // but a receive lands on this exact med while it's sitting open, before the live re-check.
    seedDoc('meds/m1', { floor: 5 });

    await user.click(screen.getByRole('button', { name: 'delete-med' }));

    // Without the live re-check fix, this would go straight to batch.delete on the med doc AND
    // every one of its lot docs, discarding the 5 units that just arrived.
    await screen.findByText('ลบไม่ได้ — มียอดคงเหลือเข้ามาระหว่างนี้ (หน้างานหรือ substock) ต้องปรับยอด/ตัดออกให้เป็น 0 ก่อน');
    expect(getLastBatchWrites().length).toBe(0);
  });
});

const OPD_MED = { ...MED, id: 'mOpd', ward: 'opd' as const, floor: 10, used30: 4, usedPrev30: 2, bin: 'A1' };
const IPD_MED = { ...MED, id: 'mIpd', ward: 'ipd' as const, floor: 5, used30: 1, usedPrev30: 1, bin: 'B2' };

function MergeWardHarness() {
  const { mergeWardMeds } = useApp();
  return <button onClick={() => mergeWardMeds(OPD_MED.id, IPD_MED.id)}>merge-ward</button>;
}

describe('mergeWardMeds — lost-update-race regression', () => {
  it('merges using each side\'s LIVE floor, not the stale client-cached one', async () => {
    const user = userEvent.setup();
    renderWithApp(<><MergeWardHarness /><AutoConfirmYes /></>);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    // Cached floors (10 + 5 = 15) are what the confirm dialog's own message is built from —
    // real UX, not what must land in the write below.
    fireCollection('meds', [OPD_MED, IPD_MED]);
    await screen.findByRole('button', { name: 'merge-ward' });

    // Another device's transfer/count landed on both sides in the gap between that cached
    // snapshot and clicking through the confirm dialog — live floors are now 20 and 8.
    seedDoc('meds/mOpd', { floor: 20 });
    seedDoc('meds/mIpd', { floor: 8 });
    seedCollection('lots', []);

    await user.click(screen.getByRole('button', { name: 'merge-ward' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const opdWrite = getLastTransactionWrites().find((w) => w.path === 'meds/mOpd');
    // Without the live re-read fix, this would write 15 (10 + 5, the stale cached sum) instead
    // of 28 (20 + 8, what actually exists at commit time) — silently discarding 13 real units.
    expect(opdWrite?.data.floor).toBe(28);
  });
});

// Drives pickRecvMed → setRecvLot → setRecvExp → setRecvQty → addRecv() one state update at a
// time (same "wait for the effect that consumes the previous update" shape as AdjustHarness),
// then exposes commitReceive once exactly one item is queued.
function ReceiveHarness() {
  const { state, pickRecvMed, setRecvLot, setRecvExp, setRecvQty, addRecv, commitReceive } = useApp();
  useEffect(() => { if (!state.recvMed && !state.recvItems.length) pickRecvMed(MED.id); }, [state.recvMed, state.recvItems.length, pickRecvMed]);
  useEffect(() => { if (state.recvMed && !state.recvLot) setRecvLot('LOT1'); }, [state.recvMed, state.recvLot, setRecvLot]);
  useEffect(() => { if (state.recvLot && !state.recvExp) setRecvExp('2027-01-01'); }, [state.recvLot, state.recvExp, setRecvExp]);
  useEffect(() => { if (state.recvExp && !state.recvQty) setRecvQty('10'); }, [state.recvExp, state.recvQty, setRecvQty]);
  useEffect(() => { if (state.recvQty && !state.recvItems.length) addRecv(); }, [state.recvQty, state.recvItems.length, addRecv]);
  return <button disabled={!state.recvItems.length} onClick={commitReceive}>commit-receive</button>;
}

describe('commitReceive — phantom-stock regression', () => {
  it('blocks the receive when the med was deleted after the cache-based guard already passed', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReceiveHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    // Cached copy — passes commitReceive's first (stale) guard, same as it did for whoever
    // built this recv list a few minutes ago before the confirm screen was reached.
    fireCollection('meds', [MED]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-receive' })).not.toBeDisabled());

    // Live: someone else deleted this med in the narrower gap between that cache check and
    // this commit — the batch write path itself never references an existing doc it could
    // fail on (a brand-new lots/txs doc has nothing to conflict with), so only the live
    // re-fetch this fix added can catch it.
    seedDoc('meds/m1', null);

    await user.click(screen.getByRole('button', { name: 'commit-receive' }));
    await screen.findByText('มีรายการที่ถูกลบออกจากระบบไปแล้ว — กลับไปลบรายการนั้นออกจากรายการรับเข้าก่อน');
    expect(getLastBatchWrites().length).toBe(0);
  });
});

function ApproveReceiveHarness() {
  const { approvePendingReceive } = useApp();
  return <button onClick={() => approvePendingReceive('pr1')}>approve-pr1</button>;
}

describe('approvePendingReceive — data-integrity regression', () => {
  it('blocks approval when the med was deleted while the request sat pending', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ApproveReceiveHarness /><Toast /></>);
    // canApproveReceive gates on role !== 'tech'.
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });

    seedDoc('pendingReceives/pr1', {
      recvNo: 'RX1', medId: MED.id, name: MED.name, unit: MED.unit, lotNo: 'LOT1',
      exp: Date.now() + 30 * 86400000, qty: 10, requestedBy: 'เทค หนึ่ง', requestedByUid: 'tech1',
      ts: Date.now(), status: 'pending',
    });
    // The med this pending request references was deleted while it sat waiting for approval.
    seedDoc('meds/m1', null);

    await user.click(screen.getByRole('button', { name: 'approve-pr1' }));
    await screen.findByText('ยาในคำขอนี้ถูกลบออกจากระบบไปแล้ว — อนุมัติไม่ได้ ให้ปฏิเสธคำขอนี้แทน');
    // Blocked inside the transaction before the pending-request doc's status was updated —
    // the old client-cache check ran before the transaction and couldn't catch a delete that
    // landed during the transaction's own retries.
    expect(getLastTransactionWrites().find((w) => w.path === 'pendingReceives/pr1')).toBeUndefined();
  });

  it('merges into an existing active lot with the same lotNo/exp instead of creating a new one', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ApproveReceiveHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });

    seedDoc('pendingReceives/pr1', {
      recvNo: 'RX1', medId: MED.id, name: MED.name, unit: MED.unit, lotNo: 'LOT1',
      exp: new Date('2027-01-01').getTime(), qty: 10, requestedBy: 'เทค หนึ่ง', requestedByUid: 'tech1',
      ts: Date.now(), status: 'pending',
    });
    seedDoc('meds/m1', {});
    // An existing, still-active lot for the exact same physical batch this pending request is
    // for (same lotNo + exp) — e.g. an earlier delivery already approved and sitting on the
    // shelf. Seeded both as a collection row (for the live getDocs() lookup) and as an
    // individual doc (for the transaction's own trx.get() re-check of that one candidate) —
    // AppContext.commit.test.tsx's own test double keeps those two stores separate.
    const existingLot = { medId: MED.id, lotNo: 'LOT1', exp: new Date('2027-01-01').getTime(), qty: 20 };
    seedCollection('lots', [{ id: 'existing-lot-1', ...existingLot }]);
    seedDoc('lots/existing-lot-1', existingLot);

    await user.click(screen.getByRole('button', { name: 'approve-pr1' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    // Without the fix, this would be a `set` creating a brand-new lot doc (data has a lotNo
    // field) instead of an `update` incrementing the existing one.
    const lotCreates = writes.filter((w) => w.kind === 'set' && !!w.data && 'lotNo' in w.data);
    expect(lotCreates.length).toBe(0);
    const merge = writes.find((w) => w.kind === 'update' && w.path === 'lots/existing-lot-1');
    expect(merge?.data?.qty).toBe(10);
  });
});

function CountHarness() {
  const { setCountInput, commitCount } = useApp();
  useEffect(() => { setCountInput('m1', '10'); }, [setCountInput]);
  return <button onClick={() => commitCount('m1')}>commit-count</button>;
}

function SubCountHarness() {
  const { setSubCountInput, commitSubCount } = useApp();
  useEffect(() => { setSubCountInput('m1', '10'); }, [setSubCountInput]);
  return <button onClick={() => commitSubCount('m1')}>commit-subcount</button>;
}

describe('commitCount / commitSubCount — silent-no-op regression', () => {
  it('commitCount toasts a clear message instead of doing nothing when the med is deleted', async () => {
    const user = userEvent.setup();
    renderWithApp(<><CountHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    // The med row this count input was typed for is gone from the live cache by commit time —
    // deleted by another device. fireCollection([]) rather than never firing at all, so
    // state.meds is confirmed empty, not just still-loading.
    fireCollection('meds', []);

    await user.click(screen.getByRole('button', { name: 'commit-count' }));
    await screen.findByText('รายการนี้ถูกลบออกจากระบบไปแล้ว — ลบแถวนี้ออกจากหน้านับสต็อกแล้วรีเฟรชหน้าจอ');
    // Confirms this returns before ever starting a transaction — not just a different failure
    // deeper in the write path.
    expect(getLastTransactionWrites().length).toBe(0);
  });

  it('commitSubCount toasts a clear message instead of doing nothing when the med is deleted', async () => {
    const user = userEvent.setup();
    renderWithApp(<><SubCountHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);

    await user.click(screen.getByRole('button', { name: 'commit-subcount' }));
    await screen.findByText('รายการนี้ถูกลบออกจากระบบไปแล้ว — ลบแถวนี้ออกจากหน้านับสต็อกแล้วรีเฟรชหน้าจอ');
    expect(getLastTransactionWrites().length).toBe(0);
  });
});

function LogoutHarness() {
  const { state, setAdjQty, setAdjNote, setRecvQty, logout } = useApp();
  return (
    <div>
      <button onClick={() => { setAdjQty('37'); setAdjNote('นับได้ต่างจากระบบมาก'); setRecvQty('99'); }}>fill-forms</button>
      <button onClick={logout}>logout</button>
      <div data-testid="adjQty">{state.adjQty}</div>
      <div data-testid="adjNote">{state.adjNote}</div>
      <div data-testid="recvQty">{state.recvQty}</div>
    </div>
  );
}

describe('logout — shared-device data-leak regression', () => {
  it('clears in-progress form fields, not just the cart, so the next person on a shared device starts clean', async () => {
    const user = userEvent.setup();
    renderWithApp(<LogoutHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });

    await user.click(screen.getByRole('button', { name: 'fill-forms' }));
    expect(screen.getByTestId('adjQty').textContent).toBe('37');
    expect(screen.getByTestId('adjNote').textContent).toBe('นับได้ต่างจากระบบมาก');
    expect(screen.getByTestId('recvQty').textContent).toBe('99');

    await user.click(screen.getByRole('button', { name: 'logout' }));

    // Without the fix, these would still show the previous user's half-entered values —
    // exactly what the next person signing in on this same shared tablet would see.
    expect(screen.getByTestId('adjQty').textContent).toBe('');
    expect(screen.getByTestId('adjNote').textContent).toBe('');
    expect(screen.getByTestId('recvQty').textContent).toBe('');
  });
});

function CountPlausibilityHarness({ value }: { value: string }) {
  const { setCountInput, commitCount } = useApp();
  useEffect(() => { setCountInput('m1', value); }, [setCountInput, value]);
  return <button onClick={() => commitCount('m1')}>commit-count</button>;
}

describe('commitCount — plausibility-check regression', () => {
  it('asks for confirmation before committing a wildly implausible count, and blocks on cancel', async () => {
    const user = userEvent.setup();
    // MED.floor=40, MED.parFloor=100 → threshold = max(100,20)*8 = 800; 5000 is well past it.
    renderWithApp(<><CountPlausibilityHarness value="5000" /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'commit-count' }));
    await screen.findByText(/ต่างจากยอดระบบ.*มากผิดปกติ/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    expect(getLastTransactionWrites().length).toBe(0);
  });

  it('commits directly with no confirm prompt when the count is plausible', async () => {
    const user = userEvent.setup();
    renderWithApp(<><CountPlausibilityHarness value="45" /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'commit-count' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(screen.queryByText(/มากผิดปกติ/)).not.toBeInTheDocument();
  });
});

function HosxpHarness() {
  const { state, setHosxpText, processHosxp } = useApp();
  return (
    <div>
      <button onClick={() => setHosxpText('Paracetamol 500mg,10\nAmoxicillin 250mg,5\nParacetamol 500mg,10\nAmoxicillin 250mg,5')}>paste-doubled</button>
      <button onClick={processHosxp}>process</button>
      <div data-testid="rowCount">{state.hosxpRows?.length ?? 'none'}</div>
    </div>
  );
}

describe('processHosxp — paste-mistake safety net regression', () => {
  it('asks for confirmation when the pasted block is an exact doubled paste, and blocks on cancel', async () => {
    const user = userEvent.setup();
    renderWithApp(<><HosxpHarness /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'paste-doubled' }));
    await user.click(screen.getByRole('button', { name: 'process' }));
    await screen.findByText(/วางซ้ำ 2 รอบ/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    // Blocked before hosxpRows was ever populated — still "none".
    expect(screen.getByTestId('rowCount').textContent).toBe('none');
  });
});

describe('guardOnce — double-submit-on-timeout regression', () => {
  it('asks for confirmation before letting a timed-out action retry, and skips the retry write on cancel', async () => {
    const user = userEvent.setup();
    renderWithApp(<><AdjustScreen /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(await screen.findByRole('button', { name: /^ปรับยอด/ }));
    const search = await screen.findByPlaceholderText('ค้นหาชื่อยา');
    await user.type(search, 'Paracetamol');
    await user.click(await screen.findByRole('button', { name: new RegExp(MED.name) }));
    await user.click(screen.getByRole('button', { name: 'บันทึกจ่ายผิดรายการ' }));
    await screen.findByText(/ส่วนต่างที่จะลบออกจากยอดระบบ/);
    const qty = screen.getAllByRole('textbox').find((el) => el.getAttribute('inputmode') === 'numeric')!;
    await user.type(qty, '5');

    // First tap: the underlying transaction hangs long enough that withTimeout gives up —
    // simulated directly by rejecting with the same TimeoutError withTimeout itself throws,
    // rather than waiting out the real 15s clock.
    vi.mocked(runTransaction).mockRejectedValueOnce(new TimeoutError());
    await user.click(screen.getByRole('button', { name: 'บันทึกปรับยอด' }));
    await screen.findByText(/การเชื่อมต่อช้าเกินไปหรือขาดหาย/);
    expect(getLastTransactionWrites().length).toBe(0);

    // Second tap (retry) within the window: without the fix, this would go straight through to
    // a second, fully independent transaction — the exact double-apply risk this fix closes.
    await user.click(screen.getByRole('button', { name: 'บันทึกปรับยอด' }));
    await screen.findByText(/รายการก่อนหน้าอาจยังไม่เสร็จสมบูรณ์/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    expect(getLastTransactionWrites().length).toBe(0);
  });

  it('proceeds with the retry once confirmed, running the transaction normally', async () => {
    const user = userEvent.setup();
    renderWithApp(<><AdjustScreen /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(await screen.findByRole('button', { name: /^ปรับยอด/ }));
    const search = await screen.findByPlaceholderText('ค้นหาชื่อยา');
    await user.type(search, 'Paracetamol');
    await user.click(await screen.findByRole('button', { name: new RegExp(MED.name) }));
    await user.click(screen.getByRole('button', { name: 'บันทึกจ่ายผิดรายการ' }));
    await screen.findByText(/ส่วนต่างที่จะลบออกจากยอดระบบ/);
    const qty = screen.getAllByRole('textbox').find((el) => el.getAttribute('inputmode') === 'numeric')!;
    await user.type(qty, '5');

    vi.mocked(runTransaction).mockRejectedValueOnce(new TimeoutError());
    await user.click(screen.getByRole('button', { name: 'บันทึกปรับยอด' }));
    await screen.findByText(/การเชื่อมต่อช้าเกินไปหรือขาดหาย/);

    await user.click(screen.getByRole('button', { name: 'บันทึกปรับยอด' }));
    await screen.findByText(/รายการก่อนหน้าอาจยังไม่เสร็จสมบูรณ์/);
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));

    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
  });
});

describe('commitReceive — lot duplication regression', () => {
  it('merges into an existing active lot with the same lotNo/exp instead of creating a new one', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReceiveHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', {});
    // An existing, still-active lot for the exact same physical batch ReceiveHarness fills in
    // (lotNo 'LOT1', exp '2027-01-01', qty 10) — e.g. an earlier delivery of this exact batch
    // still sitting on the shelf.
    const existingExp = new Date('2027-01-01').getTime();
    seedCollection('lots', [{ id: 'existing-lot-1', medId: 'm1', lotNo: 'LOT1', exp: existingExp, qty: 20 }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-receive' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'commit-receive' }));

    const writes = await waitFor(() => {
      const w = getLastBatchWrites();
      expect(w.length).toBeGreaterThan(0);
      return w;
    });
    // Without the fix, this would be a `set` creating a brand-new lot doc (data has a lotNo
    // field) instead of an `update` incrementing the existing one.
    const lotCreates = writes.filter((w) => w.kind === 'set' && !!w.data && 'lotNo' in w.data);
    expect(lotCreates.length).toBe(0);
    const merge = writes.find((w) => w.kind === 'update' && w.path === 'lots/existing-lot-1');
    expect(merge?.data?.qty).toBe(10);
  });

  it('creates a new lot when no existing active lot shares the same lotNo/exp for that med', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReceiveHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', {});
    seedCollection('lots', []);
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-receive' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'commit-receive' }));

    const writes = await waitFor(() => {
      const w = getLastBatchWrites();
      expect(w.length).toBeGreaterThan(0);
      return w;
    });
    const lotCreates = writes.filter((w) => w.kind === 'set' && !!w.data && 'lotNo' in w.data);
    expect(lotCreates.length).toBe(1);
    expect(lotCreates[0].data?.qty).toBe(10);
  });
});
