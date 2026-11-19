#!/usr/bin/env node
// Admin password reset for a user who forgot theirs. Firebase only lets someone other than the
// account owner change a password through the Admin SDK (server side) — this project has no
// Cloud Functions (see src/firebase.ts), so this runs as a manually-triggered GitHub Action
// (.github/workflows/reset-user-password.yml, "Run workflow" → enter the username), reusing the
// FIREBASE_SERVICE_ACCOUNT_KEY secret every other script here already uses.
//
// What it does, for the one username given:
//   * looks the user up in users/ (refuses an unknown username)
//   * sets a random temporary password (crypto.randomInt, no look-alike characters)
//   * revokes their existing sessions
//   * flags users/{uid}.mustChangePassword = true — the app then forces them to pick their own
//     password right after they log in with the temporary one (ForcePasswordScreen)
//   * appends an auditLog entry (who triggered it, for whom — never the password)
// The temporary password is written ONLY to the GitHub job summary (GITHUB_STEP_SUMMARY), never
// to the normal log. Anyone who can read this repo's Actions runs can open that summary — see
// docs/ADMIN_PASSWORD_RESET.md (delete the run afterwards).
//
// Local run:
//   FIREBASE_SERVICE_ACCOUNT_KEY="$(cat serviceAccountKey.json)" RESET_USERNAME=somebody node scripts/reset-user-password.mjs

import { initializeApp, cert } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { getFirestore } from 'firebase-admin/firestore';
import crypto from 'node:crypto';
import fs from 'node:fs';

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

  const tempPassword = generateTempPassword();
  await getAuth().updateUser(doc.id, { password: tempPassword });
  await getAuth().revokeRefreshTokens(doc.id);
  await doc.ref.update({ mustChangePassword: true, passwordResetAt: Date.now(), passwordResetBy: 'github:' + actor });
  await db.collection('auditLog').add({
    type: 'user_password_reset',
    by: 'GitHub Actions (' + actor + ')',
    ts: Date.now(),
    note: 'รีเซ็ตรหัสผ่านของ ' + (target.name || doc.id) + ' (@' + username + ') — ต้องตั้งรหัสใหม่เมื่อเข้าระบบครั้งถัดไป',
  });

  // The password goes to the job summary only — never console.log.
  const summary = process.env.GITHUB_STEP_SUMMARY;
  const body = [
    '### 🔑 รหัสผ่านชั่วคราวของ ' + (target.name || username) + ' (@' + username + ')',
    '',
    '`' + tempPassword + '`',
    '',
    'แจ้งรหัสนี้ให้ผู้ใช้โดยตรง — เมื่อเข้าสู่ระบบ แอพจะบังคับให้ตั้งรหัสผ่านใหม่ของตัวเอง',
    '**หลังจดรหัสแล้ว ให้ลบการรันนี้ (Delete workflow run) เพื่อไม่ให้รหัสค้างอยู่ในหน้านี้**',
    '',
  ].join('\n');
  if (summary) fs.appendFileSync(summary, body);
  else console.log('(no GITHUB_STEP_SUMMARY — local run) temp password for @' + username + ': ' + tempPassword);
  console.log('Password reset for @' + username + ' — temporary password written to the job summary.');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((e) => { console.error(e); process.exit(1); });
}
