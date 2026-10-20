// Repository module for the `floorLots` Firestore collection — see auditLogRepo.ts/
// usernamesRepo.ts for the first rounds of this same collection-at-a-time pattern.
import {
  collection, doc, getDocs, onSnapshot, query, where,
  type DocumentReference, type FirestoreError, type QueryDocumentSnapshot, type QuerySnapshot, type Unsubscribe,
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

/** Every floorLots doc for one med, regardless of qty — mergeWardPairTx() is the only caller
 * left that genuinely needs this (must reassign every floor-lot doc, including long-since-
 * emptied ones, so the surviving med's history stays complete); commitReconcile()'s own
 * per-row lookup below now uses fetchActiveFloorLotsByMedId instead. */
export function fetchFloorLotsByMedId(medId: string) {
  return getDocs(query(floorLotsCollection(), where('medId', '==', medId)));
}

/** Every floorLots doc for one med that's still genuinely active (qty > 0) — the bounded
 * counterpart to fetchFloorLotsByMedId above.
 *
 * Bug fix (real report: "เติมหน้างานตอนเช้า...ใช้ได้แป๊ปเดียวก็ถึง limit"): commitReconcile()'s
 * own HOSxP-dispense floor-lot FEFO guess (AppContext.tsx) only ever acts on a candidate whose
 * live qty is > 0 (`if (curQty <= 0) continue`) — same waste as lotsRepo's own
 * fetchActiveLotsByMedId fixes, just on the floor side: every historical, long-since-emptied
 * floor-lot doc for a commonly-dispensed med was being re-read in full on every single
 * reconcile row, every day, forever.
 *
 * Needs a one-time composite index (`floorLots`: medId Ascending + qty Ascending) — same
 * Firebase Console step as lotsRepo's own fetchActiveLotsByMedId; the same index-missing
 * fallback applies here too, so a reconcile commit never hard-fails over it. */
export async function fetchActiveFloorLotsByMedId(medId: string): Promise<QueryDocumentSnapshot[]> {
  try {
    const snap = await getDocs(query(floorLotsCollection(), where('medId', '==', medId), where('qty', '>', 0)));
    return snap.docs;
  } catch (e) {
    const err = e as FirestoreError;
    if (err?.code !== 'failed-precondition' || !/index/i.test(err.message || '')) throw e;
    const snap = await fetchFloorLotsByMedId(medId);
    return snap.docs.filter((d) => ((d.data() as { qty?: number }).qty ?? 0) > 0);
  }
}
