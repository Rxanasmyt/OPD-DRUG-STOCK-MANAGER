// Regression tests for a real request: "ช่วยพัฒนาระบบตัดยอดหน้างานจากhosxp...ให้ตัดยอดได้ดีที่สุด
// แม่นยำที่สุด และทำยังไงให้ป้องกันการแนบไฟล์ผิดวัน หรือสามารถรู้ได้ว่าวันไหนที่ทำการแนบไฟล์ไปแล้ว
// วันไหนยังไม่แนบ ตอนนี้ไม่รู้อะไรเลย" — two real gaps the existing double-run check (same-day
// re-paste only) never covered: (1) hosxpCoveredFrom used to default to a blind "yesterday only"
// regardless of what the LAST reconcile actually covered, silently dropping Friday/Saturday's
// coverage on a Monday catch-up unless the admin remembered to widen it by hand; (2) nothing ever
// cross-checked a NEW file's covered range against what was already accounted for, so a forgotten
// widen (a real gap) or an accidental re-cover (a real overlap/double-deduction risk) both went
// through with zero warning. See smartHosxpCoveredFrom's and commitReconcile's own doc comments
// (AppContext.tsx) and lastReconcileCoveredToIso's (selectors.ts).
//
// Time is pinned (same convention as AppContext.reconcileGaps.test.tsx) so the Fri/Sat/Sun
// weekday-skip math below is deterministic regardless of which real calendar day this suite
// happens to run on. 2026-01-08 is a real Thursday.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { useEffect } from 'react';
import { screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useApp } from './AppContext';
import ReconcileScreen from '../screens/ReconcileScreen';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import ConfirmDialog from '../components/ConfirmDialog';
import { signInAs, fireCollection, hasListener, getLastTransactionWrites, seedDoc } from '../test-utils/firebaseTestDouble';

const DAY = 86400000;
const BANGKOK_OFFSET_MS = 7 * 60 * 60 * 1000;
function bangkokNoon(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d, 12, 0) - BANGKOK_OFFSET_MS;
}
function isoAt(y: number, m: number, d: number): string {
  return [y, String(m + 1).padStart(2, '0'), String(d).padStart(2, '0')].join('-');
}

// 2026-01-08 Thu, 09 Fri, 10 Sat, 11 Sun, 12 Mon, 13 Tue.
const THU = isoAt(2026, 0, 8);
const FRI = isoAt(2026, 0, 9);
const SAT = isoAt(2026, 0, 10);
const SUN = isoAt(2026, 0, 11);
const MON = isoAt(2026, 0, 12);
const TUE = isoAt(2026, 0, 13);

const MED = {
  id: 'm1', code: 'MED-0001', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  used30: 0, usedPrev30: 0, volatility: 0,
};

function Harness() {
  const { state, setHosxpText, processHosxp } = useApp();
  useEffect(() => { if (!state.hosxpText) setHosxpText('Paracetamol 500mg,10'); }, [state.hosxpText, setHosxpText]);
  return (
    <>
      <button onClick={() => void processHosxp()}>process</button>
      <ReconcileScreen />
    </>
  );
}

async function setup(user: ReturnType<typeof userEvent.setup>, txTs: string, lastCoveredFrom: string, lastCoveredTo: string) {
  renderWithApp(<><Harness /><Toast /><ConfirmDialog /></>);
  await signInAs('u1', { role: 'pharm', name: 'ทดสอบ ภก.', username: 'test' });
  await waitFor(() => expect(hasListener('meds')).toBe(true));
  fireCollection('meds', [MED]);
  await waitFor(() => expect(hasListener('txs')).toBe(true));
  fireCollection('txs', [{
    id: 't1', type: 'reconcile_hosxp', medId: MED.id, ts: new Date(txTs + 'T09:00:00').getTime(),
    coveredFrom: lastCoveredFrom, coveredTo: lastCoveredTo,
  }]);
  await user.click(screen.getByRole('button', { name: 'process' }));
  await screen.findByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ });
  seedDoc('meds/m1', { floor: MED.floor });
}

describe('smartHosxpCoveredFrom — catch-up default regression', () => {
  beforeEach(() => vi.setSystemTime(bangkokNoon(2026, 0, 12))); // "today" = Monday
  afterEach(() => vi.useRealTimers());

  it('defaults "จากวันที่" to pick up right where the last reconcile left off (the real Fri-Sat-Sun Monday catch-up)', async () => {
    const user = userEvent.setup();
    // Friday's own reconcile covered Thursday's dispensing — Fri/Sat/Sun never got their own.
    await setup(user, FRI, THU, THU);

    expect((screen.getByLabelText('จากวันที่') as HTMLInputElement).value).toBe(FRI);
    expect((screen.getByLabelText('ถึงวันที่') as HTMLInputElement).value).toBe(SUN);
  });

  it('falls back to yesterday-only when the last reconcile already reaches yesterday (nothing left to catch up on)', async () => {
    const user = userEvent.setup();
    await setup(user, SUN, SUN, SUN);

    expect((screen.getByLabelText('จากวันที่') as HTMLInputElement).value).toBe(SUN);
    expect((screen.getByLabelText('ถึงวันที่') as HTMLInputElement).value).toBe(SUN);
  });

  it('falls back to yesterday-only when the last covered gap is older than the auto-catchup window (needs a deliberate manual decision)', async () => {
    const user = userEvent.setup();
    const longAgo = isoAt(2025, 10, 1); // ~2 months before THU — far beyond the 14-day window
    await setup(user, longAgo, longAgo, longAgo);

    expect((screen.getByLabelText('จากวันที่') as HTMLInputElement).value).toBe(SUN);
    expect((screen.getByLabelText('ถึงวันที่') as HTMLInputElement).value).toBe(SUN);
  });
});

describe('commitReconcile — continuity gap/overlap warning regression', () => {
  beforeEach(() => vi.setSystemTime(bangkokNoon(2026, 0, 12))); // "today" = Monday
  afterEach(() => vi.useRealTimers());

  it('warns about a real gap when "จากวันที่" is narrowed back, silently skipping real unreconciled days', async () => {
    const user = userEvent.setup();
    // Smart default already proposes Fri-Sat-Sun; simulate the admin narrowing it back to
    // yesterday (Sunday) only — Friday's real dispensing would then be silently skipped forever.
    await setup(user, FRI, THU, THU);
    fireEvent.change(screen.getByLabelText('จากวันที่'), { target: { value: SUN } });

    await user.click(screen.getByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ }));
    await screen.findByText(/มีวันทำการที่ยังไม่ถูกตัดยอดเลยอยู่ระหว่างนั้น 1 วัน/);
    expect(getLastTransactionWrites().length).toBe(0);

    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(getLastTransactionWrites().length).toBe(0);
  });

  it('commits the gap anyway once confirmed (a deliberate skip — not a hard block)', async () => {
    const user = userEvent.setup();
    await setup(user, FRI, THU, THU);
    fireEvent.change(screen.getByLabelText('จากวันที่'), { target: { value: SUN } });

    await user.click(screen.getByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ }));
    await screen.findByText(/มีวันทำการที่ยังไม่ถูกตัดยอดเลยอยู่ระหว่างนั้น/);
    await user.click(screen.getByRole('button', { name: 'ยืนยัน' }));

    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
  });

  it('shows no continuity warning at all for the ordinary, already-correct daily default (perfect continuation)', async () => {
    const user = userEvent.setup();
    // Monday's own file already covered Fri-Sat-Sun; today (pinned to Tuesday for this one
    // case) should default straight to Monday with zero gap and zero overlap.
    vi.setSystemTime(bangkokNoon(2026, 0, 13)); // "today" = Tuesday
    await setup(user, MON, FRI, SUN);

    expect((screen.getByLabelText('จากวันที่') as HTMLInputElement).value).toBe(MON);
    await user.click(screen.getByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ }));
    await waitFor(() => expect(getLastTransactionWrites().length).toBeGreaterThan(0));
    expect(screen.queryByText(/ทับซ้อนกัน/)).not.toBeInTheDocument();
    expect(screen.queryByText(/มีวันทำการที่ยังไม่ถูกตัดยอดเลยอยู่ระหว่างนั้น/)).not.toBeInTheDocument();
  });

  it('warns about an overlap when "จากวันที่" reaches back into days already covered by the last reconcile', async () => {
    const user = userEvent.setup();
    // Monday's own file already covered Fri-Sat-Sun; today (Tuesday) the admin mistakenly
    // widens "จากวันที่" back into Saturday — re-covering 2 days that are already accounted for.
    vi.setSystemTime(bangkokNoon(2026, 0, 13)); // "today" = Tuesday
    await setup(user, MON, FRI, SUN);
    fireEvent.change(screen.getByLabelText('จากวันที่'), { target: { value: SAT } });

    await user.click(screen.getByRole('button', { name: /ตัดยอดหน้างานตามไฟล์นี้/ }));
    await screen.findByText(/ทับซ้อนกัน 2 วัน/);
    expect(getLastTransactionWrites().length).toBe(0);

    await user.click(screen.getByRole('button', { name: 'ยกเลิก' }));
    expect(getLastTransactionWrites().length).toBe(0);
  });
});
