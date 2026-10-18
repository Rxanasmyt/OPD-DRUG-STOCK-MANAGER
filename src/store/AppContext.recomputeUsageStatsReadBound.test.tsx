// Regression test for a read-volume fix ("ปรับการอ่านข้อมูลของแอพให้น้อยที่สุด"): recomputeUsageStats()
// used to query Firestore with `where('type','==','reconcile_hosxp')`, unbounded by date — this
// hospital's ENTIRE reconcile_hosxp history, re-read in full every time this runs (and it now
// runs automatically after every single HOSxP reconcile — see AppContext.autoRecomputeAfterReconcile.test.tsx —
// not just from a rare manual button click), even though only the most recent 60 days are ever
// actually used. Bounded to a fetchTxsAfter(now - 61 days) query instead (see this function's
// own "Bug fix (Firestore read volume)" comment, AppContext.tsx) — the query itself can no
// longer filter by `type` server-side without a new composite index, so a client-side
// `if (x.type !== 'reconcile_hosxp') return;` check has to do that job now instead. This locks
// in that the client-side check actually works: a non-reconcile tx in the same window must
// never leak into used30/usedPrev30.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, seedCollection, getLastBatchWrites } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function Harness() {
  const { recomputeUsageStats } = useApp();
  return <button onClick={() => void recomputeUsageStats()}>recompute</button>;
}

describe('recomputeUsageStats — tx-type filtering regression', () => {
  it('sums only real reconcile_hosxp dispensing into used30, ignoring other tx types in the same window', async () => {
    const user = userEvent.setup();
    renderWithApp(<Harness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedCollection('txs', [
      { type: 'reconcile_hosxp', name: MED.name, medId: MED.id, qty: -10, unit: 'เม็ด', by: 'u1', ts: Date.now() - 1 * 86400000 },
      { type: 'reconcile_hosxp', name: MED.name, medId: MED.id, qty: -10, unit: 'เม็ด', by: 'u1', ts: Date.now() - 2 * 86400000 },
      // A transfer in the SAME recent window — if the client-side type guard were missing,
      // this would wrongly inflate used30 far past the real 20-unit reconcile total.
      { type: 'transfer_to_floor', name: MED.name, medId: MED.id, qty: -500, unit: 'เม็ด', by: 'u1', ts: Date.now() - 1 * 86400000 },
    ]);

    await user.click(screen.getByRole('button', { name: 'recompute' }));
    await waitFor(() => expect(getLastBatchWrites().length).toBeGreaterThan(0));

    const [write] = getLastBatchWrites();
    expect(write.path).toBe('meds/m1');
    expect(write.data!.used30).toBe(20); // 10 + 10 reconcile_hosxp only, never +500
  });
});

// Real-world report: a screenshot of ReconcileScreen's gap-detector showing 100+ "ตัดไม่ครบ"
// false positives a day, almost all emergency/ICU injectables with real but sporadic usage —
// see Med.dispenseDays30's own doc comment (types.ts) for the full story. This locks in that
// recomputeUsageStats() actually computes the new field correctly: a FREQUENCY count (distinct
// real calendar days), not a repeat of the quantity sum used30 already tracks.
describe('recomputeUsageStats — dispenseDays30 computation regression', () => {
  const DAY = 86400000;

  it('counts distinct calendar days, not raw tx count — two txs on the same day count once', async () => {
    const user = userEvent.setup();
    renderWithApp(<Harness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    seedCollection('txs', [
      { type: 'reconcile_hosxp', name: MED.name, medId: MED.id, qty: -5, unit: 'เม็ด', by: 'u1', ts: Date.now() - 1 * DAY },
      // A second, separate reconcile row landing the SAME real day (e.g. two package-size rows
      // for the same drug) — must still count as only 1 distinct day.
      { type: 'reconcile_hosxp', name: MED.name, medId: MED.id, qty: -3, unit: 'เม็ด', by: 'u1', ts: Date.now() - 1 * DAY + 1000 },
      { type: 'reconcile_hosxp', name: MED.name, medId: MED.id, qty: -5, unit: 'เม็ด', by: 'u1', ts: Date.now() - 2 * DAY },
    ]);

    await user.click(screen.getByRole('button', { name: 'recompute' }));
    await waitFor(() => expect(getLastBatchWrites().length).toBeGreaterThan(0));

    const [write] = getLastBatchWrites();
    expect(write.data!.dispenseDays30).toBe(2); // 2 distinct days, not 3 raw tx rows
  });

  it('spreads a multi-day covered batch (Monday catch-up) across its own real days, not just one', async () => {
    const user = userEvent.setup();
    renderWithApp(<Harness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [MED]);
    const { isoDate } = await import('../utils/format');
    const mondayTs = Date.now() - 1 * DAY;
    seedCollection('txs', [
      // One combined tx logged "today" (ts) but covering 3 real days (Fri-Sat-Sun) — must count
      // as 3 distinct days, not 1 (the day it happened to be committed on).
      {
        type: 'reconcile_hosxp', name: MED.name, medId: MED.id, qty: -30, unit: 'เม็ด', by: 'u1', ts: mondayTs,
        coveredFrom: isoDate(mondayTs - 2 * DAY), coveredTo: isoDate(mondayTs),
      },
    ]);

    await user.click(screen.getByRole('button', { name: 'recompute' }));
    await waitFor(() => expect(getLastBatchWrites().length).toBeGreaterThan(0));

    const [write] = getLastBatchWrites();
    expect(write.data!.dispenseDays30).toBe(3);
  });
});
