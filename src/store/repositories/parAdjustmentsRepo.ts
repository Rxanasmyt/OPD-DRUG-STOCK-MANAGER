// Repository module for the `parAdjustments` Firestore collection — see auditLogRepo.ts/
// usernamesRepo.ts for the first two rounds of this same collection-at-a-time pattern.
import { addDoc, collection, doc, getDocs, query, where, type DocumentReference } from 'firebase/firestore';
import { db } from '../../firebase';
import type { ParAdjustmentRecord } from '../../types';

function parAdjustmentsCollection() {
  return collection(db, 'parAdjustments');
}

/** fetchParAdjustments()'s own query — every parAdjustments doc adjusted at or after
 * `sinceMs`. */
export async function fetchParAdjustmentsSince(sinceMs: number): Promise<ParAdjustmentRecord[]> {
  const snap = await getDocs(query(parAdjustmentsCollection(), where('adjustedAt', '>=', sinceMs)));
  return snap.docs.map((d) => d.data() as ParAdjustmentRecord);
}

/** applyOnePar()'s own best-effort write — a single new parAdjustments record. */
export function addParAdjustmentRecord(record: ParAdjustmentRecord) {
  return addDoc(parAdjustmentsCollection(), record);
}

/** A fresh auto-id ref for one new parAdjustments doc — applyAllSuggested()'s own bulk-apply
 * batch.set()s one of these per med it actually changes. */
export function newParAdjustmentRef(): DocumentReference {
  return doc(parAdjustmentsCollection());
}
