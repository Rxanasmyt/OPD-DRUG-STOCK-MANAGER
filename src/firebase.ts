import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { initializeFirestore, persistentLocalCache, persistentMultipleTabManager } from 'firebase/firestore';

// This is the Firebase Web SDK "config" object — it identifies the project to
// Firebase, it is NOT a secret (Google's own docs say it's safe to ship in
// client code / public repos). Real access control lives in Firestore
// Security Rules (see firestore.rules), not in hiding this object.
const firebaseConfig = {
  apiKey: 'AIzaSyBs8q4SW6xXwS65iNgb2OKX-ysfwCV-4J4',
  authDomain: 'opd-drug-stock.firebaseapp.com',
  projectId: 'opd-drug-stock',
  storageBucket: 'opd-drug-stock.firebasestorage.app',
  messagingSenderId: '747616804221',
  appId: '1:747616804221:web:c394d33326f89eba840014',
  measurementId: 'G-JKM8JXJR3H',
};

export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);

// Persistent (IndexedDB) offline cache, shared across tabs — the counter/substock tablet on
// hospital wifi drops connectivity often enough that this matters: reads already synced keep
// working, and writes made while offline queue and flush automatically on reconnect instead
// of being silently lost on a refresh. Falls back to the plain in-memory client if IndexedDB
// isn't available (private/incognito mode in some browsers, very old browsers) rather than
// crashing the app on init.
let firestoreDb;
try {
  firestoreDb = initializeFirestore(app, {
    localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
  });
} catch (e) {
  console.warn('Persistent Firestore cache unavailable, falling back to in-memory cache:', e);
  firestoreDb = initializeFirestore(app, {});
}
export const db = firestoreDb;

// Firebase's built-in Auth provider is email/password only — there's no separate
// "username" provider without standing up Cloud Functions (a paid Blaze-plan
// feature this project intentionally avoids). So a username maps 1:1 to a
// synthetic, never-emailed address on a fake domain, and that's what Auth
// actually sees; the app and its users never think in terms of "email".
const USERNAME_DOMAIN = 'opd-drug-stock.local';

export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;

export function normalizeUsername(raw: string): string {
  return raw.trim().toLowerCase();
}

export function usernameToEmail(username: string): string {
  return `${normalizeUsername(username)}@${USERNAME_DOMAIN}`;
}
