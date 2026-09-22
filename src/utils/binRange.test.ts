import { describe, it, expect } from 'vitest';
import { parseBinRange, binInRange, binSortKey } from './binRange';

describe('parseBinRange', () => {
  it('parses a full "A1-A7" range', () => {
    expect(parseBinRange('A1-A7')).toEqual({ prefix: 'A', from: 1, to: 7 });
  });

  it('parses the shorthand "A1-7" (second side reuses the first prefix)', () => {
    expect(parseBinRange('A1-7')).toEqual({ prefix: 'A', from: 1, to: 7 });
  });

  it('is case- and space-insensitive', () => {
    expect(parseBinRange('a1 - a7')).toEqual({ prefix: 'A', from: 1, to: 7 });
    expect(parseBinRange('  a1-a7  ')).toEqual({ prefix: 'A', from: 1, to: 7 });
  });

  it('supports a Thai-script prefix', () => {
    expect(parseBinRange('ตู้1-ตู้5')).toEqual({ prefix: 'ตู้', from: 1, to: 5 });
  });

  it('rejects mismatched prefixes on each side', () => {
    expect(parseBinRange('A1-B7')).toBeNull();
  });

  it('rejects a backwards range (from > to)', () => {
    expect(parseBinRange('A7-A1')).toBeNull();
  });

  it('returns null for a plain single bin code (not a range at all)', () => {
    expect(parseBinRange('J4')).toBeNull();
  });

  it('returns null for a plain drug-name search', () => {
    expect(parseBinRange('Paracetamol')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(parseBinRange('')).toBeNull();
  });
});

describe('binInRange', () => {
  const range = { prefix: 'A', from: 1, to: 7 };

  it('matches a code inside the range', () => {
    expect(binInRange('A1', range)).toBe(true);
    expect(binInRange('A4', range)).toBe(true);
    expect(binInRange('A7', range)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(binInRange('a4', range)).toBe(true);
  });

  it('rejects a code outside the numeric range', () => {
    expect(binInRange('A8', range)).toBe(false);
    expect(binInRange('A0', range)).toBe(false);
  });

  it('rejects a code with a different prefix', () => {
    expect(binInRange('B4', range)).toBe(false);
  });

  it('rejects a code that is not cleanly "prefix + number"', () => {
    expect(binInRange('A4-1', range)).toBe(false);
    expect(binInRange('ตู้ยา-1', range)).toBe(false);
  });
});

describe('binSortKey', () => {
  it('sorts by the code\'s numeric suffix', () => {
    const codes = ['A7', 'A1', 'A10', 'A2'];
    expect(codes.slice().sort((a, b) => binSortKey(a) - binSortKey(b))).toEqual(['A1', 'A2', 'A7', 'A10']);
  });

  it('pushes a code with no numeric suffix to the end', () => {
    expect(binSortKey('ABC')).toBe(Number.MAX_SAFE_INTEGER);
  });
});
