// Regression test for a real request: "อยากให้ข้อมูลแต่ละประเภทแถบสีคนละสีเพื่อแยกให้ชัดเจน" —
// each ledger row now carries a left accent bar + icon chip background keyed to its type (see
// TYPE_META's own "Real-world request" comment, SubstockCardScreen.tsx), on top of the always-
// visible note line (SubstockCardScreen.notedetail.test.tsx). Locks in that two different types
// actually get two different colors, not a single color applied everywhere by accident.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import SubstockCardScreen from './SubstockCardScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';
import userEvent from '@testing-library/user-event';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 50, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const now = Date.now();
const TXS = [
  { id: 't1', type: 'receive_from_central', name: MED.name, medId: 'm1', ts: now - 2 * 86400000, qty: 100, by: 'ทดสอบ ภก.', note: '', loc: 'substock' },
  { id: 't2', type: 'transfer_to_floor', name: MED.name, medId: 'm1', ts: now - 1 * 86400000, qty: -20, by: 'ทดสอบ ภก.', note: '', loc: 'substock' },
];

describe('SubstockCardScreen — per-type row color regression', () => {
  it('gives รับจากคลังใหญ่ and เติมหน้างาน rows two visibly different accent colors', async () => {
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

    // Both the legend (same text, different purpose) and the ledger row's own note line show
    // this exact label — the note line is the <td> (the legend uses a <span>).
    await waitFor(() => expect(screen.getAllByText('รับจากคลังใหญ่').length).toBeGreaterThan(1));
    const receiveNote = screen.getAllByText('รับจากคลังใหญ่').find((el) => el.tagName === 'TD')!;
    const transferNote = screen.getAllByText('เติมหน้างาน').find((el) => el.tagName === 'TD')!;

    const receiveColor = (receiveNote as HTMLElement).style.borderLeft;
    const transferColor = (transferNote as HTMLElement).style.borderLeft;
    expect(receiveColor).toContain('var(--tx-receive)');
    expect(transferColor).toContain('var(--green)');
    expect(receiveColor).not.toBe(transferColor);
  });
});
