// Regression test for a real OCR-scanning bug: extractExpiry()'s date-shape regexes used to
// scan the ENTIRE raw OCR text with no keyword anchoring, so a manufacture (MFG) date printed
// ahead of the real EXP date on the same label — or a hyphenated LOT/batch code that happens to
// look date-shaped — could win the match instead of the real expiry. See extractExpiry's own
// "Bug fix (data integrity)" comment.
import { describe, it, expect } from 'vitest';
import { extractExpiry } from './ocr';

describe('extractExpiry — EXP keyword anchoring regression', () => {
  it('picks the date after "EXP", not an earlier MFG date, when both are printed on the label', () => {
    const text = 'MFG 10/03/2023  EXP 10/03/2025';
    // Without the fix, the first DD/MM/YYYY match in the whole text (the MFG date) wins.
    expect(extractExpiry(text)).toBe('2025-03-10');
  });

  it('picks the EXP date, not a hyphenated LOT code that looks date-shaped', () => {
    const text = 'LOT 12-08-25  EXP 10/2025';
    // Without the fix, "12-08-25" (a lot/batch code, not a date) matches the DD-MM-YY shape
    // first and pre-empts the real "EXP 10/2025" month-year text elsewhere on the label.
    expect(extractExpiry(text)).toBe('2025-10-31');
  });

  it('still falls back to a whole-text scan when no EXP/EXPIRY keyword is present at all', () => {
    // A poorly-printed label with no recognizable "EXP" keyword — still worth a best-effort
    // guess rather than giving up entirely.
    expect(extractExpiry('random text 08/2026 more text')).toBe('2026-08-31');
  });
});
