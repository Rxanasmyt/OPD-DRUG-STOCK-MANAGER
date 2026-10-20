// Repository module for the `lots` (substock) Firestore collection — see auditLogRepo.ts/
// usernamesRepo.ts for the first rounds of this same collection-at-a-time pattern.
import {
  collection, doc, getDocs, onSnapshot, query, where,
  type DocumentReference, type FirestoreError, type QueryDocumentSnapshot, type QuerySnapshot, type Unsubscribe,
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

/** The live substock listener.
 *
 * Bug fix (Firestore quota incident, 2026-10-14): this used to sync the WHOLE `lots` collection,
 * unfiltered, to every signed-in device for the lifetime of its session — including every lot
 * that's ever been fully dispensed/scrapped down to qty 0, which `lots` never deletes (a spent
 * lot doc just sits there forever as a record). Every real consumer of state.lots in the app
 * already filters to `qty > 0` itself (subQty/fefoLot/categoryStats/riskValue/the aging report/
 * the lot-label print/scan path — verified against every call site; see each one's own doc
 * comment), so none of those dead docs were ever actually used for anything — they were pure
 * waste, re-read in full on every single client connect/reload, for as long as this hospital's
 * been live. On the free Spark plan's daily read quota, that waste is exactly what tipped the
 * project into `resource-exhausted` on an ordinary busy OPD day (86K reads/day against a 50K cap
 * — see Firebase Console → Usage). Moving the same filter into the query itself means a spent lot
 * is never synced to a client in the first place, with no loss of functionality anywhere. */
export function subscribeLots(
  onNext: (snap: QuerySnapshot) => void,
  onError: (e: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(query(lotsCollection(), where('qty', '>', 0)), onNext, onError);
}

/** Every lots doc that exists — resetAllQuantities()'s own pre-reset snapshot needs the full
 * collection, not just one med's slice. */
export function fetchAllLots() {
  return getDocs(lotsCollection());
}

/** Every lots doc for one med, regardless of qty — deleteMed()'s own cleanup (must delete every
 * historical lot doc, not just the live ones) and mergeWardPairTx() (must reassign every lot,
 * including long-since-emptied ones, so the surviving med's ledger history stays complete) are
 * the only two callers left that genuinely need this; everything else now uses
 * fetchActiveLotsByMedId below. */
export function fetchLotsByMedId(medId: string) {
  return getDocs(query(lotsCollection(), where('medId', '==', medId)));
}

/** Every lots doc for one med that's still genuinely active (qty > 0) — the bounded counterpart
 * to fetchLotsByMedId above.
 *
 * Bug fix (real report: "เติมหน้างานตอนเช้า...ใช้ได้แป๊ปเดียวก็ถึง limit"): commitTransfer's FEFO
 * lot lookup, commitReceive/approvePendingReceive's lot-merge check, and commitSubCount/
 * commitAllSubCounts' live lot-id refresh (AppContext.tsx) all used to call fetchLotsByMedId —
 * the FULL, unfiltered per-med lot history — then immediately filter the result down to qty > 0
 * themselves, exactly the same waste subscribeLots' own doc comment describes for the live
 * listener, just re-read in full on every single one of the most routine actions in the app
 * (every item in every morning floor-refill cart, every receive, every substock count) instead
 * of once per connect. A long-running, high-turnover med can carry hundreds of spent lot docs
 * after months of real use — none of them ever actually used by any of these call sites.
 *
 * Needs a one-time composite index (`lots`: medId Ascending + qty Ascending) created in the
 * Firebase Console before this is as cheap as it should be — until then, Firestore rejects the
 * query with a "the query requires an index" error, which the fallback below catches so a real
 * transfer/receive/count action never hard-fails just because that console step hasn't happened
 * yet; it just keeps paying the old, uncapped cost until it has. */
export async function fetchActiveLotsByMedId(medId: string): Promise<QueryDocumentSnapshot[]> {
  try {
    const snap = await getDocs(query(lotsCollection(), where('medId', '==', medId), where('qty', '>', 0)));
    return snap.docs;
  } catch (e) {
    const err = e as FirestoreError;
    if (err?.code !== 'failed-precondition' || !/index/i.test(err.message || '')) throw e;
    const snap = await fetchLotsByMedId(medId);
    return snap.docs.filter((d) => ((d.data() as { qty?: number }).qty ?? 0) > 0);
  }
}

/** Every lots doc across up to 30 meds at once — Firestore's own `in` operator cap — used by
 * bulk operations that need several meds' lots in one round trip instead of one query per med. */
export function fetchLotsByMedIds(medIds: string[]) {
  return getDocs(query(lotsCollection(), where('medId', 'in', medIds)));
}
