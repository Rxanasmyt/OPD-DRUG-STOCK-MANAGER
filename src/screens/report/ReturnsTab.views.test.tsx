import { describe, it, expect, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { ReturnsTab } from './ReturnsTab';
import type { DrugReturnRecord } from '../../types';
import type { ReturnsView } from '../../utils/returnsSummary';

const rec = (o: Partial<DrugReturnRecord>): DrugReturnRecord => ({
  id: 'r', medId: 'm1', medName: 'PARACETAMOL 500 mg', medCode: 'M1', unit: 'เม็ด', category: 'pain', hn: '111', qty: 10, unitPrice: 2, value: 20,
  reason: 'ปรับเปลี่ยนการรักษา', note: '', date: '2026-10-15', ts: Date.parse('2026-10-15T03:00:00Z'), by: 'x', ...o,
});
const RECORDS = [
  rec({ id: 'a', value: 200, qty: 100 }),
  rec({ id: 'b', category: 'cardio', medName: 'AMLODIPINE 10 mg', value: 600, qty: 300, reason: 'Non-compliance', hn: '222' }),
];

function Harness({ initial = 'all' as ReturnsView, load = vi.fn() }) {
  const [view, setView] = useState<ReturnsView>(initial);
  return (
    <ReturnsTab rtnFrom="2026-10-01" setRtnFrom={() => {}} rtnTo="2026-10-31" setRtnTo={() => {}} rtnRecords={RECORDS} rtnLoading={false} rtnLoaded
      loadReturns={load} rtnTotalValue={800} rtnTotalQty={400} exportDrugReturnsCsv={async () => {}} rtnView={view} setRtnView={setView} />
  );
}

describe('ReturnsTab — three views', () => {
  it('starts on the full list and switches to category and reason groupings', async () => {
    const user = userEvent.setup();
    render(<Harness />);
    expect(screen.queryByTestId('rtn-groups-cat')).toBeNull();
    await user.click(screen.getByTestId('rtn-view-cat'));
    const cat = screen.getByTestId('rtn-groups-cat');
    expect(within(cat).getByText(/ยาโรคหัวใจ/)).toBeInTheDocument();
    expect(within(cat).getByText(/ยาแก้ปวด/)).toBeInTheDocument();
    await user.click(screen.getByTestId('rtn-view-reason'));
    const reason = screen.getByTestId('rtn-groups-reason');
    expect(within(reason).getByText(/ผู้ป่วย/)).toBeInTheDocument(); // Non-compliance → group "ผู้ป่วย"
    expect(within(reason).getByText(/การรักษา/)).toBeInTheDocument();
  });

  it('tapping a group opens its drugs', async () => {
    const user = userEvent.setup();
    render(<Harness initial="cat" />);
    expect(screen.queryByText('AMLODIPINE 10 mg')).toBeNull();
    await user.click(screen.getByRole('button', { name: /ยาโรคหัวใจ/ }));
    expect(screen.getByText('AMLODIPINE 10 mg')).toBeInTheDocument();
  });

  it('"เดือนที่แล้ว" loads the previous calendar month straight away', async () => {
    const user = userEvent.setup();
    const load = vi.fn();
    render(<Harness load={load} />);
    await user.click(screen.getByTestId('rtn-last-month'));
    expect(load).toHaveBeenCalledTimes(1);
    const arg = load.mock.calls[0]![0] as { from: string; to: string };
    expect(arg.from).toMatch(/^\d{4}-\d{2}-01$/);
    expect(arg.to.slice(0, 7)).toBe(arg.from.slice(0, 7));
  });
});
