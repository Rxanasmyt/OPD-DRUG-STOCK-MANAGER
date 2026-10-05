// Regression test for a follow-up request: after merging the weekday-usage-pattern analysis
// (analyzeWeekdayUsage, AppContext.tsx), ผู้ใช้ถามว่า "มีอะไรตกหล่นบ้าง" แล้วขอให้ทำทั้งหมด —
// one gap: the detected pattern only ever showed up in the Admin-only SettingsScreen insight
// card, invisible to whoever is actually walking the floor doing today's real เติมหน้างาน. This
// badge surfaces it right on the row, only on the exact weekday it applies to.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import TransferScreen from './TransferScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

function bangkokNoon(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d, 12, 0) - 7 * 60 * 60 * 1000;
}
// 2026-01-06 is a real Tuesday (2026-01-05 is a Monday — see format.test.ts's own fixture).
const TUESDAY_2026_01_06 = bangkokNoon(2026, 0, 6);

const PEAKS_TODAY_MED = {
  id: 'm1', code: 'MED-0001', name: 'Metformin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A1',
  used30: 300, usedPrev30: 300, volatility: 0, weekdayPeakFactor: 2.5, weekdayPeakDay: 2, // Tuesday
};
const PEAKS_OTHER_DAY_MED = {
  id: 'm2', code: 'MED-0002', name: 'Warfarin 3mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A2',
  used30: 300, usedPrev30: 300, volatility: 0, weekdayPeakFactor: 2.5, weekdayPeakDay: 5, // Friday
};
const NO_PATTERN_MED = {
  id: 'm3', code: 'MED-0003', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 10, bin: 'A3',
  used30: 300, usedPrev30: 300, volatility: 0,
};

afterEach(() => vi.useRealTimers());

describe('TransferScreen — today-is-peak-weekday badge regression', () => {
  it('shows the badge only on a row whose weekdayPeakDay matches today, not on any other row', async () => {
    vi.setSystemTime(TUESDAY_2026_01_06);
    renderWithApp(<TransferScreen />);
    await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [PEAKS_TODAY_MED, PEAKS_OTHER_DAY_MED, NO_PATTERN_MED]);
    fireCollection('lots', []);

    await screen.findByText(PEAKS_TODAY_MED.name);
    const badges = screen.getAllByText('📅 มักใช้มากวันนี้');
    expect(badges).toHaveLength(1);
  });
});
