import { describe, it, expect } from 'vitest';
import { shortLabelName, titleSizeStep } from './labelName';

describe('shortLabelName', () => {
  it('trims a trailing English packaging word', () => {
    expect(shortLabelName('Adenosine 3 mg/ml Vial')).toBe('Adenosine 3 mg/ml');
    expect(shortLabelName('Furosemide 20 mg Amphule')).toBe('Furosemide 20 mg');
  });

  it('trims a trailing parenthetical packaging note', () => {
    expect(shortLabelName('Salbutamol 100 mcg (2 mL.)')).toBe('Salbutamol 100 mcg');
  });

  it('trims both a parenthetical note AND a bare packaging word, either order, in one pass', () => {
    // The exact case this function's own doc comment calls out: "... Amphule (2 mL.)"
    expect(shortLabelName('Adrenaline 1 mg/ml Amphule (1 mL.)')).toBe('Adrenaline 1 mg/ml');
  });

  it('trims a trailing Thai packaging word (and the punctuation left dangling after it)', () => {
    expect(shortLabelName('พาราเซตามอล 500 มก. ซอง')).toBe('พาราเซตามอล 500 มก');
  });

  it('trims trailing punctuation left over after stripping packaging', () => {
    expect(shortLabelName('Diazepam 5 mg. Tube.')).not.toMatch(/[.,;:\-–]\s*$/);
  });

  it('falls back to the original name rather than returning a near-empty string', () => {
    // A name that's nothly packaging words once trimmed would otherwise collapse to
    // something too short to be a useful label — original wins in that case.
    expect(shortLabelName('Vial')).toBe('Vial');
  });

  it('never touches a name that has no packaging detail to trim', () => {
    expect(shortLabelName('Amoxicillin 500 mg')).toBe('Amoxicillin 500 mg');
  });

  it('is safe on empty/whitespace-only input', () => {
    expect(shortLabelName('')).toBe('');
    expect(shortLabelName('   ')).toBe('');
  });
});

describe('titleSizeStep', () => {
  it('picks a larger step (smaller text) as the name gets longer', () => {
    const steps = [
      titleSizeStep('Short'),
      titleSizeStep('A Medium Length Name'),
      titleSizeStep('A Genuinely Very Long Drug Name Indeed'),
    ];
    expect(steps[0]).toBeLessThanOrEqual(steps[1]);
    expect(steps[1]).toBeLessThanOrEqual(steps[2]);
  });

  it('weights ALL-CAPS text as effectively wider than mixed case of the same length', () => {
    const mixed = 'Magnesium Sulfate Inj';   // same character count as the caps version below
    const caps = 'MAGNESIUM SULFATE INJ';
    // Same length in characters, but ALL-CAPS should never resolve to a SMALLER step (bigger
    // text) than the mixed-case version of an identical-length string.
    expect(titleSizeStep(caps)).toBeGreaterThanOrEqual(titleSizeStep(mixed));
  });

  it('stays within the documented 0-5 range', () => {
    expect(titleSizeStep('')).toBeGreaterThanOrEqual(0);
    expect(titleSizeStep('x'.repeat(200))).toBe(5);
  });
});
