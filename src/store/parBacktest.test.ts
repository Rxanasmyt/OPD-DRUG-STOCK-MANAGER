// Back-test replay: stockouts, refill timing, and the out-of-sample split.
import { describe, it, expect } from 'vitest';
import { simulateFloorPolicy, backtestMed } from './parBacktest';
import type { Med } from '../types';

const mk = (over: Record<string, unknown> = {}) => ({
  id: 'm', code: 'C', name: 'x', unit: 'เม็ด', dosageForm: 'เม็ด', price: 1, had: false, active: true,
  parSub: 500, parFloor: 100, floor: 50, bin: 'A', used30: 0, usedPrev30: 0, volatility: 1.1, ...over,
}) as unknown as Med;

describe('simulateFloorPolicy', () => {
  it('never runs out when Max covers demand through the refill delay', () => {
    const r = simulateFloorPolicy(Array(30).fill(10), 40, 100, 1);
    expect(r.stockoutDays).toBe(0);
    expect(r.shortageUnits).toBe(0);
    expect(r.refills).toBeGreaterThan(0);
  });

  it('counts a stockout day and the shortage when demand exceeds the shelf', () => {
    // max 20, demand 30 on day 1: shelf empties, 10 short
    const r = simulateFloorPolicy([30, 5, 5], 5, 20, 1);
    expect(r.stockoutDays).toBe(1);
    expect(r.shortageUnits).toBe(10);
  });

  it('a refill triggered at close arrives the NEXT business day, so a spike right after still hits an empty-ish shelf', () => {
    // max 50, min 20. day0 use 40 → 10 left (<20) → refill arrives day2 start with lead 2
    const slow = simulateFloorPolicy([40, 30, 5], 20, 50, 2);
    const fast = simulateFloorPolicy([40, 30, 5], 20, 50, 1);
    expect(slow.stockoutDays).toBeGreaterThan(fast.stockoutDays);
  });

  it('a Max far above use shows a large days-of-cover (excess)', () => {
    const r = simulateFloorPolicy(Array(40).fill(2), 100, 1000, 1);
    expect(r.daysOfCover).toBeGreaterThan(50);
  });
});

describe('backtestMed', () => {
  const steady = Array(100).fill(0).map((_, i) => 10 + (i % 5)); // 10..14 per business day

  it('skips meds without a substock stage, no Max, or too little history', () => {
    const o = { testDays: 30, floorCoverDays: 4, subCoverDays: 28 };
    expect(backtestMed(mk({ noSubstock: true }), steady, o)).toBeNull();
    expect(backtestMed(mk({ parFloor: 0 }), steady, o)).toBeNull();
    expect(backtestMed(mk(), steady.slice(0, 10), o)).toBeNull();
  });

  it('uses only the days BEFORE the test window for the suggestion when history is long enough (out-of-sample)', () => {
    const row = backtestMed(mk(), steady, { testDays: 30, floorCoverDays: 4, subCoverDays: 28 })!;
    expect(row.basis).toBe('out-of-sample');
    expect(row.testDays).toBe(30);
    expect(row.suggested).not.toBeNull();
    expect(row.suggested!.min).toBeLessThan(row.suggested!.max);
  });

  it('falls back to in-sample, and says so, when history is short', () => {
    const row = backtestMed(mk(), steady.slice(0, 40), { testDays: 30, floorCoverDays: 4, subCoverDays: 28 })!;
    expect(row.basis).toBe('in-sample');
  });

  it('flags a shelf whose Max is far too small as "short" and one far too large as "excess"', () => {
    const o = { testDays: 30, floorCoverDays: 4, subCoverDays: 28 };
    expect(backtestMed(mk({ parFloor: 12, floorMin: 6 }), steady, o)!.verdict).toBe('short');
    expect(backtestMed(mk({ parFloor: 2000, floorMin: 1000 }), steady, o)!.verdict).toBe('excess');
  });

  it('a well-sized suggestion on steady demand has no stockouts', () => {
    const row = backtestMed(mk({ parFloor: 12, floorMin: 6 }), steady, { testDays: 30, floorCoverDays: 4, subCoverDays: 28 })!;
    expect(row.suggested!.result.stockoutDays).toBe(0);
  });
});
