// Repository module for the `pendingReceives` Firestore collection — see auditLogRepo.ts/
// usernamesRepo.ts for the first rounds of this same collection-at-a-time pattern.
import {
  collection, doc, limit, onSnapshot, orderBy, query,
  type DocumentReference, type FirestoreError, type QuerySnapshot, type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../../firebase';

function pendingReceivesCollection() {
  return collection(db, 'pendingReceives');
}

/** The live "รออนุมัติ" feed (ReceiveScreen) — capped at the most recent 200, same shape as the
 * other live-listener collections in this file. */
export function subscribeRecentPendingReceives(
  onNext: (snap: QuerySnapshot) => void,
  onError: (e: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(query(pendingReceivesCollection(), orderBy('ts', 'desc'), limit(200)), onNext, onError);
}

/** A fresh auto-id ref for one new pendingReceives doc — commitReceive()'s "ส่งให้อนุมัติ" path
 * batch.set()s one of these per item in the delivery. */
export function newPendingReceiveRef(): DocumentReference {
  return doc(pendingReceivesCollection());
}

/** One existing pendingReceives doc by id — approvePendingReceive()/rejectPendingReceive()
 * both resolve the same request this way, inside their own transaction. */
export function pendingReceiveRef(id: string): DocumentReference {
  return doc(db, 'pendingReceives', id);
}
