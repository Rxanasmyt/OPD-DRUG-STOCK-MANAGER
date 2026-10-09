// Regression for the follow-up real-world request: "อยากให้เลือกคืนยาได้ทั้งแบบทีละตัวยา หรือ
// ทีละหลายๆตัวยา" — คืนยา now offers an explicit "ทีละตัว"/"ทีละหลายตัว" toggle. ทีละตัว
// (single, the default) commits one drug directly with its own "บันทึกรับคืน" button and no
// cart involved at all; ทีละหลายตัว (batch) is the ตะกร้าคืนยา flow AdjustScreen.returncart.
// test.tsx already covers. This file locks in the toggle itself and the ทีละตัว direct-commit
// path (AppContext.commit.test.tsx covers commitSingleReturn's write-side behavior).
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

async function openReturnTab() {
  const user = userEvent.setup();
  renderWithApp(<AdjustScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  await user.click(screen.getByRole('button', { name: /^คืนยา/ }));
  return user;
}

describe('AdjustScreen — คืนยา ทีละตัว/ทีละหลายตัว mode toggle regression', () => {
  it('defaults to ทีละตัว, with no cart UI showing at all', async () => {
    await openReturnTab();
    expect(screen.getByRole('button', { name: 'ทีละตัว' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'ทีละหลายตัว' })).toBeInTheDocument();
    expect(screen.queryByText(/เพิ่มลงตะกร้า/)).not.toBeInTheDocument();
    expect(screen.queryByText(/บันทึกรับคืนทั้งหมด/)).not.toBeInTheDocument();
  });

  it('ทีละตัว: commits one drug directly via "บันทึกรับคืน", then resets HN for a fresh patient', async () => {
    const user = await openReturnTab();
    await user.type(screen.getByPlaceholderText('เช่น 1234567'), '1234567');
    const search = await screen.findByPlaceholderText('ค้นหาชื่อยา');
    await user.type(search, MED.name);
    await user.click(await screen.findByText(MED.name));

    const qtyLabel = screen.getByText(/จำนวนที่คืน/).closest('label') as HTMLElement;
    await user.type(within(qtyLabel).getByRole('textbox'), '5');
    await user.click(screen.getByRole('button', { name: 'ไม่ประสงค์รับยา' }));

    const submit = screen.getByRole('button', { name: 'บันทึกรับคืน' });
    expect(submit).toBeEnabled();
    await user.click(submit);

    // Unlike ทีละหลายตัว's "+ เพิ่มลงตะกร้า" (which keeps HN for the same patient's next drug),
    // a ทีละตัว commit is a complete standalone action — HN clears for the next (likely
    // different) patient, same as the med-search box does.
    await waitFor(() => expect(screen.getByPlaceholderText('เช่น 1234567')).toHaveValue(''));
    expect(screen.queryByPlaceholderText('ค้นหาชื่อยา')).not.toBeInTheDocument();
  });

  it('switching to ทีละหลายตัว reveals the "+ เพิ่มลงตะกร้า" flow instead of a direct commit button', async () => {
    const user = await openReturnTab();
    await user.click(screen.getByRole('button', { name: 'ทีละหลายตัว' }));
    await user.type(screen.getByPlaceholderText('เช่น 1234567'), '1234567');
    const search = await screen.findByPlaceholderText('ค้นหาชื่อยา');
    await user.type(search, MED.name);
    await user.click(await screen.findByText(MED.name));

    expect(screen.queryByRole('button', { name: 'บันทึกรับคืน' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+ เพิ่มลงตะกร้า' })).toBeInTheDocument();
  });
});
