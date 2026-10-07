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
// 15. commitWardMove's unit-mismatch fix: moving stock between two meds with different
//     dispensing units (e.g. เม็ด vs ขวด) must be blocked outright — see its own "Bug fix
//     (data integrity)" comment.
// 16. updateGlobalSettings' zero-cover-days fix: parFloorCoverDays/parSubCoverDays must clamp
//     to a minimum of 1 before being persisted to the shared meta/settings doc — see its own
//     "Bug fix (data integrity)" comment.
// 17. addMed/updateMedFull's bin-collision fix: saving a bin/binIpd code that already belongs
//     to a different active med must ask for confirmation first — see their own "Bug fix
//     (patient-safety-adjacent data integrity)" comments.
// 18. commitAllCounts/commitAllSubCounts' bulk plausibility-check fix: the same typo-safety-net
//     check commitCount/commitSubCount apply per-row must also apply to the "บันทึกทั้งหมด" bulk
//     path, which previously had zero such check — see their own "Bug fix (typo safety net —
//     bulk gap)" comments.
// 19. printLabels' lot-label HIGH ALERT fix: a "ฉลาก lot" label for a high-alert (had) med must
//     carry the same HIGH ALERT tag the med-label branch already does, not silently drop it —
//     see its own "Bug fix (patient safety)" comment.
import { describe, it, expect, vi } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { runTransaction, setDoc, updateDoc, addDoc } from 'firebase/firestore';
import { signInWithEmailAndPassword } from 'firebase/auth';
import TConfirmScreen from '../screens/TConfirmScreen';
import AdjustScreen from '../screens/AdjustScreen';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { TimeoutError } from '../utils/timeout';
import * as printModule from '../utils/print';
import {
  signInAs, fireCollection, hasListener, seedDoc, seedCollection, getLastTransactionWrites,
  getLastBatchWrites,
} from '../test-utils/firebaseTestDouble';

// printLabelSheet/printPickListSheet actually open a real browser print window — mocked here so
// the row-building logic of printLabels()/printTodayReplenishList()/printWarehouseRequestList()
// can be exercised (and its arguments inspected) without a DOM popup.
vi.mock('../utils/print', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/print')>();
  return { ...actual, printLabelSheet: vi.fn(() => true), printPickListSheet: vi.fn(() => true) };
});

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

  // Bug fix (patient safety, v3.107.1): an already-expired lot used to sort FIRST in
  // commitTransfer's own live lot ordering under plain soonest-expiry sort (the most "due" lot
  // by date is the one due to be scrapped, not transferred to the floor for dispensing) — see
  // commitTransfer's own "Bug fix (patient safety)" comment. fefoLot (selectors.ts), the
  // separate UI-hint selector TransferScreen's own expiry warning reads from, deliberately
  // keeps showing an expired lot — that's the warning this fix's write-path exclusion is
  // backed by, not something it should hide.
  it('skips an already-expired lot and draws from the next-soonest lot that is still usable', async () => {
    const user = userEvent.setup();
    renderWithApp(<><SeedCart /><TConfirmScreen /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [
      { id: 'lotExpired', medId: MED.id, qty: 5, lotNo: 'LE', exp: Date.now() - 86400000 },
      { id: 'lotFresh', medId: MED.id, qty: 10, lotNo: 'LF', exp: Date.now() + 30 * 86400000 },
    ]);
    await screen.findByText(MED.name);

    seedDoc('meds/m1', { floor: MED.floor });
    seedCollection('lots', [
      { id: 'lotExpired', medId: MED.id, qty: 5, exp: Date.now() - 86400000 },
      { id: 'lotFresh', medId: MED.id, qty: 10, exp: Date.now() + 30 * 86400000 },
    ]);
    seedDoc('lots/lotExpired', { qty: 5, lotNo: 'LE', exp: Date.now() - 86400000 });
    seedDoc('lots/lotFresh', { qty: 10, lotNo: 'LF', exp: Date.now() + 30 * 86400000 });

    await user.click(screen.getByRole('button', { name: /ยืนยันการเติมหน้างาน/ }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    // Without the fix, this would draw from lotExpired first (earliest exp) instead of skipping
    // it entirely for the still-usable lotFresh.
    expect(writes.find((w) => w.path === 'lots/lotExpired')).toBeUndefined();
    expect(writes.find((w) => w.path === 'lots/lotFresh')?.data).toEqual({ qty: 7 });
  });
});

const BOXED_MED = {
  id: 'm2', code: 'MED-0002', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1', packSize: 10,
  used30: 0, usedPrev30: 0, volatility: 0,
};
// Real-world request: "อยากให้การบวกเพิ่มตัวเลขเติมยาชั้นหน้างาน...ให้มีหน่วยเป็น 1 กล่องเป็นหลัก
// หากมีเสษค่อยใส่จำนวนเม็ด" — setCartQty() no longer force-rounds a typed quantity up to a whole
// box (see its own "Real-world request" comment, AppContext.tsx); a typed 23 for a 10-unit box
// stays exactly 23 (2 boxes + 3 loose), letting staff add a real remainder on top of whole boxes
// instead of always being bumped to the next full box. Ample substock here (100) so the
// unchanged cap never clips this.
function SeedBoxCart() {
  const { setCartQty, sub } = useApp();
  const qty = sub(BOXED_MED.id);
  useEffect(() => { if (qty > 0) setCartQty(BOXED_MED.id, '23'); }, [setCartQty, qty]);
  return null;
}

describe('commitTransfer — box-breakdown tx-note regression', () => {
  it('keeps a typed quantity with a remainder exactly as typed, and logs the "NxSIZE + remainder" split', async () => {
    const user = userEvent.setup();
    renderWithApp(<><SeedBoxCart /><TConfirmScreen /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BOXED_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [{ id: 'lot1', medId: BOXED_MED.id, qty: 100, lotNo: 'L1', exp: Date.now() + 30 * 86400000 }]);
    await screen.findByText(BOXED_MED.name);

    seedDoc('meds/m2', { floor: BOXED_MED.floor });
    seedCollection('lots', [{ id: 'lot1', medId: BOXED_MED.id, qty: 100, exp: Date.now() + 30 * 86400000 }]);
    seedDoc('lots/lot1', { qty: 100, lotNo: 'L1', exp: Date.now() + 30 * 86400000 });

    await user.click(screen.getByRole('button', { name: /ยืนยันการเติมหน้างาน/ }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const writes = getLastTransactionWrites();
    const txWrite = writes.find((w) => w.path.startsWith('txs/'));
    expect(txWrite?.data?.qty).toBe(23);
    expect(txWrite?.data?.note).toContain('2x10 + 3 เม็ด');
  });
});

function SetBoxCartQtyHarness({ medId, raw }: { medId: string; raw: string }) {
  const { state, setCartQty } = useApp();
  return (
    <div>
      <button onClick={() => setCartQty(medId, raw)}>set-qty</button>
      <div data-testid="cartQty">{state.cart[medId] ?? ''}</div>
    </div>
  );
}

// Real-world request: "อยากให้การบวกเพิ่มตัวเลขเติมยาชั้นหน้างาน...ให้มีหน่วยเป็น 1 กล่องเป็นหลัก
// หากมีเสษค่อยใส่จำนวนเม็ด" — setCartQty() no longer force-rounds a typed quantity up to a whole
// box for a box-only med (the +/- stepper and suggestTransferQty() still default to whole boxes —
// see bump()'s own unchanged behavior); typing lets staff add a real remainder on top.
describe('setCartQty — typed-remainder regression', () => {
  it('keeps a typed quantity with a remainder exactly as typed for a box-only med', async () => {
    const user = userEvent.setup();
    renderWithApp(<SetBoxCartQtyHarness medId={BOXED_MED.id} raw="23" />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BOXED_MED]);
    fireCollection('lots', [{ id: 'lot1', medId: BOXED_MED.id, qty: 100, lotNo: 'L1', exp: Date.now() + 30 * 86400000 }]);

    await user.click(screen.getByRole('button', { name: 'set-qty' }));
    await waitFor(() => expect(screen.getByTestId('cartQty').textContent).toBe('23'));
  });

  it('still caps a typed quantity at what substock actually has, same as any other med', async () => {
    const user = userEvent.setup();
    renderWithApp(<SetBoxCartQtyHarness medId={BOXED_MED.id} raw="23" />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BOXED_MED]);
    // Only 20 on hand — typing 23 must still clip to what's actually available.
    fireCollection('lots', [{ id: 'lot1', medId: BOXED_MED.id, qty: 20, lotNo: 'L1', exp: Date.now() + 30 * 86400000 }]);

    await user.click(screen.getByRole('button', { name: 'set-qty' }));
    await waitFor(() => expect(screen.getByTestId('cartQty').textContent).toBe('20'));
  });

  it('leaves a non-boxed med\'s typed quantity untouched', async () => {
    const user = userEvent.setup();
    renderWithApp(<SetBoxCartQtyHarness medId={MED.id} raw="23" />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', [{ id: 'lotM', medId: MED.id, qty: 100, lotNo: 'LM', exp: Date.now() + 30 * 86400000 }]);

    await user.click(screen.getByRole('button', { name: 'set-qty' }));
    await waitFor(() => expect(screen.getByTestId('cartQty').textContent).toBe('23'));
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
    await user.click(await screen.findByText(MED.name));
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
    await user.click(await screen.findByText(MED.name));
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
  // Bug fix (lot duplication race, v3.107.1): the decide-merge-vs-create + write used to run
  // as a plain getDocs() query followed by a separate, non-transactional writeBatch — now
  // folded into runTx (see commitReceive's own "Bug fix (lot duplication race...)" comment),
  // so these writes now land in the transaction write log, not the batch one.
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
    seedDoc('lots/existing-lot-1', { medId: 'm1', lotNo: 'LOT1', exp: existingExp, qty: 20 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-receive' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'commit-receive' }));

    const writes = await waitFor(() => {
      const w = getLastTransactionWrites();
      expect(w.length).toBeGreaterThan(0);
      return w;
    });
    // Without the fix, this would be a `set` creating a brand-new lot doc (data has a lotNo
    // field) instead of an `update` incrementing the existing one.
    const lotCreates = writes.filter((w) => w.kind === 'set' && !!w.data && 'lotNo' in w.data);
    expect(lotCreates.length).toBe(0);
    const merge = writes.find((w) => w.kind === 'update' && w.path === 'lots/existing-lot-1');
    expect(merge?.data?.qty).toBe(10);
    expect(getLastBatchWrites().length).toBe(0);
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
      const w = getLastTransactionWrites();
      expect(w.length).toBeGreaterThan(0);
      return w;
    });
    const lotCreates = writes.filter((w) => w.kind === 'set' && !!w.data && 'lotNo' in w.data);
    expect(lotCreates.length).toBe(1);
    expect(lotCreates[0].data?.qty).toBe(10);
  });

  // This is the actual race the runTx fix closes (see commitReceive's own comment): the live
  // getDocs() query that picks a merge candidate can still be stale by the time the
  // transaction's own trx.get() re-reads it — e.g. a concurrent scrapLot zeroed this exact lot
  // out in the gap between them. Before this fix there was no trx.get() re-check at all (a
  // plain writeBatch just trusted the query); now, same as approvePendingReceive already does,
  // a candidate that's no longer live must fall back to creating a new lot instead of merging
  // into a dead one.
  it('falls back to creating a new lot when the query-found candidate was concurrently zeroed out', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReceiveHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', {});
    const existingExp = new Date('2027-01-01').getTime();
    // The live getDocs() query still returns this candidate (qty 20, looks mergeable)...
    seedCollection('lots', [{ id: 'existing-lot-1', medId: 'm1', lotNo: 'LOT1', exp: existingExp, qty: 20 }]);
    // ...but the transaction's own trx.get() re-read sees it was scrapped to 0 in the meantime.
    seedDoc('lots/existing-lot-1', { medId: 'm1', lotNo: 'LOT1', exp: existingExp, qty: 0 });
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-receive' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'commit-receive' }));

    const writes = await waitFor(() => {
      const w = getLastTransactionWrites();
      expect(w.length).toBeGreaterThan(0);
      return w;
    });
    expect(writes.find((w) => w.kind === 'update' && w.path === 'lots/existing-lot-1')).toBeUndefined();
    const lotCreates = writes.filter((w) => w.kind === 'set' && !!w.data && 'lotNo' in w.data);
    expect(lotCreates.length).toBe(1);
    expect(lotCreates[0].data?.qty).toBe(10);
  });
});

const MED_BOTTLE = {
  id: 'm2', code: 'MED-0002', name: 'Ventolin inhaler', unit: 'ขวด', dosageForm: 'พ่น',
  price: 100, had: false, active: true, parSub: 20, parFloor: 5, floor: 3, bin: 'B1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function WardMoveHarness() {
  const { pickWmFromMed, pickWmToMed, setWmQty, setWmReason, commitWardMove } = useApp();
  return (
    <div>
      <button onClick={() => pickWmFromMed('m1')}>pick-from</button>
      <button onClick={() => pickWmToMed('m2')}>pick-to</button>
      <button onClick={() => { setWmQty('5'); setWmReason('เติม stat drawer'); }}>fill-form</button>
      <button onClick={commitWardMove}>commit-wardmove</button>
    </div>
  );
}

describe('commitWardMove — unit-mismatch regression', () => {
  it('blocks a move between two meds with different dispensing units', async () => {
    const user = userEvent.setup();
    renderWithApp(<><WardMoveHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    // MED is dispensed in เม็ด (tablets), MED_BOTTLE in ขวด (bottles) — moving "5" between them
    // has no valid meaning without a conversion the app can't compute.
    fireCollection('meds', [MED, MED_BOTTLE]);

    await user.click(screen.getByRole('button', { name: 'pick-from' }));
    await user.click(screen.getByRole('button', { name: 'pick-to' }));
    await user.click(screen.getByRole('button', { name: 'fill-form' }));
    await user.click(screen.getByRole('button', { name: 'commit-wardmove' }));

    await screen.findByText(/หน่วยยาไม่ตรงกัน/);
    expect(getLastTransactionWrites().length).toBe(0);
  });

  it('allows a move between two meds sharing the same unit', async () => {
    const user = userEvent.setup();
    const MED2 = { ...MED, id: 'm2', code: 'MED-0002', name: 'Amoxicillin 250mg' };
    renderWithApp(<><WardMoveHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED, MED2]);
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'pick-from' }));
    await user.click(screen.getByRole('button', { name: 'pick-to' }));
    await user.click(screen.getByRole('button', { name: 'fill-form' }));
    await user.click(screen.getByRole('button', { name: 'commit-wardmove' }));

    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(screen.queryByText(/หน่วยยาไม่ตรงกัน/)).not.toBeInTheDocument();
  });
});

function SettingsHarness() {
  const { updateGlobalSettings } = useApp();
  return <button onClick={() => updateGlobalSettings({ parFloorCoverDays: 0, parSubCoverDays: 0 })}>save-zero</button>;
}

describe('updateGlobalSettings — zero-cover-days regression', () => {
  it('clamps parFloorCoverDays/parSubCoverDays to a minimum of 1 before saving', async () => {
    const user = userEvent.setup();
    renderWithApp(<SettingsHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });

    await user.click(screen.getByRole('button', { name: 'save-zero' }));

    await waitFor(() => expect(vi.mocked(setDoc).mock.calls.length).toBeGreaterThan(0));
    const savedFields = vi.mocked(setDoc).mock.calls[0][1] as Record<string, unknown>;
    // Without the fix, these would be saved as literal 0 — which makes suggestPar() compute
    // every substock-backed med's suggested par ceiling as 1, regardless of real usage.
    expect(savedFields.parFloorCoverDays).toBe(1);
    expect(savedFields.parSubCoverDays).toBe(1);
  });
});

function AddMedHarness() {
  const { addMed } = useApp();
  return (
    <button onClick={() => addMed({
      name: 'Cefixime 400mg', unit: 'เม็ด', dosageForm: 'เม็ด', price: 5, had: false,
      bin: 'A1', parSub: 100, parFloor: 50, floorMin: 10, ward: 'opd', noSubstock: false,
    })}>
      add-med
    </button>
  );
}

describe('addMed — bin-collision regression', () => {
  it('asks for confirmation before saving a bin code that already belongs to a different active med', async () => {
    const user = userEvent.setup();
    renderWithApp(<><AddMedHarness /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    // MED already occupies bin 'A1' — AddMedHarness tries to save a NEW, different-named med
    // to that exact same bin.
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'add-med' }));
    await screen.findByText(/รหัสชั้นวาง.*A1.*ถูกใช้กับยา/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    // Blocked before the transaction (which mints the new med code and writes the doc) ran.
    expect(getLastTransactionWrites().length).toBe(0);
  });
});

function CountAllPlausibilityHarness({ value }: { value: string }) {
  const { setCountInput, commitAllCounts } = useApp();
  useEffect(() => { setCountInput('m1', value); }, [setCountInput, value]);
  return <button onClick={commitAllCounts}>commit-all-counts</button>;
}

describe('commitAllCounts — bulk plausibility-check regression', () => {
  it('asks for one summary confirmation before committing a batch containing a wildly implausible count', async () => {
    const user = userEvent.setup();
    // MED.floor=40, MED.parFloor=100 → threshold = max(100,20)*8 = 800; 5000 is well past it.
    // Without the fix, commitAllCounts (the "บันทึกทั้งหมด" bulk path) applies zero plausibility
    // check at all, unlike commitCount (the single-row path) — a real, more commonly used gap.
    renderWithApp(<><CountAllPlausibilityHarness value="5000" /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'commit-all-counts' }));
    await screen.findByText(/มีจำนวนที่นับได้ต่างจากยอดระบบมากผิดปกติ/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    expect(getLastTransactionWrites().length).toBe(0);
  });

  it('commits directly with no confirm prompt when every count in the batch is plausible', async () => {
    const user = userEvent.setup();
    renderWithApp(<><CountAllPlausibilityHarness value="45" /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', { floor: MED.floor });

    await user.click(screen.getByRole('button', { name: 'commit-all-counts' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(screen.queryByText(/มากผิดปกติ/)).not.toBeInTheDocument();
  });
});

const HAD_MED = {
  id: 'm-had', code: 'MED-0099', name: 'Heparin 5000U', unit: 'ขวด', dosageForm: 'ฉีด',
  price: 200, had: true, active: true, parSub: 20, parFloor: 5, floor: 3, bin: 'C9',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const HAD_LOT = { id: 'lot-had-1', medId: 'm-had', code: 'LOT-HAD1', lotNo: 'H1', qty: 10, exp: Date.now() + 300 * 86400000 };

function PrintLotLabelsHarness() {
  const { setLabelType, printLabels } = useApp();
  return (
    <div>
      <button onClick={() => setLabelType('lot')}>set-lot-type</button>
      <button onClick={printLabels}>print-labels</button>
    </div>
  );
}

describe('printLabels — lot-label HIGH ALERT regression', () => {
  it('carries a HIGH ALERT tag for a high-alert med\'s lot label', async () => {
    const user = userEvent.setup();
    renderWithApp(<PrintLotLabelsHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [HAD_MED]);
    fireCollection('lots', [HAD_LOT]);

    await user.click(screen.getByRole('button', { name: 'set-lot-type' }));
    await user.click(screen.getByRole('button', { name: 'print-labels' }));

    await waitFor(() => expect(vi.mocked(printModule.printLabelSheet).mock.calls.length).toBeGreaterThan(0));
    const labels = vi.mocked(printModule.printLabelSheet).mock.calls[0][0];
    const lotLabel = labels.find((l) => l.id === HAD_LOT.code);
    // Without the fix, a lot label's tag only ever carried a near-expiry marker — HIGH ALERT
    // status was silently dropped entirely for this print path.
    expect(lotLabel?.tag).toContain('HIGH ALERT');
  });
});

// Real-world request: "ปริ้นยังไงให้สามารถปริ้นตามชั้นวางเรียงไปเรื่อยๆตามลำดับ เพื่อง่ายต่อการแปะ
// ป้ายชั้นวางยา" — printLabels() used to emit labels in whatever order `state.meds` happened to
// iterate in (Firestore snapshot order), not physical shelf order — see binCompare()'s own doc
// comment (binRange.ts) for the fix.
const SHELF_MED_B1 = { ...HAD_MED, id: 'mB1', code: 'MED-B1', name: 'Med B1', had: false, bin: 'B1' };
const SHELF_MED_A2 = { ...HAD_MED, id: 'mA2', code: 'MED-A2', name: 'Med A2', had: false, bin: 'A2' };
const SHELF_MED_A1 = { ...HAD_MED, id: 'mA1', code: 'MED-A1', name: 'Med A1', had: false, bin: 'A1' };

function PrintMedLabelsHarness() {
  const { printLabels } = useApp();
  return <button onClick={printLabels}>print-labels</button>;
}

describe('printLabels — shelf-order regression', () => {
  it('prints med labels sorted by shelf code (A1, A2, B1), not plain formulary/snapshot order', async () => {
    const user = userEvent.setup();
    renderWithApp(<PrintMedLabelsHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    // Seeded out of shelf order on purpose — B1, then A2, then A1.
    fireCollection('meds', [SHELF_MED_B1, SHELF_MED_A2, SHELF_MED_A1]);
    fireCollection('lots', []);

    const callsBefore = vi.mocked(printModule.printLabelSheet).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'print-labels' }));
    await waitFor(() => expect(vi.mocked(printModule.printLabelSheet).mock.calls.length).toBeGreaterThan(callsBefore));

    const labels = vi.mocked(printModule.printLabelSheet).mock.calls[callsBefore][0];
    expect(labels.map((l) => l.bin)).toEqual(['A1', 'A2', 'B1']);
  });

  it('prints lot labels sorted by their med\'s shelf code too', async () => {
    const user = userEvent.setup();
    renderWithApp(<PrintLotLabelsHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [SHELF_MED_B1, SHELF_MED_A2, SHELF_MED_A1]);
    fireCollection('lots', [
      { id: 'lB1', medId: SHELF_MED_B1.id, code: 'LOT-B1', lotNo: 'L1', qty: 5, exp: Date.now() + 300 * 86400000 },
      { id: 'lA2', medId: SHELF_MED_A2.id, code: 'LOT-A2', lotNo: 'L2', qty: 5, exp: Date.now() + 300 * 86400000 },
      { id: 'lA1', medId: SHELF_MED_A1.id, code: 'LOT-A1', lotNo: 'L3', qty: 5, exp: Date.now() + 300 * 86400000 },
    ]);

    await user.click(screen.getByRole('button', { name: 'set-lot-type' }));
    const callsBefore = vi.mocked(printModule.printLabelSheet).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'print-labels' }));
    await waitFor(() => expect(vi.mocked(printModule.printLabelSheet).mock.calls.length).toBeGreaterThan(callsBefore));

    const labels = vi.mocked(printModule.printLabelSheet).mock.calls[callsBefore][0];
    expect(labels.map((l) => l.id)).toEqual(['LOT-A1', 'LOT-A2', 'LOT-B1']);
  });
});

const MED2_ACTIVE = { ...MED_BOTTLE, id: 'm2', code: 'MED-0002', name: 'Ventolin inhaler', floor: 3, active: true };

function CountAllInactiveMedHarness() {
  const { setCountInput, commitAllCounts } = useApp();
  useEffect(() => { setCountInput('m1', '45'); setCountInput('m2', '10'); }, [setCountInput]);
  return <button onClick={commitAllCounts}>commit-all-counts</button>;
}

describe('commitAllCounts — inactive-med-skip regression', () => {
  it('skips (and tallies as failed) a row whose med was deactivated mid-batch, without writing for it', async () => {
    const user = userEvent.setup();
    renderWithApp(<><CountAllInactiveMedHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED, MED2_ACTIVE]);
    seedDoc('meds/m1', { floor: MED.floor });

    // Another device deactivates m2 (not deleted — commitAllCounts's old `!m`-only check would
    // still pass for a merely-deactivated med) in the gap between typing both counts and tapping
    // "บันทึกทั้งหมด" — CountScreen's own active/typedIds filtering would already have hidden it
    // from the operator's screen by this point.
    fireCollection('meds', [MED, { ...MED2_ACTIVE, active: false }]);

    await user.click(screen.getByRole('button', { name: 'commit-all-counts' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    // Without the fix, this would still carry a real floor write for m2 — a drug the operator
    // could no longer even see on their own screen.
    expect(getLastTransactionWrites().find((w) => w.path === 'meds/m2')).toBeUndefined();
    expect(getLastTransactionWrites().find((w) => w.path === 'meds/m1')).toBeDefined();
    await screen.findByText(/ไม่สำเร็จ 1 รายการ/);
  });
});

function ReceivePlausibilityHarness({ exp, qty }: { exp: string; qty: string }) {
  const { state, pickRecvMed, setRecvLot, setRecvExp, setRecvQty, addRecv } = useApp();
  useEffect(() => { if (!state.recvMed && !state.recvItems.length) pickRecvMed(MED.id); }, [state.recvMed, state.recvItems.length, pickRecvMed]);
  useEffect(() => { if (state.recvMed && !state.recvLot) setRecvLot('LOT1'); }, [state.recvMed, state.recvLot, setRecvLot]);
  useEffect(() => { if (state.recvLot && !state.recvExp) setRecvExp(exp); }, [state.recvLot, state.recvExp, setRecvExp, exp]);
  useEffect(() => { if (state.recvExp && !state.recvQty) setRecvQty(qty); }, [state.recvExp, state.recvQty, setRecvQty, qty]);
  return (
    <div>
      <button disabled={!state.recvQty} onClick={() => addRecv()}>add-recv</button>
      <div data-testid="itemCount">{state.recvItems.length}</div>
    </div>
  );
}

describe('addRecv — past-expiry-date regression', () => {
  it('asks for confirmation before adding a lot whose typed expiry date is already in the past, and blocks on cancel', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReceivePlausibilityHarness exp="2020-01-01" qty="10" /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'add-recv' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'add-recv' }));
    await screen.findByText(/เป็นวันที่ผ่านไปแล้ว/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    expect(screen.getByTestId('itemCount').textContent).toBe('0');
  });

  it('adds the item once confirmed, despite the past expiry date', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReceivePlausibilityHarness exp="2020-01-01" qty="10" /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'add-recv' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'add-recv' }));
    await screen.findByText(/เป็นวันที่ผ่านไปแล้ว/);
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));

    await waitFor(() => expect(screen.getByTestId('itemCount').textContent).toBe('1'));
  });

  it('adds directly with no confirm prompt for a normal future expiry date', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReceivePlausibilityHarness exp="2027-01-01" qty="10" /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'add-recv' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'add-recv' }));
    await waitFor(() => expect(screen.getByTestId('itemCount').textContent).toBe('1'));
    expect(screen.queryByText(/เป็นวันที่ผ่านไปแล้ว/)).not.toBeInTheDocument();
  });
});

describe('addRecv — implausible-quantity regression', () => {
  it('asks for confirmation before adding a wildly implausible quantity, and blocks on cancel', async () => {
    const user = userEvent.setup();
    // MED.parSub=500 (MED uses substock — noSubstock is unset) → threshold = max(500,20)*8 =
    // 4000; 5000 is well past it.
    renderWithApp(<><ReceivePlausibilityHarness exp="2027-01-01" qty="5000" /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'add-recv' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'add-recv' }));
    await screen.findByText(/มากผิดปกติเมื่อเทียบกับ par/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    expect(screen.getByTestId('itemCount').textContent).toBe('0');
  });

  it('adds directly with no confirm prompt for a plausible quantity', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReceivePlausibilityHarness exp="2027-01-01" qty="10" /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'add-recv' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'add-recv' }));
    await waitFor(() => expect(screen.getByTestId('itemCount').textContent).toBe('1'));
    expect(screen.queryByText(/มากผิดปกติ/)).not.toBeInTheDocument();
  });
});

function AddMedNegativePriceHarness() {
  const { addMed } = useApp();
  return (
    <button onClick={() => addMed({
      name: 'Cefixime 400mg', unit: 'เม็ด', dosageForm: 'เม็ด', price: -50, had: false,
      bin: 'B1', parSub: 100, parFloor: 50, floorMin: 10, ward: 'opd', noSubstock: false,
    })}>
      add-med-negative-price
    </button>
  );
}

function UpdateMedNegativePriceHarness() {
  const { updateMedFull } = useApp();
  return (
    <button onClick={() => updateMedFull(MED.id, {
      name: MED.name, unit: MED.unit, dosageForm: MED.dosageForm, price: -20, had: false,
      bin: MED.bin, parSub: MED.parSub, parFloor: MED.parFloor, floorMin: 10, ward: 'opd', noSubstock: false, volatility: 1.1,
    }, null)}>
      update-med-negative-price
    </button>
  );
}

describe('addMed / updateMedFull — negative-price clamp regression', () => {
  it('addMed clamps a negative price to 0 instead of saving it as-is', async () => {
    const user = userEvent.setup();
    renderWithApp(<AddMedNegativePriceHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);

    await user.click(screen.getByRole('button', { name: 'add-med-negative-price' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    // Without the fix, this would be -50 — every other numeric field (parSub/parFloor/floorMin)
    // on this same write is already clamped with Math.max(0, ...); price wasn't.
    const write = getLastTransactionWrites().find((w) => w.kind === 'set' && !!w.data && 'code' in w.data);
    expect(write?.data?.price).toBe(0);
  });

  it('updateMedFull clamps a negative price to 0 instead of saving it as-is', async () => {
    const user = userEvent.setup();
    renderWithApp(<UpdateMedNegativePriceHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    await user.click(screen.getByRole('button', { name: 'update-med-negative-price' }));
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.length).toBeGreaterThan(0));

    const savedFields = vi.mocked(updateDoc).mock.calls[0][1] as unknown as Record<string, unknown>;
    expect(savedFields.price).toBe(0);
  });
});

function SignInDoubleTapHarness() {
  const { state, setAuthUsername, setAuthPassword, signIn } = useApp();
  useEffect(() => { if (!state.authUsername) setAuthUsername('test'); }, [state.authUsername, setAuthUsername]);
  useEffect(() => { if (!state.authPassword) setAuthPassword('secret1'); }, [state.authPassword, setAuthPassword]);
  // Two synchronous calls in the same click handler, same shape as a fast double-tap/double-
  // Enter firing the form's onSubmit twice before React flushes state.authBusy.
  return <button disabled={!state.authPassword} onClick={() => { signIn(); signIn(); }}>signin-twice</button>;
}

describe('signIn — double-submit-consistency regression', () => {
  it('blocks a synchronous double-tap from firing two concurrent sign-in attempts', async () => {
    const user = userEvent.setup();
    vi.mocked(signInWithEmailAndPassword).mockResolvedValue({ user: { uid: 'u1' } } as unknown as Awaited<ReturnType<typeof signInWithEmailAndPassword>>);
    renderWithApp(<SignInDoubleTapHarness />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'signin-twice' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'signin-twice' }));
    await waitFor(() => expect(vi.mocked(signInWithEmailAndPassword).mock.calls.length).toBeGreaterThan(0));

    // Without the fix (signIn wrapped in guardOnce, which blocks synchronously via a ref checked
    // before any await), this would be 2 — one from each of the two synchronous calls above.
    expect(vi.mocked(signInWithEmailAndPassword).mock.calls.length).toBe(1);
  });
});

// used30=560, volatility=1, default parFloorCoverDays=4 → suggestPar's floor = roundStep(560 /
// (30*5/7) * 4 * 1) = roundStep(104.53...) = 110 — deterministic suggested Max well below the
// med's existing hand-set Min (400).
const STALE_MIN_MED = {
  id: 'm3', code: 'MED-0003', name: 'Dexamethasone 4mg/ml', unit: 'Amp.', dosageForm: 'ฉีด',
  price: 1, had: false, active: true, parSub: 800, parFloor: 200, floorMin: 400, bin: 'T2',
  used30: 560, usedPrev30: 0, volatility: 1,
};
function ApplyOneParHarness({ medId }: { medId: string }) {
  const { applyOnePar } = useApp();
  return <button onClick={() => applyOnePar(medId, 'floor')}>apply-par-floor</button>;
}

describe('applyOnePar — stale-Min-above-new-Max regression', () => {
  it('pulls floorMin (Min) back down together with the new parFloor (Max) when the old Min would end up above it', async () => {
    const user = userEvent.setup();
    renderWithApp(<ApplyOneParHarness medId={STALE_MIN_MED.id} />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [STALE_MIN_MED]);

    const callsBefore = vi.mocked(updateDoc).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'apply-par-floor' }));
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.length).toBeGreaterThan(callsBefore));

    const savedFields = vi.mocked(updateDoc).mock.calls[callsBefore][1] as unknown as Record<string, unknown>;
    expect(savedFields.parFloor).toBe(110);
    // Without the fix, floorMin would be left untouched at 400 — above the new Max (110),
    // reproducing the real observed "Min 400 / Max 110" state. 53 is suggestPar()'s own
    // data-driven `min` (daily rate × half the cover-days Max represents — see its own comment),
    // not a flat 50%-of-Max guess: daily ≈ 26.13, roundStep(26.13 × 2) = 53.
    expect(savedFields.floorMin).toBe(53);
  });

  it('leaves floorMin untouched when it already sits at or below the new parFloor', async () => {
    const user = userEvent.setup();
    const med = { ...STALE_MIN_MED, id: 'm4', floorMin: 50 };
    renderWithApp(<ApplyOneParHarness medId={med.id} />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [med]);

    const callsBefore = vi.mocked(updateDoc).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'apply-par-floor' }));
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.length).toBeGreaterThan(callsBefore));

    const savedFields = vi.mocked(updateDoc).mock.calls[callsBefore][1] as unknown as Record<string, unknown>;
    expect(savedFields.parFloor).toBe(110);
    expect(savedFields.floorMin).toBeUndefined();
  });
});

function SetAllMinSuggestedHarness() {
  const { setAllMinSuggested } = useApp();
  return <button onClick={setAllMinSuggested}>set-all-min-suggested</button>;
}

// Real-world request: "วิเคราะห์ Min Max...ให้เหมาะกับการใช้งานหน้างานจริง" item 1 — bulk sibling
// to setAllMinHalfOfMax, writing suggestPar()'s own data-driven Min (real usage rate × half the
// cover-days Max represents) instead of a flat 50%-of-Max ratio.
describe('setAllMinSuggested — data-driven bulk Min regression', () => {
  it('writes the suggested data-driven Min for every active med with real usage statistics, skipping one with none', async () => {
    const user = userEvent.setup();
    renderWithApp(<><SetAllMinSuggestedHarness /><AutoConfirmYes /></>);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    // STALE_MIN_MED: used30=560, floorMin=400 (stale) -> suggested min=53 (see its own comment above).
    // NO_USAGE_MED: used30=0 -> suggestPar() returns null -> must be left untouched entirely.
    const NO_USAGE_MED = { ...STALE_MIN_MED, id: 'm-no-usage', used30: 0, usedPrev30: 0 };
    fireCollection('meds', [STALE_MIN_MED, NO_USAGE_MED]);

    await user.click(screen.getByRole('button', { name: 'set-all-min-suggested' }));
    await waitFor(() => expect(getLastBatchWrites().length).toBeGreaterThan(0));

    const writes = getLastBatchWrites();
    expect(writes.find((w) => w.path === 'meds/' + STALE_MIN_MED.id)?.data).toEqual({ floorMin: 53 });
    expect(writes.find((w) => w.path === 'meds/' + NO_USAGE_MED.id)).toBeUndefined();
  });
});

// Real-world request (user-reported, with screenshots of the actual printed documents):
// ใบเติมหน้างานประจำวัน should also show the substock shelf code to pick FROM (not just the
// floor shelf the stock is headed TO), and ใบขอเบิกจากคลังใหญ่'s "รหัสยา" (med code) column —
// never actually used in practice — should be replaced with the substock shelf code too.
const REPL_MED = {
  id: 'm5', code: 'MED-0005', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floorMin: 50, floor: 10,
  bin: 'A5', binSub: 'S12', noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0,
};
const REPL_LOT = { id: 'lot-repl-1', medId: REPL_MED.id, code: 'LOT-R1', lotNo: 'R1', qty: 200, exp: Date.now() + 300 * 86400000 };

function PrintTodayReplenishHarness() {
  const { printTodayReplenishList } = useApp();
  return <button onClick={printTodayReplenishList}>print-today-replenish</button>;
}

describe('printTodayReplenishList — substock pick-location regression', () => {
  it('adds each row\'s substock shelf code (where to pick from) alongside the floor bin it is headed to', async () => {
    const user = userEvent.setup();
    renderWithApp(<PrintTodayReplenishHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [REPL_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [REPL_LOT]);

    // printPickListSheet's mock call history accumulates across every it() in this file (the
    // test double's own listeners/doc-store get reset between tests, but vi.fn() call history
    // does not), so index by what's newly appended by THIS test's own click, not calls[0].
    const callsBefore = vi.mocked(printModule.printPickListSheet).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'print-today-replenish' }));
    await waitFor(() => expect(vi.mocked(printModule.printPickListSheet).mock.calls.length).toBeGreaterThan(callsBefore));
    const rows = vi.mocked(printModule.printPickListSheet).mock.calls[callsBefore][0];
    const row = rows.find((r) => r.name === REPL_MED.name);
    // Without the fix, pickBin was never set at all — the sheet only ever said where the stock
    // was headed (bin, the floor shelf), never where to physically go pick it from.
    expect(row?.pickBin).toBe(REPL_MED.binSub);
    expect(row?.bin).toBe(REPL_MED.bin);
  });

  // Regression for a real request: "ใบเติมหน้างานประจำ และใบเบิกจากคลังให้แยกประเภทยากิน ยาฉีด
  // ด้วยครับ" — printPickListSheet only groups by route when the caller's rows actually set it.
  it('sets each row\'s route (effectiveRouteOf, with a live suggestRoute() fallback) for printPickListSheet to group by', async () => {
    const user = userEvent.setup();
    renderWithApp(<PrintTodayReplenishHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [REPL_MED]); // unit 'เม็ด', no explicit route — suggestRoute() → 'oral'
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [REPL_LOT]);

    const callsBefore = vi.mocked(printModule.printPickListSheet).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'print-today-replenish' }));
    await waitFor(() => expect(vi.mocked(printModule.printPickListSheet).mock.calls.length).toBeGreaterThan(callsBefore));
    const rows = vi.mocked(printModule.printPickListSheet).mock.calls[callsBefore][0];
    expect(rows.find((r) => r.name === REPL_MED.name)?.route).toBe('oral');
  });
});

// Real-world request: "ในใบคุมสต็อก หรือใบหน้างาน ให้เขียนเป็นรูปแบบเช่น 1x60 แปลว่าเบิกยา 1 กล่อง
// กล่องละ 60 เม็ด" — boxBreakdownLabel() (selectors.ts), reused by every print sheet/ledger note
// that needs to say how many boxes a quantity breaks down into.
const REPL_BOXED_MED = {
  id: 'm11', code: 'MED-0011', name: 'Ibuprofen 400mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 130, floorMin: 65, floor: 10,
  bin: 'A11', binSub: 'S50', noSubstock: false, packSize: 60, used30: 0, usedPrev30: 0, volatility: 0,
};

describe('printTodayReplenishList — box-breakdown note format regression', () => {
  it('writes the pick-list note in "NxSIZE" notation for a box-only med', async () => {
    const user = userEvent.setup();
    renderWithApp(<PrintTodayReplenishHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [REPL_BOXED_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    // Deficit 120 (parFloor 130 - floor 10), packSize 60 → rounds to nearest box (2x60=120).
    fireCollection('lots', [{ id: 'lot-replbox-1', medId: REPL_BOXED_MED.id, qty: 500, lotNo: 'RB1', exp: Date.now() + 300 * 86400000 }]);

    const callsBefore = vi.mocked(printModule.printPickListSheet).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'print-today-replenish' }));
    await waitFor(() => expect(vi.mocked(printModule.printPickListSheet).mock.calls.length).toBeGreaterThan(callsBefore));
    const rows = vi.mocked(printModule.printPickListSheet).mock.calls[callsBefore][0];
    const row = rows.find((r) => r.name === REPL_BOXED_MED.name);
    expect(row?.note).toContain('หยิบ 2x60');
  });
});

const WH_SUB_MED = {
  id: 'm6', code: 'MED-0006', name: 'Cefazolin 1g', unit: 'Vial', dosageForm: 'ฉีด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floorMin: 50, floor: 80,
  bin: 'B6', binSub: 'S20', noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0,
};
const WH_NOSUB_MED = {
  id: 'm7', code: 'MED-0007', name: 'Normal saline 1000ml', unit: 'ถุง', dosageForm: 'น้ำเกลือ',
  price: 1, had: false, active: true, parSub: 0, parFloor: 50, floorMin: 25, floor: 10,
  bin: 'C7', noSubstock: true, used30: 0, usedPrev30: 0, volatility: 0,
};

function PrintWarehouseRequestHarness() {
  const { printWarehouseRequestList } = useApp();
  return <button onClick={printWarehouseRequestList}>print-warehouse-request</button>;
}

describe('printWarehouseRequestList — substock-bin-instead-of-med-code regression', () => {
  it('shows the substock shelf code (not the unused med code) for a med that has a substock stage', async () => {
    const user = userEvent.setup();
    renderWithApp(<PrintWarehouseRequestHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [WH_SUB_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', []);

    const callsBefore = vi.mocked(printModule.printPickListSheet).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'print-warehouse-request' }));
    await waitFor(() => expect(vi.mocked(printModule.printPickListSheet).mock.calls.length).toBeGreaterThan(callsBefore));
    const rows = vi.mocked(printModule.printPickListSheet).mock.calls[callsBefore][0];
    const row = rows.find((r) => r.name === WH_SUB_MED.name);
    // Without the fix, bin here was m.code (e.g. "MED-0006") — a column the user reports is
    // never actually consulted in practice.
    expect(row?.bin).toBe(WH_SUB_MED.binSub);
    expect(row?.bin).not.toBe(WH_SUB_MED.code);
    // Regression for "ใบเติมหน้างานประจำ และใบเบิกจากคลังให้แยกประเภทยากิน ยาฉีดด้วยครับ" —
    // WH_SUB_MED's unit 'Vial' → suggestRoute() → 'injection'.
    expect(row?.route).toBe('injection');
  });

  it('falls back to the floor bin for a noSubstock med, which has no substock shelf of its own', async () => {
    const user = userEvent.setup();
    renderWithApp(<PrintWarehouseRequestHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [WH_NOSUB_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', []);

    const callsBefore = vi.mocked(printModule.printPickListSheet).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'print-warehouse-request' }));
    await waitFor(() => expect(vi.mocked(printModule.printPickListSheet).mock.calls.length).toBeGreaterThan(callsBefore));
    const rows = vi.mocked(printModule.printPickListSheet).mock.calls[callsBefore][0];
    const row = rows.find((r) => r.name?.startsWith(WH_NOSUB_MED.name));
    expect(row?.bin).toBe(WH_NOSUB_MED.bin);
    expect(row?.bin).not.toBe(WH_NOSUB_MED.code);
  });
});

const WH_BOXED_MED = {
  id: 'm12', code: 'MED-0012', name: 'Diclofenac 25mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floorMin: 50, floor: 80,
  bin: 'B12', binSub: 'S60', noSubstock: false, packSize: 30, used30: 0, usedPrev30: 0, volatility: 0,
};

describe('printWarehouseRequestList — box-breakdown note format regression', () => {
  it('writes the row note in "NxSIZE" notation for a box-only med', async () => {
    const user = userEvent.setup();
    renderWithApp(<PrintWarehouseRequestHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [WH_BOXED_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', []);

    const callsBefore = vi.mocked(printModule.printPickListSheet).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'print-warehouse-request' }));
    await waitFor(() => expect(vi.mocked(printModule.printPickListSheet).mock.calls.length).toBeGreaterThan(callsBefore));
    const rows = vi.mocked(printModule.printPickListSheet).mock.calls[callsBefore][0];
    const row = rows.find((r) => r.name === WH_BOXED_MED.name);
    // Deficit 500 (parSub 500 - subQty 0), packSize 30 → rounds UP (this list has no substock
    // cap, see packStep()/this function's own comment) to ceil(500/30)=17 boxes (510 units).
    expect(row?.note).toBe('17x30');
  });
});

// Real-world request: "เพิ่มการตั้งค่ายาหมดชั่วคราว...บริษัทยาไม่มาส่ง ล่าช้า เลิกผลิต คลังปิดช่วง
// ปลาย/ต้นปีงบประมาณ...แจ้งเตือนทุกๆการเบิก" — startStockHold()/endStockHold() (AppContext.tsx)
// flag/clear Med.outOfStockSince (+Reason/+ExpectedReturn), suppress the med from
// needsWarehouseRequest() everywhere that's computed, and log a full permanent history via the
// audit log (see types.ts's AuditType additions).
const HOLD_MED = {
  id: 'm8', code: 'MED-0008', name: 'Cefixime 100mg', unit: 'แคปซูล', dosageForm: 'แคปซูล',
  price: 1, had: false, active: true, parSub: 200, parFloor: 60, floorMin: 30, floor: 50,
  bin: 'D8', binSub: 'S30', noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0,
};

function StockHoldHarness({ medId }: { medId: string }) {
  const { startStockHold, endStockHold } = useApp();
  return (
    <div>
      <button onClick={() => startStockHold(medId, 'บริษัทเลิกผลิต รอเปลี่ยนยี่ห้อ', new Date('2026-11-15').getTime())}>start-hold</button>
      <button onClick={() => endStockHold(medId, 'ได้ของจากบริษัทใหม่แล้ว')}>end-hold</button>
    </div>
  );
}

describe('startStockHold / endStockHold — temporary-stockout regression', () => {
  it('writes outOfStockSince/Reason/ExpectedReturn and logs a stock_hold_started audit entry', async () => {
    const user = userEvent.setup();
    renderWithApp(<StockHoldHarness medId={HOLD_MED.id} />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [HOLD_MED]);

    const updateCallsBefore = vi.mocked(updateDoc).mock.calls.length;
    const auditCallsBefore = vi.mocked(addDoc).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'start-hold' }));
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.length).toBeGreaterThan(updateCallsBefore));

    const savedFields = vi.mocked(updateDoc).mock.calls[updateCallsBefore][1] as unknown as Record<string, unknown>;
    expect(typeof savedFields.outOfStockSince).toBe('number');
    expect(savedFields.outOfStockReason).toBe('บริษัทเลิกผลิต รอเปลี่ยนยี่ห้อ');
    expect(savedFields.outOfStockExpectedReturn).toBe(new Date('2026-11-15').getTime());

    await waitFor(() => expect(vi.mocked(addDoc).mock.calls.length).toBeGreaterThan(auditCallsBefore));
    const auditEntry = vi.mocked(addDoc).mock.calls[auditCallsBefore][1] as unknown as { type: string; note: string };
    expect(auditEntry.type).toBe('stock_hold_started');
    expect(auditEntry.note).toContain(HOLD_MED.name);
    expect(auditEntry.note).toContain('บริษัทเลิกผลิต');
  });

  it('clears all three fields and logs a stock_hold_ended audit entry, for a med with an active hold', async () => {
    const user = userEvent.setup();
    const med = { ...HOLD_MED, id: 'm9', outOfStockSince: Date.now() - 5 * 86400000, outOfStockReason: 'จัดส่งล่าช้า' };
    renderWithApp(<StockHoldHarness medId={med.id} />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [med]);

    const updateCallsBefore = vi.mocked(updateDoc).mock.calls.length;
    const auditCallsBefore = vi.mocked(addDoc).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'end-hold' }));
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.length).toBeGreaterThan(updateCallsBefore));

    const savedFields = vi.mocked(updateDoc).mock.calls[updateCallsBefore][1] as unknown as Record<string, unknown>;
    // deleteField() sentinels aren't plain `undefined` — just confirm all three keys were
    // actually targeted by this write, which is what clears them in real Firestore.
    expect(Object.keys(savedFields)).toEqual(expect.arrayContaining(['outOfStockSince', 'outOfStockReason', 'outOfStockExpectedReturn']));

    await waitFor(() => expect(vi.mocked(addDoc).mock.calls.length).toBeGreaterThan(auditCallsBefore));
    const auditEntry = vi.mocked(addDoc).mock.calls[auditCallsBefore][1] as unknown as { type: string; note: string };
    expect(auditEntry.type).toBe('stock_hold_ended');
    expect(auditEntry.note).toContain('ได้ของจากบริษัทใหม่แล้ว');
    // 5 days ago → the logged duration should say so, not "0 วัน".
    expect(auditEntry.note).toMatch(/5 วัน/);
  });
});

const HELD_REPL_MED = {
  id: 'm10', code: 'MED-0010', name: 'Metronidazole 400mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 300, parFloor: 100, floorMin: 50, floor: 10,
  bin: 'E10', binSub: 'S40', noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0,
  outOfStockSince: Date.now() - 2 * 86400000, outOfStockReason: 'คลังปิดสิ้นปีงบ',
};

describe('printTodayReplenishList / printWarehouseRequestList — stock-hold exclusion regression', () => {
  it('excludes a held, depleted med from the pick rows but lists it in the held section', async () => {
    const user = userEvent.setup();
    renderWithApp(<PrintTodayReplenishHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [HELD_REPL_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', []); // nothing in substock — the genuinely-can't-do-anything case

    const callsBefore = vi.mocked(printModule.printPickListSheet).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'print-today-replenish' }));
    await waitFor(() => expect(vi.mocked(printModule.printPickListSheet).mock.calls.length).toBeGreaterThan(callsBefore));
    const call = vi.mocked(printModule.printPickListSheet).mock.calls[callsBefore];
    const rows = call[0];
    const heldRows = call[6] as { name: string; reason: string }[] | undefined;
    expect(rows.find((r) => r.name === HELD_REPL_MED.name)).toBeUndefined();
    expect(heldRows?.find((r) => r.name === HELD_REPL_MED.name)?.reason).toBe('คลังปิดสิ้นปีงบ');
  });

  it('excludes a held med from the pick rows even with leftover substock it could otherwise transfer', async () => {
    // Regression guard for the user-reported follow-up bug: the first version of this fix only
    // excluded a held med when it had ZERO substock left (nothing to pick anyway) — one with
    // SOME leftover substock still slipped into the main pick rows as a normal "ต้องเติม" row.
    const user = userEvent.setup();
    renderWithApp(<PrintTodayReplenishHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [HELD_REPL_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [{ id: 'lot-held-repl', medId: HELD_REPL_MED.id, code: 'LOT-H', lotNo: 'H', qty: 200, exp: Date.now() + 300 * 86400000 }]);

    const callsBefore = vi.mocked(printModule.printPickListSheet).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'print-today-replenish' }));
    await waitFor(() => expect(vi.mocked(printModule.printPickListSheet).mock.calls.length).toBeGreaterThan(callsBefore));
    const call = vi.mocked(printModule.printPickListSheet).mock.calls[callsBefore];
    const rows = call[0];
    const heldRows = call[6] as { name: string; reason: string }[] | undefined;
    expect(rows.find((r) => r.name === HELD_REPL_MED.name)).toBeUndefined();
    expect(heldRows?.find((r) => r.name === HELD_REPL_MED.name)?.reason).toBe('คลังปิดสิ้นปีงบ');
  });

  it('excludes a held med from the warehouse-request rows but lists it in the held section', async () => {
    const user = userEvent.setup();
    renderWithApp(<PrintWarehouseRequestHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [HELD_REPL_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', []);

    const callsBefore = vi.mocked(printModule.printPickListSheet).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'print-warehouse-request' }));
    await waitFor(() => expect(vi.mocked(printModule.printPickListSheet).mock.calls.length).toBeGreaterThan(callsBefore));
    const call = vi.mocked(printModule.printPickListSheet).mock.calls[callsBefore];
    const rows = call[0];
    const heldRows = call[6] as { name: string; reason: string }[] | undefined;
    // Without the fix, this med (far below both parSub and parFloor) would land in `rows` like
    // any other under-par med, asking staff to re-request something already known unavailable.
    expect(rows.find((r) => r.name === HELD_REPL_MED.name)).toBeUndefined();
    expect(heldRows?.find((r) => r.name === HELD_REPL_MED.name)?.reason).toBe('คลังปิดสิ้นปีงบ');
  });
});

function FillHarness() {
  const { state, fillAll, fillUrgent } = useApp();
  return (
    <div>
      <button onClick={fillAll}>fill-all</button>
      <button onClick={fillUrgent}>fill-urgent</button>
      <div data-testid="cart-held">{state.cart[HELD_FILL_MED.id] ?? ''}</div>
      <div data-testid="cart-normal">{state.cart[NORMAL_FILL_MED.id] ?? ''}</div>
    </div>
  );
}

const NORMAL_FILL_MED = {
  id: 'm11', code: 'MED-0011', name: 'Omeprazole 20mg', unit: 'แคปซูล', dosageForm: 'แคปซูล',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floorMin: 50, floor: 5,
  bin: 'F11', noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0,
};
const HELD_FILL_MED = {
  id: 'm12', code: 'MED-0012', name: 'Ranitidine 150mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floorMin: 50, floor: 5,
  bin: 'G12', noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0,
  outOfStockSince: Date.now() - 86400000, outOfStockReason: 'จัดส่งล่าช้า',
};
const FILL_LOT_NORMAL = { id: 'lot-fn', medId: NORMAL_FILL_MED.id, code: 'LOT-FN', lotNo: 'FN', qty: 300, exp: Date.now() + 300 * 86400000 };
const FILL_LOT_HELD = { id: 'lot-fh', medId: HELD_FILL_MED.id, code: 'LOT-FH', lotNo: 'FH', qty: 300, exp: Date.now() + 300 * 86400000 };

describe('fillAll / fillUrgent — stock-hold exclusion regression', () => {
  it('fillAll queues a normal below-Min med but skips a held one, even with leftover substock', async () => {
    const user = userEvent.setup();
    renderWithApp(<FillHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [NORMAL_FILL_MED, HELD_FILL_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [FILL_LOT_NORMAL, FILL_LOT_HELD]);

    await user.click(screen.getByRole('button', { name: 'fill-all' }));
    await waitFor(() => expect(screen.getByTestId('cart-normal').textContent).not.toBe(''));
    expect(screen.getByTestId('cart-held').textContent).toBe('');
  });

  it('fillUrgent queues a normal urgent med but skips a held one, even with leftover substock', async () => {
    const user = userEvent.setup();
    // floor:5, floorMin:50 → well below half-of-Min (25), qualifies as urgent for both.
    renderWithApp(<FillHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [NORMAL_FILL_MED, HELD_FILL_MED]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [FILL_LOT_NORMAL, FILL_LOT_HELD]);

    await user.click(screen.getByRole('button', { name: 'fill-urgent' }));
    await waitFor(() => expect(screen.getByTestId('cart-normal').textContent).not.toBe(''));
    expect(screen.getByTestId('cart-held').textContent).toBe('');
  });
});
