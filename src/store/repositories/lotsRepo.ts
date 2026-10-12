// Repository module for the `lots` (substock) Firestore collection — see auditLogRepo.ts/
// usernamesRepo.ts for the first rounds of this same collection-at-a-time pattern.
import {
  collection, doc, getDocs, onSnapshot, query, where,
  type DocumentReference, type FirestoreError, type QuerySnapshot, type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../../firebase';

function lotsCollection() {
  return collection(db, 'lots');
}

/** One existing lots doc by id — every commit action (commitTransfer, commitReceive,
 * approvePendingReceive, commitCount/commitSubCount, scrapLot, mergeWardMeds) reads or writes
 * one of these inside its own transaction. */
export function lotRef(id: string): DocumentReference {
  return doc(db, 'lots', id);
}

/** A fresh auto-id ref for one new lots doc — commitReceive()/approvePendingReceive() each
 * create one the first time a given lotNo/exp batch is received for a med. */
export function newLotRef(): DocumentReference {
  return doc(lotsCollection());
}

/** The live substock listener. */
export function subscribeLots(
  onNext: (snap: QuerySnapshot) => void,
  onError: (e: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(lotsCollection(), onNext, onError);
}

/** Every lots doc that exists — resetAllQuantities()'s own pre-reset snapshot needs the full
 * collection, not just one med's slice. */
export function fetchAllLots() {
  return getDocs(lotsCollection());
}

/** Every lots doc for one med — the live (untransacted) pre-read several commit actions run
 * before re-reading their candidates via trx.get(), same "client SDK can't query inside a
 * transaction" workaround used throughout this file. */
export function fetchLotsByMedId(medId: string) {
  return getDocs(query(lotsCollection(), where('medId', '==', medId)));
}

/** Every lots doc across up to 30 meds at once — Firestore's own `in` operator cap — used by
 * bulk operations that need several meds' lots in one round trip instead of one query per med. */
export function fetchLotsByMedIds(medIds: string[]) {
  return getDocs(query(lotsCollection(), where('medId', 'in', medIds)));
}
