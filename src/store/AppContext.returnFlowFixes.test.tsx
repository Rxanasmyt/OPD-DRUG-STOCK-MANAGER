// Regression tests for 2 bugs found auditing คืนยา (drug return) for "หน้างานจริง" use:
// the missing typo-safety-net on return quantity, and commitReturnCart's anonymous failure
// toast. (writeReturnBatch's live-read-vs-budget fix is already covered by the existing
// "writeReturnBatch — Firestore read-budget regression" tests in AppContext.commit.test.tsx,
// which assert zero Firestore reads AND the correct category/unitPrice on the written record —
// both still true after this fix, since category/unitPrice are now captured at add-to-cart time
// instead of re-read live at commit time.)
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { asMedId, type MedId } from '../types';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import {
  signInAs, fireCollection, hasListener, getLastTransactionWrites,
  failNextTransactionCommitWritingPathPrefix,
} from '../test-utils/firebaseTestDouble';

const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const MED2 = {
  id: asMedId('m2'), code: 'MED-0002', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 2, had: false, active: true, parSub: 500, parFloor: 100, floor: 20, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

// Same shape as AppContext.commit.test.tsx's own SingleReturnHarness, but with a configurable
// quantity (900 > Math.max(parFloor=100, 20) * 8 = 800, the implausible-quantity threshold).
function SingleReturnHarness({ hn, qty }: { hn: string; qty: string }) {
  const { state, pickAdjType, pickAdjMed, setAdjQty, setAdjReason, setAdjHn, commitSingleReturn } = useApp();
  useEffect(() => { if (!state.adjType) pickAdjType('return'); }, [state.adjType, pickAdjType]);
  useEffect(() => { if (state.adjType && !state.adjMed) pickAdjMed(MED.id); }, [state.adjType, state.adjMed, pickAdjMed]);
  useEffect(() => { if (state.adjMed && !state.adjQty) setAdjQty(qty); }, [state.adjMed, state.adjQty, setAdjQty, qty]);
  useEffect(() => { if (state.adjQty && !state.adjReason) setAdjReason('ผู้ป่วยคืนยา (ไม่เปิดซอง)'); }, [state.adjQty, state.adjReason, setAdjReason]);
  useEffect(() => { if (state.adjReason && !state.adjHn && hn) setAdjHn(hn); }, [state.adjReason, state.adjHn, setAdjHn, hn]);
  return <button onClick={commitSingleReturn}>commit-single-return</button>;
}

describe('commitSingleReturn — typo-safety-net regression', () => {
  it('asks for confirmation before returning an implausibly large quantity relative to par', async () => {
    const user = userEvent.setup();
    renderWithApp(<><SingleReturnHarness hn="1234567" qty="900" /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-single-return' })).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'commit-single-return' }));

    // Without the fix, this would commit immediately with zero confirmation — a typo'd "900"
    // instead of "90" silently adding unverified excess stock via increment().
    await screen.findByText(/มากผิดปกติเมื่อเทียบกับ par/);
    expect(getLastTransactionWrites().length).toBe(0);
  });
});

// Mirrors AppContext.commit.test.tsx's own ReturnCartHarness, with a configurable quantity.
function ReturnCartHarness({ hn, medIds, qty }: { hn: string; medIds: MedId[]; qty: string }) {
  const { state, pickAdjType, pickAdjMed, setAdjQty, setAdjReason, setAdjHn, addToReturnCart, commitReturnCart } = useApp();
  useEffect(() => { if (!state.adjType) pickAdjType('return'); }, [state.adjType, pickAdjType]);
  useEffect(() => { if (state.adjType && !state.adjHn && hn) setAdjHn(hn); }, [state.adjType, state.adjHn, setAdjHn, hn]);
  const nextMedId = medIds[state.returnCart.length];
  useEffect(() => { if (nextMedId && !state.adjMed) pickAdjMed(nextMedId); }, [nextMedId, state.adjMed, pickAdjMed]);
  useEffect(() => { if (state.adjMed && !state.adjQty) setAdjQty(qty); }, [state.adjMed, state.adjQty, setAdjQty, qty]);
  useEffect(() => { if (state.adjQty && !state.adjReason) setAdjReason('ผู้ป่วยคืนยา (ไม่เปิดซอง)'); }, [state.adjQty, state.adjReason, setAdjReason]);
  return (
    <>
      <button onClick={addToReturnCart}>add-to-cart</button>
      <button onClick={commitReturnCart}>commit-return-cart</button>
    </>
  );
}

describe('addToReturnCart — typo-safety-net regression', () => {
  it('asks for confirmation before adding an implausibly large return quantity to the cart', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReturnCartHarness hn="1234567" medIds={[MED.id]} qty="900" /><Toast /><ConfirmDialog /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    await waitFor(() => expect(screen.getByRole('button', { name: 'add-to-cart' })).toBeEnabled());

    await user.click(screen.getByRole('button', { name: 'add-to-cart' }));

    await screen.findByText(/มากผิดปกติเมื่อเทียบกับ par/);
    await user.click(await screen.findByRole('button', { name: 'ยกเลิก' }));
    // Cancelled — nothing should have been queued into the cart.
    await user.click(screen.getByRole('button', { name: 'commit-return-cart' }));
    expect(getLastTransactionWrites().length).toBe(0);
  });
});

describe('commitReturnCart — unexpected-failure toast names the cart\'s meds', () => {
  it('lists the cart meds instead of a fully anonymous toast when the shared transaction is rejected', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReturnCartHarness hn="1234567" medIds={[MED.id, MED2.id]} qty="7" /><Toast /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED, MED2]);

    await waitFor(() => expect(screen.getByRole('button', { name: 'add-to-cart' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'add-to-cart' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'add-to-cart' })).toBeEnabled());
    await user.click(screen.getByRole('button', { name: 'add-to-cart' }));

    failNextTransactionCommitWritingPathPrefix('meds/');

    await user.click(screen.getByRole('button', { name: 'commit-return-cart' }));

    await screen.findByText(
      'บันทึกไม่สำเร็จ (รายการ: ' + MED.name + ', ' + MED2.name + ') ลองใหม่อีกครั้ง (permission-denied)'
    );
  });
});
