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
 * collection predates medId on every tx row — see their own OPD/IPD name-twin comments). Only
 * their own 'full' mode (an explicit "load full history" action) uses this unbounded form —
 * their default 'recent' mode uses fetchTxsByNameSince below instead. */
export function fetchTxsByName(name: string) {
  return getDocs(query(txsCollection(), where('name', '==', name)));
}

/** Every txs doc logged against one med's name, at or after `sinceMs` — the bounded counterpart
 * to fetchTxsByName above. Needs a composite index (txs: name Ascending + ts Ascending) — same
 * one-time Firebase Console step as every other compound query this app added after its first
 * (see firestore-backup.yml/collect-daily-metrics.mjs's own comments on the pendingReceives one);
 * until it's created, Firestore's own error includes a direct "create this index" link. Bug fix
 * (Firestore quota incident, real-world report: "ถึง limit อีกแล้ว" — Firestore Usage showed
 * 114K reads/day, 228% over the free-tier cap — root-caused to fetchTxsByName's full, ever-
 * growing per-med history being re-read on every single SubstockCardScreen open, the single most
 * routine action in the app): fetchSubstockLedger()/fetchFloorLedger()'s default 'recent' mode
 * uses this instead, bounding the common case to the last ~13 months (LEDGER_RECENT_DAYS in
 * AppContext.tsx) regardless of how many years of history a long-running, high-turnover med has
 * accumulated — a medication filled daily for years can carry thousands of rows, all re-read in
 * full every time anyone just glances at its card. */
export function fetchTxsByNameSince(name: string, sinceMs: number) {
  return getDocs(query(txsCollection(), where('name', '==', name), where('ts', '>=', sinceMs)));
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
