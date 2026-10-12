// Repository module for the `auditLog` Firestore collection — first pilot for task "repository/
// service layer for Firestore access": centralizes the 'auditLog' collection name (and its one
// indexed field, `ts`) in one place instead of as a raw magic string repeated at 5 separate call
// sites across AppContext.tsx. Every function here wraps exactly the query/write its call site
// already issued — pure "extract function", no behavior change.
import {
  addDoc, collection, limit, onSnapshot, orderBy, query, where,
  type DocumentData, type FirestoreError, type Query, type QuerySnapshot, type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../../firebase';
import type { AuditType } from '../../types';

function auditLogCollection() {
  return collection(db, 'auditLog');
}

/** The live, on-screen "recent activity" feed (AdminScreen) — capped at the most recent 300
 * entries, same cap the `txs` collection's own live listener uses. */
export function subscribeRecentAuditLog(
  onNext: (snap: QuerySnapshot<DocumentData>) => void,
  onError: (e: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(query(auditLogCollection(), orderBy('ts', 'desc'), limit(300)), onNext, onError);
}

/** Appends one audit trail entry — a human-readable note, not a stock-affecting ledger row (see
 * logAudit()'s own doc comment in AppContext.tsx for why this is the only write still issued
 * outside a transaction). */
export function appendAuditLogEntry(entry: { type: AuditType; note: string; by: string; ts: number }) {
  return addDoc(auditLogCollection(), entry);
}

/** Every auditLog doc ever written, newest first — the full-history export query
 * (exportAllReports/exportAudit use this), never the capped live feed above. */
export function queryAllAuditLog(): Query<DocumentData> {
  return query(auditLogCollection(), orderBy('ts', 'desc'));
}

/** Every auditLog doc whose `ts` falls within [from, to] — searchHistory's bounded date-range
 * browse. */
export function queryAuditLogByDateRange(from: number, to: number): Query<DocumentData> {
  return query(auditLogCollection(), where('ts', '>=', from), where('ts', '<=', to));
}
