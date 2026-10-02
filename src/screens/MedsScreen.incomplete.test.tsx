// Regression test for a real request: "จาก flow งาน คิดว่าควรพัฒนาอะไรอีกครับ...ทำ 1 ก่อนครับ" —
// a data-completeness diagnostic ("📋 ข้อมูลยังไม่ครบ") so an admin can find every med still
// missing its floor bin, substock bin (only for meds that have a substock stage), or category
// without opening each med's edit form one by one. See MedsScreen.tsx's own missingFields() doc
// comment for exactly what counts (never packSize — no reliable "should have one" signal).
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { updateDoc } from 'firebase/firestore';
import MedsScreen from './MedsScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// Fully complete — must never show up under the diagnostic.
const COMPLETE_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 50, bin: 'A1', binSub: 'S1',
  category: 'antimicrobial', noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0,
};
// Missing floor bin AND category.
const MISSING_BIN_MED = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 50, bin: '', binSub: 'S2',
  noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0,
};
// noSubstock — missing substock bin must NOT count against it (no substock stage to have one).
const NOSUBSTOCK_COMPLETE_MED = {
  id: 'm3', code: 'MED-0003', name: 'Ventolin inhaler', unit: 'ขวด', dosageForm: 'พ่น',
  price: 1, had: false, active: true, parSub: 0, parFloor: 20, floor: 10, bin: 'B3',
  category: 'respiratory', noSubstock: true, used30: 0, usedPrev30: 0, volatility: 0,
};

describe('MedsScreen — data-completeness diagnostic regression', () => {
  it('counts a med missing its floor bin/category, excludes a complete one, and never counts a missing substock bin against a noSubstock med', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [COMPLETE_MED, MISSING_BIN_MED, NOSUBSTOCK_COMPLETE_MED]);
    fireCollection('lots', []);

    const chip = await screen.findByRole('button', { name: /ข้อมูลยังไม่ครบ \(1\)/ });
    await user.click(chip);

    await screen.findByText(MISSING_BIN_MED.name);
    expect(screen.queryByText(COMPLETE_MED.name)).not.toBeInTheDocument();
    expect(screen.queryByText(NOSUBSTOCK_COMPLETE_MED.name)).not.toBeInTheDocument();
    // Shows exactly what's missing, not just a bare count.
    expect(screen.getByText(/ขาด: ชั้นหน้างาน · หมวดกลุ่มยา/)).toBeInTheDocument();
  });

  it('lets an admin fix a missing floor bin and category inline, without opening the full edit form', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MISSING_BIN_MED]);
    fireCollection('lots', []);

    await user.click(await screen.findByRole('button', { name: /ข้อมูลยังไม่ครบ \(1\)/ }));
    await screen.findByText(MISSING_BIN_MED.name);

    // The full "แก้ไขข้อมูล" form must never have been opened for this to work.
    expect(screen.queryByText('บันทึกการแก้ไข')).not.toBeInTheDocument();

    const binInput = screen.getByPlaceholderText('เช่น A1 หรือ ตู้ยา-1');
    await user.type(binInput, 'C9');
    // setMedBin debounces its write 500ms — wait past that for the real Firestore call.
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.some((c) => (c[1] as unknown as Record<string, unknown>).bin === 'C9')).toBe(true), { timeout: 2000 });

    const categorySelect = screen.getByDisplayValue('— ยังไม่ระบุหมวด —');
    await user.selectOptions(categorySelect, 'antimicrobial');
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.some((c) => (c[1] as unknown as Record<string, unknown>).category === 'antimicrobial')).toBe(true));
  });
});
