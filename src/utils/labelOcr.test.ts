import { describe, it, expect } from 'vitest';
import { parseLabelText, fixDigitTokens } from './labelOcr';

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
    expect(r.expiries.map((e) => e.iso)).toEqual(['2027-11-15']);
    expect(r.lots[0].value).toBe('B7731X');
  });
  it('parses real Tesseract output from a printed label', () => {
    const r = P('AMLODIPINE 10 mg Tablets\n\nMFG. 02/2025\n\nEXP. 01/2028\n\nLOT. AM250201\n\nMade in Thailand');
    expect(r.expiries[0].iso).toBe('2028-01-31');
    expect(r.lots[0].value).toBe('AM250201');
  });
});
