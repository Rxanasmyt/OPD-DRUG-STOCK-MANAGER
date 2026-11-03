// Regression test for a real request: "สร้าง dashboard สรุปผลการเติมยา" — a dedicated summary of
// real transfer_to_floor (เติมหน้างาน) activity. See ReplenishTab.tsx's own doc comment and
// replenishByMed's (selectors.ts) for the full design.
import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportScreen from './ReportScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

vi.mock('../utils/csv', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../utils/csv')>();
  return { ...actual, downloadCsv: vi.fn(async () => 'saved' as const) };
});
import { downloadCsv } from '../utils/csv';

const MED_COMMON = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  category: 'pain', used30: 0, usedPrev30: 0, volatility: 0,
};
// A frequently-refilled, higher-value drug — should outrank MED_COMMON in the by-value table
// despite fewer raw units, and should trip the "เติมบ่อยผิดปกติ" flag (≥ 0.5/day over 7 days).
const MED_EXPENSIVE = {
  id: 'm2', code: 'MED-0002', name: 'Imipenem 500mg', unit: 'vial', dosageForm: 'vial',
  price: 500, had: true, active: true, parSub: 50, parFloor: 10, floor: 5, bin: 'B1',
  category: 'antimicrobial', used30: 0, usedPrev30: 0, volatility: 0,
};

function refillTx(overrides: Partial<Record<string, unknown>> = {}) {
  return { id: 't', type: 'transfer_to_floor', name: MED_COMMON.name, medId: MED_COMMON.id, qty: -20, unit: 'เม็ด', by: 'ทดสอบ ภก.', ts: Date.now(), ...overrides };
}

async function openReplenishTab(txs: ReturnType<typeof refillTx>[]) {
  const user = userEvent.setup();
  renderWithApp(<ReportScreen />);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED_COMMON, MED_EXPENSIVE]);
  fireCollection('lots', []);
  seedCollection('txs', txs);

  await user.click(screen.getByRole('button', { name: '🔄 เติมหน้างาน' }));
  await screen.findByRole('button', { name: 'ดึงรายงาน' });
  return user;
}

describe('ReportScreen — เติมหน้างาน (replenish) dashboard regression', () => {
  it('shows total events/value stat tiles and the by-value table ranked by value, not raw qty', async () => {
    const user = await openReplenishTab([
      refillTx({ id: 't1', medId: MED_COMMON.id, name: MED_COMMON.name, qty: -300 }), // value 300
      refillTx({ id: 't2', medId: MED_EXPENSIVE.id, name: MED_EXPENSIVE.name, unit: 'vial', qty: -2 }), // value 1000
    ]);
    await user.click(screen.getByRole('button', { name: 'ดึงรายงาน' }));

    await screen.findByText('จำนวนครั้งที่เติมหน้างาน');
    expect(screen.getByText('2')).toBeInTheDocument(); // total event count tile
    // Total value: 300 + 1000 = 1,300 บาท.
    await screen.findByText('1,300 บาท');

    // Imipenem (higher VALUE despite only 2 units) must rank above Paracetamol (300 units) in
    // the by-value table.
    const rows = await screen.findAllByText(/Paracetamol 500mg|Imipenem 500mg/);
    const names = rows.map((el) => el.textContent);
    expect(names.indexOf('Imipenem 500mg')).toBeLessThan(names.indexOf('Paracetamol 500mg'));
  });

  it('flags a med refilled on average more than once every 2 days as "เติมบ่อยผิดปกติ"', async () => {
    const DAY = 86400000;
    const txs = Array.from({ length: 4 }, (_, i) => refillTx({ id: 't' + i, ts: Date.now() - i * DAY, medId: MED_EXPENSIVE.id, name: MED_EXPENSIVE.name, unit: 'vial', qty: -1 }));
    const user = await openReplenishTab(txs);
    // 4 events / 7 days = 0.57/day, past the 0.5 threshold (4/30 on the default range would not be).
    await user.click(screen.getByRole('button', { name: '7 วันล่าสุด' }));
    await user.click(screen.getByRole('button', { name: 'ดึงรายงาน' }));

    await screen.findByText(/เติมหน้างานบ่อยผิดปกติ/);
    await screen.findByText(/เติม 4 ครั้ง/);
    expect(screen.getAllByText('Imipenem 500mg').length).toBeGreaterThan(0);
  });

  it('shows no "เติมบ่อยผิดปกติ" section when nothing crosses the threshold', async () => {
    const user = await openReplenishTab([refillTx({ id: 't1' })]);
    await user.click(screen.getByRole('button', { name: 'ดึงรายงาน' }));
    await screen.findByText('จำนวนครั้งที่เติมหน้างาน');
    expect(screen.queryByText(/เติมหน้างานบ่อยผิดปกติ$/)).not.toBeInTheDocument();
  });

  it('exports a CSV with one row per real transfer event, using the absolute qty', async () => {
    const user = await openReplenishTab([refillTx({ id: 't1', qty: -20 })]);
    await user.click(screen.getByRole('button', { name: 'ดึงรายงาน' }));
    await screen.findByText('จำนวนครั้งที่เติมหน้างาน');

    await user.click(screen.getByRole('button', { name: /Export CSV/ }));
    await waitFor(() => expect(vi.mocked(downloadCsv).mock.calls.length).toBeGreaterThan(0));
    const [rows] = vi.mocked(downloadCsv).mock.calls[0];
    const header = rows[0] as string[];
    const qtyCol = header.indexOf('จำนวนที่เติม');
    expect(qtyCol).toBeGreaterThan(-1);
    expect((rows[1] as (string | number)[])[qtyCol]).toBe(20); // positive, not -20
  });
});
