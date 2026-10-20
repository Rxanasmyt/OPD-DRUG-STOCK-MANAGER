// Regression test for a real request: ใบเบิกยาเดิม (ก่อนใช้แอพนี้) มาจาก Google Sheet ที่มีรหัสยาของ
// คลังยาใหญ่เอง ("คลังจะใช้เลขนี้เพื่อใช้ในการทำเบิกยาจากคลังขึ้นมาห้องยา") — คนละรหัสกับ m.code
// (แอพสร้างให้เองอัตโนมัติ คลังไม่ได้ใช้จริง — ดู printWarehouseRequestList's own comment,
// AppContext.tsx). The add/edit med form now has a free-text "รหัสยาคลังใหญ่" input (Med.whCode),
// shown on the meds list, the receive screen, and ใบขอเบิกจากคลังใหญ่.
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { updateDoc } from 'firebase/firestore';
import MedsScreen from './MedsScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, getLastTransactionWrites, seedDoc } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0, whCode: 'WH-9912',
};

async function openEditForm(user: ReturnType<typeof userEvent.setup>, medName: string) {
  const row = (await screen.findByText(medName)).closest('div[style*="padding: 11px 13px"]') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: 'แก้ไขข้อมูล' }));
}

describe('MedsScreen — warehouse drug-code field regression', () => {
  it('saves a new med with the typed warehouse code, trimmed', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);

    await user.click(screen.getByText('+ เพิ่มยาใหม่'));
    await user.type(screen.getByLabelText('ชื่อยา + ขนาด (เช่น Enalapril 5 mg)'), 'Amoxicillin 250mg');
    const whCodeField = screen.getByLabelText('รหัสยาคลังใหญ่ (ถ้ามี)');
    fireEvent.change(whCodeField, { target: { value: '  WH-0042  ' } });
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    const write = getLastTransactionWrites().find((w) => w.kind === 'set' && w.path.startsWith('meds/'));
    expect(write?.data.whCode).toBe('WH-0042');
  });

  it('does not write a whCode field at all when left blank on a new med', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);

    await user.click(screen.getByText('+ เพิ่มยาใหม่'));
    await user.type(screen.getByLabelText('ชื่อยา + ขนาด (เช่น Enalapril 5 mg)'), 'Amoxicillin 250mg');
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    const write = getLastTransactionWrites().find((w) => w.kind === 'set' && w.path.startsWith('meds/'));
    expect(write?.data.whCode).toBeUndefined();
  });

  it('pre-fills the input from an existing med\'s whCode, and shows it on the list row', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);

    expect(await screen.findByText((t) => t.includes('รหัสคลัง WH-9912'))).toBeTruthy();

    await openEditForm(user, MED.name);
    const whCodeField = screen.getByLabelText('รหัสยาคลังใหญ่ (ถ้ามี)') as HTMLInputElement;
    expect(whCodeField.value).toBe('WH-9912');
  });

  it('saves an edited whCode via updateMedFull, clearing the field entirely when emptied', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);
    // updateMedFull() re-reads the live doc via getDoc() right before writing (its own
    // lost-update check) — the test double's getDoc only ever answers from an explicit
    // seedDoc(), never from whatever fireCollection() already pushed through the live listener.
    seedDoc('meds/' + MED.id, MED);

    await openEditForm(user, MED.name);
    const whCodeField = screen.getByLabelText('รหัสยาคลังใหญ่ (ถ้ามี)');
    fireEvent.change(whCodeField, { target: { value: '' } });
    const updateCallsBefore = vi.mocked(updateDoc).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));

    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.length).toBeGreaterThan(updateCallsBefore));
    const patch = vi.mocked(updateDoc).mock.calls[updateCallsBefore][1] as unknown as Record<string, unknown>;
    // deleteField() isn't plain undefined — confirm the key was actually targeted by this write.
    expect(Object.keys(patch)).toContain('whCode');
  });

  it('matches a med by its warehouse code when searching', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);

    const search = screen.getByPlaceholderText(/ค้นหา/);
    await user.type(search, 'WH-9912');
    expect(await screen.findByText(MED.name)).toBeTruthy();
  });
});
