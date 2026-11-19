// Month calendar of HOSxP file attachment: which days have a file, which don't, and — tapping a
// day — which regularly-dispensed meds were not deducted and why. Time is pinned to a real
// Thursday (2026-01-08) so the weekday/weekend classification is deterministic.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReconcileCalendar from './ReconcileCalendar';
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
const MED_A = MED('1', 'Paracetamol 500mg');
const MED_B = MED('2', 'Amlodipine 5mg');

async function setup() {
  const user = userEvent.setup();
  renderWithApp(<ReconcileCalendar onFixMed={() => {}} />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED_A, MED_B]);
  seedCollection('txs', [
    { type: 'reconcile_hosxp', medId: '1', ts: NOW - 1 * DAY },  // Wed 7 Jan: both meds -> attached
    { type: 'reconcile_hosxp', medId: '2', ts: NOW - 1 * DAY },
    { type: 'reconcile_hosxp', medId: '1', ts: NOW - 2 * DAY },  // Tue 6 Jan: only A -> partial
  ]);
  return user;
}

describe('ReconcileCalendar', () => {
  it('colours each day of the month by attach status', async () => {
    await setup();
    await waitFor(() => expect(screen.getByRole('button', { name: /^7 มกราคม — แนบแล้ว$/ })).toHaveAttribute('data-status', 'attached'));
    expect(screen.getByRole('button', { name: /^6 มกราคม — แนบแล้วแต่ตัดไม่ครบ$/ })).toHaveAttribute('data-status', 'partial');
    expect(screen.getByRole('button', { name: /^5 มกราคม — ยังไม่แนบ$/ })).toHaveAttribute('data-status', 'missing');
    expect(screen.getByRole('button', { name: /^4 มกราคม — เสาร์-อาทิตย์/ })).toHaveAttribute('data-status', 'weekend');
    expect(screen.getByRole('button', { name: /^8 มกราคม — วันนี้/ })).toHaveAttribute('data-status', 'today');
  });

  it('shows which med was not deducted, with its reason, when a partial day is tapped', async () => {
    const user = await setup();
    await user.click(await screen.findByRole('button', { name: /^6 มกราคม — แนบแล้วแต่ตัดไม่ครบ$/ }));
    const detail = screen.getByTestId('reconcile-day-detail');
    expect(detail).toHaveTextContent(MED_B.name);
    expect(detail).not.toHaveTextContent(MED_A.name);
    // No persisted report for this day -> an honest "unknown", not an invented cause.
    expect(detail).toHaveTextContent('ไม่ทราบสาเหตุ');
  });

  it('says plainly that no file was attached on a missing day', async () => {
    const user = await setup();
    await user.click(await screen.findByRole('button', { name: /^5 มกราคม — ยังไม่แนบ$/ }));
    expect(screen.getByTestId('reconcile-day-detail')).toHaveTextContent('ยังไม่มีการแนบไฟล์ HOSxP');
  });
});
