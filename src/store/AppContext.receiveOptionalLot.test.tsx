// Regression test for a real-world request: "ตอนนี้การรับยาจากคลังเข้า substock ไม่ต้องบังคับ
// ให้ใส่ Lot และวันหมดอายุ คืออาจจะใส่ในบางเคสที่เป็นยาใช้น้อย เนื่องจากตอนนี้ภาระหน้างานหนัก
// จึงต้องจัดสรรให้ใช้แอพได้สะดวกขึ้น หากในอนาคตคงที่แล้วค่อยใส่ lot และ exp แบบเต็มรูปแบบ" —
// addRecv() used to hard-block on a blank lotNo/recvExp ("กรอก lot, วันหมดอายุ และจำนวนให้ครบ
// ก่อนเพิ่มรายการ"); only the quantity actually received is required now. Covers both ends of the
// flow: the local addRecv() validation itself, and commitReceive's real Firestore write — which
// must leave lotNo/exp OUT of the new lot doc entirely (Firestore throws on a field explicitly
// written as `undefined`), not send them as empty string/placeholder values.
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { asMedId } from '../types';
import { renderWithApp } from '../test-utils/renderWithApp';
import {
  signInAs, fireCollection, hasListener, seedDoc, seedCollection, getLastTransactionWrites,
} from '../test-utils/firebaseTestDouble';

const MED = {
  id: asMedId('m1'), code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

// Same "wait for the effect that consumes the previous update" shape as AppContext.commit.test.tsx's
// own ReceiveHarness — deliberately skips setRecvLot/setRecvExp (the thing under test is that
// addRecv() no longer needs either before it'll queue the item).
function NoLotReceiveHarness() {
  const { state, pickRecvMed, setRecvQty, addRecv, commitReceive } = useApp();
  useEffect(() => { if (!state.recvMed && !state.recvItems.length) pickRecvMed(MED.id); }, [state.recvMed, state.recvItems.length, pickRecvMed]);
  useEffect(() => { if (state.recvMed && !state.recvQty) setRecvQty('10'); }, [state.recvMed, state.recvQty, setRecvQty]);
  useEffect(() => { if (state.recvQty && !state.recvItems.length) addRecv(); }, [state.recvQty, state.recvItems.length, addRecv]);
  return (
    <>
      <button disabled={!state.recvItems.length} onClick={commitReceive}>commit-receive</button>
      <div data-testid="recvItemCount">{state.recvItems.length}</div>
      {state.recvItems[0] && (
        <>
          <div data-testid="recvItemLotNo">{state.recvItems[0].lotNo === undefined ? 'UNDEFINED' : state.recvItems[0].lotNo}</div>
          <div data-testid="recvItemExp">{state.recvItems[0].exp === undefined ? 'UNDEFINED' : state.recvItems[0].exp}</div>
        </>
      )}
    </>
  );
}

describe('addRecv — optional lot/exp regression', () => {
  it('queues the item with just a quantity, leaving lotNo/exp undefined', async () => {
    renderWithApp(<NoLotReceiveHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    // Without the fix, addRecv() would toast "กรอก lot, วันหมดอายุ และจำนวนให้ครบก่อนเพิ่มรายการ"
    // and never queue anything — recvItemCount would stay stuck at 0 forever.
    await waitFor(() => expect(screen.getByTestId('recvItemCount').textContent).toBe('1'));
    expect(screen.getByTestId('recvItemLotNo').textContent).toBe('UNDEFINED');
    expect(screen.getByTestId('recvItemExp').textContent).toBe('UNDEFINED');
  });

  it('writes a new lot doc with lotNo/exp left out entirely, not as undefined/empty', async () => {
    const user = userEvent.setup();
    renderWithApp(<NoLotReceiveHarness />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', {});
    seedCollection('lots', []);
    await waitFor(() => expect(screen.getByRole('button', { name: 'commit-receive' })).not.toBeDisabled());

    await user.click(screen.getByRole('button', { name: 'commit-receive' }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));

    const lotWrite = getLastTransactionWrites().find((w) => w.kind === 'set' && w.path.startsWith('lots/'));
    expect(lotWrite).toBeTruthy();
    // The real bug this guards against: Firestore's JS SDK throws "Unsupported field value:
    // undefined" if a field is sent with that literal value — writing `lotNo: it.lotNo` (now
    // possibly undefined) without the conditional-spread fix would have crashed this commit for
    // real, not just produced a wrong doc shape.
    expect('lotNo' in (lotWrite?.data ?? {})).toBe(false);
    expect('exp' in (lotWrite?.data ?? {})).toBe(false);
    expect(lotWrite?.data.qty).toBe(10);
  });
});
