// Regression test for a real request: "เก็บสถิติการใช้ยาแต่ละวัน...รายงานประจำไตรมาส/เดือน/ปีงบ
// ประมาณ...Top 100" — commitUsageImport (AppContext.tsx) used to write ONLY a rolling used30 rate
// per med, overwritten by every later import with no memory of any past period. This locks in
// the durable counterpart: a `usageHistory` doc per matched med per import, carrying the REAL
// qty/value for that exact declared period, through the real AppProvider/useApp() plumbing (not
// a hand-mocked context) via renderWithApp + firebaseTestDouble.
import { describe, it, expect } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import { signInAs, fireCollection, hasListener, getLastBatchWrites } from '../test-utils/firebaseTestDouble';

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 2, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 1,
};

// Drives the same importUsageFile → setUsageDateFrom/To → commitUsageImport flow the real
// SettingsScreen UI wires up, without needing a real file-picker/date-input round trip — this
// is a Firestore-write-shape test, not a UI test (MedsScreen.incomplete.test.tsx and friends
// already cover the UI layer's own behavior elsewhere).
function UsageImportHarness() {
  const { importUsageFile, setUsageDateFrom, setUsageDateTo, commitUsageImport, state } = useApp();
  return (
    <div>
      <div>rows:{(state.usageRows || []).length}</div>
      <button onClick={() => importUsageFile(new File(['Paracetamol 500mg,310'], 'usage-jan.csv', { type: 'text/csv' }))}>import-jan</button>
      <button onClick={() => importUsageFile(new File(['Paracetamol 500mg,620'], 'usage-feb.csv', { type: 'text/csv' }))}>import-feb</button>
      <button onClick={() => { setUsageDateFrom('2026-01-01'); setUsageDateTo('2026-01-31'); }}>set-range-jan</button>
      <button onClick={() => { setUsageDateFrom('2026-02-01'); setUsageDateTo('2026-02-28'); }}>set-range-feb</button>
      <button onClick={commitUsageImport}>commit</button>
    </div>
  );
}

async function setup() {
  const user = userEvent.setup();
  renderWithApp(<UsageImportHarness />);
  await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  return user;
}

describe('commitUsageImport — durable usageHistory regression', () => {
  it('writes a usageHistory record with the REAL period qty/value/category/unit, alongside the existing used30 update', async () => {
    const user = await setup();
    await user.click(screen.getByText('import-jan'));
    await screen.findByText('rows:1');
    await user.click(screen.getByText('set-range-jan'));
    await user.click(screen.getByText('commit'));

    await waitFor(() => expect(getLastBatchWrites().some((w) => w.path.startsWith('usageHistory/'))).toBe(true));
    const writes = getLastBatchWrites();

    const medUpdate = writes.find((w) => w.kind === 'update' && w.path === 'meds/m1');
    // 310 units over a 31-day declared period, normalized to a 30-day rate — same formula
    // commitUsageImport always used for used30, unchanged by this round's work.
    expect(medUpdate?.data).toMatchObject({ used30: 300 });

    const historyWrite = writes.find((w) => w.kind === 'set' && w.path.startsWith('usageHistory/'));
    expect(historyWrite?.data).toMatchObject({
      medId: 'm1', medName: 'Paracetamol 500mg', unit: 'เม็ด', category: 'other',
      qty: 310, value: 620, // 310 * price(2) — the REAL period total, NOT the 30-day-normalized used30 rate
      periodFrom: '2026-01-01', periodTo: '2026-01-31', periodDays: 31,
      monthKey: '2026-01',
    });
  });

  it('is never overwritten by a later import for the same med — both periods survive as separate records', async () => {
    const user = await setup();
    await user.click(screen.getByText('import-jan'));
    await screen.findByText('rows:1');
    await user.click(screen.getByText('set-range-jan'));
    await user.click(screen.getByText('commit'));
    await waitFor(() => expect(getLastBatchWrites().filter((w) => w.path.startsWith('usageHistory/')).length).toBe(1));

    await user.click(screen.getByText('import-feb'));
    await screen.findByText('rows:1');
    await user.click(screen.getByText('set-range-feb'));
    await user.click(screen.getByText('commit'));
    await waitFor(() => expect(getLastBatchWrites().filter((w) => w.path.startsWith('usageHistory/')).length).toBe(2));

    const historyWrites = getLastBatchWrites().filter((w) => w.path.startsWith('usageHistory/'));
    const periods = historyWrites.map((w) => w.data?.periodFrom).sort();
    expect(periods).toEqual(['2026-01-01', '2026-02-01']);
    // Two genuinely distinct docs, not the same one written twice.
    expect(new Set(historyWrites.map((w) => w.path)).size).toBe(2);
  });
});
