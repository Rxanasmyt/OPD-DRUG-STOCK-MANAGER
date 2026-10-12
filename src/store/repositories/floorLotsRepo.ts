// Repository module for the `floorLots` Firestore collection — see auditLogRepo.ts/
// usernamesRepo.ts for the first rounds of this same collection-at-a-time pattern.
import {
  collection, doc, getDocs, onSnapshot, query, where,
  type DocumentReference, type FirestoreError, type QuerySnapshot, type Unsubscribe,
} from 'firebase/firestore';
import { db } from '../../firebase';

function floorLotsCollection() {
  return collection(db, 'floorLots');
}

/** One existing floorLots doc by id — commitTransfer/scrapFloorLot/commitReconcile all read or
 * write one of these inside their own transaction. */
export function floorLotRef(id: string): DocumentReference {
  return doc(db, 'floorLots', id);
}

/** The live floorLots listener — unlike `lots`/`txs`, this collection has no live-feed cap:
 * every floor-lot doc that exists is always relevant to FEFO/aging across the whole app. */
export function subscribeFloorLots(
  onNext: (snap: QuerySnapshot) => void,
  onError: (e: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(floorLotsCollection(), onNext, onError);
}

/** Every floorLots doc that exists — resetAllQuantities()'s own pre-reset snapshot needs the
 * full collection, not just one med's slice. */
export function fetchAllFloorLots() {
  return getDocs(floorLotsCollection());
}

/** Every floorLots doc for one med — the live (untransacted) pre-read mergeWardMeds()/
 * commitReconcile() each run before re-reading their one chosen candidate via trx.get(), same
 * "client SDK can't query inside a transaction" workaround commitTransfer's own FEFO lot lookup
 * uses. */
export function fetchFloorLotsByMedId(medId: string) {
  return getDocs(query(floorLotsCollection(), where('medId', '==', medId)));
}
