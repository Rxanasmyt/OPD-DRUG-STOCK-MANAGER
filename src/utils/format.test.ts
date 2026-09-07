import { describe, it, expect, vi, afterEach } from 'vitest';
import { nf, isoDate, daysUntil, fiscalYear, fiscalYearStartIso, digitsOnly, parseIntSafe, DAY } from './format';

describe('nf', () => {
  it('rounds and thousands-separates', () => {
    expect(nf(1234.6)).toBe('1,235');
    expect(nf(0)).toBe('0');
    expect(nf(-42)).toBe('-42');
  });
});

describe('isoDate', () => {
  it('formats as YYYY-MM-DD with zero-padded month/day', () => {
    expect(isoDate(new Date(2026, 0, 5).getTime())).toBe('2026-01-05');
    expect(isoDate(new Date(2026, 11, 31).getTime())).toBe('2026-12-31');
  });
});

describe('daysUntil', () => {
  afterEach(() => vi.useRealTimers());

  it('is 0 for today, regardless of time-of-day', () => {
    const now = new Date();
    const lateToday = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59);
    expect(daysUntil(lateToday.getTime())).toBe(0);
  });

  it('counts whole calendar days, not raw 24h windows', () => {
    // Regression guard for the bug this function's own comment documents: "now" pinned to
    // 23:59 today, target pinned to 00:01 tomorrow — barely under a raw 24h, but a full
    // calendar day apart, which is the actual pharmacy-relevant boundary for an expiry date.
    vi.useFakeTimers();
    const today = new Date(2026, 5, 15, 23, 59);
    vi.setSystemTime(today);
    const tomorrow = new Date(2026, 5, 16, 0, 1).getTime();
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
    expect(fiscalYear(new Date(2026, 9, 1).getTime())).toBe(2570);
  });

  it('a date before October belongs to the fiscal year ending this September', () => {
    // 15 Sep 2026 CE -> BE 2569, still inside the fiscal year ending this same September
    expect(fiscalYear(new Date(2026, 8, 15).getTime())).toBe(2569);
  });

  it('fiscalYearStartIso always lands on Oct 1 of the correct calendar year', () => {
    expect(fiscalYearStartIso(new Date(2026, 9, 15).getTime())).toBe('2026-10-01');
    expect(fiscalYearStartIso(new Date(2026, 8, 15).getTime())).toBe('2025-10-01');
  });
});

describe('digitsOnly / parseIntSafe', () => {
  it('digitsOnly strips everything but digits', () => {
    expect(digitsOnly('a1b2c3')).toBe('123');
    expect(digitsOnly('')).toBe('');
  });

  it('parseIntSafe falls back instead of returning NaN on unparseable input', () => {
    expect(parseIntSafe('abc')).toBe(0);
    expect(parseIntSafe('abc', 7)).toBe(7);
    expect(parseIntSafe('42')).toBe(42);
  });
});
