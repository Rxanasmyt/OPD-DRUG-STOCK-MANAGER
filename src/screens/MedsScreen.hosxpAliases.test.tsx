// Regression test for a real follow-up request: "มีอะไรที่ต้องพัฒนาอีกครับเพื่อแอพแม่นยำเรื่องชื่อยา
// เพื่อไม่ให้หลุดยาในรพ.ที่มีในแอพ" — the add/edit med form now has a "ชื่อที่ไฟล์ HOSxP อาจใช้เรียก
// ยานี้" textarea (Med.hosxpAliases), letting an admin register a known recurring HOSxP spelling
// once instead of relying on matchHosxpMed()'s conservative normalization alone. See
// parseHosxpAliases()'s own doc comment (MedsScreen.tsx) for the one-name-per-line parsing.
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
  used30: 0, usedPrev30: 0, volatility: 0, hosxpAliases: ['PCM 500', 'Paracet 500mg'],
};

async function openEditForm(user: ReturnType<typeof userEvent.setup>, medName: string) {
  const row = (await screen.findByText(medName)).closest('div[style*="padding: 11px 13px"]') as HTMLElement;
  await user.click(within(row).getByRole('button', { name: 'แก้ไขข้อมูล' }));
}

describe('MedsScreen — HOSxP alias field regression', () => {
  it('saves a new med with the typed aliases, one per line, trimmed and deduped', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);

    await user.click(screen.getByText('+ เพิ่มยาใหม่'));
    await user.type(screen.getByLabelText('ชื่อยา + ขนาด (เช่น Enalapril 5 mg)'), 'Amoxicillin 250mg');
    const aliasField = screen.getByLabelText('ชื่อที่ไฟล์ HOSxP อาจใช้เรียกยานี้ (ถ้ามี)');
    // fireEvent.change, not user.type — same multi-line-text gotcha as HosxpTextarea elsewhere
    // in this app's own tests (user.type's literal '\n' handling across a controlled textarea
    // is unreliable in jsdom).
    fireEvent.change(aliasField, { target: { value: 'AMOX 250\nAMOX 250\n Amoxicillin 250mg ' } });
    await user.click(screen.getByRole('button', { name: 'บันทึก' }));

    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    // addMed() also writes the meds/medSeq counter doc in the same transaction (see its own
    // comment on why) — filter to the actual new med doc, not whichever 'set' write .find()
    // happens to hit first.
    const write = getLastTransactionWrites().find((w) => w.kind === 'set' && w.path.startsWith('meds/'));
    // Deduped (AMOX 250 typed twice) and the med's own just-typed name excluded (already covered
    // by a plain name match — no need to carry it twice as an alias too).
    expect(write?.data.hosxpAliases).toEqual(['AMOX 250']);
  });

  it('pre-fills the textarea from an existing med\'s hosxpAliases, one per line', async () => {
    const user = userEvent.setup();
    renderWithApp(<MedsScreen />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    fireCollection('lots', []);

    await openEditForm(user, MED.name);
    const aliasField = screen.getByLabelText('ชื่อที่ไฟล์ HOSxP อาจใช้เรียกยานี้ (ถ้ามี)') as HTMLTextAreaElement;
    expect(aliasField.value).toBe('PCM 500\nParacet 500mg');
  });

  it('saves an edited alias list via updateMedFull, clearing the field entirely when emptied', async () => {
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
    const aliasField = screen.getByLabelText('ชื่อที่ไฟล์ HOSxP อาจใช้เรียกยานี้ (ถ้ามี)');
    fireEvent.change(aliasField, { target: { value: '' } });
    const updateCallsBefore = vi.mocked(updateDoc).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'บันทึกการแก้ไข' }));

    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.length).toBeGreaterThan(updateCallsBefore));
    const patch = vi.mocked(updateDoc).mock.calls[updateCallsBefore][1] as unknown as Record<string, unknown>;
    // deleteField() isn't plain undefined — confirm the key was actually targeted by this write.
    expect(Object.keys(patch)).toContain('hosxpAliases');
  });
});
