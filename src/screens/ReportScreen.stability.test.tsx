// Regression test for a real request: "ทำยังไงให้การเบิกเติมยาเสถียรที่สุด" — three new
// automatic cards on the "🧠 วิเคราะห์อัตโนมัติ" tab: lead-time degradation, recurring real
// stockouts, and par-adjustment outcomes. All three fetch once when the tab opens (see
// ReportScreen.tsx's stabilityLoaded effect) and render from pure selectors already covered by
// their own unit tests in selectors.test.ts — this locks in that the fetched data actually
// reaches the screen and renders, through the real AppProvider/useApp() plumbing.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';
import { isoDate, DAY } from '../utils/format';

const VOLATILE_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 170, usedPrev30: 100, volatility: 1, // +70% swing today -> still_volatile
};
const STOCKOUT_MED = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 0, bin: 'A2',
  used30: 50, usedPrev30: 50, volatility: 1,
};

function dailyMetricsRows() {
  const rows = [];
  for (let i = 0; i < 30; i++) {
    const daysAgo = 29 - i;
    const isRecent = daysAgo < 7;
    rows.push({
      date: isoDate(Date.now() - daysAgo * DAY), generatedAt: 0,
      activeMedCount: 2, totalFloorQty: 0, totalSubQty: 0, totalStockValue: 0,
      lowStockCount: 0, urgentLowCount: 0, nearExpiryValue: 0, expiredValue: 0,
      receivedQty: 0, receivedCount: 0, transferredQty: 0, dispensedQty: 0, adjustQty: 0, txCount: 0,
      receiveLeadTimeAvgHours: isRecent ? 6 : 2, receiveApprovedCount: 1, receivePendingBacklog: 0,
      parErrorCount: 0, parReviewCount: 0, countDiscrepancyCount: 0, hosxpUnmatchedCount: 0, reconciledToday: true,
      activeUserCount: 1, txByUser: {}, stockoutCount: 1, usedMedCount: 2,
      stockoutMedIds: ['m2'],
    });
  }
  return rows;
}

describe('ReportScreen — replenishment-stability cards regression', () => {
  it('surfaces lead-time degradation, recurring real stockouts, and still-volatile par adjustments together on the insights tab', async () => {
    const user = userEvent.setup();
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [VOLATILE_MED, STOCKOUT_MED]);
    fireCollection('lots', []);
    seedCollection('dailyMetrics', dailyMetricsRows());
    seedCollection('parAdjustments', [{
      medId: 'm1', medName: 'Amoxicillin 500mg', category: 'other',
      beforeFloor: 50, beforeSub: 250, afterFloor: 100, afterSub: 500,
      used30AtAdjust: 150, usedPrev30AtAdjust: 150,
      adjustedAt: Date.now() - 20 * DAY, adjustedBy: 'ทดสอบ Admin',
    }]);

    await user.click(screen.getByRole('button', { name: '🧠 วิเคราะห์อัตโนมัติ' }));

    await screen.findByText(/เวลารอเบิกยาช้าลงผิดปกติ/);
    // The streak-count text is unique to the recurring-stockout card — STOCKOUT_MED.name alone
    // isn't, since its floor===0 also legitimately qualifies it for the pre-existing "คาดว่าจะ
    // หมดใน 21 วัน" projection card right above.
    await screen.findByText(/ขาด 30\/30 วัน/);
    await screen.findByText(/ผลลัพธ์หลังปรับ par/);
    // Unique to the par-outcome row — VOLATILE_MED.name alone also legitimately appears in the
    // pre-existing "การใช้ยาผิดปกติ" anomalies card above (same +70% swing qualifies there too).
    await screen.findByText(/หน้างาน 50→100/);
  });
});
