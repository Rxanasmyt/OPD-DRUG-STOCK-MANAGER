// Regression test for a real audit finding: updateMedFull always wrote the edit form's FULL
// snapshot straight over the live doc, with no check for whether it had changed since the form
// opened. Two admins editing the SAME med around the same time, each touching a DIFFERENT field,
// meant whoever saved second silently reverted the other's change back to their own form's
// stale snapshot — a true lost update, with no warning. See AppContext.tsx's own "Bug fix
// (lost-update race, audit finding)" comment on updateMedFull.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { signInAs, fireCollection, hasListener, seedDoc } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floorMin: 10, floor: 40, bin: 'A1',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 0, usedPrev30: 0,
};

function UpdateHarness({ baseline, price }: { baseline: typeof MED | null; price: number }) {
  const { updateMedFull } = useApp();
  return (
    <button onClick={() => updateMedFull(MED.id, {
      name: MED.name, unit: MED.unit, dosageForm: MED.dosageForm, price, had: MED.had,
      bin: MED.bin, parSub: MED.parSub, parFloor: MED.parFloor, floorMin: MED.floorMin,
      ward: MED.ward, noSubstock: MED.noSubstock, volatility: MED.volatility,
    }, baseline as never)}>
      save
    </button>
  );
}

describe('updateMedFull — lost-update race regression', () => {
  it('warns before overwriting a field someone else changed since the form opened, and blocks on cancel', async () => {
    const user = userEvent.setup();
    renderWithApp(<><UpdateHarness baseline={MED} price={5} /><Toast /><ConfirmDialog /></>);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);

    // Another admin already bumped the live price to 3 (bin unchanged) since this form's
    // baseline (price 1) was captured — this admin's own form still shows price 5 for a
    // DIFFERENT reason (a quarterly update), unaware of the other change.
    seedDoc('meds/m1', { ...MED, price: 3 });

    await user.click(screen.getByRole('button', { name: 'save' }));
    await screen.findByText(/มีคนอื่นแก้ไข.*ราคา/);
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));

    // Blocked before ever writing — confirmed via the toast never showing a save-succeeded message.
    expect(screen.queryByText(/บันทึกข้อมูล.*แล้ว/)).not.toBeInTheDocument();
  });

  it('saves directly with no warning when nothing changed since the form opened', async () => {
    const user = userEvent.setup();
    renderWithApp(<><UpdateHarness baseline={MED} price={5} /><Toast /><ConfirmDialog /></>);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', MED); // live doc still matches the baseline exactly

    await user.click(screen.getByRole('button', { name: 'save' }));
    await screen.findByText('บันทึกข้อมูล Paracetamol 500mg แล้ว');
    expect(screen.queryByText(/มีคนอื่นแก้ไข/)).not.toBeInTheDocument();
  });

  it('saves directly with no baseline at all (e.g. a caller that opts out of the check)', async () => {
    const user = userEvent.setup();
    renderWithApp(<><UpdateHarness baseline={null} price={5} /><Toast /><ConfirmDialog /></>);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', { ...MED, price: 3 }); // would conflict if a baseline were provided

    await user.click(screen.getByRole('button', { name: 'save' }));
    await screen.findByText('บันทึกข้อมูล Paracetamol 500mg แล้ว');
  });

  it('proceeds with the overwrite once confirmed', async () => {
    const user = userEvent.setup();
    renderWithApp(<><UpdateHarness baseline={MED} price={5} /><Toast /><ConfirmDialog /></>);
    await signInAs('admin0', { role: 'admin', name: 'แอดมิน หนึ่ง', username: 'admin0' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedDoc('meds/m1', { ...MED, price: 3 });

    await user.click(screen.getByRole('button', { name: 'save' }));
    await screen.findByText(/มีคนอื่นแก้ไข.*ราคา/);
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));
    await screen.findByText('บันทึกข้อมูล Paracetamol 500mg แล้ว');
  });
});
