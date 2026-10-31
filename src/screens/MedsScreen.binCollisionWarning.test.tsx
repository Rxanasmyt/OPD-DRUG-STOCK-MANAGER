// Regression test for a real patient-safety bug found auditing the med add/edit form for
// "หน้างานจริง" use: addMed/updateMedFull both confirm-block before saving a bin code already
// used by another active med ("ใช้ซ้ำเสี่ยงหยิบยาผิดตัวตอนนับ/เบิก"), but setMedBin — the debounced
// quick-edit path used by MedsScreen's "ข้อมูลยังไม่ครบ" row (and the OPD/IPD sibling-bin editor)
// — never got that same check, silently saving a real shelf-code collision with zero warning.
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { updateDoc } from 'firebase/firestore';
import MedsScreen from './MedsScreen';
import Toast from '../components/Toast';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const EXISTING_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 50, bin: 'C9', binSub: 'S1',
  category: 'antimicrobial', noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0, route: 'oral' as const,
};
// Missing its floor bin — shows up in the "ข้อมูลยังไม่ครบ" quick-fix row this bug came from.
// Same shape as MedsScreen.incomplete.test.tsx's own MISSING_BIN_MED (deliberately reused as-is).
const MISSING_BIN_MED = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 50, bin: '', binSub: 'S2',
  noSubstock: false, used30: 0, usedPrev30: 0, volatility: 0, route: 'oral' as const,
};

describe('setMedBin — bin-collision warning regression', () => {
  it('warns (but still saves) when the quick-fix row\'s typed bin code already belongs to another active med', async () => {
    const user = userEvent.setup();
    renderWithApp(<><MedsScreen /><Toast /></>);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [EXISTING_MED, MISSING_BIN_MED]);
    fireCollection('lots', []);

    await user.click(await screen.findByRole('button', { name: /ข้อมูลยังไม่ครบ \(1\)/ }));
    await screen.findByText(MISSING_BIN_MED.name);

    const binInput = screen.getByPlaceholderText('เช่น A1 หรือ ตู้ยา-1');
    // EXISTING_MED already owns "C9" — typing the same code for a different active med must warn.
    await user.type(binInput, 'C9');

    // Without the fix, this saves silently with zero indication of the collision.
    await screen.findByText(/รหัสชั้นวาง "C9" ซ้ำกับยา "Amoxicillin 500mg" \(MED-0001\)/);
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.some((c) => (c[1] as unknown as Record<string, unknown>).bin === 'C9')).toBe(true), { timeout: 2000 });
  });

  it('shows no warning for a bin code that is genuinely free', async () => {
    const user = userEvent.setup();
    renderWithApp(<><MedsScreen /><Toast /></>);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [EXISTING_MED, MISSING_BIN_MED]);
    fireCollection('lots', []);

    await user.click(await screen.findByRole('button', { name: /ข้อมูลยังไม่ครบ \(1\)/ }));
    await screen.findByText(MISSING_BIN_MED.name);

    const binInput = screen.getByPlaceholderText('เช่น A1 หรือ ตู้ยา-1');
    await user.type(binInput, 'Z9');
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.some((c) => (c[1] as unknown as Record<string, unknown>).bin === 'Z9')).toBe(true), { timeout: 2000 });

    expect(screen.queryByText(/ซ้ำกับยา/)).not.toBeInTheDocument();
  });
});
