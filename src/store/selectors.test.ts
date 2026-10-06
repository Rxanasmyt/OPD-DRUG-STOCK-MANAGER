import { describe, it, expect } from 'vitest';
import type { AppState, Med, UsageHistoryRecord, DailyMetrics, ParAdjustmentRecord } from '../types';
import {
  wardOf, matchesWard, binFor, binDisplayAll, floorMinOf, isUrgentLow, needsWarehouseRequest,
  lastReconcileDateIso, subQty, usageAnomalies,
  daysOfStockLeft, fefoLot, toneFor, subTone, roundStep, suggestTransferQty, matchHosxpMed, suggestPar,
  categoryOf, categoryStats, parAnomaliesFor, packStep, isOnStockHold, routeOf, effectiveRouteOf,
  topUsageByMed, usageByCategory, usageByMonth, leadTimeTrend, recurringStockouts, parAdjustmentOutcomes,
  monthlyDaySplits, boxBreakdownLabel,
} from './selectors';
import { categoryLabel } from '../data/categories';
import { DAY } from '../utils/format';

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

describe('routeOf', () => {
  it('falls back to "other" for a med with no route set', () => {
    expect(routeOf(med())).toBe('other');
  });

  it('returns the med\'s own route when set', () => {
    expect(routeOf(med({ route: 'oral' }))).toBe('oral');
    expect(routeOf(med({ route: 'injection' }))).toBe('injection');
    expect(routeOf(med({ route: 'other' }))).toBe('other');
  });
});

describe('effectiveRouteOf', () => {
  // Regression for the real friction report: routeOf() alone left the ENTIRE pre-existing
  // formulary unclassified (none of it has `route` set), requiring a manual per-med chip or an
  // admin bulk-action click before TransferScreen's route grouping did anything visible. See
  // effectiveRouteOf()'s own doc comment in selectors.ts.
  it('falls back to a live suggestRoute() guess when route is unset', () => {
    expect(effectiveRouteOf(med({ unit: 'Vial', name: 'Cefazolin 1g' }))).toBe('injection');
    expect(effectiveRouteOf(med({ unit: 'เม็ด', name: 'Paracetamol 500mg' }))).toBe('oral');
  });

  it('a med\'s own explicit route always wins over the live guess, even a contradictory one', () => {
    expect(effectiveRouteOf(med({ unit: 'Vial', name: 'Cefazolin 1g', route: 'other' }))).toBe('other');
  });

  it('falls back to "other" when neither an explicit route nor a confident guess exists', () => {
    expect(effectiveRouteOf(med({ unit: 'Tube', dosageForm: 'Cream', name: 'Hydrocortisone Cream' }))).toBe('other');
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

  it('defaults to a rounded ~50% of parFloor when floorMin is unset', () => {
    // Regression guard for the bug this function's own comment describes: a naive
    // Math.round(parFloor*0.5) would give an odd-looking 43 here — roundStep-style
    // rounding should land on a clean 45.
    expect(floorMinOf(med({ parFloor: 86 }))).toBe(45);
    expect(floorMinOf(med({ parFloor: 0 }))).toBe(0);
  });

  it('falls back to the 50%-of-Max default (not a clamp to exactly Max) when a hand-set floorMin ended up above the med\'s current parFloor', () => {
    // Regression guard for a real, observed case: applyOnePar/applyAllSuggested ("ใช้ par ที่
    // แนะนำ", AppContext.tsx) can lower parFloor (Max) from real usage statistics with no
    // cross-check against the med's existing hand-set floorMin (Min), leaving "Min 400 / Max
    // 110" live. A first fix clamped this down to exactly 110 (Math.min) — still wrong, since
    // Min === Max reads as permanently "ต่ำกว่า Min" the instant the shelf isn't 100% full, same
    // practical effect as the original bug, and MedsScreen's edit form would silently bake that
    // 110 in as an explicit stored floorMin the next time someone merely opened and saved it.
    // halfOfMaxRounded(110) = round(55/5)*5 = 55 — the same default an unset floorMin gets.
    expect(floorMinOf(med({ floorMin: 400, parFloor: 110 }))).toBe(55);
    // A normal, already-consistent pair must be untouched.
    expect(floorMinOf(med({ floorMin: 40, parFloor: 110 }))).toBe(40);
    // Explicitly set equal to Max is a legitimate, deliberate choice (MedsScreen's own edit-form
    // validation only blocks STRICTLY greater) — must not also be defaulted away.
    expect(floorMinOf(med({ floorMin: 110, parFloor: 110 }))).toBe(110);
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

  it('subQty stays correct across different state objects (WeakMap index cache does not cross-contaminate)', () => {
    const other = { ...st, lots: [
      { id: 'x1', code: 'X1', medId: 'm1', lotNo: '1', exp: 300, qty: 42, loc: 'x' },
    ] } as unknown as AppState;
    expect(subQty(st, 'm1')).toBe(15); // unchanged
    expect(subQty(other, 'm1')).toBe(42); // different lots array, different answer
    expect(subQty(st, 'm1')).toBe(15); // still correct after querying a different state
  });

  it('fefoLot picks the soonest-expiring lot that still has stock (first-expired-first-out)', () => {
    const l = fefoLot(st, 'm1');
    expect(l?.id).toBe('l2'); // exp 100, earliest among qty>0 lots (l3 is depleted)
  });

  it('fefoLot treats a lot with missing exp as unknown/lowest-priority, not most-urgent', () => {
    const stWithUnknownExp = { ...st, lots: [
      { id: 'known', code: 'K', medId: 'm2', lotNo: '1', exp: 500, qty: 10, loc: 'x' },
      { id: 'unknown', code: 'U', medId: 'm2', lotNo: '2', exp: undefined as unknown as number, qty: 10, loc: 'x' },
    ] } as unknown as AppState;
    // A missing exp used to coerce to NaN (or 0 in the transaction path) and could sort FIRST,
    // ahead of a lot with a real near-term expiry — exactly backwards for FEFO.
    expect(fefoLot(stWithUnknownExp, 'm2')?.id).toBe('known');
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

// Real-world request: "เก็บสถิติการใช้ยาแต่ละวัน...Top 100...ใช้ยากลุ่มไหนเยอะ...กราฟรายเดือน" — these
// three pure aggregators are what the new "📈 สถิติการใช้ยา" tab (ReportScreen.tsx) feeds through
// after fetchUsageHistory returns whatever UsageHistoryRecord rows matched the caller's date
// range; the fetch/date-filtering itself needs Firestore and is covered separately in
// AppContext.commit.test.tsx.
function usageRec(overrides: Partial<UsageHistoryRecord> = {}): UsageHistoryRecord {
  return {
    medId: 'm1', medName: 'Drug A', unit: 'เม็ด', category: 'pain',
    qty: 100, value: 1000, periodFrom: '2026-01-01', periodTo: '2026-01-31', periodDays: 31,
    importedAt: 0, monthKey: '2026-01',
    ...overrides,
  };
}

describe('topUsageByMed', () => {
  it('sums every record for the same drug across periods, ranks by the requested metric, and keeps its real unit', () => {
    const records = [
      usageRec({ medId: 'a', medName: 'Drug A', unit: 'เม็ด', qty: 100, value: 500, monthKey: '2026-01' }),
      usageRec({ medId: 'a', medName: 'Drug A', unit: 'เม็ด', qty: 50, value: 250, monthKey: '2026-02' }),
      usageRec({ medId: 'b', medName: 'Drug B', unit: 'ขวด', qty: 200, value: 100, monthKey: '2026-01' }),
    ];
    const byQty = topUsageByMed(records, 'qty');
    expect(byQty[0]).toMatchObject({ medId: 'b', qty: 200, value: 100, unit: 'ขวด' });
    expect(byQty[1]).toMatchObject({ medId: 'a', qty: 150, value: 750, unit: 'เม็ด' });

    const byValue = topUsageByMed(records, 'value');
    expect(byValue[0].medId).toBe('a'); // 750 บาท > 100 บาท, even though its qty ranks lower
  });

  it('caps the result at `limit`', () => {
    const records = Array.from({ length: 5 }, (_, i) => usageRec({ medId: 'm' + i, qty: 10 - i }));
    expect(topUsageByMed(records, 'qty', 3)).toHaveLength(3);
  });
});

describe('usageByCategory', () => {
  it('sums qty/value across different drugs sharing a category, sorted by value descending', () => {
    const records = [
      usageRec({ medId: 'a', category: 'pain', value: 100 }),
      usageRec({ medId: 'b', category: 'pain', value: 50 }),
      usageRec({ medId: 'c', category: 'antimicrobial', value: 900 }),
    ];
    const out = usageByCategory(records);
    expect(out).toEqual([
      { category: 'antimicrobial', qty: 100, value: 900 },
      { category: 'pain', qty: 200, value: 150 },
    ]);
  });
});

describe('usageByMonth', () => {
  it('sums qty/value per monthKey and sorts chronologically', () => {
    const records = [
      usageRec({ monthKey: '2026-03', value: 10 }),
      usageRec({ monthKey: '2026-01', value: 20 }),
      usageRec({ monthKey: '2026-01', value: 5 }),
    ];
    const out = usageByMonth(records);
    expect(out).toEqual([
      { monthKey: '2026-01', qty: 200, value: 25 },
      { monthKey: '2026-03', qty: 100, value: 10 },
    ]);
  });
});

// Regression for a system-analysis follow-up (not a direct user request): a multi-month usage
// import used to count its entire qty wholly under its start month — see monthlyDaySplits()'s
// own doc comment (selectors.ts) and UsageHistoryRecord's (types.ts).
describe('monthlyDaySplits', () => {
  it('returns one chunk for a period that stays within a single calendar month', () => {
    expect(monthlyDaySplits('2026-01-01', '2026-01-31')).toEqual([{ monthKey: '2026-01', days: 31 }]);
  });

  it('splits a period spanning 3 calendar months into one chunk per month, with the real day-count of each', () => {
    // 2026-01-15..2026-03-10: Jan 15-31 (17 days), Feb 1-28 (28 days, 2026 not a leap year), Mar 1-10 (10 days).
    expect(monthlyDaySplits('2026-01-15', '2026-03-10')).toEqual([
      { monthKey: '2026-01', days: 17 },
      { monthKey: '2026-02', days: 28 },
      { monthKey: '2026-03', days: 10 },
    ]);
  });

  it('every chunk\'s days sum back to the exact total period length', () => {
    const splits = monthlyDaySplits('2025-11-20', '2026-02-05');
    const total = splits.reduce((s, c) => s + c.days, 0);
    // 2025-11-20 to 2026-02-05 inclusive = 78 days.
    expect(total).toBe(78);
  });

  it('handles a period crossing a calendar-year boundary correctly', () => {
    expect(monthlyDaySplits('2025-12-20', '2026-01-10')).toEqual([
      { monthKey: '2025-12', days: 12 },
      { monthKey: '2026-01', days: 10 },
    ]);
  });
});

// Real-world request: "ทำยังไงให้การเบิกเติมยาเสถียรที่สุด" — leadTimeTrend/recurringStockouts
// (fed by scripts/collect-daily-metrics.mjs's dailyMetrics snapshots) and parAdjustmentOutcomes
// (fed by applyOnePar/applyAllSuggested's parAdjustments records) are the three new ReportScreen
// "🧠 วิเคราะห์อัตโนมัติ" tab cards covering that request. All pure aggregation — the
// fetch/date-filtering itself needs Firestore and is covered separately in
// AppContext.commit.test.tsx.
function dm(overrides: Partial<DailyMetrics> = {}): DailyMetrics {
  return {
    date: '2026-01-01', generatedAt: 0, activeMedCount: 0, totalFloorQty: 0, totalSubQty: 0,
    totalStockValue: 0, lowStockCount: 0, urgentLowCount: 0, nearExpiryValue: 0, expiredValue: 0,
    receivedQty: 0, receivedCount: 0, transferredQty: 0, dispensedQty: 0, adjustQty: 0, txCount: 0,
    receiveLeadTimeAvgHours: null, receiveApprovedCount: 0, receivePendingBacklog: 0,
    parErrorCount: 0, parReviewCount: 0, countDiscrepancyCount: 0, hosxpUnmatchedCount: 0, reconciledToday: true,
    activeUserCount: 0, txByUser: {}, stockoutCount: 0, usedMedCount: 0,
    ...overrides,
  };
}

describe('leadTimeTrend', () => {
  it('flags degraded when the last 7 days run >=50% slower (weighted) than everything before, regardless of input order', () => {
    const prior = Array.from({ length: 23 }, (_, i) => dm({ date: '2026-01-' + String(i + 1).padStart(2, '0'), receiveLeadTimeAvgHours: 2, receiveApprovedCount: 1 }));
    const recent = Array.from({ length: 7 }, (_, i) => dm({ date: '2026-01-' + String(i + 24).padStart(2, '0'), receiveLeadTimeAvgHours: 4, receiveApprovedCount: 1 }));
    // Shuffled input — the function must sort by date itself, not trust caller order.
    const rows = [...recent, ...prior].reverse();
    const out = leadTimeTrend(rows);
    expect(out).toMatchObject({ recentAvgHours: 4, priorAvgHours: 2, changePct: 1, degraded: true });
  });

  it('returns null when either window has zero approvals to average, rather than a misleading 0', () => {
    const rows = Array.from({ length: 30 }, (_, i) => dm({ date: '2026-01-' + String(i + 1).padStart(2, '0'), receiveApprovedCount: 0 }));
    expect(leadTimeTrend(rows)).toBeNull();
  });

  it('does not flag a mild slowdown under the threshold', () => {
    const prior = Array.from({ length: 23 }, (_, i) => dm({ date: '2026-01-' + String(i + 1).padStart(2, '0'), receiveLeadTimeAvgHours: 2, receiveApprovedCount: 1 }));
    const recent = Array.from({ length: 7 }, (_, i) => dm({ date: '2026-01-' + String(i + 24).padStart(2, '0'), receiveLeadTimeAvgHours: 2.2, receiveApprovedCount: 1 }));
    expect(leadTimeTrend([...prior, ...recent])?.degraded).toBe(false);
  });
});

describe('recurringStockouts', () => {
  it('flags only a med appearing on at least `minDays` different days, and excludes an inactive med', () => {
    const meds = [
      med({ id: 'frequent', active: true }),
      med({ id: 'once', active: true }),
      med({ id: 'inactive-but-frequent', active: false }),
    ];
    const rows = [
      dm({ date: '2026-01-01', stockoutMedIds: ['frequent', 'inactive-but-frequent'] }),
      dm({ date: '2026-01-02', stockoutMedIds: ['frequent', 'inactive-but-frequent'] }),
      dm({ date: '2026-01-03', stockoutMedIds: ['frequent', 'inactive-but-frequent', 'once'] }),
    ];
    const out = recurringStockouts(rows, meds);
    expect(out).toEqual([{ med: meds[0], dayCount: 3, totalDays: 3 }]);
  });

  it('treats a day with no stockoutMedIds field (pre-rollout snapshot) as an empty day, not an error', () => {
    const meds = [med({ id: 'm1', active: true })];
    const rows = [dm({ date: '2026-01-01' }), dm({ date: '2026-01-02' })]; // no stockoutMedIds at all
    expect(recurringStockouts(rows, meds)).toEqual([]);
  });
});

function parAdj(overrides: Partial<ParAdjustmentRecord> = {}): ParAdjustmentRecord {
  return {
    medId: 'a', medName: 'Drug A', category: 'pain',
    beforeFloor: 100, beforeSub: 500, afterFloor: 150, afterSub: 600,
    used30AtAdjust: 200, usedPrev30AtAdjust: 100,
    adjustedAt: Date.now() - 20 * DAY, adjustedBy: 'admin',
    ...overrides,
  };
}

describe('parAdjustmentOutcomes', () => {
  it('classifies still_volatile/stable/too_recent/med_gone correctly', () => {
    const meds = [
      med({ id: 'a', used30: 170, usedPrev30: 100 }), // +70% swing today — still volatile
      med({ id: 'b', used30: 105, usedPrev30: 100 }), // +5% — calmed down
      med({ id: 'c', used30: 100, usedPrev30: 100 }),
      // 'd' intentionally absent from meds — simulates a deleted/deactivated med.
    ];
    const records = [
      parAdj({ medId: 'a', adjustedAt: Date.now() - 20 * DAY }),
      parAdj({ medId: 'b', adjustedAt: Date.now() - 20 * DAY }),
      parAdj({ medId: 'c', adjustedAt: Date.now() - 5 * DAY }), // too recent — not matured yet
      parAdj({ medId: 'd', adjustedAt: Date.now() - 20 * DAY }),
    ];
    const out = parAdjustmentOutcomes(records, meds);
    expect(out.find((o) => o.record.medId === 'a')?.status).toBe('still_volatile');
    expect(out.find((o) => o.record.medId === 'b')?.status).toBe('stable');
    expect(out.find((o) => o.record.medId === 'c')?.status).toBe('too_recent');
    expect(out.find((o) => o.record.medId === 'd')?.status).toBe('med_gone');
  });

  it('keeps only the TRULY latest record per med (by adjustedAt), not whichever is first in the input array', () => {
    const meds = [med({ id: 'e', used30: 100, usedPrev30: 100 })];
    const records = [
      // Oldest listed FIRST — if the dedup kept "first seen" instead of comparing adjustedAt,
      // this stale record (already matured) would wrongly win over the real latest below,
      // which hasn't matured yet.
      parAdj({ medId: 'e', adjustedAt: Date.now() - 100 * DAY }),
      parAdj({ medId: 'e', adjustedAt: Date.now() - 5 * DAY }), // the real latest — too recent
    ];
    const out = parAdjustmentOutcomes(records, meds);
    expect(out).toHaveLength(1);
    expect(out[0].status).toBe('too_recent');
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
  // Bug fix: a `Math.max(1, parFloor)` guard used to just prevent a NaN crash without forcing
  // a real verdict — for a med with par never configured (parFloor: 0), the ratio degenerated
  // to the raw floor qty itself (floor/1), so e.g. floor:5 read as 5/1=5 >= 0.75 and showed a
  // confidently wrong "green/healthy" tone despite par never having been set at all. An
  // unconfigured par is never a health verdict either way — amber ("needs a look"), always.
  it('never divides by zero for a med with parFloor still 0 (new, not-yet-configured), and never claims "healthy"', () => {
    expect(() => toneFor(med({ parFloor: 0, floor: 5 }))).not.toThrow();
    expect(toneFor(med({ parFloor: 0, floor: 5 }))).toBe('var(--amber)');
    expect(toneFor(med({ parFloor: 0, floor: 0 }))).toBe('var(--amber)');
  });

  it('thresholds at the documented 34%/75% of par', () => {
    expect(toneFor(med({ parFloor: 100, floor: 33 }))).toBe('var(--red)');
    expect(toneFor(med({ parFloor: 100, floor: 74 }))).toBe('var(--amber)');
    expect(toneFor(med({ parFloor: 100, floor: 75 }))).toBe('var(--green)');
  });
});

describe('isUrgentLow', () => {
  it('flags a shelf at/below half its own Min, not just below Min', () => {
    // floorMin set explicitly here (30) — this test is about isUrgentLow()'s own "half of
    // whatever Min is" rule, independent of floorMinOf()'s default-fallback ratio.
    expect(isUrgentLow(med({ parFloor: 100, floorMin: 30, floor: 14 }))).toBe(true); // 14 <= 15 (half of 30)
    expect(isUrgentLow(med({ parFloor: 100, floorMin: 30, floor: 15 }))).toBe(true); // exactly half — urgent too, per this function's own doc comment ("at/below")
    expect(isUrgentLow(med({ parFloor: 100, floorMin: 30, floor: 16 }))).toBe(false); // just above half — below Min but not urgent yet
    expect(isUrgentLow(med({ parFloor: 100, floorMin: 30, floor: 29 }))).toBe(false); // below Min but not urgent
  });
});

describe('needsWarehouseRequest', () => {
  it('judges a substock-backed med by substock/parSub', () => {
    const m = med({ noSubstock: false, parSub: 100 });
    expect(needsWarehouseRequest(m, 99)).toBe(true);
    expect(needsWarehouseRequest(m, 100)).toBe(false);
  });

  it('judges a noSubstock med by floor/parFloor instead — it has no real substock number', () => {
    const m = med({ noSubstock: true, parFloor: 50, floor: 49 });
    expect(needsWarehouseRequest(m, 0)).toBe(true); // curSub irrelevant here — always 0 for these
    expect(needsWarehouseRequest(med({ noSubstock: true, parFloor: 50, floor: 50 }), 0)).toBe(false);
  });

  it('never flags a med currently on a stock hold, even when genuinely below par', () => {
    // Real-world request: "บริษัทยาไม่มาส่งยา...เลิกผลิต...คลังปิดช่วงปลาย/ต้นปีงบประมาณ" — a
    // held med is already known to be unrequestable; repeating the same unfulfillable ask on
    // every print run is noise, not help.
    const held = med({ noSubstock: false, parSub: 100, outOfStockSince: Date.now(), outOfStockReason: 'บริษัทเลิกผลิต' });
    expect(needsWarehouseRequest(held, 0)).toBe(false);
    // Without the hold, the exact same numbers WOULD qualify — proves the hold is what's
    // suppressing it, not some other field on this fixture.
    const notHeld = med({ noSubstock: false, parSub: 100 });
    expect(needsWarehouseRequest(notHeld, 0)).toBe(true);
  });
});

describe('isOnStockHold', () => {
  it('is true only once outOfStockSince is actually set', () => {
    expect(isOnStockHold(med())).toBe(false);
    expect(isOnStockHold(med({ outOfStockSince: Date.now(), outOfStockReason: 'จัดส่งล่าช้า' }))).toBe(true);
  });
});

describe('lastReconcileDateIso', () => {
  it('returns the ISO date of the most recent reconcile_hosxp tx, assuming txs are newest-first', () => {
    const txs = [
      { type: 'adjust', ts: new Date('2026-09-10T08:00:00').getTime() },
      { type: 'reconcile_hosxp', ts: new Date('2026-09-09T07:30:00').getTime() },
      { type: 'reconcile_hosxp', ts: new Date('2026-09-08T07:00:00').getTime() },
    ] as unknown as Parameters<typeof lastReconcileDateIso>[0];
    expect(lastReconcileDateIso(txs)).toBe('2026-09-09');
  });

  it('returns null when there is no reconcile_hosxp tx at all', () => {
    const txs = [{ type: 'adjust', ts: Date.now() }] as unknown as Parameters<typeof lastReconcileDateIso>[0];
    expect(lastReconcileDateIso(txs)).toBeNull();
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

  it('rounds a box-only med to the NEAREST whole multiple of packSize, not the generic magnitude step', () => {
    const st = { lots: [{ id: 'l1', code: 'L1', medId: 'm1', lotNo: '1', exp: 0, qty: 999, loc: 'x' }] } as unknown as AppState;
    // Deficit is 75 (parFloor 100 - floor 25); packSize 30 means the generic 10-step is
    // overridden — 75 is exactly 2.5 boxes, which rounds up to 90 (3 boxes of 30, JS's own
    // round-half-up), never a fractional box.
    expect(suggestTransferQty(st, med({ id: 'm1', parFloor: 100, floor: 25, packSize: 30 }))).toBe(90);
  });

  // Real-world request: "พอคำนวนออกมาได้ 1 กล่องกับเศษนิดหน่อย ปัดเป็น 2 ทำให้ยาที่เติมเยอะเกินไป
  // ครับเนื่องจากบางตัวยากล่องละ 1000" — a box-only med must round to the NEAREST box, not always
  // UP, or a tiny leftover over 1 box badly overfills the floor for a large box size.
  it('rounds a box-only med DOWN when the leftover is less than half a box, instead of always rounding up', () => {
    const st = { lots: [{ id: 'l1', code: 'L1', medId: 'm1', lotNo: '1', exp: 0, qty: 9999, loc: 'x' }] } as unknown as AppState;
    // Deficit is 1,050 (parFloor 1200 - floor 150); packSize 1,000 — without the fix this used
    // to round up to 2 full boxes (2,000), over twice the real need.
    expect(suggestTransferQty(st, med({ id: 'm1', parFloor: 1200, floor: 150, packSize: 1000 }))).toBe(1000);
  });

  it('still rounds a box-only med UP when the leftover is more than half a box', () => {
    const st = { lots: [{ id: 'l1', code: 'L1', medId: 'm1', lotNo: '1', exp: 0, qty: 9999, loc: 'x' }] } as unknown as AppState;
    // Deficit is 1,900 (parFloor 2050 - floor 150); packSize 1,000 — rounds up to 2 boxes
    // (2,000), since 1 box alone (1,000) would leave the floor well short of par.
    expect(suggestTransferQty(st, med({ id: 'm1', parFloor: 2050, floor: 150, packSize: 1000 }))).toBe(2000);
  });

  it('never suggests 0 boxes for a box-only med with a real deficit smaller than half a box', () => {
    const st = { lots: [{ id: 'l1', code: 'L1', medId: 'm1', lotNo: '1', exp: 0, qty: 9999, loc: 'x' }] } as unknown as AppState;
    // Deficit is 200 (parFloor 1000 - floor 800); packSize 1,000 — rounds to the nearest box
    // would naively be 0 boxes, but floor being under par always means at least 1 box is
    // genuinely worth moving.
    expect(suggestTransferQty(st, med({ id: 'm1', parFloor: 1000, floor: 800, packSize: 1000 }))).toBe(1000);
  });

  it('caps a box-only med at what substock actually has, same as any other med', () => {
    const st = { lots: [{ id: 'l1', code: 'L1', medId: 'm1', lotNo: '1', exp: 0, qty: 40, loc: 'x' }] } as unknown as AppState;
    expect(suggestTransferQty(st, med({ id: 'm1', parFloor: 100, floor: 25, packSize: 30 }))).toBe(40);
  });
});

describe('packStep', () => {
  it('uses the med\'s packSize when set and greater than 1', () => {
    expect(packStep(med({ packSize: 50 }))).toBe(50);
  });

  it('ignores a packSize of 1 or 0 (not really a box requirement) and falls back to the generic magnitude step', () => {
    expect(packStep(med({ parFloor: 25, packSize: 1 }))).toBe(1);
    expect(packStep(med({ parFloor: 200, packSize: 0 }))).toBe(10);
  });

  it('falls back to the generic magnitude step (1/10/100) when packSize is unset', () => {
    expect(packStep(med({ parFloor: 25 }))).toBe(1);
    expect(packStep(med({ parFloor: 200 }))).toBe(10);
    expect(packStep(med({ parFloor: 600 }))).toBe(100);
  });
});

// Real-world request: "ในใบคุมสต็อก หรือใบหน้างาน ให้เขียนเป็นรูปแบบเช่น 1x60 แปลว่าเบิกยา 1 กล่อง
// กล่องละ 60 เม็ด"
describe('boxBreakdownLabel', () => {
  it('shows a clean whole-box quantity as "NxSIZE" with no remainder', () => {
    expect(boxBreakdownLabel(med({ packSize: 60, unit: 'เม็ด' }), 120)).toBe('2x60');
  });

  it('appends the remainder when qty is not a clean multiple of the box size', () => {
    expect(boxBreakdownLabel(med({ packSize: 60, unit: 'เม็ด' }), 65)).toBe('1x60 + 5 เม็ด');
  });

  it('shows a plain unit count (no "0xSIZE") when qty is under one full box', () => {
    expect(boxBreakdownLabel(med({ packSize: 60, unit: 'เม็ด' }), 17)).toBe('17 เม็ด');
  });

  it('returns undefined for a med with no real box size', () => {
    expect(boxBreakdownLabel(med({ packSize: undefined }), 65)).toBeUndefined();
    expect(boxBreakdownLabel(med({ packSize: 1 }), 65)).toBeUndefined();
  });

  it('returns undefined for a non-positive qty', () => {
    expect(boxBreakdownLabel(med({ packSize: 60 }), 0)).toBeUndefined();
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

  // Regression for a real request: "การใช้ยาแต่ละวันในคลินิกที่แตกต่างกัน ยาที่ใช้ในแต่ละวันก็จะ
  // ต่างกัน...การคำนวณ min max และ par ต้องมีความแม่นยำมากๆ" — see Med.weekdayPeakFactor's own doc
  // comment. Must apply to floor par (daily refill, must survive the real busiest day) but NEVER
  // to substock par (its much longer ~2-week cycle already absorbs a single weekday's spike).
  it('scales ONLY floor par (never substock par) by weekdayPeakFactor when a real weekday pattern was detected', () => {
    const daily = 30 / (30 * (5 / 7));
    const flat = suggestPar(med({ used30: 30, volatility: 1 }), 3, 21);
    const withPattern = suggestPar(med({ used30: 30, volatility: 1, weekdayPeakFactor: 2 }), 3, 21);
    expect(withPattern).toEqual({ floor: roundStep(daily * 3 * 2), sub: roundStep(daily * 21) });
    expect(withPattern!.sub).toBe(flat!.sub); // substock par completely unaffected
    expect(withPattern!.floor).toBeGreaterThan(flat!.floor); // floor par scaled up
  });

  it('defaults weekdayPeakFactor to 1 (no change at all) for a med analyzeWeekdayUsage hasn\'t run for yet', () => {
    const daily = 30 / (30 * (5 / 7));
    const out = suggestPar(med({ used30: 30, volatility: 1 }), 3, 21);
    expect(out).toEqual({ floor: roundStep(daily * 3), sub: roundStep(daily * 21) });
  });

  // Regression for a real request: "การคำนวณ min max หรือ par substock ให้อิงตัวเลขจำนวนกล่องยาร่วม
  // ด้วยว่า 1 กล่องมีจำนวนยาเท่าไร เพราะการเบิกจะเบิกทีละกล่องทีละขวดทีละแพคอยู่แล้ว" — a med with a
  // real box size must get a suggested par that's actually a whole number of boxes, never a
  // mid-box quantity nobody could actually order.
  it('rounds the suggested par UP to a whole box when the med has a real packSize, instead of the generic 1/10/100 step', () => {
    // daily usage low enough that the generic step (1) would suggest a small, non-box number —
    // packSize=1000 must still win out and suggest one whole box.
    const lowUseBoxed = suggestPar(med({ used30: 30, volatility: 1, packSize: 1000 }), 3, 21);
    expect(lowUseBoxed!.floor % 1000).toBe(0);
    expect(lowUseBoxed!.sub % 1000).toBe(0);
    expect(lowUseBoxed!.floor).toBeGreaterThan(0);

    // A med with no packSize must be completely unaffected — same numbers as before this fix.
    const noPackSize = suggestPar(med({ used30: 30, volatility: 1 }), 3, 21);
    const daily = 30 / (30 * (5 / 7));
    expect(noPackSize).toEqual({ floor: roundStep(daily * 3), sub: roundStep(daily * 21) });
  });
});

describe('roundStep — box-aware rounding', () => {
  it('rounds up to the nearest whole box when packSize is given', () => {
    expect(roundStep(40, 1000)).toBe(1000);
    expect(roundStep(1001, 1000)).toBe(2000);
    // Same "never actually returns 0" contract as the generic step — see suggestPar()'s own
    // "ห้ามแนะนำ par" guard for why a zero input is never meant to reach this function for real.
    expect(roundStep(0, 1000)).toBe(1000);
  });

  it('falls back to the generic magnitude step when packSize is absent or <= 1', () => {
    expect(roundStep(40)).toBe(40);
    expect(roundStep(40, 1)).toBe(40);
    expect(roundStep(640)).toBe(700);
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

describe('parAnomaliesFor', () => {
  it('flags Min at or above Max', () => {
    const m = med({ parFloor: 50, floorMin: 60 });
    const codes = parAnomaliesFor(m, 4, 28).map((a) => a.code);
    expect(codes).toContain('min_ge_max');
    const m2 = med({ parFloor: 50, floorMin: 50 });
    expect(parAnomaliesFor(m2, 4, 28).map((a) => a.code)).toContain('min_ge_max');
  });

  it('does not flag Min genuinely below Max', () => {
    const m = med({ parFloor: 50, floorMin: 25 });
    expect(parAnomaliesFor(m, 4, 28).map((a) => a.code)).not.toContain('min_ge_max');
  });

  it('flags par substock smaller than par หน้างาน for a substock-using med', () => {
    const m = med({ parFloor: 100, parSub: 50, floorMin: 20, noSubstock: false });
    expect(parAnomaliesFor(m, 4, 28).map((a) => a.code)).toContain('sub_lt_floor');
  });

  it('does not flag par substock < par floor for a noSubstock med (the field is meaningless there)', () => {
    const m = med({ parFloor: 100, parSub: 50, floorMin: 20, noSubstock: true });
    expect(parAnomaliesFor(m, 4, 28).map((a) => a.code)).not.toContain('sub_lt_floor');
  });

  it('flags real usage with no par หน้างาน/par substock set at all', () => {
    const m = med({ parFloor: 0, parSub: 0, floorMin: 0, used30: 300, noSubstock: false });
    const codes = parAnomaliesFor(m, 4, 28).map((a) => a.code);
    expect(codes).toContain('no_par_floor');
    expect(codes).toContain('no_par_sub');
  });

  it('a clean, internally-consistent med with no usage stats has no anomalies', () => {
    const m = med({ parFloor: 50, parSub: 100, floorMin: 25, used30: 0, usedPrev30: 0 });
    expect(parAnomaliesFor(m, 4, 28)).toEqual([]);
  });

  it('flags a par far off from what real usage suggests, as a review (not error)', () => {
    // daily = used30/30 = 10/day; suggested floor ≈ roundStep(10*4*1) = 40 — current par of
    // 2000 is 50x that, well past the 3x threshold.
    const m = med({ parFloor: 2000, parSub: 3000, floorMin: 1000, used30: 300, volatility: 1 });
    const anomaly = parAnomaliesFor(m, 4, 28).find((a) => a.code === 'floor_far_from_suggested');
    expect(anomaly?.severity).toBe('review');
  });

  it('ignores an inactive med entirely', () => {
    const m = med({ active: false, parFloor: 50, floorMin: 60 });
    expect(parAnomaliesFor(m, 4, 28)).toEqual([]);
  });

  it('flags zero stock + never-configured par + no usage as a review (the one gap no_par_floor does not cover)', () => {
    const m = med({ parFloor: 0, parSub: 0, floorMin: 0, floor: 0, used30: 0 });
    const codes = parAnomaliesFor(m, 4, 28).map((a) => a.code);
    expect(codes).toContain('floor_zero_no_par');
    expect(codes).not.toContain('no_par_floor'); // that one only fires when used30 > 0
  });

  it('does not flag floor_zero_no_par once real usage exists (no_par_floor covers that case instead)', () => {
    const m = med({ parFloor: 0, parSub: 0, floorMin: 0, floor: 0, used30: 10 });
    expect(parAnomaliesFor(m, 4, 28).map((a) => a.code)).not.toContain('floor_zero_no_par');
  });

  it('does not flag floor_zero_no_par once a floor par has actually been configured', () => {
    const m = med({ parFloor: 50, parSub: 0, floorMin: 25, floor: 0, used30: 0 });
    expect(parAnomaliesFor(m, 4, 28).map((a) => a.code)).not.toContain('floor_zero_no_par');
  });
});

describe('subTone', () => {
  // Same fix/reasoning as toneFor() above, applied to the substock ratio.
  it('never claims "healthy" for an unconfigured par, regardless of current qty', () => {
    expect(subTone(5, 0)).toBe('var(--amber)');
    expect(subTone(0, 0)).toBe('var(--amber)');
  });

  it('thresholds at the documented 34%/75% of par once a real par is set', () => {
    expect(subTone(33, 100)).toBe('var(--red)');
    expect(subTone(74, 100)).toBe('var(--amber)');
    expect(subTone(75, 100)).toBe('var(--green)');
  });
});
