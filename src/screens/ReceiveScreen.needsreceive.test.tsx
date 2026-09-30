// Regression tests for two real gaps found in the "ควรเบิกจากคลังใหญ่" default list:
// A) undercount: the header ("ควรเบิกจากคลังใหญ่ (N)") and the list itself used to read the
//    SAME N off the already-.slice(0, 20)'d array — with more than 20 qualifying meds, the
//    header silently showed only 20 with nothing hinting more existed.
// B) options (direct-search) block never showed the noSubstock branch the needsReceive block
//    already had — a noSubstock med found via search showed the misleading "substock 0 · par N"
//    instead of "ไม่มี substock · หน้างาน...". See ReceiveScreen.tsx's own bug-fix comments.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReceiveScreen from './ReceiveScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// 25 meds, all usesSubstock (noSubstock unset), sub qty 0 (no lots) well under parSub 500 — all
// qualify for "ควรเบิกจากคลังใหญ่", more than the 20-row display cap.
const MANY_NEEDS_RECEIVE_MEDS = Array.from({ length: 25 }, (_, i) => ({
  id: 'm' + i, code: 'MED-' + String(i).padStart(4, '0'), name: 'ยาทดสอบ ' + i, unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A' + i,
  used30: 0, usedPrev30: 0, volatility: 0,
}));

describe('ReceiveScreen — "ควรเบิกจากคลังใหญ่" undercount regression', () => {
  it('shows the TRUE total in the header, not the post-slice 20-cap, and discloses the cap', async () => {
    renderWithApp(<ReceiveScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', MANY_NEEDS_RECEIVE_MEDS);
    fireCollection('lots', []);
    fireCollection('pendingReceives', []);

    // Without the fix, this would read "(20)" — the length of the already-capped array.
    await screen.findByText('ควรเบิกจากคลังใหญ่ (25)');
    await screen.findByText('แสดง 20 จาก 25 รายการ — ค้นหาชื่อยาด้านบนเพื่อดูรายการอื่น');
  });

  it('shows no disclosure line when the qualifying count is at or under the cap', async () => {
    renderWithApp(<ReceiveScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', MANY_NEEDS_RECEIVE_MEDS.slice(0, 5));
    fireCollection('lots', []);
    fireCollection('pendingReceives', []);

    await screen.findByText('ควรเบิกจากคลังใหญ่ (5)');
    expect(screen.queryByText(/แสดง.*จาก.*รายการ/)).not.toBeInTheDocument();
  });
});

const NOSUB_MED = {
  id: 'mNoSub', code: 'MED-0099', name: 'Ventolin inhaler', unit: 'ขวด', dosageForm: 'พ่น',
  price: 100, had: false, active: true, noSubstock: true, parSub: 0, parFloor: 20, floor: 3, bin: 'B1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

describe('ReceiveScreen — search-result noSubstock-branch regression', () => {
  it('shows "ไม่มี substock · หน้างาน..." for a noSubstock med found via direct search, not "substock 0 · par 0"', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReceiveScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [NOSUB_MED]);
    fireCollection('lots', []);
    fireCollection('pendingReceives', []);

    await user.type(screen.getByPlaceholderText('ค้นหา / สแกนชื่อยา'), 'Ventolin');

    await screen.findByText(/ไม่มี substock/);
    expect(screen.queryByText(/substock 0 · par 0/)).not.toBeInTheDocument();
  });
});
