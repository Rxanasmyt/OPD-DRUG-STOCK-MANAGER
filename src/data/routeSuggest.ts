// Best-effort oral/injection route suggestion from a drug's unit + dosage form + name — the
// engine behind the one-tap "แนะนำประเภทการให้ยา" chip in MedsScreen's add/edit form AND
// autoRouteAll() in AppContext.tsx (the bulk action, mirroring autoCategorizeAll()'s own
// "never overwrite a human's existing choice, never force a guess" rule).
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
import type { Med } from '../types';

const INJECTION_UNIT_KEYWORDS = [
  'vial', 'amp', 'amphule', 'ampoule', 'syringe', 'prefill', 'หลอดฉีด',
];
const INJECTION_FORM_KEYWORDS = [
  'injection', 'inj', 'intravenous', 'iv solution', 'iv fluid', 'parenteral',
];
const INJECTION_NAME_KEYWORDS = [
  'injection', ' inj', 'ฉีด', 'intravenous', 'intramuscular', ' im ', ' iv ',
];

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
 * exactly like suggestCategoryId()'s own contract. Injection signals are checked first: a med
 * whose unit says "Vial" is an injectable regardless of what its dosageForm/name text happens to
 * also contain, so a false oral match can never override a confident injectable one. */
export function suggestRoute(m: Pick<Med, 'name' | 'unit' | 'dosageForm'>): 'oral' | 'injection' | null {
  const unit = (m.unit || '').toLowerCase();
  const form = (m.dosageForm || '').toLowerCase();
  const name = (' ' + (m.name || '').toLowerCase() + ' ');

  if (containsAny(unit, INJECTION_UNIT_KEYWORDS) || containsAny(form, INJECTION_FORM_KEYWORDS) || containsAny(name, INJECTION_NAME_KEYWORDS)) {
    return 'injection';
  }
  if (containsAny(unit, ORAL_UNIT_KEYWORDS) || containsAny(form, ORAL_FORM_KEYWORDS)) {
    return 'oral';
  }
  return null;
}
