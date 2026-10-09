// Regression tests for a real-world request: "อยากให้ปรับเหตุผลการคืนมีให้เลือกตามนี้คือ
// ปรับเปลี่ยนการรักษา แพ้ยา/ผลข้างเคียงการรักษา Non-compliance ได้ยาเกินจากวันนัดรอบก่อน
// ไม่ประสงค์รับยา ยาตามอาการเหลือ ยาโรคเรื้อรังเหลือเยอะ อื่นๆมีให้ใส่ข้อความเองได้" — the fixed
// 3-chip คืนยา reason list was replaced with these 7 clinical reasons plus a synthetic "อื่นๆ"
// chip that reveals a free-text input. See AdjustScreen.tsx's own REASONS/customReasonOpen
// comments.
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

async function openReturnForMed() {
  const user = userEvent.setup();
  renderWithApp(<AdjustScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);

  await user.click(screen.getByRole('button', { name: /คืนยา/ }));
  // คืนยา gates the med-search box behind HN ผู้ป่วย — see "ตะกร้าคืนยา" (AdjustScreen.tsx's own
  // comment on this): HN is entered once per patient, before any drug is searched/added.
  await user.type(await screen.findByPlaceholderText('เช่น 1234567'), '0010643');
  const search = await screen.findByPlaceholderText('ค้นหาชื่อยา');
  await user.type(search, 'Paracetamol');
  await user.click(await screen.findByText(MED.name));
  return user;
}

describe('AdjustScreen — คืนยา reason chips regression', () => {
  it('shows the 7 new clinical return reasons, not the old generic 3-chip list', async () => {
    await openReturnForMed();
    for (const r of ['ปรับเปลี่ยนการรักษา', 'แพ้ยา/ผลข้างเคียงการรักษา', 'Non-compliance', 'ได้ยาเกินจากวันนัดรอบก่อน', 'ไม่ประสงค์รับยา', 'ยาตามอาการเหลือ', 'ยาโรคเรื้อรังเหลือเยอะ']) {
      expect(screen.getByRole('button', { name: r })).toBeInTheDocument();
    }
    expect(screen.queryByRole('button', { name: 'เหลือจากหน่วยงาน' })).not.toBeInTheDocument();
  });

  it('"อื่นๆ" reveals a free-text input, and the typed text itself becomes the saved reason', async () => {
    const user = await openReturnForMed();
    expect(screen.queryByPlaceholderText('ระบุเหตุผลการคืนยา')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'อื่นๆ' }));
    const customInput = await screen.findByPlaceholderText('ระบุเหตุผลการคืนยา');
    await user.type(customInput, 'ผู้ป่วยเสียชีวิต');
    expect(customInput).toHaveValue('ผู้ป่วยเสียชีวิต');

    // "บันทึกรับคืน" (ทีละตัว, the default mode) becomes enabled once a qty + the typed reason
    // are both filled — confirms the typed text really is wired into state.adjReason, not just
    // displayed. HN is already filled by openReturnForMed() (entered once per patient, before
    // any drug is picked — see that helper's own comment). The qty label wraps NumberStepper's
    // −/input/+ as a group (all three are "labelable" HTML elements), so getByLabelText alone
    // could grab a button instead of the actual input — narrow to the one real textbox inside
    // that specific label.
    const qtyLabel = screen.getByText('จำนวนที่คืน (จะเพิ่มเข้ายอด) (เม็ด)').closest('label') as HTMLElement;
    await user.type(within(qtyLabel).getByRole('textbox'), '5');
    await waitFor(() => expect(screen.getByRole('button', { name: 'บันทึกรับคืน' })).not.toBeDisabled());
  });

  it('picking a preset chip after "อื่นๆ" switches back off the free-text input', async () => {
    const user = await openReturnForMed();
    await user.click(screen.getByRole('button', { name: 'อื่นๆ' }));
    await screen.findByPlaceholderText('ระบุเหตุผลการคืนยา');

    await user.click(screen.getByRole('button', { name: 'ไม่ประสงค์รับยา' }));
    expect(screen.queryByPlaceholderText('ระบุเหตุผลการคืนยา')).not.toBeInTheDocument();
  });
});
