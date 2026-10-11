// Regression test for a real request: "เก็บมูลค่าความเสียหาย/หมดอายุที่ตัดจริง" — unlike the
// existing nearExpiryValue/expiredValue (a current-inventory-SNAPSHOT "value still at risk right
// now"), damagedLossValue/expiredLossValue (collect-daily-metrics.mjs) are a historical FLOW
// figure: what actually got written off on each specific day. The "📅 ตัวชี้วัดย้อนหลัง" (kpi)
// tab's new tile sums both across the selected date range. Also locks in that a dailyMetrics
// doc written before this field existed (damagedLossValue/expiredLossValue absent, not just 0)
// doesn't turn the whole range's sum into NaN — see ReportScreen.tsx's kpiDamagedLossSum/
// kpiExpiredLossSum `?? 0` handling.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';
import { isoDate, DAY } from '../utils/format';

function baseRow(overrides: Record<string, unknown> = {}) {
  return {
    date: isoDate(Date.now()), generatedAt: 0,
    activeMedCount: 0, totalFloorQty: 0, totalSubQty: 0, totalStockValue: 0,
    lowStockCount: 0, urgentLowCount: 0, nearExpiryValue: 0, expiredValue: 0,
    receivedQty: 0, receivedCount: 0, transferredQty: 0, dispensedQty: 0, adjustQty: 0, txCount: 0,
    receiveLeadTimeAvgHours: null, receiveApprovedCount: 0, receivePendingBacklog: 0,
    parErrorCount: 0, parReviewCount: 0, countDiscrepancyCount: 0, hosxpUnmatchedCount: 0, reconciledToday: true,
    activeUserCount: 0, txByUser: {}, stockoutCount: 0, usedMedCount: 0,
    ...overrides,
  };
}

describe('ReportScreen — realized waste/loss KPI tile regression', () => {
  it('sums damagedLossValue/expiredLossValue across the selected range, even when an older doc predates the field entirely', async () => {
    renderWithApp(<ReportScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', []);
    fireCollection('lots', []);
    // Day 1: a doc written before this feature existed — no damagedLossValue/expiredLossValue
    // keys at all (not even 0). Day 2 and 3: real values from the new fields.
    seedCollection('dailyMetrics', [
      baseRow({ date: isoDate(Date.now() - 2 * DAY) }),
      baseRow({ date: isoDate(Date.now() - 1 * DAY), damagedLossValue: 150, expiredLossValue: 300 }),
      baseRow({ date: isoDate(Date.now()), damagedLossValue: 50, expiredLossValue: 0 }),
    ]);

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: '📅 ตัวชี้วัดย้อนหลัง' }));

    const tile = await screen.findByText('มูลค่าเสีย/หมดอายุที่ตัดจริงช่วงนี้');
    const card = tile.closest('div')!.parentElement as HTMLElement;
    // 150+50 damaged, 300+0 expired, total 500 — NOT NaN despite the first day having neither field.
    expect(card.textContent).toContain('500');
    expect(card.textContent).toContain('ของเสีย 200');
    expect(card.textContent).toContain('หมดอายุ 300');
  });
});
