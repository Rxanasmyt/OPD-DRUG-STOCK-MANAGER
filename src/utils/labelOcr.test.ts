import { describe, it, expect } from 'vitest';
import { parseLabelText, fixDigitTokens, mergeParses } from './labelOcr';

const NOW = Date.parse('2026-11-20T00:00:00Z');
const P = (t: string) => parseLabelText(t, NOW);

describe('parseLabelText — expiry', () => {
  it('reads EXP mm/yyyy as last day of month', () => {
    expect(P('Paracetamol 500 mg\nEXP 11/2027').expiries[0]).toMatchObject({ iso: '2027-11-30', anchored: true, plausible: true });
  });
  it('reads EXP with a dd/mm/yyyy date and Buddhist-era year', () => {
    expect(P('EXP: 05/03/2570').expiries[0].iso).toBe('2027-03-05');
  });
  it('reads month names, with and without day', () => {
    expect(P('Exp. Date: NOV 2027').expiries[0].iso).toBe('2027-11-30');
    expect(P('EXP 15 JAN 2028').expiries[0].iso).toBe('2028-01-15');
    expect(P('USE BEFORE 03-28').expiries[0].iso).toBe('2028-03-31');
  });
  it('ignores the manufacture date and keeps the expiry when both are on one line', () => {
    const r = P('MFG 01/2025 EXP 12/2027');
    expect(r.expiries.map((e) => e.iso)).toEqual(['2027-12-31']);
  });
  it('takes the date from the next line when the keyword stands alone', () => {
    expect(P('EXP\n09/2028').expiries[0].iso).toBe('2028-09-30');
  });
  it('repairs OCR letter/digit confusion inside a date token', () => {
    expect(fixDigitTokens('1O/2O27')).toBe('10/2027');
    expect(P('EXP 1O/2O27').expiries[0].iso).toBe('2027-10-31');
  });
  it('does not treat the word MED/ED inside text as an expiry keyword', () => {
    expect(P('MED 12/2027').expiries[0]?.anchored).toBe(false);
  });
  it('rejects impossible dates and flags implausible years', () => {
    expect(P('EXP 31/02/2027').expiries).toEqual([]);
    expect(P('EXP 11/1995').expiries).toEqual([]);
    expect(P('EXP 11/2009').expiries[0].plausible).toBe(false);
    expect(P('EXP 11/2045').expiries[0].plausible).toBe(false);
  });
  it('flags an already-expired date as not plausible', () => {
    expect(P('EXP 01/2024').expiries[0].plausible).toBe(false);
  });
});

describe('parseLabelText — lot', () => {
  it('reads LOT / Lot No. / Batch No.', () => {
    expect(P('Lot No.: A2609').lots[0].value).toBe('A2609');
    expect(P('LOT 240811B').lots[0].value).toBe('240811B');
    expect(P('Batch No: BX-1234/5').lots[0].value).toBe('BX-1234/5');
    expect(P('B.NO. C77881').lots[0].value).toBe('C77881');
  });
  it('takes the lot from the next line when the keyword stands alone', () => {
    expect(P('LOT\nZ998877').lots[0].value).toBe('Z998877');
  });
  it('does not mistake a date or plain word for a lot', () => {
    expect(P('LOT NO. 11/2027').lots).toEqual([]);
    expect(P('SLOT 12345').lots).toEqual([]);
  });
  it('offers tappable alphanumeric words as a manual fallback', () => {
    expect(P('Amlodipine\nA2609X something').words).toContain('A2609X');
  });
  it('parses a whole realistic label', () => {
    const r = P('AMLODIPINE 10 mg\nMFG. 02/2025\nEXP. 01/2028\nLOT. AM250201\nMade in Thailand');
    expect(r.expiries[0].iso).toBe('2028-01-31');
    expect(r.lots[0].value).toBe('AM250201');
  });
  it('parses real Tesseract output from a photographed label (dark background, Batch No, Exp.Date + Mfg.Date)', () => {
    const r = P('Paracetamol 500mg\nBatch No: B7731X\nExp.Date: 15 NOV 2027\nMfg.Date: 15 NOV 2024');
    expect(r.expiries[0].iso).toBe('2027-11-15');
    expect(r.lots[0].value).toBe('B7731X');
  });
  it('parses real Tesseract output from a printed label', () => {
    const r = P('AMLODIPINE 10 mg Tablets\n\nMFG. 02/2025\n\nEXP. 01/2028\n\nLOT. AM250201\n\nMade in Thailand');
    expect(r.expiries[0].iso).toBe('2028-01-31');
    expect(r.lots[0].value).toBe('AM250201');
  });
});

// Verbatim Tesseract output (adaptive-threshold pass) from 7 real photographed Thai drug boxes.
describe('parseLabelText — real box photos', () => {
  const cases: Array<[string, string, string, string]> = [
    ['Chumchon', 'Store at a temperature below 30 C | Lot No | 260171 | Mfg. Date | 24/4/26 | Exp. Date | 23/4/29 | (B18ue78)', '2029-04-23', '260171'],
    ['dot dates + space lot', 'Lot No. | VS 649 | Mfg. Date | 21.8.26 | Exp. Date | 21.8.29 | (Rua)', '2029-08-21', 'VS 649'],
    ['compact ddmmyy', 'FRY | Lot No. | A 690092 | 301025 | Mfd. | 301028 | 4 | enaueng /EXp. | Ratcathewt Bangkok.', '2028-10-30', 'A 690092'],
    ['spaced dates', 'IPTYLI NE | Reg. No. 1A 119/45 | Lot No. | L 690301 | Mfd. | 26 02 26 | EAUDI/Exp | 26 02 30 | FEL', '2030-02-26', 'L 690301'],
    ['L/C label, lot above', 'Reg.No. 1A 270/48 | 26111189 | L/C | Mfg. Date | 05 08 26 | il | 8"852: | Exp. Date | 05 08 29 | (81duane)', '2029-08-05', '26111189'],
    ['thai warning box', 'Tingalden uasunuunnd | Lot No. | N 690088 | Mfd. | 06 03 26 | 06 03 28 | ] Ud1Y/Exp. | i LE', '2028-03-06', 'N 690088'],
    ['slash read as 7', 'Lot No. | < | 9715021 | Tsunwdosowlasd G6PD | Mfd. | 27702726 | me methemoglobinemia | gue | 277027289 | (Exp. Date)', '', '9715021'],
  ];
  for (const [name, text, iso, lot] of cases) {
    it(name, () => {
      const r = parseLabelText(text.split(' | ').join('\n'), Date.parse('2026-11-20T00:00:00Z'));
      if (iso) { expect(r.expiries[0].iso).toBe(iso); expect(r.expiryConfident).toBe(true); }
      expect(r.lots[0]?.value).toBe(lot);
    });
  }
  it('ignores phone numbers and registration numbers as dates', () => {
    const r = P('Tel. 0-2943-0935-7 Fax. 0-2510-7874\nReg. No. 1A 119/45\n038-480766-7');
    expect(r.expiries).toEqual([]);
  });
});

describe('mergeParses — agreement between OCR passes', () => {
  const T = Date.parse('2026-11-20T00:00:00Z');
  it('ranks a value two passes agree on above one seen once', () => {
    const m = mergeParses([parseLabelText('EXP 11/2028\nLOT AB1234', T), parseLabelText('EXP 11/2028\nLOT AB1234\nEXP 12/2028', T)], T);
    expect(m.expiries.find((e) => e.iso === '2028-11-30')?.votes).toBe(2);
    expect(m.lots[0]).toMatchObject({ value: 'AB1234', votes: 2 });
  });
  it('prefers the letter reading when two passes differ only by D/0 confusion', () => {
    const m = mergeParses([parseLabelText('Lot No.\n260171', T), parseLabelText('Lot No.\n26D171', T)], T);
    expect(m.lots[0].value).toBe('26D171');
  });
  it('refuses to pre-fill when two same-month readings tie (27 vs 28 Feb)', () => {
    const m = mergeParses([parseLabelText('Mfd. 27/02/26\nExp. 28/02/29', T), parseLabelText('Mfd. 27/02/26\nExp. 27/02/29', T)], T);
    expect(m.expiryConfident).toBe(false);
    expect(m.expiries.slice(0, 2).map((e) => e.iso).sort()).toEqual(['2029-02-27', '2029-02-28']);
  });
});
