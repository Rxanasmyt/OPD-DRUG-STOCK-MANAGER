// Regression test for a real request: "นำข้อมูลการจ่ายยาหน้างานจริงในแต่ละวันจันทร์-ศุกร์ นำมา
// วิเคราะห์การใช้ยาจริง เนื่องจากการใช้ยาแต่ละวันในคลินิกที่แตกต่างกัน ยาที่ใช้ในแต่ละวันก็จะ
// ต่างกัน...การคำนวณ min max และ par ต้องมีความแม่นยำมากๆ" — analyzeWeekdayUsage() mines real
// reconcile_hosxp tx history (the only source with a real per-dispense date) for a per-med
// weekday pattern, feeding suggestPar()'s floor-par sizing via Med.weekdayPeakFactor. See its
// own doc comment in AppContext.tsx and Med.weekdayPeakFactor's in types.ts.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { updateDoc } from 'firebase/firestore';
import { useApp } from './AppContext';
import { renderWithApp } from '../test-utils/renderWithApp';
import Toast from '../components/Toast';
import { signInAs, fireCollection, hasListener, seedCollection, getLastBatchWrites } from '../test-utils/firebaseTestDouble';

function bangkokNoon(y: number, m: number, d: number): number {
  return Date.UTC(y, m, d, 12, 0) - 7 * 60 * 60 * 1000;
}
// 2026-01-05 is a real Monday — Fri 2026-01-09 anchors "today" for this test (set via
// vi.setSystemTime isn't needed here since analyzeWeekdayUsage reads Date.now() internally and
// we instead seed tx timestamps RELATIVE to the real current time, each tagged with its own real
// weekday via bangkokWeekday — simplest to keep deterministic by building weeks backward from a
// fixed recent Monday instead of "now" itself, since the lookback window (91 days) comfortably
// covers either a real "now" or this fixed anchor as long as the anchor is recent).
const MONDAY = (w: number) => bangkokNoon(2026, 0, 5 - w * 7); // 2026-01-05, and each Monday before it
const TUESDAY = (w: number) => bangkokNoon(2026, 0, 6 - w * 7);
const WEDNESDAY = (w: number) => bangkokNoon(2026, 0, 7 - w * 7);
const THURSDAY = (w: number) => bangkokNoon(2026, 0, 8 - w * 7);
const FRIDAY = (w: number) => bangkokNoon(2026, 0, 9 - w * 7);

const SPIKE_MED = {
  id: 'm1', code: 'MED-0001', name: 'Amoxicillin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A1',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 300, usedPrev30: 300,
};
const FLAT_MED = {
  id: 'm2', code: 'MED-0002', name: 'Paracetamol 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A2',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 300, usedPrev30: 300,
};
const STALE_MED = {
  id: 'm3', code: 'MED-0003', name: 'Metformin 500mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A3',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 300, usedPrev30: 300,
  weekdayPeakFactor: 2, weekdayPeakDay: 2, // a stale pattern from a previous run
};
const SPARSE_MED = {
  id: 'm4', code: 'MED-0004', name: 'Enalapril 5mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 500, parFloor: 100, floor: 40, bin: 'A4',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 20, usedPrev30: 20,
};
// Real-world request: "ยาบางตัว min max par ไม่เหมาะสม...จำนวนยาในการใช้ 1 ครั้ง เยอะกว่าค่า min
// max ปัจจุบันอย่างมาก" (เช่น phenytoin สั่ง 3 เดือน 270 เม็ดใน 1 เคส) — a drug with almost no
// ordinary daily usage, but ONE huge one-off dispense ~120 days ago: outside the 91-day
// weekday-pattern window entirely (so no weekdayPeakFactor gets set — there's no regular
// pattern, just a single real spike), but still inside the longer 180-day peak-day window.
const BURST_MED = {
  id: 'm5', code: 'MED-0005', name: 'Phenytoin 100mg', unit: 'เม็ด', dosageForm: 'เม็ด',
  price: 1, had: false, active: true, parSub: 50, parFloor: 20, floor: 10, bin: 'A5',
  ward: 'opd' as const, noSubstock: false, volatility: 1, used30: 10, usedPrev30: 10,
};
// MONDAY(14) = 14 weeks (98 days) before the 2026-01-05 anchor — ~102 days before "now"
// (2026-01-09): past the 91-day weekday window, comfortably inside the 180-day peak window.
// A real Monday (not a weekend) so it isn't skipped by the "never reconciles on a weekend" gate.
const burstRows = [
  { type: 'reconcile_hosxp', name: BURST_MED.name, medId: BURST_MED.id, qty: -270, unit: 'เม็ด', by: 'u1', ts: MONDAY(14) },
];

// 8 weeks of history for SPIKE_MED: a clear, real Tuesday spike (50 vs 10 every other weekday) —
// avg = (10+50+10+10+10)/5 = 18, peak/avg ≈ 2.78 (well past the 1.15 "meaningful" threshold).
const spikeRows = Array.from({ length: 8 }, (_, w) => [
  { type: 'reconcile_hosxp', name: SPIKE_MED.name, medId: SPIKE_MED.id, qty: -10, unit: 'เม็ด', by: 'u1', ts: MONDAY(w) },
  { type: 'reconcile_hosxp', name: SPIKE_MED.name, medId: SPIKE_MED.id, qty: -50, unit: 'เม็ด', by: 'u1', ts: TUESDAY(w) },
  { type: 'reconcile_hosxp', name: SPIKE_MED.name, medId: SPIKE_MED.id, qty: -10, unit: 'เม็ด', by: 'u1', ts: WEDNESDAY(w) },
  { type: 'reconcile_hosxp', name: SPIKE_MED.name, medId: SPIKE_MED.id, qty: -10, unit: 'เม็ด', by: 'u1', ts: THURSDAY(w) },
  { type: 'reconcile_hosxp', name: SPIKE_MED.name, medId: SPIKE_MED.id, qty: -10, unit: 'เม็ด', by: 'u1', ts: FRIDAY(w) },
]).flat();

// 8 weeks of genuinely flat usage for both FLAT_MED and STALE_MED — same 20 units every weekday.
function flatRows(med: { id: string; name: string }) {
  return Array.from({ length: 8 }, (_, w) => [
    { type: 'reconcile_hosxp', name: med.name, medId: med.id, qty: -20, unit: 'เม็ด', by: 'u1', ts: MONDAY(w) },
    { type: 'reconcile_hosxp', name: med.name, medId: med.id, qty: -20, unit: 'เม็ด', by: 'u1', ts: TUESDAY(w) },
    { type: 'reconcile_hosxp', name: med.name, medId: med.id, qty: -20, unit: 'เม็ด', by: 'u1', ts: WEDNESDAY(w) },
    { type: 'reconcile_hosxp', name: med.name, medId: med.id, qty: -20, unit: 'เม็ด', by: 'u1', ts: THURSDAY(w) },
    { type: 'reconcile_hosxp', name: med.name, medId: med.id, qty: -20, unit: 'เม็ด', by: 'u1', ts: FRIDAY(w) },
  ]).flat();
}

// Only 2 weeks of history (below MIN_OCC_PER_WEEKDAY=4) — a real Tuesday-looking spike, but not
// enough data to trust yet.
const sparseRows = Array.from({ length: 2 }, (_, w) => [
  { type: 'reconcile_hosxp', name: SPARSE_MED.name, medId: SPARSE_MED.id, qty: -2, unit: 'เม็ด', by: 'u1', ts: MONDAY(w) },
  { type: 'reconcile_hosxp', name: SPARSE_MED.name, medId: SPARSE_MED.id, qty: -20, unit: 'เม็ด', by: 'u1', ts: TUESDAY(w) },
]).flat();

function Harness() {
  const { analyzeWeekdayUsage } = useApp();
  return <button onClick={analyzeWeekdayUsage}>analyze-weekday</button>;
}

afterEach(() => vi.useRealTimers());

describe('analyzeWeekdayUsage — real weekday-pattern regression', () => {
  it('sets weekdayPeakFactor/weekdayPeakDay only for a med with a real, confident weekday spike; skips flat and sparse meds; clears a stale factor that has since flattened', async () => {
    // "Now" pinned to the most recent Friday in the fixture (2026-01-09) — all MONDAY(w)..
    // FRIDAY(w) timestamps above are built relative to this same fixed anchor, so they land
    // inside analyzeWeekdayUsage's 91-day lookback window regardless of the real wall-clock date.
    vi.setSystemTime(bangkokNoon(2026, 0, 9));
    const user = userEvent.setup();
    renderWithApp(<Harness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [SPIKE_MED, FLAT_MED, STALE_MED, SPARSE_MED, BURST_MED]);
    seedCollection('txs', [...spikeRows, ...flatRows(FLAT_MED), ...flatRows(STALE_MED), ...sparseRows, ...burstRows]);

    await user.click(screen.getByRole('button', { name: 'analyze-weekday' }));
    await waitFor(() => expect(getLastBatchWrites().length).toBeGreaterThan(0));

    const writes = getLastBatchWrites();
    const byPath = Object.fromEntries(writes.map((w) => [w.path, w.data]));

    // SPIKE_MED: a real, confident Tuesday spike — factor set, day = 2 (Tuesday).
    expect(byPath['meds/m1']).toBeDefined();
    expect(byPath['meds/m1']!.weekdayPeakDay).toBe(2);
    expect(byPath['meds/m1']!.weekdayPeakFactor as number).toBeGreaterThan(1.15);
    // Follow-up request ("มีอะไรตกหล่นบ้าง...ทำทั้งหมด"): confidence (occurrence count) and the
    // full per-weekday shape are recorded alongside the bare peak factor/day.
    expect(byPath['meds/m1']!.weekdayPeakOccurrences).toBe(8); // all 8 weeks of fixture data
    expect(byPath['meds/m1']!.weekdayPattern as number[]).toHaveLength(5);
    // pattern[1] is Tuesday (index = wd-1) — the peak day itself must read as the biggest ratio.
    const spikePattern = byPath['meds/m1']!.weekdayPattern as number[];
    expect(spikePattern[1]).toBe(Math.max(...spikePattern));

    // FLAT_MED: genuinely flat usage — no weekday-pattern write (never had a factor, data is
    // flat), but a real peak-day value still gets recorded (its own worst-day scan doesn't
    // require regular weekday confidence — see the dedicated peak-day describe block below for
    // what that signal is actually FOR; a flat med's "peak" is simply its ordinary daily amount).
    expect(byPath['meds/m2']).toBeDefined();
    expect(byPath['meds/m2']!.weekdayPeakFactor).toBeUndefined();
    expect(byPath['meds/m2']!.peakDayQty).toBe(20);

    // STALE_MED: had a stale factor from a previous run, but this round's data is flat —
    // explicitly cleared (deleteField() resolves to undefined in the test double).
    expect(byPath['meds/m3']).toBeDefined();
    expect(byPath['meds/m3']!.weekdayPeakFactor).toBeUndefined();
    expect(byPath['meds/m3']!.weekdayPeakDay).toBeUndefined();
    expect(byPath['meds/m3']!.weekdayPeakOccurrences).toBeUndefined();
    expect(byPath['meds/m3']!.weekdayPattern).toBeUndefined();

    // SPARSE_MED: a real-looking spike shape, but only 2 weeks of data — not enough to trust a
    // WEEKDAY pattern from, so no weekdayPeakFactor write; its peak-day scan has no such
    // confidence bar though, so the real 20-unit day it did see still gets recorded.
    expect(byPath['meds/m4']).toBeDefined();
    expect(byPath['meds/m4']!.weekdayPeakFactor).toBeUndefined();
    expect(byPath['meds/m4']!.peakDayQty).toBe(20);

    // BURST_MED (the real-world "phenytoin" case): a single huge one-off dispense ~102 days
    // ago — outside the 91-day weekday window entirely (no regular pattern to detect, so no
    // weekdayPeakFactor), but inside the 180-day peak window. This is the actual fix: Max/sub
    // par now gets clamped to at least this real worst-case day (see suggestPar() in
    // selectors.ts), not just the smoothed 30-day average that would otherwise hide it.
    expect(byPath['meds/m5']).toBeDefined();
    expect(byPath['meds/m5']!.weekdayPeakFactor).toBeUndefined();
    expect(byPath['meds/m5']!.peakDayQty).toBe(270);
  });
});

// Real-world request: "ยาบางตัว min max par ไม่เหมาะสม...จำนวนยาในการใช้ 1 ครั้ง เยอะกว่าค่า min
// max ปัจจุบันอย่างมาก" — dedicated coverage for the peak-day signal itself, independent of the
// combined-fixture test above: a med whose single worst real day already exceeds its current
// Max is exactly the "เบิกฉุกเฉิน" risk this exists to catch.
describe('analyzeWeekdayUsage — peak single-day usage regression', () => {
  it('records the real worst single calendar day for a med with an infrequent large one-off dispense, with the date that backs it', async () => {
    vi.setSystemTime(bangkokNoon(2026, 0, 9));
    const user = userEvent.setup();
    renderWithApp(<Harness />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [BURST_MED]);
    seedCollection('txs', burstRows);

    await user.click(screen.getByRole('button', { name: 'analyze-weekday' }));
    await waitFor(() => expect(getLastBatchWrites().length).toBeGreaterThan(0));

    const [write] = getLastBatchWrites();
    expect(write.path).toBe('meds/m5');
    expect(write.data!.peakDayQty).toBe(270);
    expect(write.data!.peakDayDate).toBe('2025-09-29'); // MONDAY(14) — see burstRows' own comment
  });

  it('does not re-write an unchanged peak on a later run', async () => {
    vi.setSystemTime(bangkokNoon(2026, 0, 9));
    const user = userEvent.setup();
    renderWithApp(<><Harness /><Toast /></>);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    // Already carries the exact same peak this run would find — nothing new to write.
    fireCollection('meds', [{ ...BURST_MED, peakDayQty: 270, peakDayDate: '2025-09-29' }]);
    seedCollection('txs', burstRows);

    await user.click(screen.getByRole('button', { name: 'analyze-weekday' }));
    // BURST_MED's single real day sits outside the 91-day weekday window entirely, so it's
    // never even counted as "analyzed" for that purpose — this lone-med run falls through to
    // the "no history at all within the weekday window" message, not the "found nothing NEW"
    // one. Either way, the real assertion is the same: nothing gets written.
    await screen.findByText(/ยังไม่มียาตัวไหนมีประวัติ HOSxP ต่อเนื่องพอจะวิเคราะห์/);
    expect(getLastBatchWrites().length).toBe(0);
  });
});

// Follow-up request: "แก้ไข/ยกเลิกรูปแบบที่ตรวจพบเองไม่ได้" — before this, a wrongly-detected
// pattern could only ever clear itself automatically once new data flattened it out on a LATER
// analyzeWeekdayUsage() run; there was no way for an admin to clear one by hand immediately.
function ClearHarness({ medId }: { medId: string }) {
  const { clearMedWeekdayPattern } = useApp();
  return <button onClick={() => clearMedWeekdayPattern(medId)}>clear-pattern</button>;
}

describe('clearMedWeekdayPattern — manual override regression', () => {
  it('clears all 4 weekday-pattern fields immediately via a real Firestore write, without waiting for a re-analysis run', async () => {
    const user = userEvent.setup();
    renderWithApp(<ClearHarness medId={STALE_MED.id} />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [{ ...STALE_MED, weekdayPattern: [1, 2.5, 1, 1, 1] }]);

    await user.click(screen.getByRole('button', { name: 'clear-pattern' }));
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.length).toBeGreaterThan(0));

    const [, data] = vi.mocked(updateDoc).mock.calls[0];
    const fields = data as unknown as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(['weekdayPattern', 'weekdayPeakDay', 'weekdayPeakFactor', 'weekdayPeakOccurrences'].sort());
    // deleteField() resolves to undefined in the test double — every one of the 4 fields.
    expect(fields.weekdayPeakFactor).toBeUndefined();
    expect(fields.weekdayPeakDay).toBeUndefined();
    expect(fields.weekdayPeakOccurrences).toBeUndefined();
    expect(fields.weekdayPattern).toBeUndefined();
  });
});

// Same immediate-clear escape hatch as clearMedWeekdayPattern above, for the separate
// peakDayQty/peakDayDate signal.
function ClearPeakHarness({ medId }: { medId: string }) {
  const { clearMedPeakDay } = useApp();
  return <button onClick={() => clearMedPeakDay(medId)}>clear-peak</button>;
}

describe('clearMedPeakDay — manual override regression', () => {
  it('clears both peak-day fields immediately via a real Firestore write, without waiting for new history to age it out', async () => {
    const user = userEvent.setup();
    renderWithApp(<ClearPeakHarness medId={BURST_MED.id} />);
    await signInAs('u1', { role: 'admin', name: 'ทดสอบ Admin', username: 'test' });
    await waitFor(() => expect(hasListener('meds')).toBe(true));
    fireCollection('meds', [{ ...BURST_MED, peakDayQty: 270, peakDayDate: '2025-09-29' }]);

    const callsBefore = vi.mocked(updateDoc).mock.calls.length;
    await user.click(screen.getByRole('button', { name: 'clear-peak' }));
    await waitFor(() => expect(vi.mocked(updateDoc).mock.calls.length).toBeGreaterThan(callsBefore));

    // Not calls[0] — updateDoc's mock call history isn't reset between tests in this file (the
    // earlier clearMedWeekdayPattern test above already made one), so the LATEST call is this
    // test's own one.
    const [, data] = vi.mocked(updateDoc).mock.calls[vi.mocked(updateDoc).mock.calls.length - 1];
    const fields = data as unknown as Record<string, unknown>;
    expect(Object.keys(fields).sort()).toEqual(['peakDayDate', 'peakDayQty'].sort());
    // deleteField() resolves to undefined in the test double.
    expect(fields.peakDayQty).toBeUndefined();
    expect(fields.peakDayDate).toBeUndefined();
  });
});
