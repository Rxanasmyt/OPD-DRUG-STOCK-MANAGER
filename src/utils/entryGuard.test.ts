import { describe, it, expect } from 'vitest';
import { assessCount, assessTransfer, assessReceive, describeFindings } from './entryGuard';

const base = { name: 'AMLODIPINE', unit: 'เม็ด' };
describe('assessCount', () => {
  it('flags a floor count that is really the substock number (the "counted the wrong place" mistake)', () => {
    const f = assessCount({ ...base, scope: 'floor', counted: 1300, system: 90, other: 1300, par: 400 });
    expect(f[0]?.code).toBe('scope_mixup');
    expect(f[0]?.severity).toBe('stop');
    expect(f[0]?.message).toContain('substock');
  });
  it('flags the opposite mix-up for a substock count', () => {
    const f = assessCount({ ...base, scope: 'sub', counted: 92, system: 1300, other: 90, par: 1500 });
    expect(f[0]?.code).toBe('scope_mixup');
  });
  it('does not call a normal count a mix-up (close to its own system value)', () => {
    expect(assessCount({ ...base, scope: 'floor', counted: 88, system: 90, other: 1300, par: 400 })).toEqual([]);
  });
  it('does not call it a mix-up when both stores hold similar quantities', () => {
    expect(assessCount({ ...base, scope: 'floor', counted: 500, system: 450, other: 480, par: 400 }).map((f) => f.code)).not.toContain('scope_mixup');
  });
  it('flags a 10× / 1/10 typo', () => {
    expect(assessCount({ ...base, scope: 'floor', counted: 900, system: 90, other: 0, par: 400 })[0]?.code).toBe('extra_digit');
    expect(assessCount({ ...base, scope: 'floor', counted: 9, system: 90, other: 0, par: 400 })[0]?.code).toBe('extra_digit');
  });
  it('flags 0 when stock exists, but not 0 vs 0', () => {
    expect(assessCount({ ...base, scope: 'floor', counted: 0, system: 40, other: 0, par: 400 })[0]?.code).toBe('zero_count');
    expect(assessCount({ ...base, scope: 'floor', counted: 0, system: 0, other: 0, par: 400 })).toEqual([]);
  });
  it('keeps the original far-from-par backstop', () => {
    expect(assessCount({ ...base, scope: 'floor', counted: 5000, system: 100, other: 0, par: 100 })[0]?.code).toBe('big_delta');
  });
  it('ignores invalid numbers', () => {
    expect(assessCount({ ...base, scope: 'floor', counted: NaN, system: 1, other: 1, par: 1 })).toEqual([]);
  });
});

describe('assessTransfer / assessReceive', () => {
  it('flags a refill that overfills the shelf past Max', () => {
    expect(assessTransfer({ ...base, qty: 500, floor: 200, parFloor: 400 })[0]?.code).toBe('over_max');
    expect(assessTransfer({ ...base, qty: 200, floor: 100, parFloor: 400 })).toEqual([]);
  });
  it('flags a receive that doubles par, and a non-whole-box receive', () => {
    expect(assessReceive({ ...base, qty: 3000, sub: 500, parSub: 1500 })[0]?.code).toBe('over_par');
    expect(assessReceive({ ...base, qty: 130, sub: 0, parSub: 1500, packSize: 100 })[0]?.code).toBe('pack_multiple');
    expect(assessReceive({ ...base, qty: 200, sub: 0, parSub: 1500, packSize: 100 })).toEqual([]);
  });
  it('describeFindings reads the numbers back and is firmer for "stop"', () => {
    const f = assessCount({ ...base, scope: 'floor', counted: 1300, system: 90, other: 1300, par: 400 });
    const txt = describeFindings('AMLODIPINE', f);
    expect(txt).toContain('⛔');
    expect(txt).toContain('1,300');
  });
});
