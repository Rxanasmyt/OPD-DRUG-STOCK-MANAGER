// Repository module for the `returns` Firestore collection — see auditLogRepo.ts/
// usernamesRepo.ts for the first two rounds of this same collection-at-a-time pattern.
import { collection, doc, getDocs, orderBy, query, where, type DocumentReference } from 'firebase/firestore';
import { db } from '../../firebase';
import type { DrugReturnRecord } from '../../types';

/** fetchDrugReturns()'s own query — every returns doc whose `date` falls within
 * [fromDate, toDate], ascending. */
export async function fetchDrugReturnsByDateRange(fromDate: string, toDate: string): Promise<DrugReturnRecord[]> {
  const snap = await getDocs(query(
    collection(db, 'returns'),
    where('date', '>=', fromDate), where('date', '<=', toDate), orderBy('date', 'asc'),
  ));
  return snap.docs.map((d) => d.data() as DrugReturnRecord);
}

/** A fresh auto-id ref for one new returns doc — writeReturnBatch() trx.set()s one of these per
 * returned item, inside the same transaction as its matching `txs`/`meds` writes. */
export function newDrugReturnRef(): DocumentReference {
  return doc(collection(db, 'returns'));
}
