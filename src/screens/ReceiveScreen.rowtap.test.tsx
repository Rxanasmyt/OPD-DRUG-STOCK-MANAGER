// Regression test for a real request: "ให้ทุกหน้าที่แสดงชื่อยาจำนวนยา...หน้ารับยาเข้า substock...
// ให้สามารถดูบัตรสต็อคได้" — every med row on this screen used to be action-only (pick it to
// receive / remove it / approve/reject it), with zero way to peek at the drug's real substock
// history first. Two shapes need two different fixes (see ReceiveScreen.tsx's own comment):
// - "ควรเบิกจากคลังใหญ่" rows are themselves the primary pick action, so they get a small,
//   separate 📋 CardPeekButton instead of hijacking the whole row.
// - "รออนุมัติ" rows have no primary action of their own (only the nested approve/reject
//   buttons do), so the whole row is wired directly, same rowToCard/stopRowNav pattern as
//   HomeScreen's own rows.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceiveScreen from './ReceiveScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

function ScreenProbe() {
  const { state } = useApp();
  return <div data-testid="probe">{state.screen}:{state.substockFocusId ?? ''}</div>;
}

// usesSubstock (noSubstock unset) with sub qty (0, no lots) well under parSub 500 → lands in
// "ควรเบิกจากคลังใหญ่".
const NEEDS_RECEIVE_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const PENDING = {
  id: 'p1', recvNo: 'RN-1', medId: 'm1', name: NEEDS_RECEIVE_MED.name, unit: 'เม็ด',
  lotNo: 'LOT-1', exp: Date.now() + 365 * 86400000, qty: 100,
  requestedBy: 'ทดสอบ ภก.', requestedByUid: 'u1', ts: Date.now(), status: 'pending' as const,
};

describe('ReceiveScreen — row-tap-to-substock-card regression', () => {
  it('opens the บัตรสต็อก via the small 📋 button on a "ควรเบิกจากคลังใหญ่" row, without also picking the med for receiving', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReceiveScreen /><ScreenProbe /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [NEEDS_RECEIVE_MED]);
    fireCollection('lots', []);
    fireCollection('pendingReceives', []);

    await user.click(await screen.findByLabelText('ดูบัตรสต็อก ' + NEEDS_RECEIVE_MED.name));
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('substockcard:' + NEEDS_RECEIVE_MED.id));
    // Tapping the 📋 button must not ALSO have picked this med for receiving (recvSearch/
    // recvMed unaffected — the "เพิ่มรายการ" search box would show it as picked otherwise).
    expect(screen.queryByText('ยกเลิก')).not.toBeInTheDocument();
  });

  it('tapping the row itself picks the med for receiving (the row\'s own primary action still works)', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReceiveScreen /><ScreenProbe /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [NEEDS_RECEIVE_MED]);
    fireCollection('lots', []);
    fireCollection('pendingReceives', []);

    await user.click(await screen.findByText(NEEDS_RECEIVE_MED.name));
    // pickRecvMed sets recvSearch to the med's name and clears the "ควรเบิกจากคลังใหญ่" list
    // (it only shows while nothing is picked) — its disappearance proves the pick went through.
    await waitFor(() => expect(screen.queryByText('ควรเบิกจากคลังใหญ่ (1)')).not.toBeInTheDocument());
    expect(screen.getByTestId('probe')).not.toHaveTextContent('substockcard');
  });

  it('opens the บัตรสต็อก by tapping a "รออนุมัติ" row directly, without also triggering อนุมัติ/ปฏิเสธ', async () => {
    const user = userEvent.setup();
    renderWithApp(<><ReceiveScreen /><ScreenProbe /></>);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [NEEDS_RECEIVE_MED]);
    fireCollection('lots', []);
    fireCollection('pendingReceives', [PENDING]);

    // PENDING.name equals NEEDS_RECEIVE_MED.name, which ALSO still shows in "ควรเบิกจากคลังใหญ่"
    // (a pending request doesn't change that list's own filter) — the "รออนุมัติ" section renders
    // first in the DOM, so its row is the first match.
    const rows = await screen.findAllByText(PENDING.name);
    await user.click(rows[0]);
    await waitFor(() => expect(screen.getByTestId('probe')).toHaveTextContent('substockcard:' + NEEDS_RECEIVE_MED.id));
    // Still pending — a real อนุมัติ/ปฏิเสธ write would have shown a toast/removed the row.
    expect(screen.getByRole('button', { name: 'อนุมัติ' })).toBeInTheDocument();
  });
});
