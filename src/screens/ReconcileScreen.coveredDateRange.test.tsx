// Regression test for a real request: "ให้ admin และเภสัชกรเป็นคนตัดยอด" follow-up — "แปลว่าเช้า
// วันจันทร์จะตัดยอดหน้างานโดยแนบไฟล์ ของวันศุกร์ เสาร์และอาทิตย์ เป็นจำนวน 3 วัน" — the old "confirm
// this covers only 1 day" checkbox was factually wrong every Monday. Replaced with a real
// จากวันที่/ถึงวันที่ date-range picker (hosxpCoveredFrom/To) that defaults to yesterday-only (zero
// extra taps for the normal case) and widens backward for a catch-up. See commitReconcile()'s own
// doc comment (AppContext.tsx) and Tx.coveredFrom/coveredTo's (types.ts).
import { describe, it, expect } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, getLastTransactionWrites } from '../test-utils/firebaseTestDouble';

const DAY = 24 * 60 * 60 * 1000;
function isoDay(daysAgo: number): string {
  const d = new Date(Date.now() - daysAgo * DAY);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function Harness() {
  const { state, setHosxpText, processHosxp } = useApp();
  useEffect(() => { if (!state.hosxpText) setHosxpText('Paracetamol 500mg,10'); }, [state.hosxpText, setHosxpText]);
  return (
    <>
      <button onClick={() => void processHosxp()}>process</button>
      <ReconcileScreen />
    </>
  );
}

async function setup(user: ReturnType<typeof userEvent.setup>) {
  renderWithApp(<Harness />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  await user.click(screen.getByRole('button', { name: 'process' }));
  await screen.findByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ });
}

describe('ReconcileScreen — covered date-range regression', () => {
  it('defaults both dates to yesterday after processing, with commit already enabled (zero extra taps for the normal case)', async () => {
    const user = userEvent.setup();
    await setup(user);

    const fromInput = screen.getByLabelText('จากวันที่') as HTMLInputElement;
    const toInput = screen.getByLabelText('ถึงวันที่') as HTMLInputElement;
    expect(fromInput.value).toBe(isoDay(1));
    expect(toInput.value).toBe(isoDay(1));
    expect(screen.getByText('รวม 1 วัน')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ })).not.toBeDisabled();
  });

  it('allows widening "จากวันที่" backward for a Monday catch-up and writes the real range onto the committed tx', async () => {
    const user = userEvent.setup();
    await setup(user);

    const fromInput = screen.getByLabelText('จากวันที่');
    // Simulate a Monday catch-up: widen the start date back 2 more days (Fri-Sat-Sun → 3 days).
    // fireEvent.change, not user.type — native <input type="date"> doesn't accept simulated
    // keystrokes the way a plain text input does.
    fireEvent.change(fromInput, { target: { value: isoDay(3) } });

    // Not an exact-string match — daysCovered > 1 appends an explanatory suffix after "รวม 3 วัน".
    await screen.findByText(/^รวม 3 วัน/);
    const commitBtn = screen.getByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ });
    expect(commitBtn).not.toBeDisabled();

    await user.click(commitBtn);
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    const txWrite = getLastTransactionWrites().find((w) => w.kind === 'set');
    expect(txWrite?.data.coveredFrom).toBe(isoDay(3));
    expect(txWrite?.data.coveredTo).toBe(isoDay(1));
  });

  it('disables commit when "ถึงวันที่" is pushed to include today', async () => {
    const user = userEvent.setup();
    await setup(user);

    const toInput = screen.getByLabelText('ถึงวันที่');
    fireEvent.change(toInput, { target: { value: isoDay(0) } });

    expect(screen.getByText('ระบุช่วงวันที่ให้ครบ (ถึงวันที่ต้องไม่ใช่วันนี้)')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ })).toBeDisabled();
  });

  it('disables commit when the start date is after the end date', async () => {
    const user = userEvent.setup();
    await setup(user);

    const toInput = screen.getByLabelText('ถึงวันที่');
    fireEvent.change(toInput, { target: { value: isoDay(5) } }); // now "to" (5 days ago) is before "from" (1 day ago)

    expect(screen.getByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ })).toBeDisabled();
  });
});
