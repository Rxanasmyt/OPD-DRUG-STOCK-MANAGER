import { describe, it, expect, vi, afterEach } from 'vitest';
import { nf, isoDate, daysUntil, fiscalYear, fiscalYearStartIso, digitsOnly, parseIntSafe, DAY, bangkokWeekday } from './format';

// isoDate/daysUntil/fiscalYear/fiscalYearStartIso all anchor to Asia/Bangkok explicitly now (see
// format.ts's own "Bug fix (audit finding — device-timezone trust)" comment) — they no longer
// read the test RUNNER's local timezone at all. Building fixtures with the local `new Date(y, m,
// d, h, min)` constructor (as these tests used to) would make a boundary-crossing test's result
// depend on whichever timezone happens to run this suite (this repo's CI runs UTC, where device-
// local midnight and Bangkok midnight are 7h apart) — bangkokUtcMs constructs the real UTC
// instant for a given BANGKOK wall-clock reading directly, so these tests mean the same thing
// regardless of what timezone actually runs them.
function bangkokUtcMs(y: number, m: number, d: number, h = 0, min = 0): number {
  return Date.UTC(y, m, d, h, min) - 7 * 60 * 60 * 1000;
}

describe('nf', () => {
  it('rounds and thousands-separates', () => {
    expect(nf(1234.6)).toBe('1,235');
    expect(nf(0)).toBe('0');
    expect(nf(-42)).toBe('-42');
  });

  it('never renders negative zero as "-0"', () => {
    // Regression guard: (-0).toLocaleString('en-US') is literally "-0" in JS. A real -0 can
    // reach here from Math.round(-0.4), or from reconcile math like -(before - after) when a
    // HOSxP dispense is clamped against a drug already at 0 on the shelf (commitReconcile in
    // AppContext.tsx) — which used to print a confusing "-0" on ReportScreen's discrepancy log.
    expect(nf(-0)).toBe('0');
    expect(nf(-0.4)).toBe('0');
    expect(nf(-(0 - 0))).toBe('0');
  });
});

describe('isoDate', () => {
  it('formats as YYYY-MM-DD with zero-padded month/day', () => {
    expect(isoDate(bangkokUtcMs(2026, 0, 5))).toBe('2026-01-05');
    expect(isoDate(bangkokUtcMs(2026, 11, 31))).toBe('2026-12-31');
  });

  it('reads the Bangkok calendar date, not the UTC one, near a day boundary', () => {
    // 2026-01-05 23:00 Bangkok = 2026-01-05 16:00 UTC — same UTC calendar day here, so this
    // alone wouldn't catch a bug that used raw UTC getters. The real case: 2026-01-06 02:00
    // Bangkok = 2026-01-05 19:00 UTC — already into Jan 6 in Bangkok, still Jan 5 in UTC.
    expect(isoDate(bangkokUtcMs(2026, 0, 6, 2, 0))).toBe('2026-01-06');
  });
});

// Regression for a real request: "นำข้อมูลการจ่ายยาหน้างานจริงในแต่ละวันจันทร์-ศุกร์ มาวิเคราะห์
// การใช้ยาจริง" — analyzeWeekdayUsage() (AppContext.tsx) buckets reconcile_hosxp tx history by
// bangkokWeekday(), so a device-timezone-driven misread here would silently bucket a dispense
// under the wrong weekday, exactly the bug class bangkokParts()/isoDate() above already exist to
// close for the DATE side of the same timestamp.
describe('bangkokWeekday', () => {
  it('returns the real Bangkok weekday (2026-01-05 is a Monday)', () => {
    expect(bangkokWeekday(bangkokUtcMs(2026, 0, 5))).toBe(1); // Monday
    expect(bangkokWeekday(bangkokUtcMs(2026, 0, 6))).toBe(2); // Tuesday
    expect(bangkokWeekday(bangkokUtcMs(2026, 0, 10))).toBe(6); // Saturday
  });

  it('reads the Bangkok weekday, not the UTC one, near a day boundary', () => {
    // 2026-01-06 02:00 Bangkok (Tuesday) = 2026-01-05 19:00 UTC (still Monday in UTC).
    expect(bangkokWeekday(bangkokUtcMs(2026, 0, 6, 2, 0))).toBe(2);
  });
});

describe('daysUntil', () => {
  afterEach(() => vi.useRealTimers());

  it('is 0 for today, regardless of time-of-day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(bangkokUtcMs(2026, 5, 15, 9, 0));
    const lateToday = bangkokUtcMs(2026, 5, 15, 23, 59);
    expect(daysUntil(lateToday)).toBe(0);
  });

  it('counts whole calendar days, not raw 24h windows', () => {
    // Regression guard for the bug this function's own comment documents: "now" pinned to
    // 23:59 today, target pinned to 00:01 tomorrow — barely under a raw 24h, but a full
    // calendar day apart, which is the actual pharmacy-relevant boundary for an expiry date.
    // Both pinned via Bangkok wall-clock time, not whatever timezone runs this test.
    vi.useFakeTimers();
    vi.setSystemTime(bangkokUtcMs(2026, 5, 15, 23, 59));
    const tomorrow = bangkokUtcMs(2026, 5, 16, 0, 1);
    expect(daysUntil(tomorrow)).toBe(1);
  });

  it('is negative for a past date', () => {
    const yesterday = Date.now() - 2 * DAY;
    expect(daysUntil(yesterday)).toBeLessThan(0);
  });
});

describe('fiscalYear / fiscalYearStartIso (Thai fiscal year, Oct-Sep, named for the ending BE year)', () => {
  it('a date in October or later belongs to the fiscal year ending the following September', () => {
    // 1 Oct 2026 CE -> BE 2569, fiscal year running to Sep 2570 -> named 2570
    expect(fiscalYear(bangkokUtcMs(2026, 9, 1))).toBe(2570);
  });

  it('a date before October belongs to the fiscal year ending this September', () => {
    // 15 Sep 2026 CE -> BE 2569, still inside the fiscal year ending this same September
    expect(fiscalYear(bangkokUtcMs(2026, 8, 15))).toBe(2569);
  });

  it('fiscalYearStartIso always lands on Oct 1 of the correct calendar year', () => {
    expect(fiscalYearStartIso(bangkokUtcMs(2026, 9, 15))).toBe('2026-10-01');
    expect(fiscalYearStartIso(bangkokUtcMs(2026, 8, 15))).toBe('2025-10-01');
  });
});

describe('digitsOnly / parseIntSafe', () => {
  it('digitsOnly strips everything but digits', () => {
    expect(digitsOnly('a1b2c3')).toBe('123');
    expect(digitsOnly('')).toBe('');
  });

  it('digitsOnly converts Thai numerals instead of silently stripping them', () => {
    expect(digitsOnly('๕๐')).toBe('50');
    expect(digitsOnly('๑๒3๔')).toBe('1234');
  });

  it('parseIntSafe falls back instead of returning NaN on unparseable input', () => {
    expect(parseIntSafe('abc')).toBe(0);
    expect(parseIntSafe('abc', 7)).toBe(7);
    expect(parseIntSafe('42')).toBe(42);
  });

  it('parseIntSafe parses Thai numerals instead of falling back to 0', () => {
    expect(parseIntSafe('๕๐')).toBe(50);
  });

  it('digitsOnly caps length so a long pasted digit string cannot lose precision downstream', () => {
    expect(digitsOnly('123456789012345678901234567890')).toBe('123456789');
    expect(parseIntSafe('999999999999999999999')).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER);
  });
});
