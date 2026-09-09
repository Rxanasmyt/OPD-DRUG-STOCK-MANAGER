import { describe, it, expect } from 'vitest';
import type { AppState, Med } from '../types';
import {
  wardOf, matchesWard, binFor, binDisplayAll, floorMinOf, subQty, usageAnomalies,
  daysOfStockLeft, fefoLot, toneFor, roundStep, suggestTransferQty, matchHosxpMed, suggestPar,
  categoryOf, categoryStats,
} from './selectors';
import { categoryLabel } from '../data/categories';

// Minimal, fully-typed fixture — every test overrides only the fields it cares about, so a
// future required field on Med surfaces here as a type error instead of a runtime surprise in
// this file three months from now.
function med(overrides: Partial<Med> = {}): Med {
  return {
    id: 'm1', code: 'M1', name: 'Test Drug', unit: 'เม็ด', dosageForm: 'tab', price: 1,
    had: false, active: true, parSub: 100, parFloor: 50, floor: 25, bin: 'A1',
    used30: 0, usedPrev30: 0, volatility: 1,
    ...overrides,
  };
}

function state(overrides: Partial<AppState> = {}): AppState {
  // Bug fix: this used to ignore `overrides` entirely (always returned the same bare
  // { lots: [], meds: [] }), so a test fixture that read state.lots for anything but the
  // default empty array would silently get nothing back — harmless while no test needed real
  // lots, but a real trap for the next test that does (see categoryStats below, which reads
  // state.lots directly for expiry-risk value).
  return { lots: [], meds: [], expiryWarnDays: 30, ...overrides } as unknown as AppState;
}

describe('wardOf / matchesWard / binFor / binDisplayAll', () => {
  it('defaults an unset ward to opd', () => {
    expect(wardOf(med())).toBe('opd');
  });

  it('matchesWard: "all" matches everything, own ward matches, other ward does not', () => {
    const m = med({ ward: 'ipd' });
    expect(matchesWard(m, 'all')).toBe(true);
    expect(matchesWard(m, 'ipd')).toBe(true);
    expect(matchesWard(m, 'opd')).toBe(false);
  });

  it('matchesWard: a shared med matches every ward filter regardless of its own ward', () => {
    const m = med({ ward: 'opd', shared: true });
    expect(matchesWard(m, 'ipd')).toBe(true);
  });

  it('binFor: shared med with a distinct IPD bin shows binIpd only when asked from ipd', () => {
    const m = med({ bin: 'A1', shared: true, binIpd: 'B2' });
    expect(binFor(m, 'opd')).toBe('A1');
    expect(binFor(m, 'ipd')).toBe('B2');
  });

  it('binFor: a shared med with no distinct binIpd falls back to the one bin for both wards', () => {
    const m = med({ bin: 'A1', shared: true });
    expect(binFor(m, 'ipd')).toBe('A1');
  });

  it('binDisplayAll: combines both codes only when they genuinely differ', () => {
    expect(binDisplayAll(med({ bin: 'A1', shared: true, binIpd: 'B2' }))).toBe('A1/B2');
    expect(binDisplayAll(med({ bin: 'A1', shared: true, binIpd: 'A1' }))).toBe('A1');
    expect(binDisplayAll(med({ bin: 'A1' }))).toBe('A1');
  });
});

describe('categoryOf / categoryLabel', () => {
  it('falls back to "other" for a med with no category set', () => {
    expect(categoryOf(med())).toBe('other');
  });

  it('returns the med\'s own category id when set', () => {
    expect(categoryOf(med({ category: 'antimicrobial' }))).toBe('antimicrobial');
  });

  it('categoryLabel resolves a known id and falls back for an unknown/missing one', () => {
    expect(categoryLabel('antimicrobial')).toBe('ยาต้านจุลชีพ (ปฏิชีวนะ/เชื้อรา/ไวรัส)');
    expect(categoryLabel('not-a-real-id')).toBe('อื่นๆ / ยังไม่ระบุหมวด');
    expect(categoryLabel(undefined)).toBe('อื่นๆ / ยังไม่ระบุหมวด');
  });
});

describe('categoryStats', () => {
  it('rolls up meds into their category — count, low-stock, and value', () => {
    const meds = [
      med({ id: 'a', category: 'pain', floor: 5, floorMin: 10, price: 2, used30: 3 }), // low
      med({ id: 'b', category: 'pain', floor: 20, floorMin: 10, price: 3, used30: 1 }), // not low
      med({ id: 'c', category: 'cardio', floor: 15, floorMin: 5, price: 10, used30: 0 }),
    ];
    const rows = categoryStats(state({ meds }), meds, 30);
    const pain = rows.find((r) => r.id === 'pain')!;
    const cardio = rows.find((r) => r.id === 'cardio')!;
    expect(pain.meds).toBe(2);
    expect(pain.low).toBe(1);
    expect(pain.value).toBe(5 * 2 + 20 * 3); // (floor + substock=0) * price, summed
    expect(pain.used30).toBe(4);
    expect(cardio.meds).toBe(1);
    expect(cardio.low).toBe(0);
  });

  it('uncategorized meds fall into the "other" bucket, never dropped', () => {
    const meds = [med({ id: 'x', category: undefined })];
    const rows = categoryStats(state({ meds }), meds, 30);
    expect(rows.map((r) => r.id)).toEqual(['other']);
  });

  it('at-risk value comes from real lots expiring within the warn window, not from floor', () => {
    const meds = [med({ id: 'a', category: 'pain', price: 5 })];
    const soon = Date.now() + 5 * 24 * 60 * 60 * 1000; // 5 days out
    const far = Date.now() + 200 * 24 * 60 * 60 * 1000;
    const lots = [
      { id: 'l1', code: 'L1', medId: 'a', lotNo: '1', exp: soon, qty: 10, loc: 'A1' },
      { id: 'l2', code: 'L2', medId: 'a', lotNo: '2', exp: far, qty: 100, loc: 'A1' },
    ];
    const rows = categoryStats(state({ meds, lots }), meds, 30);
    expect(rows[0].atRisk).toBe(10 * 5); // only the soon-expiring lot counts
  });

  it('returns rows in DRUG_CATEGORIES order, not sorted by value', () => {
    // 'emergency' is listed well after 'pain' in DRUG_CATEGORIES despite having the bigger
    // value here — order must still follow the fixed list, not the numbers.
    const meds = [
      med({ id: 'a', category: 'emergency', floor: 1000, price: 100 }),
      med({ id: 'b', category: 'pain', floor: 1, price: 1 }),
    ];
    const rows = categoryStats(state({ meds }), meds, 30);
    expect(rows.map((r) => r.id)).toEqual(['pain', 'emergency']);
  });
});

describe('floorMinOf', () => {
  it('uses the real floorMin when set, even if 0', () => {
    expect(floorMinOf(med({ floorMin: 0, parFloor: 100 }))).toBe(0);
    expect(floorMinOf(med({ floorMin: 12, parFloor: 100 }))).toBe(12);
  });

  it('defaults to a rounded ~30% of parFloor when floorMin is unset', () => {
    // Regression guard for the bug this function's own comment describes: a naive
    // Math.round(parFloor*0.3) would give an odd-looking 27 here — roundStep-style
    // rounding should land on a clean 25.
    expect(floorMinOf(med({ parFloor: 90 }))).toBe(25);
    expect(floorMinOf(med({ parFloor: 0 }))).toBe(0);
  });
});

describe('subQty / fefoLot', () => {
  const st = { lots: [
    { id: 'l1', code: 'L1', medId: 'm1', lotNo: '1', exp: 300, qty: 10, loc: 'x' },
    { id: 'l2', code: 'L2', medId: 'm1', lotNo: '2', exp: 100, qty: 5, loc: 'x' },
    { id: 'l3', code: 'L3', medId: 'm1', lotNo: '3', exp: 200, qty: 0, loc: 'x' }, // depleted
    { id: 'l4', code: 'L4', medId: 'other', lotNo: '4', exp: 100, qty: 999, loc: 'x' },
  ] } as unknown as AppState;

  it('subQty sums only lots for the given med', () => {
    expect(subQty(st, 'm1')).toBe(15);
    expect(subQty(st, 'nonexistent')).toBe(0);
  });

  it('fefoLot picks the soonest-expiring lot that still has stock (first-expired-first-out)', () => {
    const l = fefoLot(st, 'm1');
    expect(l?.id).toBe('l2'); // exp 100, earliest among qty>0 lots (l3 is depleted)
  });
});

describe('usageAnomalies', () => {
  it('flags a swing at/above the threshold in either direction, ignores drugs below it', () => {
    const meds = [
      med({ id: 'up', used30: 140, usedPrev30: 100 }),   // +40% — exactly at default threshold
      med({ id: 'down', used30: 50, usedPrev30: 100 }),  // -50%
      med({ id: 'flat', used30: 105, usedPrev30: 100 }), // +5% — below threshold
      med({ id: 'new', used30: 50, usedPrev30: 0 }),     // no baseline — never an "anomaly"
      med({ id: 'inactive', active: false, used30: 500, usedPrev30: 10 }),
    ];
    const out = usageAnomalies(meds);
    const ids = out.map((a) => a.med.id);
    expect(ids).toContain('up');
    expect(ids).toContain('down');
    expect(ids).not.toContain('flat');
    expect(ids).not.toContain('new');
    expect(ids).not.toContain('inactive');
    expect(out.find((a) => a.med.id === 'up')?.direction).toBe('up');
    expect(out.find((a) => a.med.id === 'down')?.direction).toBe('down');
  });

  it('sorts by the size of the swing, largest first', () => {
    const meds = [
      med({ id: 'small', used30: 141, usedPrev30: 100 }),
      med({ id: 'big', used30: 300, usedPrev30: 100 }),
    ];
    const out = usageAnomalies(meds);
    expect(out.map((a) => a.med.id)).toEqual(['big', 'small']);
  });
});

describe('daysOfStockLeft', () => {
  it('returns null when there is no usage rate to project from (used30 <= 0)', () => {
    expect(daysOfStockLeft(state(), med({ used30: 0 }))).toBeNull();
  });

  it('projects days remaining from combined floor + substock at the current weekday-adjusted daily rate', () => {
    const st = { lots: [{ id: 'l1', code: 'L1', medId: 'm1', lotNo: '1', exp: 0, qty: 30, loc: 'x' }] } as unknown as AppState;
    // floor 30 + substock 30 = 60 on hand; used30=30 -> daily = 30 / (30*5/7) ≈ 1.4/day ->
    // round(60 / 1.4) = 43 days — NOT the naive used30/30 = 1/day -> 60 days (see
    // dailyUsageRate()'s doc comment for why the divisor isn't a flat 30).
    expect(daysOfStockLeft(st, med({ id: 'm1', floor: 30, used30: 30 }))).toBe(43);
  });
});

describe('toneFor', () => {
  it('never divides by zero for a med with parFloor still 0 (new, not-yet-configured)', () => {
    // The Math.max(1, ...) guard just prevents a NaN crash — it does not force a verdict.
    // With par 0 and any floor stock, the ratio comes out "healthy" (>=100% of the guarded
    // denominator), which is the correct read: there's stock and no real target to fall short of.
    expect(() => toneFor(med({ parFloor: 0, floor: 5 }))).not.toThrow();
    expect(toneFor(med({ parFloor: 0, floor: 5 }))).toBe('var(--green)');
    expect(toneFor(med({ parFloor: 0, floor: 0 }))).toBe('var(--red)'); // 0 floor is still 0 floor
  });

  it('thresholds at the documented 34%/75% of par', () => {
    expect(toneFor(med({ parFloor: 100, floor: 33 }))).toBe('var(--red)');
    expect(toneFor(med({ parFloor: 100, floor: 74 }))).toBe('var(--amber)');
    expect(toneFor(med({ parFloor: 100, floor: 75 }))).toBe('var(--green)');
  });
});

describe('roundStep', () => {
  it('rounds up to a clean step depending on magnitude (step 1 below 100, 10 below 500, 100 above)', () => {
    expect(roundStep(7)).toBe(7); // under 100 -> step 1, i.e. unchanged
    expect(roundStep(101)).toBe(110); // 100-499 -> step 10
    expect(roundStep(501)).toBe(600); // 500+ -> step 100
    expect(roundStep(0)).toBe(1); // never collapses to a useless 0
  });
});

describe('suggestTransferQty', () => {
  it('never suggests more than what substock actually has available', () => {
    const st = { lots: [{ id: 'l1', code: 'L1', medId: 'm1', lotNo: '1', exp: 0, qty: 5, loc: 'x' }] } as unknown as AppState;
    // Needs 75 to reach par (parFloor 100 - floor 25) but substock only has 5.
    expect(suggestTransferQty(st, med({ id: 'm1', parFloor: 100, floor: 25 }))).toBe(5);
  });

  it('suggests up to the full deficit, rounded UP to a clean step, when substock covers it', () => {
    const st = { lots: [{ id: 'l1', code: 'L1', medId: 'm1', lotNo: '1', exp: 0, qty: 999, loc: 'x' }] } as unknown as AppState;
    // Deficit is 75 (parFloor 100 - floor 25); parFloor>=100 means step 10, and 75 rounds UP
    // to the next step (80) rather than down — intentional, so a transfer never falls short
    // of reaching par by staying at the un-rounded deficit.
    expect(suggestTransferQty(st, med({ id: 'm1', parFloor: 100, floor: 25 }))).toBe(80);
  });
});

describe('suggestPar', () => {
  it('refuses to suggest anything without a real usage rate (would otherwise floor to a bogus 1)', () => {
    expect(suggestPar(med({ used30: 0 }), 3, 21)).toBeNull();
  });

  it('scales floor/sub par by cover days and volatility', () => {
    // daily = 30 / (30*5/7) ≈ 1.4286 — not the naive used30/30 = 1 (see dailyUsageRate()).
    const daily = 30 / (30 * (5 / 7));
    const out = suggestPar(med({ used30: 30, volatility: 1 }), 3, 21);
    expect(out).toEqual({ floor: roundStep(daily * 3), sub: roundStep(daily * 21) });
  });

  it('sizes a no-substock med\'s floor par off subCoverDays, not floorCoverDays — it has no substock buffer to absorb the wait for the next central-warehouse refill', () => {
    const daily = 30 / (30 * (5 / 7));
    const withSubstock = suggestPar(med({ used30: 30, volatility: 1, noSubstock: false }), 3, 21);
    const noSubstock = suggestPar(med({ used30: 30, volatility: 1, noSubstock: true }), 3, 21);
    expect(withSubstock).toEqual({ floor: roundStep(daily * 3), sub: roundStep(daily * 21) });
    // Same subCoverDays basis drives both floor and sub once there's no substock stage.
    expect(noSubstock).toEqual({ floor: roundStep(daily * 21), sub: roundStep(daily * 21) });
  });
});

describe('matchHosxpMed', () => {
  const meds = [
    med({ id: '1', name: 'Amoxicillin 250 mg' }),
    med({ id: '2', name: 'Amoxicillin 500 mg' }),
    med({ id: '3', name: 'Paracetamol 500 mg' }),
    med({ id: '4', name: 'Paracetamol 500 mg', ward: 'ipd' }), // OPD/IPD name twin
    med({ id: '5', name: 'Inactive Drug', active: false }),
  ];

  it('exact case-insensitive match resolves directly', () => {
    expect(matchHosxpMed(meds, 'paracetamol 500 mg')).toEqual({ kind: 'ambiguous', candidateIds: ['3', '4'] });
    expect(matchHosxpMed(meds, 'amoxicillin 250 mg')).toEqual({ kind: 'exact', medId: '1' });
  });

  it('a substring match with exactly one candidate resolves fuzzy', () => {
    expect(matchHosxpMed(meds, 'Amoxicillin 250')).toEqual({ kind: 'fuzzy', medId: '1' });
  });

  it('a substring match with multiple candidates is ambiguous, never guessed', () => {
    expect(matchHosxpMed(meds, 'Amoxicillin')).toEqual({ kind: 'ambiguous', candidateIds: ['1', '2'] });
  });

  it('never matches an inactive/discontinued drug', () => {
    expect(matchHosxpMed(meds, 'Inactive Drug')).toEqual({ kind: 'none' });
  });

  it('empty input is never a match', () => {
    expect(matchHosxpMed(meds, '   ')).toEqual({ kind: 'none' });
  });
});
