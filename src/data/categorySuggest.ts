// Best-effort category suggestion from a drug's name, so tagging the ~500+ existing meds this
// feature launched into doesn't mean typing every single one by hand from a blank dropdown.
// Deliberately NOT auto-applied anywhere — see suggestCategoryId()'s callers in MedsScreen —
// this only ever offers a chip someone taps to accept; a wrong guess never silently lands on a
// real drug's record. Keyword list covers the generic names/classes actually common in a Thai
// hospital OPD/IPD formulary; anything unmatched just gets no suggestion (falls back to
// "ยังไม่ระบุหมวด" like today), which is always safe — never guess/force a category.
import { UNCATEGORIZED } from './categories';

// Order matters: checked top-to-bottom, first match wins. More specific keywords (e.g.
// "insulin") are listed before broad ones so a drug name can't fall into the wrong bucket just
// because it also happens to contain a generic word.
const RULES: [string, string][] = [
  // ยาแก้ปวด/ลดไข้/ต้านอักเสบ
  ['paracetamol', 'pain'], ['ibuprofen', 'pain'], ['diclofenac', 'pain'], ['naproxen', 'pain'],
  ['mefenamic', 'pain'], ['celecoxib', 'pain'], ['tramadol', 'pain'], ['aspirin', 'pain'],
  ['พาราเซตามอล', 'pain'],
  // ยาต้านจุลชีพ
  ['amoxicillin', 'antimicrobial'], ['cloxacillin', 'antimicrobial'], ['ampicillin', 'antimicrobial'],
  ['cephalexin', 'antimicrobial'], ['ceftriaxone', 'antimicrobial'], ['cefixime', 'antimicrobial'],
  ['azithromycin', 'antimicrobial'], ['clarithromycin', 'antimicrobial'], ['erythromycin', 'antimicrobial'],
  ['ciprofloxacin', 'antimicrobial'], ['levofloxacin', 'antimicrobial'], ['norfloxacin', 'antimicrobial'],
  ['doxycycline', 'antimicrobial'], ['metronidazole', 'antimicrobial'], ['clindamycin', 'antimicrobial'],
  ['co-trimoxazole', 'antimicrobial'], ['cotrimoxazole', 'antimicrobial'], ['fluconazole', 'antimicrobial'],
  ['ketoconazole', 'antimicrobial'], ['acyclovir', 'antimicrobial'], ['penicillin', 'antimicrobial'],
  // ยาโรคหัวใจ/หลอดเลือด/ความดัน
  ['enalapril', 'cardio'], ['captopril', 'cardio'], ['losartan', 'cardio'], ['valsartan', 'cardio'],
  ['amlodipine', 'cardio'], ['nifedipine', 'cardio'], ['atenolol', 'cardio'], ['propranolol', 'cardio'],
  ['bisoprolol', 'cardio'], ['carvedilol', 'cardio'], ['hydrochlorothiazide', 'cardio'],
  ['furosemide', 'cardio'], ['spironolactone', 'cardio'], ['digoxin', 'cardio'], ['isosorbide', 'cardio'],
  ['warfarin', 'cardio'], ['clopidogrel', 'cardio'],
  // ยาเบาหวาน/ต่อมไร้ท่อ/ไขมัน
  ['metformin', 'endocrine'], ['glipizide', 'endocrine'], ['gliclazide', 'endocrine'],
  ['glibenclamide', 'endocrine'], ['insulin', 'endocrine'], ['simvastatin', 'endocrine'],
  ['atorvastatin', 'endocrine'], ['gemfibrozil', 'endocrine'], ['levothyroxine', 'endocrine'],
  // ยาระบบทางเดินหายใจ/หอบหืด
  ['salbutamol', 'resp'], ['ventolin', 'resp'], ['budesonide', 'resp'], ['ipratropium', 'resp'],
  ['theophylline', 'resp'], ['dextromethorphan', 'resp'], ['bromhexine', 'resp'], ['ambroxol', 'resp'],
  ['carbocisteine', 'resp'],
  // ยาระบบทางเดินอาหาร
  ['omeprazole', 'gi'], ['esomeprazole', 'gi'], ['lansoprazole', 'gi'], ['ranitidine', 'gi'],
  ['antacid', 'gi'], ['domperidone', 'gi'], ['metoclopramide', 'gi'], ['hyoscine', 'gi'],
  ['loperamide', 'gi'], ['ors', 'gi'], ['senna', 'gi'], ['bisacodyl', 'gi'], ['lactulose', 'gi'],
  ['simeticone', 'gi'], ['simethicone', 'gi'],
  // ยาระบบประสาท/จิตเวช/นอนไม่หลับ
  ['diazepam', 'neuro_psych'], ['lorazepam', 'neuro_psych'], ['amitriptyline', 'neuro_psych'],
  ['fluoxetine', 'neuro_psych'], ['sertraline', 'neuro_psych'], ['phenytoin', 'neuro_psych'],
  ['carbamazepine', 'neuro_psych'], ['gabapentin', 'neuro_psych'], ['risperidone', 'neuro_psych'],
  ['haloperidol', 'neuro_psych'],
  // ยาแก้แพ้/ภูมิแพ้
  ['chlorpheniramine', 'allergy'], ['cetirizine', 'allergy'], ['loratadine', 'allergy'],
  ['diphenhydramine', 'allergy'], ['cpm', 'allergy'],
  // ยาผิวหนัง/ยาทาภายนอก
  ['hydrocortisone cream', 'derm'], ['betamethasone cream', 'derm'], ['clotrimazole cream', 'derm'],
  ['silver sulfadiazine', 'derm'], ['calamine', 'derm'], ['whitfield', 'derm'],
  // ยาตา/หู/คอ/จมูก
  ['eye drop', 'eye_ent'], ['ear drop', 'eye_ent'], ['tetrahydrozoline', 'eye_ent'],
  ['chloramphenicol eye', 'eye_ent'], ['normal saline nasal', 'eye_ent'],
  // วิตามิน/เกลือแร่/อาหารเสริม
  ['vitamin', 'vitamin'], ['folic acid', 'vitamin'], ['ferrous', 'vitamin'], ['calcium carbonate', 'vitamin'],
  ['multivitamin', 'vitamin'], ['tri-vi', 'vitamin'],
  // สารน้ำ/IV fluid
  ['normal saline', 'iv_fluid'], ['0.9% nacl', 'iv_fluid'], ['dextrose', 'iv_fluid'],
  ["ringer", 'iv_fluid'], ['nss', 'iv_fluid'], ['d5w', 'iv_fluid'], ['acetar', 'iv_fluid'],
  // ยาฉุกเฉิน/ช่วยชีวิต
  ['adrenaline', 'emergency'], ['epinephrine', 'emergency'], ['atropine', 'emergency'],
  ['naloxone', 'emergency'], ['sodium bicarbonate', 'emergency'], ['calcium gluconate', 'emergency'],
];

/** Returns a suggested category id from a drug's name/strength text, or null when nothing in
 * the keyword list matches — callers always treat null as "no suggestion to offer", never as
 * UNCATEGORIZED being the suggestion itself. */
export function suggestCategoryId(name: string): string | null {
  const n = name.toLowerCase();
  for (const [kw, id] of RULES) {
    if (n.indexOf(kw) >= 0) return id === UNCATEGORIZED ? null : id;
  }
  return null;
}
