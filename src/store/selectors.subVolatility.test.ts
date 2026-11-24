// "ตัวเลข min max par ดูเยอะผิดปกติ": the volatility buffer (1 + usageCv) used to be applied in full to the 28-day substock par.
import { describe, it, expect } from 'vitest';
import { parBreakdown } from './selectors';
import type { Med } from '../types';

const base = { id: 'x', name: 'x', used30: 600, usedPrev30: 600, volatility: 1, had: false, floor: 0 } as unknown as Med;

describe('substock par volatility buffer', () => {
  it('a steady drug is unchanged (no volatility → plain 28-day need)', () => {
    expect(parBreakdown(base, 4, 28)!.sub).toBe(600);
  });
  it('a lumpy drug (CV 1.0) no longer gets ~2x the 28-day need, but still gets a buffer', () => {
    const b = parBreakdown({ ...base, usageCv: 1 } as Med, 4, 28)!;
    expect(b.sub).toBeGreaterThan(600);
    expect(b.sub).toBeLessThan(900); // was 1200
    expect(b.floor).toBe(250); // shelf (floor) number deliberately untouched
  });
  it('a med with no substock stage keeps its full buffer (floorDays === subDays)', () => {
    const b = parBreakdown({ ...base, usageCv: 1, noSubstock: true } as Med, 4, 28)!;
    expect(b.floor).toBe(1700); // 28d x 2.0, same as before
  });
});
