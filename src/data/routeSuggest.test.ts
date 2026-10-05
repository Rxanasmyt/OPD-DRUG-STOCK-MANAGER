import { describe, it, expect } from 'vitest';
import { suggestRoute } from './routeSuggest';

describe('suggestRoute', () => {
  it('suggests injection from a Vial/Amp unit', () => {
    expect(suggestRoute({ name: 'Diclofenac', unit: 'Vial', dosageForm: '' })).toBe('injection');
    expect(suggestRoute({ name: 'Adrenaline', unit: 'Amp', dosageForm: '' })).toBe('injection');
  });

  it('suggests oral from a เม็ด/แคปซูล unit', () => {
    expect(suggestRoute({ name: 'Paracetamol', unit: 'เม็ด', dosageForm: '' })).toBe('oral');
    expect(suggestRoute({ name: 'Amoxicillin', unit: 'แคปซูล', dosageForm: '' })).toBe('oral');
  });

  it('suggests injection from dosageForm text even with a blank unit', () => {
    expect(suggestRoute({ name: 'Diazepam', unit: '', dosageForm: 'Injection' })).toBe('injection');
  });

  it('is case-insensitive', () => {
    expect(suggestRoute({ name: 'Ceftriaxone', unit: 'VIAL', dosageForm: '' })).toBe('injection');
  });

  // Regression: this is the exact real-world formulary ambiguity (med_list.csv has "INJECTIONS",
  // "Injection", "INJ", "Solution" all meaning the same thing) that justified an explicit field
  // instead of a live guess — injection signals must win even when an oral-ish word also appears.
  it('prefers a confident injection signal over a weaker oral one', () => {
    expect(suggestRoute({ name: 'Dexamethasone Injection', unit: 'Amp', dosageForm: 'Solution' })).toBe('injection');
  });

  it('returns null (no guess) when nothing matches confidently', () => {
    expect(suggestRoute({ name: 'Hydrocortisone Cream', unit: 'Tube', dosageForm: 'Cream' })).toBeNull();
    expect(suggestRoute({ name: '', unit: '', dosageForm: '' })).toBeNull();
  });
});
