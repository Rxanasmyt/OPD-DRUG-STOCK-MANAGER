// Regression tests for a diagnosability gap found auditing "เติมยาหน้างานไม่ได้"/"เบิกยาจากคลังเข้า
// substock ไม่ได้" reports: commitTransfer and commitReceive's own unexpected-failure toasts used
// to be fully anonymous ("เติมหน้างานไม่สำเร็จ ลองใหม่อีกครั้ง (permission-denied)" / "บันทึกใบรับ
// ไม่สำเร็จ ลองใหม่อีกครั้ง (permission-denied)"), with zero indication of which med/lot was
// involved — the exact same class of gap commitReconcile suffered through 3 real production
// incidents before failedMedName/failedDebug were added (v3.236.0/v3.238.0). Ward tablets have no
// DevTools console (see toastErr's own doc comment), so this was the only diagnostic signal that
// would otherwise exist at all on a real unexplained failure.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { asMedId } from '../types';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import {
  signInAs, fireCollection, hasListener, seedDoc, seedCollection,
  failNextTransactionCommitWritingPathPrefix,
} from '../test-utils/firebaseTestDouble';

const MED_A = {
  id: asMedId('m1'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function TransferHarness() {
  const { sub, setCartQty, commitTransfer } = useApp();
  const qty = sub(MED_A.id);
  useEffect(() => { if (qty > 0) setCartQty(MED_A.id, '5'); }, [setCartQty, qty]);
  return <button onClick={commitTransfer}>confirm-transfer</button>;
}

describe('commitTransfer — unexpected-failure toast names the cart\'s meds', () => {
  it('lists the cart meds instead of a fully anonymous toast when the shared transaction is rejected', async () => {
    const user = userEvent.setup();
    renderWithApp(<><TransferHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED_A]);
    await waitFor(() => expect(hasListener('lots')).toBe(true));
    fireCollection('lots', [{ id: 'lotA', medId: MED_A.id, qty: 10, lotNo: 'L1', exp: Date.now() + 86400000 }]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'confirm-transfer' })).toBeInTheDocument());

    seedDoc('meds/m1', { floor: MED_A.floor });
    seedCollection('lots', [{ id: 'lotA', medId: MED_A.id, qty: 10, exp: Date.now() + 86400000 }]);
    seedDoc('lots/lotA', { qty: 10, lotNo: 'L1', exp: Date.now() + 86400000 });
    seedCollection('floorLots', []);

    // Rejects the whole shared transaction for a reason that isn't missing-med/insufficient
    // (the two cases that already have their own specific toasts) — the exact scenario the old
    // flat fallback gave zero information about.
    failNextTransactionCommitWritingPathPrefix('meds/');

    await user.click(screen.getByRole('button', { name: 'confirm-transfer' }));

    await screen.findByText('เติมหน้างานไม่สำเร็จ (รายการ: ' + MED_A.name + ') ลองใหม่อีกครั้ง (permission-denied)');
  });
});

function ReceiveTwoMedsHarness() {
  const { state, pickRecvMed, setRecvQty, setRecvLot, addRecv, commitReceive } = useApp();
  return (
    <>
      <button onClick={() => pickRecvMed(asMedId('m1'))}>pick-m1</button>
      <button onClick={() => pickRecvMed(asMedId('m2'))}>pick-m2</button>
      <button onClick={() => setRecvLot('LOT-A')}>set-lot-a</button>
      <button onClick={() => setRecvLot('LOT-B')}>set-lot-b</button>
      <button onClick={() => setRecvQty('10')}>set-qty</button>
      <button onClick={() => addRecv()}>add-item</button>
      <button disabled={!state.recvItems.length} onClick={commitReceive}>commit-receive</button>
      <div data-testid="recvItemCount">{state.recvItems.length}</div>
      <div data-testid="medsCount">{state.meds.length}</div>
    </>
  );
}

describe('commitReceive — unexpected-failure toast names the failing med', () => {
  it('names which med\'s group transaction was rejected instead of a fully anonymous toast', async () => {
    const user = userEvent.setup();
    const medA = { ...MED_A, id: asMedId('m1'), code: 'MED-0001', name: 'ยาทดสอบ A' };
    const medB = { ...MED_A, id: asMedId('m2'), code: 'MED-0002', name: 'ยาทดสอบ B' };
    renderWithApp(<><ReceiveTwoMedsHarness /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [medA, medB]);
    await waitFor(() => expect(screen.getByTestId('medsCount').textContent).toBe('2'));
    seedDoc('meds/m1', {});
    seedDoc('meds/m2', {});
    // Distinct lotNo per med — this test double's query()/where() are no-ops (getDocs returns
    // every row in the collection unfiltered; see its own comment), so the existing-lot lookup
    // inside commitReceive (which matches on lotNo+exp, trusting Firestore's real server-side
    // medId filter) needs a real discriminator here or it'd pick whichever lot sorts first
    // regardless of medId, same risk as any other test seeding more than one med's lots at once.
    seedDoc('lots/lot-m1', { medId: 'm1', qty: 5, lotNo: 'LOT-A' });
    seedDoc('lots/lot-m2', { medId: 'm2', qty: 5, lotNo: 'LOT-B' });
    seedCollection('lots', [
      { id: 'lot-m1', medId: 'm1', qty: 5, lotNo: 'LOT-A' },
      { id: 'lot-m2', medId: 'm2', qty: 5, lotNo: 'LOT-B' },
    ]);

    await user.click(screen.getByRole('button', { name: 'pick-m1' }));
    await user.click(screen.getByRole('button', { name: 'set-lot-a' }));
    await user.click(screen.getByRole('button', { name: 'set-qty' }));
    await user.click(screen.getByRole('button', { name: 'add-item' }));
    await waitFor(() => expect(screen.getByTestId('recvItemCount').textContent).toBe('1'));
    await user.click(screen.getByRole('button', { name: 'pick-m2' }));
    await user.click(screen.getByRole('button', { name: 'set-lot-b' }));
    await user.click(screen.getByRole('button', { name: 'set-qty' }));
    await user.click(screen.getByRole('button', { name: 'add-item' }));
    await waitFor(() => expect(screen.getByTestId('recvItemCount').textContent).toBe('2'));
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-receive' })).not.toBeDisabled());

    // Each med now commits as its own separate transaction (see the per-group transaction
    // budget regression above) — reject only the one writing lot-m2, so the toast must name
    // medB specifically, not medA (which committed fine) or nothing at all.
    failNextTransactionCommitWritingPathPrefix('lots/lot-m2');

    await user.click(screen.getByRole('button', { name: 'commit-receive' }));

    // Which of medA/medB's two concurrent per-group transactions happens to settle first isn't
    // what's under test here (that's the pre-existing "partial progress" behavior) — only that
    // the toast names medB specifically (the one actually rejected), not a fully anonymous
    // fallback and not medA (which never failed).
    await screen.findByText(new RegExp('บันทึกใบรับไม่สำเร็จ \\(ยา: ' + medB.name + '\\).*permission-denied'));
  });
});
