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

  // Added to cover real formulary gaps found by reviewing src/data/med_list.csv: therapeutic
  // groups the original 17-category/keyword set had no coverage for at all (vaccines/biologics,
  // Thai herbal medicine, oncology, hormones/contraceptives/obstetrics), plus missing keywords
  // for existing categories (opioids, antivirals, additional psych/cardio/GI/resp drugs, IV
  // fluid variants, electrolytes).
  it('matches the new vaccine/biologic category', () => {
    expect(suggestCategoryId('Corona vaccine- Sinovac 0.5 ml. Vial')).toBe('vaccine_biologic');
    expect(suggestCategoryId('HEPATITIS B VACCINE - PL 1 ml. Vial')).toBe('vaccine_biologic');
    expect(suggestCategoryId('TETANUS ANTI TOXIN (TAT) 1,500 iu./ml. Vial')).toBe('vaccine_biologic');
    expect(suggestCategoryId('Anti-D immunoglobulin 300 mcg./2ml Vial')).toBe('vaccine_biologic');
    expect(suggestCategoryId('ANTIVENUM SERA,COBRA(งูเห่า) neut 0.6 Vial (10 ml.)')).toBe('vaccine_biologic');
  });

  it('matches the new Thai herbal/traditional medicine category', () => {
    expect(suggestCategoryId('ฟ้าทะลายโจร 500 mg. แค็บซูล')).toBe('herbal');
    expect(suggestCategoryId('ขมิ้นชัน 500 mg. แค็บซูล')).toBe('herbal');
    expect(suggestCategoryId('สหัสธารา ตราธนัทเฮิร์บ 500mg. แคปซูล')).toBe('herbal');
  });

  it('matches the new oncology/immunosuppressant category', () => {
    expect(suggestCategoryId('Methotrexate 2.5 mg. เม็ด')).toBe('oncology');
    expect(suggestCategoryId('Tamoxifen 20 mg เม็ด')).toBe('oncology');
  });

  it('matches the new hormone/contraceptive/obstetric category', () => {
    expect(suggestCategoryId('DMPA-MEDROXYPROGESTERONE ACETATE 150 mg. Vial')).toBe('hormone_repro');
    expect(suggestCategoryId('OXYTOCIN-Syntocinon 10 iu. Amp. (1 ml.)')).toBe('hormone_repro');
    expect(suggestCategoryId('Exluton-Lynestrenol 0.5 mg. เม็ด')).toBe('hormone_repro');
  });

  it('fills in missing keywords for existing categories (opioids, antivirals, psych, cardio, GI, resp, IV fluid)', () => {
    expect(suggestCategoryId('MORPHINE - PL 10 mg./ml. Amphule (1 ml.)')).toBe('pain');
    expect(suggestCategoryId('Efavirenz 200 mg tablet')).toBe('antimicrobial');
    expect(suggestCategoryId('Lithium - ไม่มียานี้ใน รพ.กรงปินัง 300 mg. capsule')).toBe('neuro_psych');
    expect(suggestCategoryId('Clonazepam 0.5 mg. เม็ด')).toBe('neuro_psych');
    expect(suggestCategoryId('Ticagrelor 90 mg tablet')).toBe('cardio');
    expect(suggestCategoryId('Mosapride citrate 5 mg tablets')).toBe('gi');
    expect(suggestCategoryId('Seretide accuhaler 60 dose 50/250 mcg./dos หลอด(60 dose)')).toBe('resp');
    expect(suggestCategoryId('D-5-W 5 % ถุง (1,000 ml.)')).toBe('iv_fluid');
    expect(suggestCategoryId('KCl 500 mg. เม็ด')).toBe('vitamin');
  });

  it('still never guesses for a genuinely unmatched/discontinued catalog entry', () => {
    expect(suggestCategoryId('Nataral EZ - ไม่มียานี้ใน รพ.กรงปินัง 5 เม็ด')).toBeNull();
  });
});
