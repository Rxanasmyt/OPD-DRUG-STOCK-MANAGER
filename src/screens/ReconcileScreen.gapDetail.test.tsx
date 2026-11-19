// Real request: the "ตรวจสอบความครบถ้วนของการตัดยอด" list said "ตัดไม่ครบ — 36 รายการ" and named only
// 5 meds, with no way to see WHY each one wasn't deducted. Tapping a flagged day now expands the
// per-med reasons (same detail as the calendar), with a jump to fix the med.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReconcileScreen from './ReconcileScreen';
import { useApp } from '../store/AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

const DAY = 86400000;
const NOW = Date.UTC(2026, 0, 8, 12, 0) - 7 * 3600000; // Thu 8 Jan 2026 noon, Bangkok
beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => vi.useRealTimers());

const MED = (id: string, name: string) => ({
  id, code: 'C-' + id, name, unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true,
  parSub: 500, parFloor: 100, floor: 40, bin: 'A' + id, used30: 300, usedPrev30: 300, volatility: 0, dispenseDays30: 20,
});

// The gap list is fetched once on mount (it deliberately doesn't refetch on every meds snapshot —
// that would re-read the txs range each time), so mount the screen only once meds have loaded,
// as happens in the real app (the formulary is live long before anyone opens this screen).
function AfterMeds() {
  const { state } = useApp();
  return state.meds.length ? <ReconcileScreen /> : null;
}

describe('ReconcileScreen — gap list per-med reasons', () => {
  it('expands a "ตัดไม่ครบ" day to list the un-deducted med with its reason and a fix button', async () => {
    const user = userEvent.setup();
    renderWithApp(<AfterMeds />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    seedCollection('txs', [
      { type: 'reconcile_hosxp', medId: '1', ts: NOW - 1 * DAY },
      { type: 'reconcile_hosxp', medId: '2', ts: NOW - 1 * DAY },
      { type: 'reconcile_hosxp', medId: '1', ts: NOW - 2 * DAY },
    ]);

    fireCollection('meds', [MED('1', 'Paracetamol 500mg'), MED('2', 'Amlodipine 5mg')]);
    // The list first renders before meds arrive (everything looks "ไม่มีไฟล์"), then refetches.
    const partial = await waitFor(() => {
      const row = screen.getAllByRole('button', { name: /ดูสาเหตุรายตัว/ }).find((r) => r.textContent?.includes('ตัดไม่ครบ'));
      expect(row).toBeTruthy();
      return row!;
    });
    expect(partial).toHaveAttribute('aria-expanded', 'false');
    await user.click(partial);
    expect(partial).toHaveAttribute('aria-expanded', 'true');

    const detail = await screen.findByTestId('reconcile-day-detail');
    expect(detail).toHaveTextContent('Amlodipine 5mg');
    expect(detail).toHaveTextContent('ไม่ทราบสาเหตุ');
    expect(screen.getAllByRole('button', { name: /แก้ไขชื่อยา\/เพิ่มชื่อ HOSxP ที่รู้จัก/ }).length).toBeGreaterThan(0);
  });
});
