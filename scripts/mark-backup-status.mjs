#!/usr/bin/env node
// Last step of the daily backup workflow: stamps meta/backupStatus.lastBackupAt = now (only reached when the backup was
// written, verified and pushed). The app shows admins a red banner when this stamp is older than ~36 h, so a backup
// that silently stopped running is noticed inside the app — not only by an email nobody reads.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
if (!keyJson) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set.'); process.exit(1); }
initializeApp({ credential: cert(JSON.parse(keyJson)) });
const at = Date.now();
await getFirestore().collection('meta').doc('backupStatus').set({ lastBackupAt: at, source: 'github-actions' });
console.log('meta/backupStatus.lastBackupAt =', new Date(at).toISOString());
