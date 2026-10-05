// Regression test for a real request: "ข้อมูลว่าจำนวนที่ชั้นวางยาตอนนี้สามารถอยู่ได้กี่วันก็มีความ
// สำคัญ เพื่อใช้ในการประเมินว่ายาควรได้รับการเติมหรือยัง" — the edit-med form (where Min/Max/par
// substock actually get set) now shows daysOfStockLeft() right above those fields, since that's
// exactly the decision it's meant to inform. See MedsScreen.tsx's own "Real-world request"
// comment on MedForm's currentDaysLeft prop.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import MedsScreen from './MedsScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// floor 10 + substock lot qty 50 = 60 on hand, used30 300 → dailyUsageRate ≈ 14/day → ~4 วัน.
const WITH_HISTORY = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1', binSub: 'S1',
  category: 'antimicrobial', route: 'oral' as const, used30: 300, usedPrev30: 0, volatility: 0,
};
const SUBSTOCK_LOT = { id: 'l1', code: 'LOT1', medId: 'm1', lotNo: 'L1', exp: Date.now() + 1e10, qty: 50, loc: 'S1' };
const NO_HISTORY = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A2', binSub: 'S2',
  category: 'antimicrobial', route: 'oral' as const, used30: 0, usedPrev30: 0, volatility: 0,
};

async function openEditForm(user: ReturnType<typeof userEvent.setup>, medName: string) {
  const row = (await screen.findByText(medName)).closest('div[style*="padding: 11px 13px"]') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: 'แก้ไขข้อมูล' }));
}

describe('MedsScreen — edit-form days-of-stock-left regression', () => {
  it('shows the real runway for a med with usage history', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [WITH_HISTORY]);
    fireCollection('lots', [SUBSTOCK_LOT]);

    await openEditForm(user, WITH_HISTORY.name);
    await screen.findByText(/เหลือใช้ ~4 วัน/);
  });

  it('shows "ยังไม่มีสถิติการใช้พอประเมิน" instead of a fabricated number for a med with no usage history', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [NO_HISTORY]);
    fireCollection('lots', []);

    await openEditForm(user, NO_HISTORY.name);
    await screen.findByText('ยังไม่มีสถิติการใช้พอประเมิน');
    expect(screen.queryByText(/เหลือใช้/)).not.toBeInTheDocument();
  });

  it('never shows a days-left line at all on the blank "เพิ่มยาใหม่" form', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);

    await user.click(await screen.findByRole('button', { name: '+ เพิ่มยาใหม่' }));
    await screen.findByText('บันทึก');
    expect(screen.queryByText(/เหลือใช้/)).not.toBeInTheDocument();
    expect(screen.queryByText('ยังไม่มีสถิติการใช้พอประเมิน')).not.toBeInTheDocument();
  });
});
