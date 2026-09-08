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

describe('shortLabelName — noise-word/paren stripping (name+strength only)', () => {
  it('strips a dosage-form word from the MIDDLE of the name, not just the end', () => {
    // "Amiodarone injection 150 mg/3ml" — the old trailing-only stripping never touched this.
    expect(shortLabelName('Amiodarone injection 150 mg/3ml')).toBe('Amiodarone 150 mg/3ml');
    expect(shortLabelName('KCl injection 20 mEq')).toBe('KCl 20 mEq');
  });

  it('strips this hospital\'s own "PL" formulary-list marker and the dangling dash it leaves', () => {
    // Real formulary pattern: "<name> - PL <strength>" — a HIGH ALERT drug in this exact shape
    // prompted the request ("MORPHINE - PL 10 mg./ml" reads far worse than "MORPHINE 10 mg./ml").
    expect(shortLabelName('MORPHINE - PL 10 mg./ml')).toBe('MORPHINE 10 mg./ml');
    expect(shortLabelName('25 mg CARVEDILOL - PL 25 mg. เม็ด')).toBe('25 mg CARVEDILOL 25 mg');
  });

  it('strips a non-trailing parenthetical (brand name), not just a trailing one', () => {
    // "(Levophed)" sits in the middle, followed by the strength — the trailing-only regex
    // this used to have never reached it.
    expect(shortLabelName('Norepinephrine (Levophed) 1 mg./ml')).toBe('Norepinephrine 1 mg./ml');
  });

  it('strips a Thai dosage-form/unit word from the middle', () => {
    expect(shortLabelName('WARFARIN (สีชมพู) 5 mg. เม็ด')).toBe('WARFARIN 5 mg');
  });

  it('never mangles a word that only superficially contains a noise word', () => {
    // \b-anchored — "cap" must never match inside "Captopril", "sol" never inside a name
    // that merely contains those letters in sequence without being its own word.
    expect(shortLabelName('Captopril 25 mg')).toBe('Captopril 25 mg');
    expect(shortLabelName('Co-trimoxazole 480 mg')).toBe('Co-trimoxazole 480 mg');
  });

  it('leaves a name with nothing to strip untouched', () => {
    expect(shortLabelName('Amoxicillin 500 mg')).toBe('Amoxicillin 500 mg');
  });

  it('never drops a strength that is written only inside parentheses', () => {
    // Bug fix: the normal pass deletes parentheses wholesale, so a name whose strength is
    // written ONLY inside them ("Aspirin (81 mg)") used to come out as bare "Aspirin" — the
    // dose silently missing from the printed shelf label. The fallback unwraps parens (keeps
    // the text, drops just the brackets) instead of deleting them whenever that would happen.
    expect(shortLabelName('Aspirin (81 mg)')).toBe('Aspirin 81 mg');
    expect(shortLabelName('Some Drug (250 mcg) Vial')).toBe('Some Drug 250 mcg');
  });

  it('still deletes a purely-noise parenthetical (brand name/packaging note) outright', () => {
    // Confirms the fallback path above is NOT taken when the strength already survives outside
    // the parens — these must keep behaving exactly as before.
    expect(shortLabelName('Norepinephrine (Levophed) 1 mg./ml')).toBe('Norepinephrine 1 mg./ml');
    expect(shortLabelName('FUROSEMIDE (Lasix) 20 mg')).toBe('FUROSEMIDE 20 mg');
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

  it('stays within the documented 0-7 range', () => {
    expect(titleSizeStep('')).toBeGreaterThanOrEqual(0);
    expect(titleSizeStep('x'.repeat(200))).toBe(7);
  });

  it('steps down further (not stuck at a 9pt floor) for a genuinely long HIGH ALERT-style name', () => {
    // Regression guard: a name this long used to hit the old step-5 ceiling (the smallest size
    // the old 6-step scale had) and still overflow the print label's single forced line — now
    // it should land on one of the two newer, smaller steps instead of maxing out there.
    const longHighAlertName = 'Norepinephrine (Levophed) 1 mg./ml Amphule 4 mL injection';
    expect(titleSizeStep(longHighAlertName)).toBeGreaterThan(5);
  });
});
