// Safety net on the REAL formulary (src/data/med_list.csv, 500+ drugs): reformatting a drug's name
// (periods, case, spacing, word order) must never resolve to a DIFFERENT drug, and every name must
// still resolve to itself.
import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { matchHosxpMed } from './selectors';
import type { Med } from '../types';

describe('matchHosxpMed on the real formulary', () => {
  const names = fs.readFileSync('src/data/med_list.csv', 'utf8').split(/\r?\n/).slice(1).filter(Boolean)
    .map((l) => l.match(/^(\d+),(.*?),([^,]*),([^,]*),([\d.]+)$/)?.[2]).filter((x): x is string => !!x);
  const meds = names.map((n, i) => ({ id: String(i), name: n, active: true, hosxpAliases: [] })) as unknown as Med[];

  it('loads a realistic formulary', () => { expect(meds.length).toBeGreaterThan(400); });
  it('every drug name resolves exactly to itself', () => {
    const bad = meds.filter((m) => { const r = matchHosxpMed(meds, m.name); return r.kind !== 'exact' || r.medId !== m.id; }).map((m) => m.name);
    expect(bad).toEqual([]);
  });
  it('reformatted names never resolve to a different drug', () => {
    const wrong: string[] = [];
    for (const m of meds) {
      const variants = [m.name.replace(/\./g, ''), m.name.toUpperCase(), m.name.split(/\s+/).reverse().join(' ')];
      for (const v of variants) {
        const r = matchHosxpMed(meds, v);
        if (r.kind === 'exact' && r.medId !== m.id) wrong.push(m.name + ' | ' + v);
      }
    }
    expect(wrong).toEqual([]);
  });
});
