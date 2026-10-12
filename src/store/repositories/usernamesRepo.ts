// Repository module for the `usernames` Firestore collection — task "repository/service layer
// for Firestore access", continuing the collection-at-a-time pattern auditLogRepo.ts started.
// `usernames` only ever exists to reserve/check username uniqueness during signUp() (one doc per
// claimed username, keyed by the username itself, holding just the uid that claimed it) — the
// smallest, most self-contained collection left after auditLog, with exactly 2 call sites, both
// in signUp(). Pure "extract function": wraps only the doc-reference construction, so it slots
// into either a plain getDoc() or a writeBatch.set() exactly as the 2 call sites already do.
import { doc, type DocumentReference } from 'firebase/firestore';
import { db } from '../../firebase';

export function usernameRef(username: string): DocumentReference {
  return doc(db, 'usernames', username);
}
