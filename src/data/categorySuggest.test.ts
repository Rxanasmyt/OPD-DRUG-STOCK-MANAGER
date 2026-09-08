import { describe, it, expect } from 'vitest';
import { suggestCategoryId } from './categorySuggest';

describe('suggestCategoryId', () => {
  it('matches a common generic name to its therapeutic group', () => {
    expect(suggestCategoryId('Paracetamol 500 mg')).toBe('pain');
    expect(suggestCategoryId('Amoxicillin 500 mg')).toBe('antimicrobial');
    expect(suggestCategoryId('Metformin 500 mg')).toBe('endocrine');
    expect(suggestCategoryId('0.9% NaCl 1000 ml')).toBe('iv_fluid');
  });

  it('is case-insensitive', () => {
    expect(suggestCategoryId('AMOXICILLIN 500')).toBe('antimicrobial');
  });

  it('matches the newer steroid/anesthetic/supply categories', () => {
    expect(suggestCategoryId('Prednisolone 5 mg')).toBe('steroid');
    expect(suggestCategoryId('Lidocaine 2%')).toBe('anesthetic');
    expect(suggestCategoryId('Sterile Gauze 4x4')).toBe('supply');
  });

  it('returns null (never a guess) for a name matching no keyword', () => {
    expect(suggestCategoryId('Some Unlisted Drug XYZ 10 mg')).toBeNull();
  });

  // Bug fix regression: the broad 'diazepam' rule used to sit before the more specific
  // 'diazepam inj' rule, so RULES' own first-match-wins order made the emergency-specific
  // rule unreachable — every diazepam name (injectable or not) fell into neuro_psych.
  it('prefers the more specific "diazepam inj" rule over the broad "diazepam" one', () => {
    expect(suggestCategoryId('Diazepam Inj 10 mg/2 mL Amp')).toBe('emergency');
    expect(suggestCategoryId('Diazepam 5 mg Tablet')).toBe('neuro_psych');
  });
});
