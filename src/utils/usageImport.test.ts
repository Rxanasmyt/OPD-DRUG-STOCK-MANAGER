import { describe, it, expect } from 'vitest';
import { parseUsageCsvText } from './usageImport';

describe('parseUsageCsvText', () => {
  it('parses plain "name,qty" lines', () => {
    expect(parseUsageCsvText('PARACETAMOL 500 mg,340\namlodipine 5 mg,120')).toEqual([
      { name: 'PARACETAMOL 500 mg', qty: 340 },
      { name: 'amlodipine 5 mg', qty: 120 },
    ]);
  });

  it('drops a leading header row whose second field is not numeric', () => {
    const rows = parseUsageCsvText('ชื่อยา,จำนวน\nParacetamol,10');
    expect(rows).toEqual([{ name: 'Paracetamol', qty: 10 }]);
  });

  it('keeps the first row when it is real data, not a header', () => {
    const rows = parseUsageCsvText('Paracetamol,10\nAmoxicillin,20');
    expect(rows).toHaveLength(2);
  });

  it('splits on the LAST comma so a name containing a comma still parses', () => {
    expect(parseUsageCsvText('Drug, Extra Strength,15')).toEqual([{ name: 'Drug, Extra Strength', qty: 15 }]);
  });

  it('drops rows with a zero, negative, or unparseable quantity rather than a bogus 0', () => {
    const rows = parseUsageCsvText('Real Drug,10\nZeroQty,0\nBadQty,abc\nNegative,-5');
    expect(rows).toEqual([{ name: 'Real Drug', qty: 10 }]);
  });

  it('ignores blank lines', () => {
    expect(parseUsageCsvText('\nDrug A,5\n\n')).toEqual([{ name: 'Drug A', qty: 5 }]);
  });

  it('returns an empty array for input with no valid rows at all', () => {
    expect(parseUsageCsvText('')).toEqual([]);
  });
});
