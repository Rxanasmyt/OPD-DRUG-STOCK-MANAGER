// "ทำไมได้เลขนี้" panel + Min/Max back-test tab: the pharmacist must see where each suggested number came
// from, and how current vs suggested settings would have fared against real dispensing history.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ParExplain } from './ParExplain';
import { ParBacktestTab } from './report/ParBacktestTab';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

const DAY = 86400000;
const MED = (over: Record<string, unknown> = {}) => ({
  id: 'm1', code: 'MED-1', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true,
  parSub: 500, parFloor: 100, floorMin: 50, floor: 60, bin: 'A1', used30: 300, usedPrev30: 100, volatility: 1.1, ...over,
});

function ExplainHarness() {
  const { state } = useApp();
  const m = state.meds.find((x) => x.id === 'm1');
  return m ? <ParExplain med={m} /> : null;
}

describe('ParExplain', () => {
  it('shows each step of the suggestion and the current-vs-suggested table', async () => {
    renderWithApp(<ExplainHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED()]);
    fireCollection('lots', []);
    const box = await screen.findByTestId('par-explain');
    expect(box).toHaveTextContent('1) ยอดใช้');
    expect(box).toHaveTextContent('เดือนล่าสุด 300');
    expect(box).toHaveTextContent('ถ่วง 70%'); // 300 then 100 → blend wins over the average
    expect(box).toHaveTextContent('2) อัตราใช้ต่อวัน');
    expect(box).toHaveTextContent('5) Max');
    expect(box).toHaveTextContent('6) Min');
    expect(box).toHaveTextContent('เทียบกับที่ตั้งอยู่ตอนนี้');
  });

  it('says plainly when there are no usage statistics (no suggestion is made)', async () => {
    renderWithApp(<ExplainHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED({ used30: 0, usedPrev30: 0 })]);
    fireCollection('lots', []);
    expect(await screen.findByText(/ไม่แนะนำ par/)).toBeInTheDocument();
  });

  it('explains that the monthly figure is the 2-month average after a quiet month', async () => {
    renderWithApp(<ExplainHarness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED({ used30: 100, usedPrev30: 400 })]);
    fireCollection('lots', []);
    expect(await screen.findByText(/ใช้ค่าเฉลี่ยสองเดือน/)).toBeInTheDocument();
  });
});

describe('ParBacktestTab', () => {
  it('replays real history: a far-too-small Max is flagged "ขาดบ่อย" and shows stockout days', async () => {
    const user = userEvent.setup();
    renderWithApp(<ParBacktestTab />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED({ parFloor: 15, floorMin: 8 })]);
    fireCollection('lots', []);
    // steady ~12/day on every weekday of the last 150 days
    const now = Date.now();
    const rows: Record<string, unknown>[] = [];
    for (let i = 1; i <= 150; i++) rows.push({ type: 'reconcile_hosxp', medId: 'm1', name: 'Paracetamol 500mg', qty: -12, unit: 'เม็ด', ts: now - i * DAY });
    seedCollection('txs', rows);

    await user.click(screen.getByRole('button', { name: 'รันการทดสอบ' }));
    expect(await screen.findByText('Paracetamol 500mg')).toBeInTheDocument();
    expect(screen.getByText('ขาดบ่อย')).toBeInTheDocument();
    expect(screen.getByText(/ตั้งอยู่ Max 15 \/ Min 8/)).toBeInTheDocument();
    expect(screen.getByText(/แนะนำ Max/)).toBeInTheDocument();
  });

  it('says so when there is not enough history to test', async () => {
    const user = userEvent.setup();
    renderWithApp(<ParBacktestTab />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED()]);
    fireCollection('lots', []);
    seedCollection('txs', []);
    await user.click(screen.getByRole('button', { name: 'รันการทดสอบ' }));
    expect(await screen.findByText('ข้อมูลไม่พอทดสอบ')).toBeInTheDocument();
  });
});
