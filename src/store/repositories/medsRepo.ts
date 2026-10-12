// Repository module for the `meds` Firestore collection — see auditLogRepo.ts/usernamesRepo.ts
// for the first rounds of this same collection-at-a-time pattern. `meds` is the drug master list
// every screen reads from and nearly every admin/commit action writes a field on — the
// largest/most-referenced collection in AppContext.tsx.
import {
  collection, doc, getDocs, onSnapshot,
  type DocumentReference, type FirestoreError, type QuerySnapshot, type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../../firebase';

function medsCollection() {
  return collection(db, 'meds');
}

/** One existing meds doc by id — by far the most common access pattern, used under every
 * read/write shape (trx.get/trx.set/trx.update, getDoc, updateDoc, batch.update, batch.delete)
 * at its own call site; this repo only ever builds the ref. */
export function medRef(id: string): DocumentReference {
  return doc(db, 'meds', id);
}

/** A fresh auto-id ref for one new meds doc — addMed()'s own trx.set(). */
export function newMedRef(): DocumentReference {
  return doc(medsCollection());
}

/** The live, on-screen drug-list listener — every screen in the app renders off this. */
export function subscribeMeds(
  onNext: (snap: QuerySnapshot) => void,
  onError: (e: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(medsCollection(), onNext, onError);
}

/** Every meds doc that exists — resetAllStockLedgers()'s own pre-delete snapshot needs the
 * full collection. */
export function fetchAllMeds() {
  return getDocs(medsCollection());
}
