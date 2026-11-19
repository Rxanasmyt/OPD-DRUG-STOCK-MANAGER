// "ไม่ถูกตัดเพราะอะไร": the diagnosis must say WHICH file name looks like the missed drug and where
// the names differ, offer a one-tap alias only when strength agrees, and say plainly "probably not
// dispensed" when nothing resembles it.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MissDiagnosis } from './MissDiagnosis';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, seedDoc, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';

const MED = (id: string, name: string, extra: Record<string, unknown> = {}) => ({
  id, code: 'C-' + id, name, unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true,
  parSub: 500, parFloor: 100, floor: 40, bin: 'A' + id, used30: 300, usedPrev30: 300, volatility: 0, dispenseDays30: 15, ...extra,
});
const RISP = MED('1', 'Risperidone 1 mg เม็ด');

function Harness({ names }: { names: string[] }) {
  const { state } = useApp();
  const med = state.meds.find((m) => m.id === '1');
  return med ? <MissDiagnosis med={med} fileNames={names} onFixMed={() => {}} /> : null;
}

async function setup(names: string[], role = 'admin') {
  const user = userEvent.setup();
  renderWithApp(<Harness names={names} />);
  await signInAs('u1', { role, name: 'ทดสอบ', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [RISP]);
  return user;
}

describe('MissDiagnosis', () => {
  it('shows the similar file name, what differs, and adds it as an alias on tap', async () => {
    const user = await setup(['RISPERIDONE 1 MG TAB (Risperdal)', 'Paracetamol 500 mg']);
    const box = await screen.findByTestId('miss-diagnosis');
    expect(box).toHaveAttribute('data-verdict', 'rename_candidate');
    expect(box).toHaveTextContent('ไฟล์มีแต่: risperdal');
    expect(box).toHaveTextContent('ความแรงตรงกัน');
    seedDoc('meds/1', { hosxpAliases: ['เดิม'] });
    await user.click(screen.getByRole('button', { name: /เพิ่ม "RISPERIDONE 1 MG TAB \(Risperdal\)" เป็นชื่อ HOSxP/ }));
    await waitFor(() => expect(getLastTransactionWrites().some((w) => w.path === 'meds/1')).toBe(true));
    const w = getLastTransactionWrites().find((x) => x.path === 'meds/1')!;
    expect(w.data.hosxpAliases).toEqual(['เดิม', 'RISPERIDONE 1 MG TAB (Risperdal)']);
    // the analysis is replaced by the outcome (it must NOT flip to "probably not dispensed" once the name resolves)
    await screen.findByText(/เพิ่มชื่อ "RISPERIDONE 1 MG TAB \(Risperdal\)" ให้ยานี้แล้ว/);
    expect(screen.queryByTestId('miss-diagnosis')).toBeNull();
  });

  it('does not offer an alias when only the strength differs', async () => {
    await setup(['RISPERIDONE 2 MG TAB']);
    const box = await screen.findByTestId('miss-diagnosis');
    expect(box).toHaveAttribute('data-verdict', 'strength_mismatch');
    expect(box).toHaveTextContent('ตัวเลขต่าง');
    expect(screen.queryByRole('button', { name: /เป็นชื่อ HOSxP ของยานี้/ })).toBeNull();
  });

  it('says it was probably not dispensed when nothing in the file resembles it', async () => {
    await setup(['Paracetamol 500 mg']);
    const box = await screen.findByTestId('miss-diagnosis');
    expect(box).toHaveAttribute('data-verdict', 'likely_no_dispense');
    expect(box).toHaveTextContent('วันนั้นไม่มีการจ่ายยานี้');
  });

  it('is honest that it cannot analyse when no file names were recorded', async () => {
    await setup([]);
    await screen.findByText(/วิเคราะห์ไม่ได้ว่าเป็นเพราะชื่อไม่ตรง/);
  });

  it('shows no add button to a non-admin, only who to ask', async () => {
    await setup(['RISPERIDONE 1 MG TAB'], 'pharm');
    await screen.findByText(/เพิ่มชื่อนี้ได้เฉพาะ Admin/);
    expect(screen.queryByRole('button', { name: /^เพิ่ม "/ })).toBeNull();
  });
});
