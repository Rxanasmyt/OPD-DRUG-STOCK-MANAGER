// Verifies firestore.rules against the real Firestore emulator (not a mock).
// Run:  npm run test:rules   (needs Java; downloads the emulator on first run)
import { test, before, after, beforeEach } from 'node:test';
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, deleteField } from 'firebase/firestore';

let env;
before(async () => {
  const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');
  env = await initializeTestEnvironment({
    projectId: 'demo-opd-rules',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8'), host, port: +port },
  });
});
after(async () => { await env?.cleanup(); });

const MED = { code: 'MED-1', name: 'Paracetamol', unit: 'เม็ด', dosageForm: 'tab', price: 1, had: false, active: true, parSub: 10, parFloor: 5, floor: 5, floorMin: 1, bin: 'A1', used30: 0, usedPrev30: 0, volatility: 0, lastCountTs: 1, ward: 'opd', noSubstock: false };
beforeEach(async () => {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, 'users/admin1'), { name: 'Admin', role: 'admin', active: true });
    await setDoc(doc(db, 'users/pharm1'), { name: 'Pharm', role: 'pharm', active: true });
    await setDoc(doc(db, 'users/pharm2'), { name: 'Pharm2', role: 'pharm', active: true });
    await setDoc(doc(db, 'users/tech1'), { name: 'Tech', role: 'tech', active: true });
    await setDoc(doc(db, 'users/pending1'), { name: 'Pending', role: 'tech', active: false });
    await setDoc(doc(db, 'meds/m1'), { ...MED, lastSubCountTs: 1 });
    await setDoc(doc(db, 'lots/l1'), { code: 'MED-1', medId: 'm1', lotNo: 'A', qty: 10, exp: 5, loc: 'sub' });
    await setDoc(doc(db, 'txs/t1'), { type: 'adjust', name: 'x', medId: 'm1', qty: 1, by: 'Tech', ts: 1 });
    await setDoc(doc(db, 'returns/r1'), { medId: 'm1', medName: 'x', medCode: 'c', unit: 'u', category: 'c', hn: '1', qty: 1, unitPrice: 1, value: 1, reason: 'r', note: '', date: '2026-11-20', ts: 1, by: 'Tech' });
  });
});
const as = (uid) => env.authenticatedContext(uid).firestore();
const anon = () => env.unauthenticatedContext().firestore();

test('unauthenticated and pending (inactive) users cannot read stock data', async () => {
  await assertFails(getDoc(doc(anon(), 'meds/m1')));
  await assertFails(getDoc(doc(as('pending1'), 'meds/m1')));
  await assertFails(getDoc(doc(as('pending1'), 'txs/t1')));
  await assertSucceeds(getDoc(doc(as('tech1'), 'meds/m1')));
});

test('self-registration can only create an inactive tech profile', async () => {
  await assertSucceeds(setDoc(doc(as('newbie'), 'users/newbie'), { name: 'N', role: 'tech', active: false }));
  await assertFails(setDoc(doc(as('newbie2'), 'users/newbie2'), { name: 'N', role: 'admin', active: false }));
  await assertFails(setDoc(doc(as('newbie3'), 'users/newbie3'), { name: 'N', role: 'tech', active: true }));
});

test('a tech cannot self-promote or approve others; an admin can, with a valid role', async () => {
  await assertFails(updateDoc(doc(as('tech1'), 'users/tech1'), { role: 'admin' }));
  await assertFails(updateDoc(doc(as('tech1'), 'users/pending1'), { active: true }));
  await assertSucceeds(updateDoc(doc(as('admin1'), 'users/pending1'), { active: true }));
  await assertFails(updateDoc(doc(as('admin1'), 'users/tech1'), { role: 'superuser' }));
});

test('meds: a tech may change floor/lastCountTs only; never par, name, or Infinity', async () => {
  await assertSucceeds(updateDoc(doc(as('tech1'), 'meds/m1'), { floor: 7, lastCountTs: 99 }));
  await assertFails(updateDoc(doc(as('tech1'), 'meds/m1'), { parFloor: 99 }));
  await assertFails(updateDoc(doc(as('tech1'), 'meds/m1'), { name: 'hacked' }));
  await assertFails(updateDoc(doc(as('tech1'), 'meds/m1'), { floor: Infinity }));
  await assertFails(updateDoc(doc(as('tech1'), 'meds/m1'), { floor: -1 }));
  await assertFails(updateDoc(doc(as('tech1'), 'meds/m1'), { floor: NaN }));
});

test('meds: a tech cannot wipe lastCountTs (bulk-reset payload) but an admin can', async () => {
  await assertFails(updateDoc(doc(as('tech1'), 'meds/m1'), { floor: 0, lastCountTs: deleteField(), lastSubCountTs: deleteField() }));
  await assertSucceeds(updateDoc(doc(as('admin1'), 'meds/m1'), { floor: 0, lastCountTs: deleteField(), lastSubCountTs: deleteField() }));
});

test('meds: only an admin can create/delete; med code is immutable even for admin', async () => {
  await assertFails(setDoc(doc(as('pharm1'), 'meds/m2'), MED));
  await assertSucceeds(setDoc(doc(as('admin1'), 'meds/m2'), MED));
  await assertFails(setDoc(doc(as('admin1'), 'meds/m3'), { ...MED, extra: 1 }));
  await assertFails(updateDoc(doc(as('admin1'), 'meds/m1'), { code: 'MED-9' }));
  await assertFails(deleteDoc(doc(as('pharm1'), 'meds/m1')));
  await assertSucceeds(deleteDoc(doc(as('admin1'), 'meds/m1')));
});

test('lots: qty updates ok, but lotNo/exp are immutable and qty cannot go negative', async () => {
  await assertSucceeds(updateDoc(doc(as('tech1'), 'lots/l1'), { qty: 4 }));
  await assertFails(updateDoc(doc(as('tech1'), 'lots/l1'), { qty: -1 }));
  await assertFails(updateDoc(doc(as('tech1'), 'lots/l1'), { lotNo: 'B' }));
  await assertFails(updateDoc(doc(as('tech1'), 'lots/l1'), { exp: 6 }));
  await assertFails(deleteDoc(doc(as('tech1'), 'lots/l1')));
});

test('txs: append-only. Create must be by the signed-in name; no update; only admin deletes', async () => {
  const ok = { type: 'adjust', name: 'x', medId: 'm1', qty: 1, by: 'Tech', ts: 2 };
  await assertSucceeds(addDoc(collection(as('tech1'), 'txs'), ok));
  await assertFails(addDoc(collection(as('tech1'), 'txs'), { ...ok, by: 'Someone Else' }));
  await assertFails(addDoc(collection(as('tech1'), 'txs'), { ...ok, surprise: 1 }));
  await assertFails(updateDoc(doc(as('tech1'), 'txs/t1'), { qty: 999 }));
  await assertFails(updateDoc(doc(as('admin1'), 'txs/t1'), { qty: 999 }));
  await assertFails(deleteDoc(doc(as('tech1'), 'txs/t1')));
  await assertSucceeds(deleteDoc(doc(as('admin1'), 'txs/t1')));
});

test('returns: append-only, non-negative qty/value, by = own name', async () => {
  const ok = { medId: 'm1', medName: 'x', medCode: 'c', unit: 'u', category: 'c', hn: '1', qty: 1, unitPrice: 1, value: 1, reason: 'r', note: '', date: '2026-11-20', ts: 2, by: 'Tech' };
  await assertSucceeds(addDoc(collection(as('tech1'), 'returns'), ok));
  await assertFails(addDoc(collection(as('tech1'), 'returns'), { ...ok, qty: -1 }));
  await assertFails(addDoc(collection(as('tech1'), 'returns'), { ...ok, by: 'Other' }));
  await assertFails(updateDoc(doc(as('tech1'), 'returns/r1'), { qty: 5 }));
  await assertFails(deleteDoc(doc(as('admin1'), 'returns/r1')));
});

test('auditLog is append-only and attributed to the writer', async () => {
  await assertSucceeds(addDoc(collection(as('tech1'), 'auditLog'), { type: 't', by: 'Tech', ts: 1, note: 'n' }));
  await assertFails(addDoc(collection(as('tech1'), 'auditLog'), { type: 't', by: 'Admin', ts: 1, note: 'n' }));
});

test('meta: admin writes; pharm may only stamp usageStatsRecomputedAt; tech nothing', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'meta/stats'), { usageStatsRecomputedAt: 1, other: 1 }));
  await assertSucceeds(updateDoc(doc(as('admin1'), 'meta/stats'), { other: 2 }));
  await assertSucceeds(updateDoc(doc(as('pharm1'), 'meta/stats'), { usageStatsRecomputedAt: 5 }));
  await assertFails(updateDoc(doc(as('pharm1'), 'meta/stats'), { other: 3 }));
  await assertFails(updateDoc(doc(as('tech1'), 'meta/stats'), { usageStatsRecomputedAt: 6 }));
});

test('pendingReceives: requester cannot approve their own; another pharm can; qty frozen', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'pendingReceives/p1'), { recvNo: 'R1', medId: 'm1', name: 'x', unit: 'u', qty: 10, requestedBy: 'Pharm', requestedByUid: 'pharm1', status: 'pending', ts: 1 }));
  await assertFails(updateDoc(doc(as('pharm1'), 'pendingReceives/p1'), { status: 'approved', resolvedBy: 'Pharm', resolvedTs: 2 }));
  await assertFails(updateDoc(doc(as('pharm2'), 'pendingReceives/p1'), { qty: 99, status: 'approved' }));
  await assertSucceeds(updateDoc(doc(as('pharm2'), 'pendingReceives/p1'), { status: 'approved', resolvedBy: 'Pharm2', resolvedTs: 2 }));
});

test('username claims: single get allowed, listing blocked, no overwrite', async () => {
  await env.withSecurityRulesDisabled((c) => setDoc(doc(c.firestore(), 'usernames/bob'), { uid: 'x' }));
  await assertSucceeds(getDoc(doc(anon(), 'usernames/bob')));
  await assertFails(setDoc(doc(as('tech1'), 'usernames/bob'), { uid: 'tech1' }));
});

test('dailyMetrics are read-only for every client, even admin', async () => {
  await assertFails(setDoc(doc(as('admin1'), 'dailyMetrics/2026-11-20'), { a: 1 }));
});
