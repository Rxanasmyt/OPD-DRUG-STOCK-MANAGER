// Regression test for a real request: "พัฒนาในเรื่องการบันทึกข้อมูล ให้ดูสวยงามน่าใช้งานครับ" —
// the ตะกร้าคืนยา (return cart) used to show each item's qty/reason but never the มูลค่า
// (value) they add up to, even though every item already carries its own unitPrice (captured
// at add-time — see ReturnCartItem's own doc comment, types.ts). A header now shows the running
// item count + total value, reinforcing the "ประหยัดมูลค่า" framing this feature exists for
// right at the point of entry. Also locks in the friendlier HN-empty hint that replaced the
// blank gap that used to render before anything was typed.
import { describe, it, expect } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AdjustScreen from './AdjustScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const MED2 = {
  id: 'm2', code: 'MED-0002', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 2, had: false, active: true, parSub: 500, parFloor: 100, floor: 20, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

async function openReturnBatchTab() {
  const user = userEvent.setup();
  renderWithApp(<AdjustScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED, MED2]);
  await user.click(screen.getByRole('button', { name: /^คืนยา/ }));
  await user.click(screen.getByRole('button', { name: 'ทีละหลายตัว' }));
  return user;
}

async function addToCart(user: ReturnType<typeof userEvent.setup>, name: string, qty: string) {
  const search = await screen.findByPlaceholderText('ค้นหาชื่อยา');
  await user.clear(search);
  await user.type(search, name);
  await user.click(await screen.findByText(name));
  const qtyLabel = screen.getByText(/จำนวนที่คืน/).closest('label') as HTMLElement;
  await user.type(within(qtyLabel).getByRole('textbox'), qty);
  await user.click(screen.getByRole('button', { name: 'ไม่ประสงค์รับยา' }));
  await user.click(screen.getByRole('button', { name: '+ เพิ่มลงตะกร้า' }));
}

describe('AdjustScreen — ตะกร้าคืนยา มูลค่ารวม / HN-empty hint regression', () => {
  it('shows a friendly hint instead of a blank gap before HN is typed', async () => {
    await openReturnBatchTab();
    await screen.findByText('กรอก HN ผู้ป่วยก่อน');
  });

  it('hides the hint once HN is typed', async () => {
    const user = await openReturnBatchTab();
    await user.type(screen.getByPlaceholderText('เช่น 1234567'), '1234567');
    expect(screen.queryByText('กรอก HN ผู้ป่วยก่อน')).not.toBeInTheDocument();
  });

  it('shows the cart header with item count and running total value, updating as items are added/removed', async () => {
    const user = await openReturnBatchTab();
    await user.type(screen.getByPlaceholderText('เช่น 1234567'), '1234567');

    await addToCart(user, MED.name, '5'); // 5 × 1 บาท = 5
    await screen.findByText('🧺 ตะกร้าคืนยา');
    await screen.findByText('1 รายการ');
    // With exactly one item in the cart, the header's running total and that one item's own
    // value legitimately show the same number (5 บาท) — both the header total and the per-item
    // value badge, so there are two matches, not a false positive.
    await waitFor(() => expect(screen.getAllByText('5 บาท')).toHaveLength(2));

    await addToCart(user, MED2.name, '3'); // + 3 × 2 บาท = 6 → total 11 (unique — no single item costs 11)
    await screen.findByText('2 รายการ');
    await screen.findByText('11 บาท');

    const removeButtons = screen.getAllByRole('button', { name: 'ลบ' });
    await user.click(removeButtons[0]); // removes MED (5 บาท) — leaves MED2's 3 × 2 = 6 บาท
    await screen.findByText('1 รายการ');
    await waitFor(() => expect(screen.getAllByText('6 บาท')).toHaveLength(2));
  });
});
