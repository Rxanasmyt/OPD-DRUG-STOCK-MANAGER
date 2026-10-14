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

/** The live floorLots listener.
 *
 * Bug fix (Firestore quota incident, 2026-10-14): this doc comment used to claim "every
 * floor-lot doc that exists is always relevant to FEFO/aging across the whole app" — not true of
 * any real consumer: floorLotsFor()/fefoFloorLot() (selectors.ts), AdjustScreen's floorScrapRows,
 * and scrapFloorLot's own lookup (AppContext.tsx) all filter to `qty > 0` themselves, same as
 * every `lots` consumer (see subscribeLots' own doc comment, same incident, same fix). A
 * floor-lot drawn down to 0 by commitTransfer/commitAdjust/commitReconcile just sits there
 * forever as a spent record, unfiltered — pure dead weight re-synced to every client on every
 * connect. Filtering it out of the live query itself (not just client-side, which already
 * happened everywhere that mattered) removes that waste with no loss of functionality. */
export function subscribeFloorLots(
  onNext: (snap: QuerySnapshot) => void,
  onError: (e: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(query(floorLotsCollection(), where('qty', '>', 0)), onNext, onError);
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
