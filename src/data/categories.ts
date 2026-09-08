/** Fixed list of drug-therapeutic-group categories, chosen to match how a Thai hospital
 * pharmacy actually talks about its formulary (กลุ่มยาต้านจุลชีพ, กลุ่มยาโรคเรื้อรัง, ...) rather
 * than a generic/administrative grouping — this is what makes "แยกตามหมวดกลุ่มยา" actually useful
 * day to day: a high-volume group (ยาแก้ปวด/ลดไข้, ยาปฏิชีวนะ) can be scanned/restocked quickly
 * as its own bucket, while a low-volume group (ยาฉุกเฉิน/ช่วยชีวิต) that's dispensed rarely
 * doesn't clutter the list the rest of the time.
 *
 * A fixed id list (not free-text) so filtering/grouping stays exact — two people typing
 * "ยาแก้ปวด" vs "แก้ปวด" for the same drug would silently split into two groups. `id` is what's
 * stored on Med.category; `label` is what's shown. Order here is also the display order
 * everywhere this list is rendered (add/edit form, filter chips, grouped list headers).
 */
export interface DrugCategory {
  id: string;
  label: string;
}

export const DRUG_CATEGORIES: DrugCategory[] = [
  { id: 'pain', label: 'ยาแก้ปวด/ลดไข้/ต้านอักเสบ' },
  { id: 'antimicrobial', label: 'ยาต้านจุลชีพ (ปฏิชีวนะ/เชื้อรา/ไวรัส)' },
  { id: 'cardio', label: 'ยาโรคหัวใจ/หลอดเลือด/ความดัน' },
  { id: 'endocrine', label: 'ยาเบาหวาน/ต่อมไร้ท่อ/ไขมันในเลือด' },
  { id: 'resp', label: 'ยาระบบทางเดินหายใจ/หอบหืด' },
  { id: 'gi', label: 'ยาระบบทางเดินอาหาร' },
  { id: 'neuro_psych', label: 'ยาระบบประสาท/จิตเวช/นอนไม่หลับ' },
  { id: 'allergy', label: 'ยาแก้แพ้/ภูมิแพ้' },
  { id: 'derm', label: 'ยาผิวหนัง/ยาทาภายนอก' },
  { id: 'eye_ent', label: 'ยาตา/หู/คอ/จมูก' },
  { id: 'vitamin', label: 'วิตามิน/เกลือแร่/อาหารเสริม' },
  { id: 'iv_fluid', label: 'สารน้ำ/IV fluid' },
  { id: 'emergency', label: 'ยาฉุกเฉิน/ช่วยชีวิต' },
  { id: 'supply', label: 'เวชภัณฑ์ที่ไม่ใช่ยา' },
  { id: 'other', label: 'อื่นๆ / ยังไม่ระบุหมวด' },
];

/** Fallback id for a med with no category set yet (every drug added before this feature
 * existed) — never leaves a med invisible under a "ยังไม่ระบุหมวด" group instead of silently
 * vanishing from a category-filtered view. */
export const UNCATEGORIZED = 'other';

const LABEL_BY_ID: Record<string, string> = Object.fromEntries(DRUG_CATEGORIES.map((c) => [c.id, c.label]));

/** `m.category` is optional/free — old docs have none, and even a stored value could in
 * theory not match this fixed list any more (a category renamed/removed later). Both fall
 * back to the same "ยังไม่ระบุหมวด" bucket rather than a blank/undefined label. */
export function categoryLabel(id: string | undefined): string {
  return (id && LABEL_BY_ID[id]) || LABEL_BY_ID[UNCATEGORIZED];
}
