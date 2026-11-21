#!/usr/bin/env node
// Restore DRILL — proves, end to end and against a throwaway emulator (never real data), that the
// backup file this repo produces can actually bring the database back:
//   seed realistic docs → run scripts/backup-firestore.mjs → wipe everything → run
//   scripts/restore-firestore.mjs --confirm → compare every document with what was seeded.
// Run:  npm run test:restore-drill      (needs Java; wraps itself in the Firestore emulator)
// Refuses to run unless FIRESTORE_EMULATOR_HOST is set, so it can never touch the live project.
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { generateKeyPairSync } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

if (!process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('Refusing to run: FIRESTORE_EMULATOR_HOST is not set (this drill must only ever use the emulator).');
  process.exit(1);
}
const { privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048, privateKeyEncoding: { type: 'pkcs8', format: 'pem' }, publicKeyEncoding: { type: 'spki', format: 'pem' } });
const key = JSON.stringify({ type: 'service_account', project_id: 'opd-drug-stock', private_key: privateKey, client_email: 'drill@opd-drug-stock.iam.gserviceaccount.com' });
initializeApp({ credential: cert(JSON.parse(key)) });
const db = getFirestore();

const SEED = {
  meds: { m1: { code: 'MED-0001', name: 'Paracetamol 500 mg เม็ด', unit: 'เม็ด', floor: 120, parFloor: 200, parSub: 1000, active: true, ward: 'opd', lastCountTs: 1760000000000 }, m2: { code: 'MED-0002', name: 'Insulin', unit: 'Vial', floor: 3, active: true, ward: 'ipd', fridge: true } },
  lots: { l1: { code: 'MED-0001', medId: 'm1', lotNo: 'A1', qty: 500, exp: 1800000000000, loc: 'sub' } },
  floorLots: { f1: { medId: 'm1', lotNo: 'A1', qty: 120, exp: 1800000000000 } },
  txs: { t1: { type: 'transfer', name: 'Paracetamol', medId: 'm1', qty: 50, unit: 'เม็ด', by: 'ทดสอบ', ts: 1760000000001, note: 'หมายเหตุ ไทย' }, t2: { type: 'reconcile_hosxp', name: 'x', medId: 'm1', qty: -9, by: 'ทดสอบ', ts: 1760000000002, coveredFrom: '2026-11-20', coveredTo: '2026-11-20' } },
  returns: { r1: { medId: 'm1', hn: '123', qty: 2, value: 6, reason: 'ผู้ป่วยเสียชีวิต', ts: 1760000000003, by: 'ทดสอบ' } },
  auditLog: { a1: { type: 'login', by: 'ทดสอบ', ts: 1760000000004, note: 'n' } },
  users: { u1: { name: 'ทดสอบ', role: 'admin', active: true } },
  usernames: { bob: { uid: 'u1' } },
  meta: { medSeq: { n: 42 } },
};

async function wipe() {
  for (const c of Object.keys(SEED)) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

const work = mkd();
function mkd() { return mkdtempSync(join(tmpdir(), 'restore-drill-')); }
const env = { ...process.env, FIREBASE_SERVICE_ACCOUNT_KEY: key };
let failed = false;
try {
  await wipe();
  for (const [c, docs] of Object.entries(SEED)) for (const [id, data] of Object.entries(docs)) await db.collection(c).doc(id).set(data);

  execFileSync('node', ['scripts/backup-firestore.mjs', '--out-dir=' + work], { env, stdio: 'inherit' });
  const file = readdirSync(work).find((f) => f.startsWith('firestore-backup-'));
  if (!file) throw new Error('backup produced no file');

  await wipe();
  const emptied = (await db.collection('meds').get()).size;
  if (emptied !== 0) throw new Error('wipe failed — drill is not trustworthy');

  execFileSync('node', ['scripts/restore-firestore.mjs', join(work, file), '--confirm'], { env, stdio: 'inherit' });

  let checked = 0;
  for (const [c, docs] of Object.entries(SEED)) {
    const snap = await db.collection(c).get();
    if (snap.size !== Object.keys(docs).length) { console.error(`✗ ${c}: expected ${Object.keys(docs).length} docs, found ${snap.size}`); failed = true; }
    for (const [id, data] of Object.entries(docs)) {
      const got = (await db.collection(c).doc(id).get()).data();
      if (JSON.stringify(got, Object.keys(got || {}).sort()) !== JSON.stringify(data, Object.keys(data).sort())) { console.error(`✗ ${c}/${id} differs after restore`, got, data); failed = true; }
      checked++;
    }
  }
  console.log(failed ? '\n✗ RESTORE DRILL FAILED' : `\n✓ Restore drill passed — ${checked} documents survived backup → wipe → restore unchanged.`);
} catch (e) {
  console.error('Drill error:', e);
  failed = true;
} finally {
  rmSync(work, { recursive: true, force: true });
}
process.exit(failed ? 1 : 0);
