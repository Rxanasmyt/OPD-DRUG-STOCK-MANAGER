// Regression test for autoRouteAll(): the bulk "แยกประเภทการให้ยาทั้งหมดอัตโนมัติ" action behind
// the real-world requests "ยาที่ต้องเติมหน้างานให้แยกยากินกับยาฉีด...เพื่อง่ายต่อการเบิกยาจริงหน้างาน"
// and, this round, "ยังไม่มียาพ่น ยาทาภายนอก ยาหยอดตา ยาป้าย ยาหยอดหู" — mirrors
// autoCategorizeAll()'s own contract: suggest from suggestRoute() (now covering more than just
// oral/injection — see data/routeSuggest.ts), never touch a med that already has a route set,
// and leave anything the engine isn't confident about as unclassified.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { signInAs, fireCollection, hasListener, getLastBatchWrites } from '../test-utils/firebaseTestDouble';

const ORAL_UNCLASSIFIED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'tab',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 0, usedPrev30: 0,
};
const INJECTION_UNCLASSIFIED = {
  id: 'm2', code: 'MED-0002', name: 'Adrenaline', unit: 'Amp', dosageForm: 'Injection',
  price: 1, had: false, active: true, parSub: 50, parFloor: 10, floor: 4, bin: 'A2',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 0, usedPrev30: 0,
};
const ALREADY_SET = {
  id: 'm3', code: 'MED-0003', name: 'Amoxicillin', unit: 'แคปซูล', dosageForm: 'cap',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A3',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 0, usedPrev30: 0,
  route: 'injection' as const, // deliberately "wrong" — proves a human choice is never overwritten
};
// Real-world request (this round): "ยังไม่มียาพ่น ยาทาภายนอก ยาหยอดตา ยาป้าย ยาหยอดหู" — a
// cream/ointment now gets confidently classified as 'topical' instead of staying unconfident.
const TOPICAL_UNCLASSIFIED = {
  id: 'm4', code: 'MED-0004', name: 'Hydrocortisone Cream', unit: 'Tube', dosageForm: 'Cream',
  price: 1, had: false, active: true, parSub: 20, parFloor: 5, floor: 2, bin: 'A4',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 0, usedPrev30: 0,
};
const EYE_UNCLASSIFIED = {
  id: 'm5', code: 'MED-0005', name: 'Chloramphenicol Eye Drop', unit: 'Eye drop', dosageForm: 'Ophthalmic solution',
  price: 1, had: false, active: true, parSub: 30, parFloor: 6, floor: 3, bin: 'A5',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 0, usedPrev30: 0,
};
// "SOLUTIONS" alone is genuinely ambiguous (see routeSuggest.ts's own comment) — this is the
// real-world case that's still, correctly, not confident enough to auto-classify.
const UNCONFIDENT = {
  id: 'm6', code: 'MED-0006', name: 'Normal Saline Solution', unit: 'Bag', dosageForm: 'Solution',
  price: 1, had: false, active: true, parSub: 20, parFloor: 5, floor: 2, bin: 'A6',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 0, usedPrev30: 0,
};

function Harness() {
  const { autoRouteAll } = useApp();
  return <button onClick={autoRouteAll}>auto-route</button>;
}

describe('autoRouteAll — oral/injection bulk-classify regression', () => {
  it('classifies the confident, unset meds (oral/injection/topical/eye) and leaves an existing choice and an unconfident one untouched', async () => {
    const user = userEvent.setup();
    renderWithApp(<><Harness /><Toast /><ConfirmDialog /></>);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [ORAL_UNCLASSIFIED, INJECTION_UNCLASSIFIED, ALREADY_SET, TOPICAL_UNCLASSIFIED, EYE_UNCLASSIFIED, UNCONFIDENT]);

    await user.click(screen.getByRole('button', { name: 'auto-route' }));
    await screen.findByText(/ให้ระบบแยกประเภทการให้ยาอัตโนมัติ/);
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await screen.findByText(/แยกประเภทให้แล้ว 4 รายการ/);

    const writes = getLastBatchWrites();
    const byPath = Object.fromEntries(writes.map((w) => [w.path, w.data]));
    expect(byPath['meds/m1']).toEqual({ route: 'oral' });
    expect(byPath['meds/m2']).toEqual({ route: 'injection' });
    expect(byPath['meds/m3']).toBeUndefined(); // ALREADY_SET — never overwritten
    expect(byPath['meds/m4']).toEqual({ route: 'topical' });
    expect(byPath['meds/m5']).toEqual({ route: 'eye' });
    expect(byPath['meds/m6']).toBeUndefined(); // UNCONFIDENT — genuinely ambiguous "Solution"
  });

  it('shows a toast and writes nothing when every med is already classified or unconfident', async () => {
    const user = userEvent.setup();
    renderWithApp(<><Harness /><Toast /><ConfirmDialog /></>);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [ALREADY_SET, UNCONFIDENT]);

    await user.click(screen.getByRole('button', { name: 'auto-route' }));
    await screen.findByText('ไม่มียาที่ระบบแนะนำประเภทการให้ยาให้ได้เพิ่มแล้ว — ที่เหลือต้องเลือกเอง');
    expect(screen.queryByText(/ให้ระบบแยกประเภทการให้ยาอัตโนมัติ/)).not.toBeInTheDocument();
  });
});
