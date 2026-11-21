// A cancellation (ยกเลิกเติมหน้างาน/รับเข้า/การนับ) is logged as a 'count' row; the card must label it as a reversal,
// never as "นับสต็อกใหม่" — otherwise a cancelled transfer reads like a recount in the stock history.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubstockCardScreen from './SubstockCardScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = { id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 50, bin: 'A1', used30: 0, usedPrev30: 0, volatility: 0 };
const now = Date.now();
const TXS = [
  { id: 'c1', type: 'count', name: MED.name, medId: 'm1', ts: now - 3600000, qty: 60, by: 'ทดสอบ ภก.', note: '#tr1 · ยกเลิกเติมหน้างาน คืน substock 60 เม็ด', loc: 'substock', reason: '↩ ยกเลิกรายการคืน · เติมหน้างาน' },
  { id: 'c2', type: 'count', name: MED.name, medId: 'm1', ts: now - 7200000, qty: 5, by: 'ทดสอบ ภก.', note: 'นับได้มากกว่าระบบ 5 เม็ด', loc: 'substock' },
];

describe('SubstockCardScreen — reversal rows', () => {
  it('labels a cancel as ยกเลิกรายการ, and a real recount still as นับสต็อกใหม่', async () => {
    const user = userEvent.setup();
    renderWithApp(<SubstockCardScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);
    seedCollection('txs', TXS);
    await user.type(screen.getByPlaceholderText('ค้นหาชื่อยา'), 'Paracetamol');
    await user.click(await screen.findByText(MED.name));
    await screen.findByText(/ยกเลิกรายการ \(ย้อนยอด\) — #tr1 · ยกเลิกเติมหน้างาน/);
    await screen.findByText(/นับสต็อก substock ใหม่ \(ปรับยอด\) — นับได้มากกว่าระบบ 5/);
  });
});
