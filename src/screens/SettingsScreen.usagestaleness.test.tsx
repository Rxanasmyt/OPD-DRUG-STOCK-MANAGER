// Regression test for a real request: "used30 ไม่มีการคำนวณใหม่อัตโนมัติ...ไม่มีสัญญาณเตือนว่า
// ข้อมูลเก่าแค่ไหนแล้ว" — SettingsScreen now shows when usage stats (the only inputs suggestPar()
// reads) were last recomputed, via the meta/settings doc's usageStatsRecomputedAt field written
// by recomputeUsageStats() (AppContext.tsx) and the scheduled scripts/recompute-usage-stats.mjs
// job, and visibly warns once it's gone stale (≥2 days — the scheduled job runs daily).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import SettingsScreen from './SettingsScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, fireDoc, hasListener } from '../test-utils/firebaseTestDouble';

afterEach(() => vi.useRealTimers());

async function setup() {
  renderWithApp(<SettingsScreen />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', []);
  fireCollection('lots', []);
}

describe('SettingsScreen — usage-stats staleness regression', () => {
  it('shows a plain "computed today" line, no staleness warning, right after a fresh recompute', async () => {
    vi.setSystemTime(new Date('2026-06-15T09:00:00Z').getTime());
    await setup();
    fireDoc('meta/settings', { usageStatsRecomputedAt: Date.now() });

    const line = await screen.findByText(/คำนวณสถิติการใช้ยาล่าสุด.*\(วันนี้\)/);
    expect(line.textContent).not.toMatch(/นานกว่าปกติ/);
  });

  it('warns when the last recompute is 2+ days old', async () => {
    const now = new Date('2026-06-15T09:00:00Z').getTime();
    vi.setSystemTime(now);
    await setup();
    fireDoc('meta/settings', { usageStatsRecomputedAt: now - 3 * 24 * 60 * 60 * 1000 });

    await screen.findByText(/คำนวณสถิติการใช้ยาล่าสุด.*\(3 วันที่แล้ว\).*นานกว่าปกติ/);
  });

  it('tells the admin to run it at least once when it has never run at all', async () => {
    await setup();
    // No fireDoc('meta/settings', ...) at all — usageStatsRecomputedAt stays its default null.
    await screen.findByText(/ยังไม่เคยคำนวณสถิติการใช้ยาเลย/);
  });
});
