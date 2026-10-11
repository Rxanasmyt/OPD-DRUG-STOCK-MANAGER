// Regression test for a real request: "ความถี่การเติมหน้างานต่อยา (ไม่ใช่แค่ยอดรวม)" —
// dailyMetrics.transferredQty is one mixed-unit total across every drug refilled that day, so a
// drug refilled constantly in small amounts looks identical to one refilled once in bulk. The
// "🧠 วิเคราะห์อัตโนมัติ" tab's new "🔄 เติมหน้างานบ่อยผิดปกติ" block sums the new
// floorRefillCounts map (collect-daily-metrics.mjs) across the fetched 30-day window and flags a
// drug refilled on average more than once every two days. See selectors.ts's own
// frequentFloorRefills (unit-tested there) — this test locks in the UI wiring through the real
// AppProvider/useApp() plumbing specifically.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';
import { isoDate, DAY } from '../utils/format';

const FREQUENT_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};
const OCCASIONAL_MED = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A2',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function dailyMetricsRows() {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const daysAgo = 29 - i;
    rows.push({
      date: isoDate(Date.now() - daysAgo * DAY), generatedAt: 0,
      activeMedCount: 2, totalFloorQty: 0, totalSubQty: 0, totalStockValue: 0,
      lowStockCount: 0, urgentLowCount: 0, nearExpiryValue: 0, expiredValue: 0,
      receivedQty: 0, receivedCount: 0, transferredQty: 0, dispensedQty: 0, adjustQty: 0, txCount: 0,
      receiveLeadTimeAvgHours: null, receiveApprovedCount: 0, receivePendingBacklog: 0,
      parErrorCount: 0, parReviewCount: 0, countDiscrepancyCount: 0, hosxpUnmatchedCount: 0, reconciledToday: true,
      activeUserCount: 1, txByUser: {}, stockoutCount: 0, usedMedCount: 2,
      // m1 refilled twice every day (2/day, well past the default 0.5/day threshold) — m2
      // refilled once every 3 days (0.33/day, below threshold, must never show up).
      floorRefillCounts: i % 3 === 0 ? { m1: 2, m2: 1 } : { m1: 2 },
    });
  }
  return rows;
}

describe('ReportScreen — frequent-floor-refill insight regression', () => {
  it('flags only the drug refilled on average more than once every 2 days', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [FREQUENT_MED, OCCASIONAL_MED]);
    fireCollection('lots', []);
    seedCollection('dailyMetrics', dailyMetricsRows());

    await user.click(screen.getByRole('button', { name: '🧠 วิเคราะห์อัตโนมัติ' }));

    await screen.findByText('🔄 เติมหน้างานบ่อยผิดปกติ');
    const row = screen.getByText('Amoxicillin 500mg').closest('button') as HTMLElement;
    expect(row.textContent).toContain('เติม 60 ครั้ง/30 วัน');
    expect(screen.queryByText('Paracetamol 500mg')).toBeNull();
  });

  it('stays hidden when no drug is refilled frequently enough', async () => {
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [FREQUENT_MED, OCCASIONAL_MED]);
    fireCollection('lots', []);
    // No floorRefillCounts field at all — same as a dailyMetrics doc written before this
    // feature existed.
    seedCollection('dailyMetrics', dailyMetricsRows().map((r) => ({ ...r, floorRefillCounts: undefined })));

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '🧠 วิเคราะห์อัตโนมัติ' }));
    await screen.findByText(/คำนวณจากสถิติการใช้ยา/);
    expect(screen.queryByText('🔄 เติมหน้างานบ่อยผิดปกติ')).toBeNull();
  });
});
