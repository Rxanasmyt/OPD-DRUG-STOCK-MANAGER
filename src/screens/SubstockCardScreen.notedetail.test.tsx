// Regression test for a real request: "ตอนนี้ในบัตรสต็อค หรือใบหน้างาน ยังไม่มีรายละเอียดบอกว่าที่
// บอกเพิ่มหรือลบคือเกิดจากอะไร เช่นตัดยอดเข้าหน้างาน รับยาจากคลังยาเข้า substock คืนยา นับสต็อค
// หน้างานใหม่แล้วคลาดเคลื่อนจากเดิม นับสต็อคsubstockใหม่แล้วคลาดเคลื่อนจากเดิม...ให้มีรายละเอียดที่
// ชัดเจนตรวจสอบย้อนหลังได้" — every row already carried this exact detail in its `note` (see
// commitCount/commitSubCount in AppContext.tsx), but the only place it ever surfaced was a row's
// `title` attribute, a hover-only tooltip a touchscreen never triggers. See SubstockCardScreen.tsx's
// own "Real-world request" comments on expandedRows/labelFor for the two-part fix: (1) tap a row to
// reveal its full type label + note as real, visible text, and (2) a "count" row's label itself now
// says WHICH stage was recounted (substock vs หน้างาน) instead of one flat generic wording, since a
// printed sheet or CSV row read outside this screen's own toggle had no other way to tell them apart.
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
const SUB_COUNT_NOTE = 'นับได้มากกว่าระบบ 10 เม็ด — ลงเป็น lot ปรับยอด ยังไม่ทราบวันหมดอายุจริง ควรแก้ไขเมื่อทราบ';
const FLOOR_COUNT_NOTE = 'นับได้น้อยกว่าระบบ 5 เม็ด — คาดว่าจ่ายผ่าน HOSxP แต่ยังไม่ reconcile';
const TXS = [
  // substock-side count (loc:'substock') — only ever shows on the substock ledger.
  { id: 't1', type: 'count', name: MED.name, medId: 'm1', ts: now - 2 * 86400000, qty: 10, by: 'ทดสอบ ภก.', note: SUB_COUNT_NOTE, loc: 'substock' },
  // floor-side count (loc:'floor') — only ever shows on the หน้างาน ledger.
  { id: 't2', type: 'count', name: MED.name, medId: 'm1', ts: now - 1 * 86400000, qty: -5, by: 'ทดสอบ ภก.', note: FLOOR_COUNT_NOTE, loc: 'floor' },
];

async function openCard() {
  const user = userEvent.setup();
  renderWithApp(<SubstockCardScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  fireCollection('lots', []);
  seedCollection('txs', TXS);

  await user.type(screen.getByPlaceholderText('ค้นหาชื่อยา'), 'Paracetamol');
  await user.click(await screen.findByText(MED.name));
  return user;
}

describe('SubstockCardScreen — count-row wording regression', () => {
  it('labels a substock-side recount distinctly from a หน้างาน-side one', async () => {
    await openCard();
    await screen.findByText('บัตรคุมสต็อกยา');
    await screen.findByTitle(/^นับสต็อก substock ใหม่ \(ปรับยอด\) — นับได้มากกว่าระบบ/);
    // The floor-side row (different wording) must never show up while viewing substock.
    expect(screen.queryByTitle(/นับสต็อกหน้างานใหม่/)).not.toBeInTheDocument();
  });

  it('switching to หน้างาน shows the distinct floor-side recount wording instead', async () => {
    const user = await openCard();
    await user.click(screen.getByRole('button', { name: 'หน้างาน' }));
    await screen.findByText('บัตรคุมยา (มุมมองหน้างาน)');
    await screen.findByTitle(/^นับสต็อกหน้างานใหม่ \(ปรับยอด\) — นับได้น้อยกว่าระบบ/);
    expect(screen.queryByTitle(/นับสต็อก substock ใหม่/)).not.toBeInTheDocument();
  });
});

describe('SubstockCardScreen — tap-to-reveal note detail regression', () => {
  it('keeps the note hidden as plain text until the row is tapped, then shows it, then hides it again on a second tap', async () => {
    const user = await openCard();
    const row = await screen.findByTitle(/^นับสต็อก substock ใหม่/);

    expect(screen.queryByText(/นับได้มากกว่าระบบ 10 เม็ด/)).not.toBeInTheDocument();

    await user.click(row);
    await screen.findByText(/นับสต็อก substock ใหม่ \(ปรับยอด\) — นับได้มากกว่าระบบ 10 เม็ด/);

    await user.click(row);
    await waitFor(() => expect(screen.queryByText(/นับได้มากกว่าระบบ 10 เม็ด/)).not.toBeInTheDocument());
  });
});
