// Regression test for an audit finding: the expandable ledger row (tap to reveal a note — see
// SubstockCardScreen.notedetail.test.tsx) was a plain `<tr onClick>` with no role, no tabIndex,
// and no keydown handling — a keyboard-only user (or anyone using a screen reader, since a bare
// <tr onClick> exposes no accessible role at all) had no way to reach it. See
// SubstockCardScreen.tsx's own "Bug fix (audit finding — keyboard accessibility)" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubstockCardScreen from './SubstockCardScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 50, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const now = Date.now();
const NOTE = 'นับได้มากกว่าระบบ 10 เม็ด — ลงเป็น lot ปรับยอด ยังไม่ทราบวันหมดอายุจริง ควรแก้ไขเมื่อทราบ';
const TXS = [
  { id: 't1', type: 'count', name: MED.name, medId: 'm1', ts: now - 2 * 86400000, qty: 10, by: 'ทดสอบ ภก.', note: NOTE, loc: 'substock' },
];

describe('SubstockCardScreen — ledger row keyboard accessibility regression', () => {
  it('exposes a note-bearing row as a focusable button that Enter/Space can toggle', async () => {
    const user = userEvent.setup();
    renderWithApp(<SubstockCardScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);
    seedCollection('txs', TXS);

    await user.type(screen.getByPlaceholderText('ค้นหาชื่อยา'), 'Paracetamol');
    await user.click(await screen.findByText(MED.name));
    await screen.findByText('บัตรคุมสต็อกยา');

    const row = await screen.findByTitle(/^นับสต็อก substock ใหม่/);
    expect(row.getAttribute('role')).toBe('button');
    expect(row.tabIndex).toBe(0);
    expect(row.getAttribute('aria-expanded')).toBe('false');

    row.focus();
    await user.keyboard('{Enter}');
    await screen.findByText(/นับสต็อก substock ใหม่ \(ปรับยอด\) — นับได้มากกว่าระบบ 10 เม็ด/);
    expect(row.getAttribute('aria-expanded')).toBe('true');

    await user.keyboard(' ');
    await waitFor(() => expect(screen.queryByText(/นับได้มากกว่าระบบ 10 เม็ด/)).not.toBeInTheDocument());
    expect(row.getAttribute('aria-expanded')).toBe('false');
  });
});
