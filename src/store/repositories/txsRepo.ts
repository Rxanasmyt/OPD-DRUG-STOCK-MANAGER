// Repository module for the `txs` Firestore collection — see auditLogRepo.ts/usernamesRepo.ts
// for the first rounds of this same collection-at-a-time pattern. `txs` is the stock-affecting
// transaction ledger every commit action in this file appends to (never updates/deletes a doc,
// only resetAllStockLedgers()'s own one-time "start the system over" admin action does) — by far
// the most-referenced collection in AppContext.tsx.
import {
  collection, doc, getDocs, onSnapshot, orderBy, query, where, limit,
  type DocumentReference, type FirestoreError, type Query, type QuerySnapshot, type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../../firebase';

function txsCollection() {
  return collection(db, 'txs');
}

/** One existing txs doc by id — only resetAllStockLedgers()'s bulk delete needs this; every
 * other write is a brand-new doc via newTxRef(). */
export function txRef(id: string): DocumentReference {
  return doc(db, 'txs', id);
}

/** A fresh auto-id ref for one new txs doc — every commit action (commitTransfer, commitReceive,
 * approvePendingReceive, commitAdjust, commitSingleReturn/commitReturnCart, scrapLot,
 * commitWardMove, commitCount/commitSubCount, commitReconcile) trx.set()s one of these as part
 * of its own transaction, logging the stock-affecting change it just made. */
export function newTxRef(): DocumentReference {
  return doc(txsCollection());
}

/** The live, on-screen "recent activity" feed — capped at the most recent 300 entries. */
export function subscribeRecentTxs(
  onNext: (snap: QuerySnapshot) => void,
  onError: (e: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(query(txsCollection(), orderBy('ts', 'desc'), limit(300)), onNext, onError);
}

/** Every txs doc ever written, newest first — the full-history export query (exportReportCsv's
 * discrepancy-log branch, exportAllReports, exportAudit all use this), never the capped live
 * feed above. */
export function queryAllTxs(): Query {
  return query(txsCollection(), orderBy('ts', 'desc'));
}

/** Every txs doc whose `ts` is at or after `sinceMs` — printExecutiveSummary()/
 * fetchExecTxsThisMonth() each pass this straight to getCountFromServer() rather than fetching
 * the actual docs, since only the count is needed. */
export function queryTxsSince(sinceMs: number): Query {
  return query(txsCollection(), where('ts', '>=', sinceMs));
}

/** Every txs doc that exists — resetAllStockLedgers()'s own pre-delete snapshot + bulk delete
 * needs the full collection. */
export function fetchAllTxs() {
  return getDocs(txsCollection());
}

/** Every txs doc logged against one med's name — fetchSubstockLedger()/fetchFloorLedger() each
 * build their own running-balance ledger from this (matched by name, not medId, since this
 * collection predates medId on every tx row — see their own OPD/IPD name-twin comments). */
export function fetchTxsByName(name: string) {
  return getDocs(query(txsCollection(), where('name', '==', name)));
}

/** Every txs doc logged strictly after `dateMs` — fetchStockAsOf()'s own point-in-time
 * reconstruction walks the ledger backward from this set. Also reused by recomputeUsageStats()/
 * analyzeWeekdayUsage() (AppContext.tsx) to bound their own HOSxP-history scan to a fixed
 * lookback window instead of the unbounded, ever-growing fetchReconcileHosxpTxs() this repo used
 * to export for exactly that — a single-field `ts`-range filter needs no composite index, where
 * combining it with `where('type','==','reconcile_hosxp')` would; both callers filter `type`
 * back out client-side instead (see their own comments). */
export function fetchTxsAfter(dateMs: number) {
  return getDocs(query(txsCollection(), where('ts', '>', dateMs)));
}

/** Every txs doc whose `ts` falls within [from, to] — searchHistory's bounded date-range
 * browse. */
export function queryTxsByDateRange(from: number, to: number): Query {
  return query(txsCollection(), where('ts', '>=', from), where('ts', '<=', to));
}
