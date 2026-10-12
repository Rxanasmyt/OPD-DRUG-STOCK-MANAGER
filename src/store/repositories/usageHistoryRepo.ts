// Repository module for the `usageHistory` Firestore collection — see auditLogRepo.ts/
// usernamesRepo.ts for the first two rounds of this same collection-at-a-time pattern.
import { collection, doc, getDocs, query, where, type DocumentReference } from 'firebase/firestore';
import { db } from '../../firebase';
import type { UsageHistoryRecord } from '../../types';

/** fetchUsageHistory()'s own query — every usageHistory doc whose `periodFrom` falls within
 * [fromDate, toDate]. */
export async function fetchUsageHistoryByPeriod(fromDate: string, toDate: string): Promise<UsageHistoryRecord[]> {
  const snap = await getDocs(query(
    collection(db, 'usageHistory'),
    where('periodFrom', '>=', fromDate), where('periodFrom', '<=', toDate),
  ));
  return snap.docs.map((d) => d.data() as UsageHistoryRecord);
}

/** A fresh auto-id ref for one new usageHistory doc — commitUsageImport() batch.set()s one of
 * these per matched med per import. */
export function newUsageHistoryRef(): DocumentReference {
  return doc(collection(db, 'usageHistory'));
}
