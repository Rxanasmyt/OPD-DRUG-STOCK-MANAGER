#!/usr/bin/env node
// Real-world request: "อยากให้เมื่อมีการ merge เข้า main แล้ว อยากให้มีการอัพเดตเวอชั่นที่รวดเร็ว
// ตอนนี้ต้องรอนานกว่าจะขึ้นป็อปอัพให้อัพเดต" — the running app's own "มีแอพเวอร์ชันใหม่" banner
// used to rely purely on the service worker's own update check, which only ever runs on a timer
// (every 3 min) or when the tab becomes visible/focused again (see src/store/AppContext.tsx) —
// a deploy landing while a ward tablet sits open and idle could still take up to 3 extra minutes
// to even be NOTICED, on top of however long the deploy itself took.
//
// This script closes that gap using infrastructure the app already has: every open tab already
// holds a live Firestore subscription to meta/settings (src/store/AppContext.tsx). Writing the
// just-deployed version string into that SAME doc right after a successful deploy pushes the
// change to every connected client in REAL TIME (Firestore's own onSnapshot, no polling) — the
// app compares it against its own compiled-in VERSION and, the moment it sees a mismatch,
// immediately kicks the service worker to re-check for the new build instead of waiting for its
// next scheduled poll. It never sets the "ready to update" banner directly — the service worker
// still has to actually fetch+install the new build first; this only shortens "how long until it
// starts looking" from up to 3 minutes down to effectively the deploy's own real propagation
// time.
//
// Run automatically by .github/workflows/deploy-pages.yml, right after a successful deploy (a
// short sleep first — see that workflow's own comment on why). Same free-tier "GitHub Actions
// IS the server" pattern, and the same FIREBASE_SERVICE_ACCOUNT_KEY secret, as every other
// script in this directory. To run locally:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" node scripts/publish-app-version.mjs

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

async function main() {
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) {
    console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set. See this file\'s header comment for how to run it.');
    process.exit(1);
  }

  const here = dirname(fileURLToPath(import.meta.url));
  const version = readFileSync(join(here, '..', 'VERSION'), 'utf8').trim();
  if (!version) {
    console.error('VERSION file is empty — refusing to publish a blank version string.');
    process.exit(1);
  }

  const serviceAccount = JSON.parse(keyJson);
  initializeApp({ credential: cert(serviceAccount) });
  const db = getFirestore();

  await db.doc('meta/settings').set({ latestVersion: version }, { merge: true });
  console.log(`Published latestVersion=${version} to meta/settings (project "${serviceAccount.project_id}").`);
}

main().catch((e) => { console.error(e); process.exit(1); });
