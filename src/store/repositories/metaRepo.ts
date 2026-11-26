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

export interface NotifyRun { ranAt: number; result: string; error?: string; why?: string }
export type NotifyStatus = Partial<Record<'stock' | 'hosxp' | 'monthly', NotifyRun>>;

/** One-off read of `meta/notifyStatus` — each scheduled LINE notifier (scripts/notify-*.mjs) stamps `{ranAt, result}` here after every run,
 * even a run that had nothing to send. Admin banner only; 1 read per sign-in. `null` = never written / unreadable. */
export async function fetchNotifyStatus(): Promise<NotifyStatus | null> {
  const snap = await getDoc(doc(db, 'meta', 'notifyStatus'));
  if (!snap.exists()) return null;
  const d = snap.data() as Record<string, { ranAt?: unknown; result?: unknown; error?: unknown; why?: unknown } | undefined>;
  const out: NotifyStatus = {};
  for (const k of ['stock', 'hosxp', 'monthly'] as const) {
    const r = d[k];
    if (r && typeof r.ranAt === 'number' && isFinite(r.ranAt) && typeof r.result === 'string') {
      out[k] = { ranAt: r.ranAt, result: r.result, ...(typeof r.error === 'string' ? { error: r.error } : {}), ...(typeof r.why === 'string' ? { why: r.why } : {}) };
    }
  }
  return out;
}
