// Best-effort route suggestion from a drug's unit + dosage form + name — the engine behind the
// one-tap "แนะนำประเภทการให้ยา" chip in MedsScreen's add/edit form AND autoRouteAll() in
// AppContext.tsx (the bulk action, mirroring autoCategorizeAll()'s own "never overwrite a
// human's existing choice, never force a guess" rule).
//
// Why this can't just read `dosageForm`/`unit` directly at display time (routeOf() in
// selectors.ts always falls back to 'other', never infers): this hospital's real formulary CSV
// (src/data/med_list.csv) has "INJECTIONS", "Injection", "INJ", and "Solution" all meaning the
// same real-world thing, spelled four different ways by whoever typed each row over the years —
// and "SOLUTIONS" alone is genuinely ambiguous (an oral solution and an IV solution are both
// "SOLUTIONS" in that same column). Guessing live from that text on every render would make the
// same drug's bucket potentially flicker between runs if the matching rules ever changed, and
// would have no way to let a pharmacist correct a wrong guess for one specific drug without it
// snapping back next time. An explicit, stored, human-correctable field (Med.route) is the only
// reliable way — this file only ever SUGGESTS a value for it, never substitutes for it.
import type { RouteType } from './routes';

const INJECTION_UNIT_KEYWORDS = [
  'vial', 'amp', 'amphule', 'ampoule', 'syringe', 'prefill', 'หลอดฉีด',
];
const INJECTION_FORM_KEYWORDS = [
  'injection', 'inj', 'intravenous', 'iv solution', 'iv fluid', 'parenteral',
];
const INJECTION_NAME_KEYWORDS = [
  'injection', ' inj', 'ฉีด', 'intravenous', 'intramuscular', ' im ', ' iv ',
];

// Real-world request: "ยังไม่มียาพ่น ยาทาภายนอก ยาหยอดตา ยาป้าย ยาหยอดหู" — eye/ear checked
// BEFORE the broad topical keywords below specifically because "ophthalmic ointment"/"ear drop
// ointment" both legitimately contain "ointment" (a topical keyword) — the more specific
// eye/ear signal has to win, or every eye/ear ointment would silently misfile as plain topical.
const EYE_KEYWORDS = ['หยอดตา', 'eye drop', 'eye oint', 'ophthalmic', 'ophth', 'ocular'];
const EAR_KEYWORDS = ['หยอดหู', 'ear drop', 'otic', 'aural'];
const INHALED_UNIT_KEYWORDS = [
  'mdi', 'inhaler', 'turbuhaler', 'accuhaler', 'diskus', 'nebule', 'ขวด mdi',
];
const INHALED_FORM_KEYWORDS = [
  'inhaler', 'inhalation', 'nebule', 'nebuliser', 'nebulizer', 'aerosol', 'mdi', 'metered dose',
];
const INHALED_NAME_KEYWORDS = [' inhaler', ' mdi', 'พ่น', 'nebule', ' neb '];
// "ยาป้าย" — a Thai hospital's own term for an antiseptic/topical solution applied by swabbing
// directly onto a lesion (classic example: เจนเชี่ยนไวโอเลต/gentian violet for oral thrush), a
// distinct real-world category from a plain cream/ointment rubbed over a wider area.
const PAINT_KEYWORDS = ['ป้าย', 'paint'];
const TOPICAL_UNIT_KEYWORDS = ['cream', 'ointment', 'lotion', 'gel', 'ครีม', 'ขี้ผึ้ง', 'โลชั่น', 'เจล'];
const TOPICAL_FORM_KEYWORDS = ['cream', 'ointment', 'lotion', 'topical', 'gel'];
const TOPICAL_NAME_KEYWORDS = ['cream', 'ointment', 'lotion', 'ทาผิว', 'ทาภายนอก'];

const ORAL_UNIT_KEYWORDS = [
  'เม็ด', 'แคปซูล', 'แค็บซูล', 'ซอง', 'tablet', 'tab', 'capsule', 'cap', 'ยาผง',
];
const ORAL_FORM_KEYWORDS = [
  'tablet', 'capsule', 'syrup', 'suspension', 'powder', 'oral',
];

function containsAny(haystack: string, needles: string[]): boolean {
  return needles.some((n) => haystack.indexOf(n) >= 0);
}

/** Returns a suggested route for `m`, or null when nothing here is confident enough to guess —
 * callers always treat null as "no suggestion to offer" (falls back to 'other' via routeOf()),
 * exactly like suggestCategoryId()'s own contract. Checked most-specific-first: injection (an
 * unambiguous Vial/Amp unit overrides anything else the name/form text also happens to contain),
 * then eye/ear (so an ophthalmic/otic OINTMENT is never caught by the broader topical check
 * below), then inhaled/paint, then topical last among the dosage-form guesses (its "cream/
 * ointment/lotion/gel" keywords are the widest net here), then oral. */
export function suggestRoute(m: { name: string; unit: string; dosageForm: string }): RouteType | null {
  const unit = (m.unit || '').toLowerCase();
  const form = (m.dosageForm || '').toLowerCase();
  const name = (' ' + (m.name || '').toLowerCase() + ' ');

  if (containsAny(unit, INJECTION_UNIT_KEYWORDS) || containsAny(form, INJECTION_FORM_KEYWORDS) || containsAny(name, INJECTION_NAME_KEYWORDS)) {
    return 'injection';
  }
  if (containsAny(unit, EYE_KEYWORDS) || containsAny(form, EYE_KEYWORDS) || containsAny(name, EYE_KEYWORDS)) {
    return 'eye';
  }
  if (containsAny(unit, EAR_KEYWORDS) || containsAny(form, EAR_KEYWORDS) || containsAny(name, EAR_KEYWORDS)) {
    return 'ear';
  }
  if (containsAny(unit, INHALED_UNIT_KEYWORDS) || containsAny(form, INHALED_FORM_KEYWORDS) || containsAny(name, INHALED_NAME_KEYWORDS)) {
    return 'inhaled';
  }
  if (containsAny(name, PAINT_KEYWORDS) || containsAny(form, PAINT_KEYWORDS)) {
    return 'paint';
  }
  if (containsAny(unit, TOPICAL_UNIT_KEYWORDS) || containsAny(form, TOPICAL_FORM_KEYWORDS) || containsAny(name, TOPICAL_NAME_KEYWORDS)) {
    return 'topical';
  }
  if (containsAny(unit, ORAL_UNIT_KEYWORDS) || containsAny(form, ORAL_FORM_KEYWORDS)) {
    return 'oral';
  }
  return null;
}
