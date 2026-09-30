// Regression test for a real bug found by audit: "ตรวจสอบข้อมูลการตัดยอดการบันทึกจำนวน การแสดง
// ข้อมูลตัวเลขให้เห็นชัดเจนถูกต้อง realtime" — the live-balance card's "N% ของ par" label used to
// divide by Math.max(1, par), which only guards the divide-by-zero crash, not a misleading
// RESULT: a med with no par configured (a real, common state) silently divided by 1 instead of a
// real par, so e.g. 50 units on hand with par 0 showed "5000% ของ par" in bold right next to the
// one number this screen exists to show clearly. See SubstockCardScreen.tsx's own "Bug fix
// (misleading number)" comment.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SubstockCardScreen from './SubstockCardScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const NO_PAR_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 0, parFloor: 100, floor: 10, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const CONFIGURED_PAR_MED = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 100, parFloor: 100, floor: 10, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

async function openCard(name: string) {
  const user = userEvent.setup();
  renderWithApp(<SubstockCardScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [NO_PAR_MED, CONFIGURED_PAR_MED]);
  fireCollection('lots', [
    { id: 'l1', medId: 'm1', qty: 50, lotNo: 'L1', exp: Date.now() + 365 * 86400000 },
    { id: 'l2', medId: 'm2', qty: 50, lotNo: 'L2', exp: Date.now() + 365 * 86400000 },
  ]);
  fireCollection('txs', []);

  await user.type(screen.getByPlaceholderText('ค้นหาชื่อยา'), name);
  await user.click(await screen.findByText(name));
  return user;
}

describe('SubstockCardScreen — balance-percentage-of-par regression', () => {
  it('shows "ยังไม่ตั้ง par" instead of a misleading percentage when par is unconfigured', async () => {
    await openCard(NO_PAR_MED.name);
    // Without the fix, this would show "5000% ของ par" (50 units / Math.max(1, 0) * 100).
    await screen.findByText('ยังไม่ตั้ง par');
    expect(screen.queryByText(/% ของ par/)).not.toBeInTheDocument();
  });

  it('shows a real percentage of par for a med with par configured', async () => {
    await openCard(CONFIGURED_PAR_MED.name);
    // 50 units / par 100 * 100 = 50%.
    await screen.findByText('50% ของ par');
    expect(screen.queryByText('ยังไม่ตั้ง par')).not.toBeInTheDocument();
  });
});
