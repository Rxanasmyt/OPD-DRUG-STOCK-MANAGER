// Repository module for the `meta` Firestore collection — see auditLogRepo.ts/usernamesRepo.ts
// for the first rounds of this same collection-at-a-time pattern. Two unrelated docs share this
// one collection: `meta/settings` (the global, admin-editable settings doc — expiryWarnDays,
// parFloorCoverDays, idleLogoutMinutes, usageStatsRecomputedAt, etc.) and `meta/medSeq` (the
// atomic counter addMed() increments inside a transaction to mint each new med's shelf-label
// code).
import { doc, getDoc, onSnapshot, type DocumentReference, type DocumentSnapshot, type FirestoreError, type Unsubscribe } from 'firebase/firestore';
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

/** One-off read of `meta/backupStatus` — written by the daily backup workflow AFTER a backup was verified and pushed
 * (scripts/mark-backup-status.mjs). Admin banner only; 1 read per sign-in. `null` = never written / unreadable. */
export async function fetchBackupStatus(): Promise<{ lastBackupAt: number } | null> {
  const snap = await getDoc(doc(db, 'meta', 'backupStatus'));
  const t = snap.exists() ? (snap.data() as { lastBackupAt?: unknown }).lastBackupAt : undefined;
  return typeof t === 'number' && isFinite(t) ? { lastBackupAt: t } : null;
}
