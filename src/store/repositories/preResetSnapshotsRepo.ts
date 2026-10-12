// Repository module for the `_preResetSnapshots` Firestore collection — see auditLogRepo.ts/
// usernamesRepo.ts for the first rounds of this same collection-at-a-time pattern. Admin-only
// (read AND write) in firestore.rules — snapshotBeforeDelete()'s own pre-destructive-reset
// backup is the single writer, one chunk doc at a time.
import { collection, doc, type DocumentReference } from 'firebase/firestore';
import { db } from '../../firebase';

export function preResetSnapshotRef(id: string): DocumentReference {
  return doc(collection(db, '_preResetSnapshots'), id);
}
