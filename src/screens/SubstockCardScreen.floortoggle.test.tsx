// Regression test for a real request: "ยาหน้างาน ไม่มีประวัติว่าแต่ละวันถูกตัดยอดไปเท่าไร คงเหลือ
// เท่าไร ประวัติของการรับยาจาก substock ว่ารับมากี่กล่อง จำนวนกี่เม็ด" — a med with a substock
// stage used to only ever show its substock ledger on this screen; fetchFloorLedger already
// existed and worked correctly, it just was never wired up as a toggle for one. See
// SubstockCardScreen.tsx's own "Real-world request" comments on viewSide/canToggle/switchSide
// and the ledger table's box-breakdown line.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubstockCardScreen from './SubstockCardScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

// packSize 10 → the transfer_to_floor row below (qty 25) splits into 2x10+5 (boxBreakdownLabel's
// compact format — see the "1x60" box-primary-entry convention now shared across the whole app).
const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 25, bin: 'A1', packSize: 10,
  used30: 0, usedPrev30: 0, volatility: 0,
};
const now = Date.now();
const TXS = [
  { id: 't1', type: 'receive_from_central', name: MED.name, medId: 'm1', ts: now - 20 * 86400000, qty: 100, by: 'ทดสอบ ภก.', to: 'substock' },
  { id: 't2', type: 'transfer_to_floor', name: MED.name, medId: 'm1', ts: now - 10 * 86400000, qty: 25, by: 'ทดสอบ ภก.', note: 'FEFO lot L1 (25)' },
  // Floor-only type — must appear on the หน้างาน side but never on substock.
  { id: 't3', type: 'adjust', name: MED.name, medId: 'm1', ts: now - 5 * 86400000, qty: -5, by: 'ทดสอบ ภก.', note: 'ปรับยอด' },
];

async function openCard() {
  const user = userEvent.setup();
  renderWithApp(<SubstockCardScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  fireCollection('lots', []);
  seedCollection('txs', TXS);

  await user.type(screen.getByPlaceholderText('ค้นหาชื่อยา'), 'Amoxicillin');
  await user.click(await screen.findByText(MED.name));
  return user;
}

describe('SubstockCardScreen — floor-ledger toggle regression', () => {
  it('defaults to substock, and switching to หน้างาน shows the adjust row that never appears on substock', async () => {
    const user = await openCard();
    await screen.findByText('บัตรคุมสต็อกยา');
    // adjust is floor-only — must not show up while viewing substock.
    expect(screen.queryByTitle(/ปรับยอด — ปรับยอด/)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'หน้างาน' }));

    await screen.findByText('บัตรคุมยา (มุมมองหน้างาน)');
    await screen.findByTitle(/ปรับยอด — ปรับยอด/);
  });

  it('shows the exact box+loose split on the transfer_to_floor row for a box-only med', async () => {
    await openCard();
    // Substock side (default): transfer_to_floor is a DISPENSE (จ่าย column).
    await screen.findByText('2x10+5');
  });

  it('switching back to substock restores the original substock-only ledger', async () => {
    const user = await openCard();
    await user.click(screen.getByRole('button', { name: 'หน้างาน' }));
    await screen.findByText('บัตรคุมยา (มุมมองหน้างาน)');

    await user.click(screen.getByRole('button', { name: 'substock' }));

    await screen.findByText('บัตรคุมสต็อกยา');
    expect(screen.queryByTitle(/ปรับยอด — ปรับยอด/)).not.toBeInTheDocument();
  });
});
