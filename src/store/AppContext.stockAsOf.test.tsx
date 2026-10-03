// Regression test for a real request: "ทำอย่างไรให้แอพมีความเสถียรที่สุดเหมือนโปรแกรม Hosxp...
// ดูย้อนหลังได้เสมอ" — Firestore only ever holds the CURRENT floor/lot quantities (no built-in
// history), so fetchStockAsOf reconstructs a point-in-time stock level by walking the txs log
// BACKWARD from the known-correct live value, subtracting every logged delta that happened
// AFTER the target date. This locks in that the reconstruction lands on the exact right number
// for both a floor-only (noSubstock) med and a substock-backed one, through the real
// AppProvider/useApp() plumbing (not a hand-mocked context) via renderWithApp + firebaseTestDouble.
import { describe, it, expect } from 'vitest';
import { useEffect, useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';

// noSubstock — floor only, no substock stage at all.
const NOSUB_MED = {
  id: 'm1', code: 'MED-0001', name: 'Ventolin inhaler', unit: 'ขวด', dosageForm: 'พ่น',
  price: 50, had: false, active: true, parSub: 0, parFloor: 20, floor: 30, bin: 'A1',
  noSubstock: true, used30: 0, usedPrev30: 0, volatility: 1,
};
// Substock-backed med.
const SUB_MED = {
  id: 'm2', code: 'MED-0002', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 2, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A2', binSub: 'S2',
  noSubstock: false, used30: 0, usedPrev30: 0, volatility: 1,
};
const LOT = { id: 'lot1', medId: SUB_MED.id, lotNo: 'L1', qty: 300, exp: Date.now() + 300 * 86400000 };

const DAY = 86400000;
const now = Date.now();

function StockAsOfHarness({ dateMs }: { dateMs: number }) {
  const { fetchStockAsOf } = useApp();
  const [rows, setRows] = useState<{ medId: string; floor: number; sub: number }[] | null>(null);
  useEffect(() => { fetchStockAsOf(dateMs).then(setRows); }, [fetchStockAsOf, dateMs]);
  if (!rows) return <div>loading</div>;
  return (
    <div>
      {rows.map((r) => <div key={r.medId} data-testid={'row-' + r.medId}>{r.floor}:{r.sub}</div>)}
    </div>
  );
}

async function setup() {
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [NOSUB_MED, SUB_MED]);
  fireCollection('lots', [LOT]);
}

describe('fetchStockAsOf — point-in-time stock reconstruction regression', () => {
  it('matches the live value exactly when asking for "today" (zero deltas to subtract)', async () => {
    renderWithApp(<StockAsOfHarness dateMs={now} />);
    await setup();
    seedCollection('txs', []);

    await waitFor(() => expect(screen.getByTestId('row-' + NOSUB_MED.id)).toHaveTextContent('30:0'));
    expect(screen.getByTestId('row-' + SUB_MED.id)).toHaveTextContent('40:300');
  });

  it('subtracts a floor adjustment that happened AFTER the target date, reconstructing the earlier (smaller) floor', async () => {
    // Floor is currently 30 (live) — a +10 adjust happened 2 days ago (AFTER a target date of
    // 5 days ago), so 5 days ago it must have been 30 - 10 = 20.
    renderWithApp(<StockAsOfHarness dateMs={now - 5 * DAY} />);
    await setup();
    seedCollection('txs', [
      { type: 'adjust', ts: now - 2 * DAY, qty: 10, name: NOSUB_MED.name, medId: NOSUB_MED.id, loc: 'floor' },
    ]);

    await waitFor(() => expect(screen.getByTestId('row-' + NOSUB_MED.id)).toHaveTextContent('20:0'));
  });

  it('subtracts a substock receive that happened AFTER the target date, without touching floor (receive_from_central to substock never affects floor)', async () => {
    // Substock currently 300 (live) — a +200 receive from central landed in substock
    // (receive_from_central, to:'substock') 3 days ago, AFTER a target date of 5 days ago, so
    // 5 days ago it must have been 300 - 200 = 100. Floor must stay untouched (40) since this
    // tx type only matches the floor ledger when to==='floor' — see fetchFloorLedger's own
    // receive_from_central guard.
    renderWithApp(<StockAsOfHarness dateMs={now - 5 * DAY} />);
    await setup();
    seedCollection('txs', [
      { type: 'receive_from_central', ts: now - 3 * DAY, qty: 200, name: SUB_MED.name, medId: SUB_MED.id, to: 'substock' },
    ]);

    await waitFor(() => expect(screen.getByTestId('row-' + SUB_MED.id)).toHaveTextContent('40:100'));
  });

  it('excludes an untagged tx row whose name is ambiguous between two active meds (no medId tag)', async () => {
    const TWIN = { ...SUB_MED, id: 'm3', ward: 'ipd' as const, floor: 5, bin: 'B9' };
    renderWithApp(<StockAsOfHarness dateMs={now - 5 * DAY} />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [NOSUB_MED, SUB_MED, TWIN]);
    fireCollection('lots', [LOT]);
    // No medId tag, and two active meds now share SUB_MED's name — must be excluded from both,
    // not guessed onto either (same "incomplete-but-correct" rule fetchFloorLedger documents).
    seedCollection('txs', [
      { type: 'adjust', ts: now - 2 * DAY, qty: 999, name: SUB_MED.name, loc: 'floor' },
    ]);

    await waitFor(() => expect(screen.getByTestId('row-' + SUB_MED.id)).toHaveTextContent('40:300'));
    // TWIN has no lots of its own (LOT above is tagged to SUB_MED's id) — 0 sub is correct and
    // unrelated to the ambiguous-row exclusion; what this test actually pins down is that
    // SUB_MED's floor (40) above was NOT corrupted by the untagged qty:999 row.
    expect(screen.getByTestId('row-' + TWIN.id)).toHaveTextContent('5:0');
  });
});
