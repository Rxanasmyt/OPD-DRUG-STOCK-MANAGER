import { describe, it, expect } from 'vitest';
import { computeAppHeight } from './appHeight';

describe('computeAppHeight', () => {
  it('uses the physical screen height for an iPhone home-screen app whose viewport is a bit short', () => {
    expect(computeAppHeight(759, 852, true, true)).toBe(852);
  });
  it('is just innerHeight in a normal browser tab (address bar must not be covered)', () => {
    expect(computeAppHeight(700, 852, false, true)).toBe(700);
  });
  it('is just innerHeight on desktop / tablet widths', () => {
    expect(computeAppHeight(900, 1080, true, false)).toBe(900);
  });
  it('ignores an implausibly large gap (split view etc.)', () => {
    expect(computeAppHeight(400, 852, true, true)).toBe(400);
  });
  it('never shrinks below innerHeight', () => {
    expect(computeAppHeight(852, 800, true, true)).toBe(852);
  });
});
