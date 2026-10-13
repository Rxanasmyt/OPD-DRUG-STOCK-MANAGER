// Regression test for a real request: "ป้องกันการหลุดยาที่มีในระบบแต่ไม่ได้ถูกตัดจำนวนยา และป้องกัน
// การหลุดวันที่ยังไม่ได้แนบไฟล์ เพื่อป้องกันจำนวนยาในระบบไม่ตรงกับจำนวนยาที่ใช้ยาจริง" —
// ReconcileScreen's pre-existing notDeductedLatestDay check only ever looks at the single MOST
// RECENT day with any reconcile_hosxp tx, so a day skipped entirely (the file never attached at
// all) becomes invisible the moment the next day's file IS attached. fetchReconcileGaps instead
// scans a whole lookback window and flags each day as either 'missing' (zero reconcile_hosxp tx
// that day) or 'partial' (reconciled, but a drug that normally moves every day — active &&
// used30 > 0 — got no deduction). See its own doc comment in AppContext.tsx for the full design.
import { describe, it, expect } from 'vitest';
import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';
import type { ReconcileGapDay } from '../types';

const DAY = 86400000;
const now = Date.now();

// Both regularly dispensed (active && used30 > 0) — the exact shape fetchReconcileGaps' own
// 'partial' check targets.
const MED_A = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 300, usedPrev30: 300, volatility: 0,
};
const MED_B = {
  id: 'm2', code: 'MED-0002', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 2, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A2',
  used30: 200, usedPrev30: 200, volatility: 0,
};
// Genuinely rare — active but used30 === 0 — must never surface as a 'partial' leak no matter
// which days it's missing from, per notDeductedLatestDay's own "plenty of genuinely-rare drugs"
// reasoning that fetchReconcileGaps shares.
const MED_RARE = {
  id: 'm3', code: 'MED-0003', name: 'Rare Drug', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 3, had: false, active: true, parSub: 50, parFloor: 10, floor: 5, bin: 'A3',
  used30: 0, usedPrev30: 0, volatility: 0,
};

// Button-triggered rather than an auto-fire-on-mount useEffect — fetchReconcileGaps reads
// Firestore directly (not state.txs), so calling it explicitly AFTER the test has already
// seeded meds/txs (rather than racing an effect against sign-in + collection seeding) is both
// simpler and exactly how the real ReconcileScreen's own first render would behave once meds
// has actually loaded.
function GapsHarness({ days }: { days: number }) {
  const { fetchReconcileGaps } = useApp();
  const [result, setResult] = useState<ReconcileGapDay[] | null>(null);
  return (
    <div>
      <button onClick={() => fetchReconcileGaps(days).then(setResult)}>run</button>
      {result && <div data-testid="gap-count">{result.length}</div>}
      {result && result.map((g) => (
        <div key={g.dateIso} data-testid={'gap-' + g.dateIso}>
          {g.kind}{g.kind === 'partial' ? ':' + g.missingMeds.map((m) => m.id).join(',') : ''}
        </div>
      ))}
    </div>
  );
}

async function setup(meds: Record<string, unknown>[]) {
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', meds);
}

describe('fetchReconcileGaps — missed-day and per-day leak detection regression', () => {
  it('flags a calendar day with zero reconcile_hosxp tx at all as "missing"', async () => {
    const user = userEvent.setup();
    renderWithApp(<GapsHarness days={2} />);
    await setup([MED_A]);
    // Yesterday (i=1) fully covered; the day before (i=2) has no reconcile_hosxp tx whatsoever.
    seedCollection('txs', [
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: now - 1 * DAY },
    ]);

    await user.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(screen.getByTestId('gap-' + isoDay(2))).toHaveTextContent('missing'));
    expect(screen.queryByTestId('gap-' + isoDay(1))).not.toBeInTheDocument();
  });

  it('flags a reconciled day as "partial" when a regularly-dispensed med got no deduction, naming only that med', async () => {
    const user = userEvent.setup();
    renderWithApp(<GapsHarness days={1} />);
    await setup([MED_A, MED_B]);
    // Yesterday: only MED_A got a reconcile_hosxp tx — MED_B (also regularly dispensed) did not.
    seedCollection('txs', [
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: now - 1 * DAY },
    ]);

    await user.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(screen.getByTestId('gap-' + isoDay(1))).toHaveTextContent('partial'));
    const row = screen.getByTestId('gap-' + isoDay(1));
    expect(row).toHaveTextContent(MED_B.id);
    expect(row).not.toHaveTextContent(MED_A.id);
  });

  it('never flags a genuinely-rare med (used30 === 0) as a "partial" leak even when it has no deduction', async () => {
    const user = userEvent.setup();
    renderWithApp(<GapsHarness days={1} />);
    await setup([MED_A, MED_RARE]);
    // Both MED_A and MED_RARE get no deduction yesterday — only MED_A (used30 > 0) should count.
    seedCollection('txs', []);

    await user.click(screen.getByRole('button', { name: 'run' }));
    // No reconcile_hosxp tx at all that day — this is the 'missing' case, not 'partial' — and
    // MED_RARE must never appear even listed as missing, since it's genuinely allowed to go
    // days without being dispensed.
    await waitFor(() => expect(screen.getByTestId('gap-' + isoDay(1))).toHaveTextContent('missing'));
    expect(screen.getByTestId('gap-' + isoDay(1))).not.toHaveTextContent(MED_RARE.id);
  });

  it('excludes today itself from the scan even with zero reconcile_hosxp tx today', async () => {
    const user = userEvent.setup();
    renderWithApp(<GapsHarness days={1} />);
    await setup([MED_A]);
    // Yesterday fully covered; today has nothing yet (still in progress) — must not appear.
    seedCollection('txs', [
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: now - 1 * DAY },
    ]);

    await user.click(screen.getByRole('button', { name: 'run' }));
    // Fully covered and no gaps at all expected — gap-count appearing (even at 0) confirms the
    // click's own async call actually resolved, rather than asserting on a row that never shows.
    await waitFor(() => expect(screen.getByTestId('gap-count')).toHaveTextContent('0'));
    expect(screen.queryByTestId('gap-' + isoDay(0))).not.toBeInTheDocument();
    expect(screen.queryByTestId('gap-' + isoDay(1))).not.toBeInTheDocument();
  });
});

// Mirrors isoDate()'s own Bangkok-anchored conversion (utils/format.ts) so expected test ids
// never depend on the host machine's own timezone.
function isoDay(daysAgo: number): string {
  const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
  const shifted = new Date(now - daysAgo * DAY + BANGKOK_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
