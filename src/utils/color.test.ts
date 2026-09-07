import { describe, it, expect } from 'vitest';
import { medColor, medColorTint } from './color';

describe('medColor / medColorTint', () => {
  it('is deterministic — the same code always produces the same color', () => {
    expect(medColor('MED-0035')).toBe(medColor('MED-0035'));
    expect(medColorTint('MED-0035')).toBe(medColorTint('MED-0035'));
  });

  it('returns a valid hsl() string with the documented saturation/lightness', () => {
    expect(medColor('MED-0035')).toMatch(/^hsl\(\d+, 62%, 42%\)$/);
    expect(medColorTint('MED-0035')).toMatch(/^hsl\(\d+, 65%, 95%\)$/);
  });

  it('never crashes on an empty or unusual code', () => {
    expect(() => medColor('')).not.toThrow();
    expect(medColor('')).toMatch(/^hsl\(\d+, 62%, 42%\)$/);
  });

  // Regression guard for the exact real-world case this module's own doc comment calls out:
  // sequential med codes ("MED-0001", "MED-0002", ...) are the pair most likely to sit right
  // next to each other in a by-name list. A naive `h = h*31 + c` polynomial hash barely changes
  // between two strings differing only in their last character by 1 (their final hash values
  // differ by ~31^0 = 1), so every sequential code would land within a couple of hue degrees of
  // its neighbor — a visibly broken "every drug near the top of the list looks the same color"
  // result. Checking span-of-hues over a real run of sequential codes catches exactly that,
  // without the flakiness an exact-collision or single-adjacent-pair assertion would have (with
  // only 360 discrete hue buckets, a handful of exact or near collisions among many samples is
  // normal pigeonhole/birthday-paradox behavior for a well-mixed hash, not a defect).
  it('spreads a run of sequential codes across a wide range of hues, not clustered together', () => {
    const hues = Array.from({ length: 30 }, (_, i) => {
      const code = 'MED-' + String(i + 1).padStart(4, '0');
      const m = medColor(code).match(/^hsl\((\d+),/);
      return m ? parseInt(m[1], 10) : -1;
    });
    expect(Math.max(...hues) - Math.min(...hues)).toBeGreaterThan(300);
    // At least half of the 30 codes should land in distinct hue "buckets" (30° wide, 12 total)
    // — a linear-drift hash would instead pack almost all of them into just one or two.
    expect(new Set(hues.map((h) => Math.floor(h / 30))).size).toBeGreaterThanOrEqual(6);
  });

  it('hue is always in the valid 0-359 range', () => {
    for (const code of ['MED-0001', 'MED-9999', 'A', 'ยาทดสอบ']) {
      const m = medColor(code).match(/^hsl\((\d+),/);
      const hue = m ? parseInt(m[1], 10) : -1;
      expect(hue).toBeGreaterThanOrEqual(0);
      expect(hue).toBeLessThan(360);
    }
  });
});
