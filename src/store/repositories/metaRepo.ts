// Repository module for the `meta` Firestore collection — see auditLogRepo.ts/usernamesRepo.ts
// for the first rounds of this same collection-at-a-time pattern. Two unrelated docs share this
// one collection: `meta/settings` (the global, admin-editable settings doc — expiryWarnDays,
// parFloorCoverDays, idleLogoutMinutes, usageStatsRecomputedAt, etc.) and `meta/medSeq` (the
// atomic counter addMed() increments inside a transaction to mint each new med's shelf-label
// code).
import { doc, onSnapshot, type DocumentReference, type DocumentSnapshot, type FirestoreError, type Unsubscribe } from 'firebase/firestore';
import { db } from '../../firebase';

export function settingsRef(): DocumentReference {
  return doc(db, 'meta', 'settings');
}

export function subscribeSettings(
  onNext: (snap: DocumentSnapshot) => void,
  onError: (e: FirestoreError) => void,
): Unsubscribe {
  return onSnapshot(settingsRef(), onNext, onError);
}

export function medSeqRef(): DocumentReference {
  return doc(db, 'meta', 'medSeq');
}
