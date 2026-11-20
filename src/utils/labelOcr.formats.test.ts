import { describe, it, expect } from 'vitest';
import { parseLabelText } from './labelOcr';

const NOW = Date.parse('2026-11-20T00:00:00Z');
const exp = (t: string) => parseLabelText(t, NOW).expiries[0]?.iso;

// Every way a 31 Dec 2027 expiry can plausibly be printed — all must resolve to exactly 2027-12-31.
const FULL_DAY = [
  '31/12/2027', '31/12/27', '31-12-2027', '31-12-27', '31.12.2027', '31.12.27', '31 12 2027', '31 12 27',
  '2027-12-31', '2027/12/31', '2027.12.31', '2027 12 31',
  '31/12/2570', '31-12-2570', '31.12.70', '31 12 2570',
  '31 DEC 2027', '31 Dec 2027', '31-DEC-2027', '31-Dec-27', '31DEC2027', '31.DEC.27', '31 DEC 27', '31 DECEMBER 2027',
  'DEC 31 2027', 'DEC 31, 2027', 'Dec-31-2027',
  '31 ธ.ค. 2570', '31 ธ.ค. 70', '31 ธันวาคม 2570', '31 ธันวาคม 2027',
  '๓๑/๑๒/๒๕๗๐', '๓๑/๑๒/๒๐๒๗',
  '12/31/2027', '12-31-2027', '12/31/27',
  '31122027', '311227', '20271231', '31/12/2027.', '31 / 12 / 2027', '31/ 12 /2027',
  '3112 2027', '31-12/2027',
  '2027.12.31',
];
// month-only forms: expiry = last day of the month
const MONTH_ONLY = [
  '12/2027', '12-2027', '12.2027', '12 2027', '12/27', '12-27', '12.27', '2027/12', '2027-12', '2027.12',
  'DEC 2027', 'DEC-2027', 'DEC.2027', 'DEC 27', 'DEC-27', 'DECEMBER 2027', 'Dec2027', '12/2570', 'ธ.ค. 2570', 'ธันวาคม 2570', '122027',
];

describe('expiry — every plausible date format (31 Dec 2027)', () => {
  for (const f of FULL_DAY) {
    for (const prefix of ['EXP ', 'EXP. ', 'Exp.Date: ', 'EXPIRY DATE ', 'Use before ', 'หมดอายุ ', '']) {
      it(`"${prefix}${f}"`, () => {
        // unprefixed single date is not anchored but must still be PARSED (offered as a candidate)
        expect(exp(prefix + f)).toBe('2027-12-31');
      });
    }
  }
  for (const f of MONTH_ONLY) {
    it(`month-only "EXP ${f}"`, () => { expect(exp('EXP ' + f)).toBe('2027-12-31'); });
  }
});

describe('date formats — edge cases', () => {
  it('keyword and date on separate lines', () => {
    expect(exp('Exp. Date\n31/12/2570')).toBe('2027-12-31');
    expect(exp('EXP\n2027-12-31')).toBe('2027-12-31');
  });
  it('picks the expiry (latest) over the manufacture date, in any format mix', () => {
    expect(exp('MFG 31/12/2024\nEXP 31/12/2027')).toBe('2027-12-31');
    expect(exp('Mfd. 31 12 24\nExp. 31 12 27')).toBe('2027-12-31');
    expect(exp('ผลิต 31/12/2567\nหมดอายุ 31/12/2570')).toBe('2027-12-31');
    expect(exp('MFD DEC 2024 EXP DEC 2027')).toBe('2027-12-31');
  });
  it('month-first only when the day is unambiguous (>12)', () => {
    expect(exp('EXP 12/31/2027')).toBe('2027-12-31');
    expect(exp('EXP 05/06/2027')).toBe('2027-06-05'); // day-first (Thai/EU)
  });
  it('leap day and month ends', () => {
    expect(parseLabelText('EXP 29/02/2028', NOW).expiries[0].iso).toBe('2028-02-29');
    expect(parseLabelText('EXP 29/02/2027', NOW).expiries).toEqual([]);
    expect(exp('EXP FEB 2028')).toBe('2028-02-29');
    expect(exp('EXP 04/2028')).toBe('2028-04-30');
  });
  it('does not read lot numbers or barcodes as dates', () => {
    for (const t of ['Lot No. 260171', 'LOT 690092', 'Lot 9715021', 'L/C 26111189', 'Batch AB123456', '8852512345678']) {
      expect(parseLabelText(t, NOW).expiries).toEqual([]);
    }
  });
});
