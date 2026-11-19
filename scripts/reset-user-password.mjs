#!/usr/bin/env node
// Admin password reset for a user who forgot theirs. Firebase only lets someone other than the
// account owner change a password through the Admin SDK (server side) — this project has no
// Cloud Functions (see src/firebase.ts), so this runs as a manually-triggered GitHub Action
// (.github/workflows/reset-user-password.yml, "Run workflow" → enter the username), reusing the
// FIREBASE_SERVICE_ACCOUNT_KEY secret every other script here already uses.
//
// What it does, for the one username given:
//   * looks the user up in users/ (refuses an unknown username; refuses an app admin unless
//     ALLOW_ADMIN_RESET=true)
//   * sets a random temporary password (crypto.randomInt, no look-alike characters)
//   * revokes their existing sessions
//   * flags users/{uid}.mustChangePassword = true — the app then forces them to pick their own
//     password right after they log in with the temporary one (ForcePasswordScreen)
//   * appends an auditLog entry (who triggered it, for whom — never the password)
//
// This repo is PUBLIC (GitHub Pages), so Actions logs and job summaries are readable by anyone:
// the temporary password is NEVER printed there. It is written to passwordResets/{uid}, a
// collection only an active admin can read/delete (firestore.rules), and the admin reads it in the
// app (Admin screen → the user → "ดูรหัสชั่วคราว"), then deletes it.
//
// Local run:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" RESET_USERNAME=somebody node scripts/reset-user-password.mjs

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'node:crypto';

// No 0/O/1/l/I — a password an admin reads out over the phone or types for someone.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function generateTempPassword(length = 12) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

export async function main() {
  const keyJson = process.env.FIREBASE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) { console.error('FIREBASE_SERVICE_ACCOUNT_KEY env var is not set.'); process.exit(1); }
  const username = String(process.env.RESET_USERNAME || '').trim().toLowerCase();
  if (!/^[a-z0-9_.]{3,20}$/.test(username)) { console.error('RESET_USERNAME is missing or not a valid username (a-z, 0-9, _ and ., 3-20 chars).'); process.exit(1); }
  const actor = String(process.env.GITHUB_ACTOR || 'local').slice(0, 60);

  initializeApp({ credential: cert(JSON.parse(keyJson)) });
  const db = getFirestore();

  const found = await db.collection('users').where('username', '==', username).limit(1).get();
  if (found.empty) { console.error('No user with username "' + username + '" — nothing changed.'); process.exit(1); }
  const doc = found.docs[0];
  const target = doc.data();

  if (target.role === 'admin' && process.env.ALLOW_ADMIN_RESET !== 'true') {
    console.error('@' + username + ' is an app ADMIN — refusing (re-run with the "allow_admin" option ticked if this is really intended). Nothing changed.');
    process.exit(1);
  }

  const tempPassword = generateTempPassword();
  // Store the password for the admin FIRST: if a later step fails, the account is never left with a
  // changed password that nobody can read.
  await db.collection('passwordResets').doc(doc.id).set({ tempPassword, username, name: target.name || '', createdAt: Date.now(), requestedBy: 'github:' + actor });
  await getAuth().updateUser(doc.id, { password: tempPassword });
  await getAuth().revokeRefreshTokens(doc.id);
  await doc.ref.update({ mustChangePassword: true, passwordResetAt: Date.now(), passwordResetBy: 'github:' + actor });
  await db.collection('auditLog').add({
    type: 'user_password_reset',
    by: 'GitHub Actions (' + actor + ')',
    ts: Date.now(),
    note: 'รีเซ็ตรหัสผ่านของ ' + (target.name || doc.id) + ' (@' + username + ') — ต้องตั้งรหัสใหม่เมื่อเข้าระบบครั้งถัดไป',
  });

  console.log('Password reset for @' + username + ' — temporary password stored for the admin in the app (Admin screen → ดูรหัสชั่วคราว). It is not printed here.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
