// Back-test of Min/Max settings against REAL dispensing history: "if this med's shelf had been run on
// Min/Max X over the last N business days, how many days would it have run out, and how much stock
// would it have sat on?" Pure functions (no Firestore) — the screen feeds them the per-day demand.
import type { Med } from '../types';
import { suggestPar, floorMinOf, percentile, coefficientOfVariation, usesSubstock } from './selectors';

export interface PolicyResult {
  /** business days on which demand exceeded what the shelf held */
  stockoutDays: number;
  /** units demanded but not on the shelf, total */
  shortageUnits: number;
  /** average end-of-day stock */
  avgStock: number;
  /** avgStock ÷ mean daily demand — how many days of use the shelf sat on, on average */
  daysOfCover: number;
  /** number of refills triggered */
  refills: number;
}

/** Replays `demands` (one number per business day, oldest first) on a shelf run as: start full at `max`;
 * after each day's close, if stock < `min` (and no refill is already on its way) a refill to `max` is
 * triggered, arriving at the start of the business day `leadDays` later. Assumes substock can always
 * supply the refill (this tests the SHELF's Min/Max, not the warehouse). */
export function simulateFloorPolicy(demands: readonly number[], min: number, max: number, leadDays = 1): PolicyResult {
  let stock = max;
  let pendingAt = -1;
  let stockoutDays = 0, shortageUnits = 0, stockSum = 0, refills = 0;
  for (let t = 0; t < demands.length; t++) {
    if (pendingAt === t) { stock = max; pendingAt = -1; }
    const d = Math.max(0, demands[t]);
    if (d > stock) { stockoutDays++; shortageUnits += d - stock; stock = 0; } else stock -= d;
    stockSum += stock;
    if (pendingAt === -1 && stock < min) { pendingAt = t + leadDays; refills++; }
  }
  const n = demands.length || 1;
  const mean = demands.reduce((a, b) => a + Math.max(0, b), 0) / n;
  const avgStock = stockSum / n;
  return { stockoutDays, shortageUnits, avgStock, daysOfCover: mean > 0 ? avgStock / mean : 0, refills };
}

export type BacktestVerdict = 'short' | 'excess' | 'ok';

export interface BacktestRow {
  med: Med;
  basis: 'out-of-sample' | 'in-sample';
  testDays: number;
  meanDemand: number;
  demandDays: number;
  current: { min: number; max: number; result: PolicyResult };
  suggested: { min: number; max: number; result: PolicyResult } | null;
  verdict: BacktestVerdict;
}

const BDAYS_PER_MONTH = 21; // ≈ business days in 30 calendar days

/** Rebuilds the usage statistics suggestPar() reads, from a slice of demand history. */
function statsFrom(train: readonly number[]): Pick<Med, 'used30' | 'usedPrev30' | 'peakDayQty' | 'peakDayP90Qty' | 'usageCv'> {
  const last = train.slice(-BDAYS_PER_MONTH);
  const prev = train.slice(-2 * BDAYS_PER_MONTH, -BDAYS_PER_MONTH);
  const sum = (a: readonly number[]) => a.reduce((x, y) => x + Math.max(0, y), 0);
  // Same population the app's own stats use: only days the drug actually moved.
  const days = train.filter((v) => v > 0);
  const p90 = days.length ? Math.round(percentile(days, 0.9)) : 0;
  const cv = days.length >= 2 ? Math.round(coefficientOfVariation(days.map((v) => Math.min(v, p90))) * 1000) / 1000 : undefined;
  return {
    used30: Math.round(sum(last)), usedPrev30: Math.round(sum(prev)),
    peakDayQty: days.length ? Math.round(Math.max(...days)) : undefined,
    peakDayP90Qty: days.length ? p90 : undefined,
    usageCv: cv,
  } as Pick<Med, 'used30' | 'usedPrev30' | 'peakDayQty' | 'peakDayP90Qty' | 'usageCv'>;
}

/** Back-tests one med. With enough history the suggestion is built ONLY from the days before the test
 * window (out-of-sample — an honest "would have worked"); otherwise the suggestion uses the stats from the
 * whole series and the test window is all of it (in-sample, flagged — flattering to the suggestion). */
export function backtestMed(
  med: Med, demand: readonly number[],
  opts: { testDays: number; floorCoverDays: number; subCoverDays: number; leadDays?: number },
): BacktestRow | null {
  if (!usesSubstock(med) || !(med.parFloor > 0) || demand.length < 15) return null;
  const lead = opts.leadDays ?? 1;
  const outOfSample = demand.length >= opts.testDays + 2 * BDAYS_PER_MONTH;
  const test = outOfSample ? demand.slice(-opts.testDays) : demand;
  const train = outOfSample ? demand.slice(0, demand.length - opts.testDays) : demand;
  const stats = statsFrom(train);
  const pseudo = { ...med, ...stats, recentStockoutDays30: undefined } as Med;
  const sug = suggestPar(pseudo, opts.floorCoverDays, opts.subCoverDays);
  const curMin = floorMinOf(med);
  const current = { min: curMin, max: med.parFloor, result: simulateFloorPolicy(test, curMin, med.parFloor, lead) };
  const suggested = sug ? { min: sug.min, max: sug.floor, result: simulateFloorPolicy(test, sug.min, sug.floor, lead) } : null;
  const meanDemand = test.reduce((a, b) => a + Math.max(0, b), 0) / test.length;
  const r = current.result;
  const shortPct = meanDemand > 0 ? r.shortageUnits / (meanDemand * test.length) : 0;
  const verdict: BacktestVerdict = r.stockoutDays >= 2 || shortPct >= 0.02 ? 'short'
    : r.daysOfCover > 2.5 * opts.floorCoverDays && meanDemand > 0 ? 'excess' : 'ok';
  return { med, basis: outOfSample ? 'out-of-sample' : 'in-sample', testDays: test.length, meanDemand, demandDays: test.filter((v) => v > 0).length, current, suggested, verdict };
}
