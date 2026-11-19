// Admin-initiated password reset. Firebase only lets someone OTHER than the account owner change
// a password through the Admin SDK (server side), so the app's "รีเซ็ตรหัสผ่าน" button calls this.
//
// Security model — everything is decided HERE, never trusted from the client:
//   * caller must be signed in AND their users/{uid} doc must be active:true, role:'admin'
//   * the target must be an existing users/{uid} doc, and not the caller (use the normal
//     change-my-password screen for yourself)
//   * the temporary password is generated server-side (crypto.randomInt), returned once to the
//     admin, and never written to a log or to Firestore
//   * the target is flagged mustChangePassword:true (the app forces a new password on next login)
//     and their existing sessions are revoked
//   * every reset is appended to auditLog (who reset whose password — not the password)
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('node:crypto');

initializeApp();

// No 0/O/1/l/I — a password an admin reads out over the phone or types for someone.
const ALPHABET = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function generateTempPassword(length = 12) {
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[crypto.randomInt(ALPHABET.length)];
  return out;
}

exports.adminResetPassword = onCall({ region: 'asia-southeast1', maxInstances: 5 }, async (request) => {
  if (!request.auth) throw new HttpsError('unauthenticated', 'ต้องเข้าสู่ระบบก่อน');
  const callerUid = request.auth.uid;
  const targetUid = request.data && request.data.uid;
  if (typeof targetUid !== 'string' || !targetUid || targetUid.length > 128) {
    throw new HttpsError('invalid-argument', 'ไม่ระบุผู้ใช้ที่ต้องการรีเซ็ต');
  }

  const db = getFirestore();
  const callerSnap = await db.doc('users/' + callerUid).get();
  const caller = callerSnap.data();
  if (!caller || caller.active !== true || caller.role !== 'admin') {
    throw new HttpsError('permission-denied', 'เฉพาะ Admin ที่ใช้งานอยู่เท่านั้นที่รีเซ็ตรหัสผ่านได้');
  }
  if (targetUid === callerUid) {
    throw new HttpsError('failed-precondition', 'รีเซ็ตรหัสผ่านของตัวเองไม่ได้ — ใช้เมนูเปลี่ยนรหัสผ่านของฉัน');
  }
  const targetSnap = await db.doc('users/' + targetUid).get();
  if (!targetSnap.exists) throw new HttpsError('not-found', 'ไม่พบผู้ใช้นี้');
  const target = targetSnap.data();

  const tempPassword = generateTempPassword();
  await getAuth().updateUser(targetUid, { password: tempPassword });
  await getAuth().revokeRefreshTokens(targetUid);
  await db.doc('users/' + targetUid).update({
    mustChangePassword: true,
    passwordResetAt: Date.now(),
    passwordResetBy: callerUid,
  });
  await db.collection('auditLog').add({
    type: 'user_password_reset',
    by: caller.name || '',
    ts: Date.now(),
    note: 'รีเซ็ตรหัสผ่านของ ' + (target.name || targetUid) + ' (@' + (target.username || '?') + ') — ต้องตั้งรหัสใหม่เมื่อเข้าระบบครั้งถัดไป',
  });
  return { tempPassword };
});

exports._generateTempPassword = generateTempPassword;
