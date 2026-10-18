// Regression test for a real request: "ป้องกันการหลุดยาที่มีในระบบแต่ไม่ได้ถูกตัดจำนวนยา และป้องกัน
// การหลุดวันที่ยังไม่ได้แนบไฟล์ เพื่อป้องกันจำนวนยาในระบบไม่ตรงกับจำนวนยาที่ใช้ยาจริง" —
// ReconcileScreen's pre-existing notDeductedLatestDay check only ever looks at the single MOST
// RECENT day with any reconcile_hosxp tx, so a day skipped entirely (the file never attached at
// all) becomes invisible the moment the next day's file IS attached. fetchReconcileGaps instead
// scans a whole lookback window and flags each day as either 'missing' (zero reconcile_hosxp tx
// that day) or 'partial' (reconciled, but a drug that normally moves every day — active &&
// used30 > 0 — got no deduction). See its own doc comment in AppContext.tsx for the full design.
//
// Follow-up real-world explanation: "วันเสาร์อาทิตย์ที่เป็นวันหยุดราชการ...โดยปกติจะไม่มีการตัดยอด" —
// this hospital routinely has NO HOSxP reconcile at all on Sat/Sun, so every weekend day used to
// show up as a permanent false 'missing' flag, every single week. fetchReconcileGaps now skips
// Sun/Sat entirely from the scan — see the dedicated describe block below.
//
// Time is pinned to a real Thursday (2026-01-08) so "yesterday"/"the day before" in every test
// below land on real weekdays regardless of which real calendar day this suite happens to run on
// — otherwise a test run on certain days of the week would spuriously hit the new weekend-skip
// and break for a reason unrelated to what it's actually testing.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useState } from 'react';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, seedCollection, hasListener } from '../test-utils/firebaseTestDouble';
import type { ReconcileGapDay } from '../types';

const DAY = 86400000;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
function bangkokNoon(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d, 12, 0) - BANGKOK_OFFSET_MS;
}
// A real Thursday — i=1 (Wed) and i=2 (Tue) both land on ordinary weekdays.
const NOW = bangkokNoon(2026, 0, 8);

beforeEach(() => vi.setSystemTime(NOW));
afterEach(() => vi.useRealTimers());

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
    // Yesterday (i=1, Wed) fully covered; the day before (i=2, Tue) has no reconcile_hosxp tx
    // whatsoever.
    seedCollection('txs', [
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: NOW - 1 * DAY },
    ]);

    await user.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(screen.getByTestId('gap-' + isoDay(2))).toHaveTextContent('missing'));
    expect(screen.queryByTestId('gap-' + isoDay(1))).not.toBeInTheDocument();
  });

  it('flags a reconciled day as "partial" when a regularly-dispensed med got no deduction, naming only that med', async () => {
    const user = userEvent.setup();
    renderWithApp(<GapsHarness days={1} />);
    await setup([MED_A, MED_B]);
    // Yesterday (Wed): only MED_A got a reconcile_hosxp tx — MED_B (also regularly dispensed)
    // did not.
    seedCollection('txs', [
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: NOW - 1 * DAY },
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

  // Real-world report: a screenshot of this exact panel showing 100+ "ตัดไม่ครบ" items a day,
  // almost all emergency/ICU injectables (Adenosine, Amiodarone, Dopamine, ...) kept in stock
  // for rare cases (a refer-back case from รพ.ยะลา, say) rather than genuinely daily drugs —
  // see Med.dispenseDays30's own doc comment (types.ts) and isRegularlyDispensed()'s
  // (selectors.ts) for the full fix.
  it('never flags a med with real quantity but low day-frequency (dispenseDays30) as a "partial" leak — the exact false-positive case reported', async () => {
    const user = userEvent.setup();
    const emergencyDrug = { ...MED_B, id: 'm4', name: 'Adenosine 3 mg/ml Vial', used30: 30, dispenseDays30: 2 };
    renderWithApp(<GapsHarness days={1} />);
    await setup([MED_A, emergencyDrug]);
    // Yesterday: only MED_A got a reconcile_hosxp tx — the emergency drug did not, same as most
    // days of the month for a real sporadic-use drug.
    seedCollection('txs', [
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: NOW - 1 * DAY },
    ]);

    await user.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(screen.getByTestId('gap-count')).toHaveTextContent('0'));
    expect(screen.queryByTestId('gap-' + isoDay(1))).not.toBeInTheDocument();
  });

  it('excludes today itself from the scan even with zero reconcile_hosxp tx today', async () => {
    const user = userEvent.setup();
    renderWithApp(<GapsHarness days={1} />);
    await setup([MED_A]);
    // Yesterday (Wed) fully covered; today has nothing yet (still in progress) — must not appear.
    seedCollection('txs', [
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: NOW - 1 * DAY },
    ]);

    await user.click(screen.getByRole('button', { name: 'run' }));
    // Fully covered and no gaps at all expected — gap-count appearing (even at 0) confirms the
    // click's own async call actually resolved, rather than asserting on a row that never shows.
    await waitFor(() => expect(screen.getByTestId('gap-count')).toHaveTextContent('0'));
    expect(screen.queryByTestId('gap-' + isoDay(0))).not.toBeInTheDocument();
    expect(screen.queryByTestId('gap-' + isoDay(1))).not.toBeInTheDocument();
  });
});

// Real-world explanation: "วันเสาร์อาทิตย์ที่เป็นวันหยุดราชการ...โดยปกติจะไม่มีการตัดยอด ถ้า Admin
// ไม่ได้อยู่เวรเสาร์อาทิตย์...จะตัดยอดอีกทีเช้าวันจันทร์" — a weekend day with no reconcile at all is
// the hospital's normal routine, not a real gap; it must never surface as 'missing' the way a
// skipped WEEKDAY genuinely should.
describe('fetchReconcileGaps — weekend skip regression', () => {
  // With NOW pinned to Thursday 2026-01-08: i=1..3 are Wed/Tue/Mon (real weekdays), i=4 is
  // Sunday, i=5 is Saturday.
  it('never flags Saturday or Sunday as "missing" even with zero reconcile_hosxp tx on either day', async () => {
    const user = userEvent.setup();
    renderWithApp(<GapsHarness days={5} />);
    await setup([MED_A]);
    // Only Wed (i=1) reconciled — Tue (i=2) and Mon (i=3) are real weekday gaps; Sun (i=4) and
    // Sat (i=5) must be silently skipped, not reported, despite also having zero tx.
    seedCollection('txs', [
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: NOW - 1 * DAY },
    ]);

    await user.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(screen.getByTestId('gap-' + isoDay(2))).toHaveTextContent('missing')); // Tue
    expect(screen.getByTestId('gap-' + isoDay(3))).toHaveTextContent('missing'); // Mon
    expect(screen.queryByTestId('gap-' + isoDay(4))).not.toBeInTheDocument(); // Sun
    expect(screen.queryByTestId('gap-' + isoDay(5))).not.toBeInTheDocument(); // Sat
    // Only the 2 real weekday gaps — not 4 (which a naive weekend-blind scan would report).
    expect(screen.getByTestId('gap-count')).toHaveTextContent('2');
  });

  it('does not penalize a weekend day that DID get a real reconcile (an on-duty admin that weekend)', async () => {
    const user = userEvent.setup();
    renderWithApp(<GapsHarness days={5} />);
    await setup([MED_A, MED_B]);
    // Every real weekday (Wed/Tue/Mon) fully covered for both meds — no weekday gaps at all.
    // Sat (i=5): reconciled, but only MED_A — MED_B got no deduction, which WOULD be 'partial'
    // if this day were evaluated at all. It never is (weekend days are skipped outright), so it
    // must not surface either way.
    seedCollection('txs', [
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: NOW - 1 * DAY },
      { type: 'reconcile_hosxp', medId: MED_B.id, ts: NOW - 1 * DAY },
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: NOW - 2 * DAY },
      { type: 'reconcile_hosxp', medId: MED_B.id, ts: NOW - 2 * DAY },
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: NOW - 3 * DAY },
      { type: 'reconcile_hosxp', medId: MED_B.id, ts: NOW - 3 * DAY },
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: NOW - 5 * DAY }, // Sat — MED_B missing
    ]);

    await user.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(screen.getByTestId('gap-count')).toHaveTextContent('0'));
    expect(screen.queryByTestId('gap-' + isoDay(5))).not.toBeInTheDocument();
  });
});

// Real-world explanation: "เช้าวันจันทร์จะตัดยอดหน้างานโดยแนบไฟล์ ของวันศุกร์ เสาร์และอาทิตย์ เป็น
// จำนวน 3 วัน" — a Monday-dated reconcile's coveredFrom/coveredTo reaches back further than its
// own `ts`. Before this, Friday (not just the weekend) would show as a false 'missing' every
// single week, since nothing was ever dated with Friday's own ts.
describe('fetchReconcileGaps — Monday multi-day catch-up regression', () => {
  it('marks Friday as covered by a Monday tx whose coveredFrom reaches back to it, not just its own ts date', async () => {
    const user = userEvent.setup();
    // days=6 from this Thursday anchor reaches: Wed(i1), Tue(i2), Mon(i3), Sun(i4, skipped),
    // Sat(i5, skipped), Fri(i6).
    renderWithApp(<GapsHarness days={6} />);
    await setup([MED_A]);
    // The ONLY tx in the whole window: dated Monday (ts = NOW - 3*DAY), but covering last
    // Friday through Sunday combined — exactly the real Fri-Sat-Sun catch-up pattern.
    seedCollection('txs', [
      { type: 'reconcile_hosxp', medId: MED_A.id, ts: NOW - 3 * DAY, coveredFrom: isoDay(6), coveredTo: isoDay(4) },
    ]);

    await user.click(screen.getByRole('button', { name: 'run' }));
    await waitFor(() => expect(screen.getByTestId('gap-count')).toHaveTextContent('3')); // Wed/Tue/Mon genuinely uncovered
    expect(screen.queryByTestId('gap-' + isoDay(6))).not.toBeInTheDocument(); // Friday — covered via the Monday tx's range
    expect(screen.getByTestId('gap-' + isoDay(1))).toHaveTextContent('missing'); // Wed
    expect(screen.getByTestId('gap-' + isoDay(2))).toHaveTextContent('missing'); // Tue
    expect(screen.getByTestId('gap-' + isoDay(3))).toHaveTextContent('missing'); // Mon itself — genuinely not covered by this tx
  });
});

// Mirrors isoDate()'s own Bangkok-anchored conversion (utils/format.ts) so expected test ids
// never depend on the host machine's own timezone.
function isoDay(daysAgo: number): string {
  const shifted = new Date(NOW - daysAgo * DAY + BANGKOK_OFFSET_MS);
  const y = shifted.getUTCFullYear();
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
