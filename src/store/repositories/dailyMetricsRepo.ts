// Repository module for the `dailyMetrics` Firestore collection — task "repository/service
// layer for Firestore access", continuing the collection-at-a-time pattern (see
// auditLogRepo.ts/usernamesRepo.ts for the first two rounds). This collection is written only
// by scripts/collect-daily-metrics.mjs (an external GitHub Actions job), never by the app
// itself — AppContext.tsx only ever reads it, via the one call site this wraps.
import { collection, getDocs, orderBy, query, where } from 'firebase/firestore';
import { db } from '../../firebase';
import type { DailyMetrics } from '../../types';

/** fetchDailyMetrics()'s own query — every dailyMetrics doc whose `date` falls within
 * [fromDate, toDate], ascending. */
export async function fetchDailyMetricsByDateRange(fromDate: string, toDate: string): Promise<DailyMetrics[]> {
  const snap = await getDocs(query(
    collection(db, 'dailyMetrics'),
    where('date', '>=', fromDate), where('date', '<=', toDate), orderBy('date', 'asc'),
  ));
  return snap.docs.map((d) => d.data() as DailyMetrics);
}
