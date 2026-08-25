import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

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
export const db = getFirestore(app);
