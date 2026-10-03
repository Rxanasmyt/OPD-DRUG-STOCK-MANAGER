// Regression test for a real request: "เก็บสถิติการใช้ยาแต่ละวัน...Top 100...ใช้ยากลุ่มไหนเยอะ...
// รายงานประจำไตรมาส/เดือน/ปีงบประมาณ" — the new "📈 สถิติการใช้ยา" tab fetches usageHistory records
// (written by commitUsageImport, see AppContext.usageHistory.test.tsx for that side) and ranks/
// groups them into a Top 100 table + category breakdown. This locks in that the fetched records
// actually render correctly ranked, through the real AppProvider/useApp() plumbing.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

const USAGE_RECORDS = [
  {
    medId: 'm1', medName: 'Drug A (ใช้น้อยกว่า)', unit: 'เม็ด', category: 'pain',
    qty: 100, value: 500, periodFrom: '2026-01-01', periodTo: '2026-01-31', periodDays: 31,
    importedAt: 0, monthKey: '2026-01',
  },
  {
    medId: 'm2', medName: 'Drug B (มูลค่าสูงกว่า)', unit: 'ขวด', category: 'antimicrobial',
    qty: 10, value: 900, periodFrom: '2026-01-01', periodTo: '2026-01-31', periodDays: 31,
    importedAt: 0, monthKey: '2026-01',
  },
];

describe('ReportScreen — usage-history tab regression', () => {
  it('ranks Top 100 by value by default, shows the category breakdown, and sums the right total', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);
    seedCollection('usageHistory', USAGE_RECORDS);

    await user.click(screen.getByRole('button', { name: '📈 สถิติการใช้ยา' }));

    // Drug B (900 บาท) ranks above Drug A (500 บาท) under the default "เรียงตามมูลค่า".
    const rows = await screen.findAllByText(/Drug [AB]/);
    expect(rows.map((el) => el.textContent)).toEqual(['Drug B (มูลค่าสูงกว่า)', 'Drug A (ใช้น้อยกว่า)']);

    // Total value tile sums both records' value (500 + 900 = 1,400 บาท).
    await screen.findByText('1,400 บาท');

    // Category breakdown resolves raw ids to real Thai labels, not bare ids.
    await screen.findByText('ยาต้านจุลชีพ (ปฏิชีวนะ/เชื้อรา/ไวรัส)');
  });

  it('re-ranks by qty when that toggle is selected', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);
    seedCollection('usageHistory', USAGE_RECORDS);

    await user.click(screen.getByRole('button', { name: '📈 สถิติการใช้ยา' }));
    await screen.findAllByText(/Drug [AB]/);

    await user.click(screen.getByRole('button', { name: 'เรียงตามปริมาณ' }));
    // Drug A has the higher raw qty (100 vs 10), so it should now rank first even though its
    // value is lower.
    const rows = await screen.findAllByText(/Drug [AB]/);
    expect(rows.map((el) => el.textContent)).toEqual(['Drug A (ใช้น้อยกว่า)', 'Drug B (มูลค่าสูงกว่า)']);
  });
});
