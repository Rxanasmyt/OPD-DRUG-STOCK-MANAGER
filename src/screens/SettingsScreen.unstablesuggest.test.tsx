// Regression test for a real request: "...ทำข้อ 1 และ 3 แบบดีที่สุด" (item 3 — ตรวจสอบความแม่นยำ
// ของตัวเลขแนะนำ par). suggestPar() (selectors.ts) sizes every par number purely off the most
// recent 30-day usage window (used30) with no stability check at all — while usageAnomalies()
// already flags a ≥40% swing vs the PRIOR 30-day window (usedPrev30), it was never cross-
// referenced against the bulk "ใช้ค่าแนะนำทั้งหมด" apply flow. This locks in the new warning card
// that surfaces exactly which of the meds a bulk apply would actually change also have unstable
// usage, through the real AppProvider/useApp() plumbing.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import SettingsScreen from './SettingsScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener } from '../test-utils/firebaseTestDouble';

// Default parFloorCoverDays=4 / parSubCoverDays=28 (AppContext.tsx) give daily=used30/21.43
// -> floor=roundStep(daily*4), sub=roundStep(daily*28). Starting parFloor/parSub at 0
// guarantees suggestPar's output differs from the live value for every med below.

// Swings 100 -> 1000 (900% up, >= the 40% threshold) AND its suggested par differs from its
// current (0) par — must show up in the warning card.
const UNSTABLE_AND_CHANGING = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 0, parFloor: 0, floor: 50, bin: 'A1',
  noSubstock: false, used30: 1000, usedPrev30: 100, volatility: 1,
};

// Stable usage (1000 -> 1050, a 5% change, well under the 40% threshold) but still a par
// change (0 -> suggested) — must NOT show up in the warning card.
const STABLE_BUT_CHANGING = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 0, parFloor: 0, floor: 50, bin: 'A2',
  noSubstock: false, used30: 1050, usedPrev30: 1000, volatility: 1,
};

// Wildly unstable usage (900% swing) but its par is ALREADY set to exactly what suggestPar
// would compute -> no actual change -> must NOT show up (nothing to warn about applying).
const UNSTABLE_BUT_NOT_CHANGING = {
  id: 'm3', code: 'MED-0003', name: 'Ventolin inhaler', unit: 'ขวด', dosageForm: 'พ่น',
  price: 1, had: false, active: true,
  // suggestPar() blends used30/usedPrev30 70/30 when a real prior-month baseline exists (see its
  // own comment) — blended = 1000*0.7 + 100*0.3 = 730, daily = 730/21.43 ≈ 34.07 ->
  // floor = roundStep(34.07*4) = 140, sub = roundStep(34.07*28) = 1000.
  parSub: 1000, parFloor: 140, floor: 50, bin: 'A3',
  noSubstock: false, used30: 1000, usedPrev30: 100, volatility: 1,
};

async function setup() {
  renderWithApp(<SettingsScreen />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
}

describe('SettingsScreen — unstable-usage warning on bulk par suggestions', () => {
  it('warns about a med whose suggested par would change AND has an unstable usage swing, excluding a stable-change and a no-op-change med', async () => {
    await setup();
    fireCollection('meds', [UNSTABLE_AND_CHANGING, STABLE_BUT_CHANGING, UNSTABLE_BUT_NOT_CHANGING]);
    fireCollection('lots', []);

    await screen.findByText(/1 จาก 2 รายการที่จะเปลี่ยน มีอัตราการใช้ผันผวนมาก/);
    // The per-med swing line ("100 → 1,000 (+900%)") is unique to the new warning card — the
    // med's bare name alone isn't, since parFloor=0 with real usage also trips the pre-existing
    // parAnomalies "no_par_floor" error card for the same fixture.
    expect(screen.getByText('100 → 1,000 (+900%)')).toBeInTheDocument();
    expect(screen.queryByText('1,000 → 1,050 (+5%)')).not.toBeInTheDocument();
  });

  it('shows no warning card when nothing unstable is about to change', async () => {
    await setup();
    fireCollection('meds', [STABLE_BUT_CHANGING, UNSTABLE_BUT_NOT_CHANGING]);
    fireCollection('lots', []);

    await screen.findByRole('button', { name: /ใช้ค่าแนะนำทั้งหมด \(1 รายการเปลี่ยน\)/ });
    expect(screen.queryByText(/รายการที่จะเปลี่ยน มีอัตราการใช้ผันผวนมาก/)).not.toBeInTheDocument();
  });
});
