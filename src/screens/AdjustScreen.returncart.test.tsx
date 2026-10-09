// Screen-level regression for the ตะกร้าคืนยา (return cart) flow — real-world request:
// "ผู้ป่วย HN 1 คนคืนยาหลายๆตัว...กรอกข้อมูลได้รวดเร็ว แต่ยังเก็บข้อมูลได้สมบูรณ์เหมือนเดิม".
// AppContext.commit.test.tsx already covers the write-side (one full DrugReturnRecord per drug,
// in a single atomic commit) — this file covers the on-screen UX: HN entered once up front,
// the med-search box gated behind it, each add showing up in a visible list with its own
// remove button, and HN surviving across adds (never retyped for the same patient's next drug).
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

async function openReturnTab() {
  const user = userEvent.setup();
  renderWithApp(<AdjustScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED, MED2]);
  await user.click(screen.getByRole('button', { name: /^คืนยา/ }));
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

describe('AdjustScreen — ตะกร้าคืนยา (return cart) regression', () => {
  it('hides the med-search box until HN ผู้ป่วย is filled', async () => {
    await openReturnTab();
    expect(screen.queryByPlaceholderText('ค้นหาชื่อยา')).not.toBeInTheDocument();
    const user = userEvent.setup();
    await user.type(screen.getByPlaceholderText('เช่น 1234567'), '1234567');
    expect(await screen.findByPlaceholderText('ค้นหาชื่อยา')).toBeInTheDocument();
  });

  it('adds two different drugs under one HN without ever re-typing it, listing both with their qty/reason', async () => {
    const user = await openReturnTab();
    await user.type(screen.getByPlaceholderText('เช่น 1234567'), '1234567');

    await addToCart(user, MED.name, '5');
    // HN still holds the same value — never cleared by the per-drug "เพิ่มลงตะกร้า" tap, unlike
    // the old single-item flow this replaced (which wiped HN after every commit).
    expect(screen.getByPlaceholderText('เช่น 1234567')).toHaveValue('1234567');
    await addToCart(user, MED2.name, '3');
    expect(screen.getByPlaceholderText('เช่น 1234567')).toHaveValue('1234567');

    expect(screen.getByText(MED.name)).toBeInTheDocument();
    expect(screen.getByText(MED2.name)).toBeInTheDocument();
    expect(screen.getByText(/5 เม็ด · ไม่ประสงค์รับยา/)).toBeInTheDocument();
    expect(screen.getByText(/3 เม็ด · ไม่ประสงค์รับยา/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'บันทึกรับคืนทั้งหมด (2 รายการ)' })).toBeEnabled();
  });

  it('removes one cart item without disturbing the other or the HN', async () => {
    const user = await openReturnTab();
    await user.type(screen.getByPlaceholderText('เช่น 1234567'), '1234567');
    await addToCart(user, MED.name, '5');
    await addToCart(user, MED2.name, '3');

    const removeButtons = screen.getAllByRole('button', { name: 'ลบ' });
    await user.click(removeButtons[0]);

    expect(screen.queryByText(MED.name)).not.toBeInTheDocument();
    expect(screen.getByText(MED2.name)).toBeInTheDocument();
    expect(screen.getByPlaceholderText('เช่น 1234567')).toHaveValue('1234567');
    expect(screen.getByRole('button', { name: 'บันทึกรับคืนทั้งหมด (1 รายการ)' })).toBeEnabled();
  });

  it('shows no final commit button at all while the cart is empty', async () => {
    await openReturnTab();
    expect(screen.queryByText(/บันทึกรับคืนทั้งหมด/)).not.toBeInTheDocument();
  });
});
