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

  // Real-world request: "ตอนนี้หน้าจัดการรายการยา ประเภทยามีเพียงยากิน ยาฉีด และอื่นๆ แต่ยังไม่มี
  // ยาพ่น ยาทาภายนอก ยาหยอดตา ยาป้าย ยาหยอดหู" — each of these now gets a confident guess.
  it('suggests topical from a cream/ointment/lotion unit or dosageForm', () => {
    expect(suggestRoute({ name: 'Hydrocortisone Cream', unit: 'Tube', dosageForm: 'Cream' })).toBe('topical');
    expect(suggestRoute({ name: 'Betamethasone', unit: 'Tube', dosageForm: 'Ointment' })).toBe('topical');
  });

  it('suggests eye from a หยอดตา/ophthalmic/eye drop signal', () => {
    expect(suggestRoute({ name: 'Chloramphenicol Eye Drop', unit: 'Eye drop', dosageForm: 'Ophthalmic solution' })).toBe('eye');
    expect(suggestRoute({ name: 'ยาหยอดตา Tetrahydrozoline', unit: 'ขวด', dosageForm: '' })).toBe('eye');
  });

  it('suggests ear from a หยอดหู/otic/ear drop signal', () => {
    expect(suggestRoute({ name: 'Ofloxacin Ear Drop', unit: 'Ear drop', dosageForm: 'Otic solution' })).toBe('ear');
  });

  it('suggests inhaled from an MDI/inhaler/nebule signal', () => {
    expect(suggestRoute({ name: 'Salbutamol MDI', unit: 'MDI', dosageForm: 'Inhaler' })).toBe('inhaled');
    expect(suggestRoute({ name: 'Ipratropium Nebule', unit: 'Nebule', dosageForm: '' })).toBe('inhaled');
  });

  it('suggests paint from a ป้าย/paint signal', () => {
    expect(suggestRoute({ name: 'เจนเชี่ยนไวโอเลต ยาป้ายปาก', unit: 'ขวด', dosageForm: '' })).toBe('paint');
  });

  // Regression: an ophthalmic/otic OINTMENT still has to read as eye/ear, never fall through to
  // the broader topical "ointment" keyword — eye/ear are checked first for exactly this reason.
  it('prefers eye/ear over the broader topical signal for an ophthalmic/otic ointment', () => {
    expect(suggestRoute({ name: 'Chloramphenicol Eye Ointment', unit: 'Tube', dosageForm: 'Ophthalmic ointment' })).toBe('eye');
  });

  it('returns null (no guess) when nothing matches confidently', () => {
    // "SOLUTIONS" alone is genuinely ambiguous (an oral solution and an IV solution are both
    // "SOLUTIONS") — this is the real formulary case that justified not guessing at all here.
    expect(suggestRoute({ name: 'Normal Saline Solution', unit: 'Bag', dosageForm: 'Solution' })).toBeNull();
    expect(suggestRoute({ name: '', unit: '', dosageForm: '' })).toBeNull();
  });
});
