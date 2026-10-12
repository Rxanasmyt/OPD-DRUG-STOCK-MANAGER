// Repository module for the `users` Firestore collection — see auditLogRepo.ts/
// usernamesRepo.ts for the first rounds of this same collection-at-a-time pattern.
import { collection, doc, query, where, type DocumentReference, type Query } from 'firebase/firestore';
import { db } from '../../firebase';

export function userRef(id: string): DocumentReference {
  return doc(db, 'users', id);
}

export function usersCollection() {
  return collection(db, 'users');
}

/** lastAdminGuardedWrite()'s own pre-transaction headcount — every user doc with role 'admin',
 * read live (untransacted) before the transaction re-checks each one's current role/active via
 * trx.get(), same "client SDK can't query inside a transaction" shape every other live-then-
 * trx.get() lookup in this file uses. */
export function queryAdminUsers(): Query {
  return query(usersCollection(), where('role', '==', 'admin'));
}
