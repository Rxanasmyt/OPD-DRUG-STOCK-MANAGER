// Wrong-day protection for an attached HOSxP file: commitReconcile asks the pharmacist to confirm
// the file name + covered dates (escalating when the date the file states disagrees with the chosen
// range, or when the same file was already committed), blocks on cancel, and — once committed —
// records a per-day 'hosxp_day_report' (covered range + every reason) that the month
// calendar reads.
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { addDoc } from 'firebase/firestore';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import ConfirmDialog from '../components/ConfirmDialog';
import { signInAs, fireCollection, hasListener, seedDoc, getAllTransactionLogs } from '../test-utils/firebaseTestDouble';

const MED_A = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 300, usedPrev30: 300, volatility: 0,
};
const MED_ZERO = { ...MED_A, id: 'm2', code: 'MED-0002', name: 'Amoxicillin 250mg', bin: 'A2', floor: 50 };

const YESTERDAY = new Date(Date.now() - 86400000).toISOString().slice(0, 10);

function Harness({ csv }: { csv: string }) {
  const { state, processHosxpFile, setHosxpCoveredFrom, setHosxpCoveredTo, commitReconcile } = useApp();
  return (
    <div>
      <button onClick={() => processHosxpFile(new File([csv], 'hosxp-report.csv', { type: 'text/csv' }))}>attach</button>
      <button onClick={() => { setHosxpCoveredFrom(YESTERDAY); setHosxpCoveredTo(YESTERDAY); }}>set-range</button>
      <button onClick={commitReconcile} disabled={!state.hosxpRows}>commit</button>
      <div data-testid="file">{state.hosxpFileInfo ? state.hosxpFileInfo.name + '|' + (state.hosxpFileInfo.dateRange ? 'dated' : 'undated') : 'none'}</div>
    </div>
  );
}

async function setup(csv = 'Paracetamol 500mg,10\nAmoxicillin 250mg,0') {
  const user = userEvent.setup();
  renderWithApp(<><Harness csv={csv} /><ConfirmDialog /></>);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED_A, MED_ZERO]);
  seedDoc('meds/m1', { floor: MED_A.floor });
  await user.click(screen.getByRole('button', { name: 'attach' }));
  await waitFor(() => expect(screen.getByTestId('file').textContent).toContain('hosxp-report.csv'));
  await user.click(screen.getByRole('button', { name: 'set-range' }));
  return user;
}

describe('commitReconcile — attached-file date verification', () => {
  it('asks to confirm the file name and covered date, and writes nothing when cancelled', async () => {
    const user = await setup();
    await user.click(screen.getByRole('button', { name: 'commit' }));
    await screen.findByText(/ตัดยอดหน้างานจากไฟล์ "hosxp-report\.csv"/);
    expect(screen.getByText(/ไฟล์นี้ไม่ได้ระบุวันที่/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(getAllTransactionLogs().length).toBe(0);
  });

  it('commits after confirming, and logs a hosxp_day_report with the covered range and the not_in_file reason', async () => {
    const user = await setup();
    const before = vi.mocked(addDoc).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'commit' }));
    await user.click(await screen.findByRole('button', { name: 'ยืนยัน' }));
    await waitFor(() => expect(vi.mocked(addDoc).mock.calls.slice(before).some((c) => (c[1] as { type?: string }).type === 'hosxp_day_report')).toBe(true));
    const entry = vi.mocked(addDoc).mock.calls.slice(before).map((c) => c[1] as unknown as { type: string; note: string }).find((e) => e.type === 'hosxp_day_report')!;
    expect(entry.note.split('\n')[1]).toBe(YESTERDAY + '..' + YESTERDAY);
    // A HOSxP report only lists drugs actually dispensed (zero-qty rows are dropped on read), so a
    // regularly-dispensed med absent from the file is persisted as not_in_file — the calendar text
    // explains both readings (not dispensed that day vs. name mismatch).
    expect(entry.note).toContain('[not_in_file] ' + MED_ZERO.name);
  });
});
