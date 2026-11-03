// Regression test for a real request: "สามารถรู้ได้ว่าวันไหนที่ทำการแนบไฟล์ไปแล้ว วันไหนยังไม่แนบ
// ตอนนี้ไม่รู้อะไรเลย" — fetchReconcileGaps' own gap panel already answered this, but only after
// its own async round trip resolves, and only for the last 7 days. This instead reads straight
// off state.txs (already loaded) for an instant, always-visible answer the moment the screen
// opens — before anyone's even attached a file yet. See ReconcileScreen.tsx's own
// lastCoveredTo/missingWeekdaysSoFar doc comment.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import ReconcileScreen from './ReconcileScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
function bangkokNoon(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d, 12, 0) - BANGKOK_OFFSET_MS;
}
function isoAt(y: number, m: number, d: number): string {
  return [y, String(m + 1).padStart(2, '0'), String(d).padStart(2, '0')].join('-');
}
// 2026-01-08 is a real Thursday (same reference as AppContext.reconcileGaps.test.tsx).
const THU = isoAt(2026, 0, 8);
const SUN = isoAt(2026, 0, 11);

beforeEach(() => vi.setSystemTime(bangkokNoon(2026, 0, 12))); // "today" = Monday
afterEach(() => vi.useRealTimers());

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

async function setup() {
  renderWithApp(<ReconcileScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  await waitFor(() => expect(hasListener('txs')).toBe(true));
}

describe('ReconcileScreen — last-covered-to status banner regression', () => {
  it('shows "ยังไม่มีประวัติ" when this system has never run a HOSxP reconcile at all', async () => {
    await setup();
    fireCollection('txs', []);

    await screen.findByText('ยังไม่มีประวัติการตัดยอด HOSxP ในระบบนี้เลย');
  });

  it('shows a red warning naming the missing-day count when the last reconcile left a real gap', async () => {
    await setup();
    // Last reconcile only covered Thursday — Friday (a real weekday) was never reconciled at
    // all, and today is Monday.
    fireCollection('txs', [{ id: 't1', type: 'reconcile_hosxp', medId: MED.id, ts: Date.now() - 86400000, coveredFrom: THU, coveredTo: THU }]);

    await screen.findByText(/ตัดยอด HOSxP ล่าสุดถึงวันที่.*ค้างอีก 1 วันทำการที่ยังไม่ตัดยอด/);
  });

  it('shows a green "ล่าสุดเท่าที่ควรแล้ว" when the last reconcile already covers through yesterday with no gap', async () => {
    await setup();
    // Today is Monday, "yesterday" is Sunday — last reconcile already covers through Sunday.
    fireCollection('txs', [{ id: 't1', type: 'reconcile_hosxp', medId: MED.id, ts: Date.now() - 86400000, coveredFrom: SUN, coveredTo: SUN }]);

    await screen.findByText(/ตัดยอด HOSxP ล่าสุดถึงวันที่.*ล่าสุดเท่าที่ควรแล้ว/);
    expect(screen.queryByText(/ค้างอีก/)).not.toBeInTheDocument();
  });
});
