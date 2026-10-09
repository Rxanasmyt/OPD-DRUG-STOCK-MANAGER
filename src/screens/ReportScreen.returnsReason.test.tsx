// Regression test for a real request: "ดึงรายงานการคืนยายังไม่มีข้อมูลเหตุผลในการคืนยาช่วยเพิ่ม
// จากการดึงข้อมูลรายงานเดิมครับ" — the return reason picked in AdjustScreen's own structured
// list (ปรับเปลี่ยนการรักษา/แพ้ยา/Non-compliance/.../อื่นๆ) was always written to the generic txs
// audit log, but DrugReturnRecord (the "รายงานคืนยา" tab/export's actual source) never carried
// its own copy of it — see DrugReturnRecord's own doc comment (types.ts) and commitAdjust's
// return-branch (AppContext.tsx) for the write-side fix this locks in from the read side.
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

vi.mock('../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/csv')>();
  return { ...actual, downloadCsv: vi.fn(async () => 'saved' as const) };
});
import { downloadCsv } from '../utils/csv';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const today = new Date().toISOString().slice(0, 10);
const RETURN_WITH_REASON = {
  medId: 'm1', medName: 'Amoxicillin 500mg', medCode: 'MED-0001', unit: 'เม็ด', category: 'antimicrobial',
  hn: '1234567', qty: 10, unitPrice: 1, value: 10,
  reason: 'แพ้ยา/ผลข้างเคียงการรักษา', note: '—', date: today, ts: Date.now(), by: 'ทดสอบ ภก.',
};
// Simulates a returns doc written before DrugReturnRecord.reason existed — real Firestore data
// this old, not a contrived case.
const OLD_RETURN_NO_REASON = {
  medId: 'm1', medName: 'Amoxicillin 500mg', medCode: 'MED-0001', unit: 'เม็ด', category: 'antimicrobial',
  hn: '7654321', qty: 5, unitPrice: 1, value: 5,
  note: '—', date: today, ts: Date.now() - 1000, by: 'ทดสอบ ภก.',
};

async function openReturnsTab() {
  const user = userEvent.setup();
  renderWithApp(<ReportScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  fireCollection('lots', []);
  seedCollection('returns', [RETURN_WITH_REASON, OLD_RETURN_NO_REASON]);

  await user.click(screen.getByRole('button', { name: '↩️ รายงานคืนยา' }));
  return user;
}

describe('ReportScreen — returns-report reason regression', () => {
  it('shows the return reason next to the category on screen, for a record that has one', async () => {
    await openReturnsTab();
    await screen.findByText(RETURN_WITH_REASON.hn); // confirms the row itself rendered first
    expect(screen.getByText(/แพ้ยา\/ผลข้างเคียงการรักษา/)).toBeInTheDocument();
  });

  it('shows no stray reason text for an old record written before the field existed', async () => {
    await openReturnsTab();
    await screen.findByText(/แพ้ยา\/ผลข้างเคียงการรักษา/);
    // The old record's HN row must render (the med/category line) without any " · undefined"
    // or similar artifact from a missing reason.
    expect(screen.queryByText(/undefined/)).not.toBeInTheDocument();
  });

  it('includes a "เหตุผล" column in the CSV export, falling back to "—" for a record with none', async () => {
    const user = await openReturnsTab();
    await screen.findByText(/แพ้ยา\/ผลข้างเคียงการรักษา/);

    await user.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(vi.mocked(downloadCsv).mock.calls.length).toBeGreaterThan(0));

    const [rows] = vi.mocked(downloadCsv).mock.calls[0];
    const header = rows[0] as string[];
    const reasonCol = header.indexOf('เหตุผล');
    expect(reasonCol).toBeGreaterThan(-1);

    const dataRows = rows.slice(1) as (string | number)[][];
    const withReasonRow = dataRows.find((r) => r[1] === RETURN_WITH_REASON.hn);
    const noReasonRow = dataRows.find((r) => r[1] === OLD_RETURN_NO_REASON.hn);
    expect(withReasonRow?.[reasonCol]).toBe('แพ้ยา/ผลข้างเคียงการรักษา');
    expect(noReasonRow?.[reasonCol]).toBe('—');
  });
});
