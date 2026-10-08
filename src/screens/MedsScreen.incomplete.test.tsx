// Regression test for a real request: "จาก flow งาน คิดว่าควรพัฒนาอะไรอีกครับ...ทำ 1 ก่อนครับ" —
// a data-completeness diagnostic ("📋 ข้อมูลยังไม่ครบ") so an admin can find every med still
// missing its floor bin, substock bin (only for meds that have a substock stage), category, or
// route (ยากิน/ยาฉีด — added per a later real request: "อยากให้แจ้งที่ตัวยาเลย...เติมตรงนั้นได้เลย
// อย่างรวดเร็ว") without opening each med's edit form one by one. See MedsScreen.tsx's own
// missingFields() doc comment for exactly what counts (never packSize — no reliable "should have
// one" signal).
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
  category: 'antimicrobial', noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0, route: 'oral' as const,
};
// Missing floor bin AND category (route set, so it doesn't also show up as missing that).
const MISSING_BIN_MED = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 50, bin: '', binSub: 'S2',
  noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0, route: 'oral' as const,
};
// noSubstock — missing substock bin must NOT count against it (no substock stage to have one).
const NOSUBSTOCK_COMPLETE_MED = {
  id: 'm3', code: 'MED-0003', name: 'Ventolin inhaler', unit: 'ขวด', dosageForm: 'พ่น',
  price: 1, had: false, active: true, parSub: 0, parFloor: 20, floor: 10, bin: 'B3',
  category: 'respiratory', noSubstock: true, used30: 0, usedPrev30: 0, volatility: 0, route: 'other' as const,
};
// Everything else complete — missing ONLY route.
const MISSING_ROUTE_MED = {
  id: 'm4', code: 'MED-0004', name: 'Cefazolin 1g', unit: 'Vial', dosageForm: '',
  price: 1, had: false, active: true, parSub: 60, parFloor: 20, floor: 10, bin: 'C4', binSub: 'S4',
  category: 'antimicrobial', noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0,
};
// Disabled AND missing its floor bin/category — a disabled med is never getting restocked, so
// nobody's expected to go complete its data either. Must never count against (or show up under)
// the diagnostic, same as a fully-complete med.
const DISABLED_MISSING_MED = {
  id: 'm5', code: 'MED-0005', name: 'Metformin 500mg (เลิกใช้)', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: false, parSub: 500, parFloor: 100, floor: 50, bin: '', binSub: 'S5',
  noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0, route: 'oral' as const,
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

  it('flags a med missing ONLY route, and lets an admin fix it inline with a one-tap chip', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [COMPLETE_MED, MISSING_ROUTE_MED]);
    fireCollection('lots', []);

    const chip = await screen.findByRole('button', { name: /ข้อมูลยังไม่ครบ \(1\)/ });
    await user.click(chip);

    await screen.findByText(MISSING_ROUTE_MED.name);
    expect(screen.queryByText(COMPLETE_MED.name)).not.toBeInTheDocument();
    expect(screen.getByText(/ขาด: ประเภทการให้ยา/)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: '💉 ยาฉีด' }));
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.some((c) => (c[1] as unknown as Record<string, unknown>).route === 'injection')).toBe(true));
  });

  it('excludes disabled meds from both the diagnostic count and the filtered list, even though they are also missing data', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MISSING_BIN_MED, DISABLED_MISSING_MED]);
    fireCollection('lots', []);

    // The chip's own count must not include the disabled med — it was previously only kept out
    // of the count, not out of the list that tapping the chip actually shows.
    const chip = await screen.findByRole('button', { name: /ข้อมูลยังไม่ครบ \(1\)/ });
    await user.click(chip);

    await screen.findByText(MISSING_BIN_MED.name);
    expect(screen.queryByText(DISABLED_MISSING_MED.name)).not.toBeInTheDocument();
  });
});
