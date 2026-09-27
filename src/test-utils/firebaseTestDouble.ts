// Test double for the Firebase SDK surface AppContext.tsx uses. Loaded globally via
// vite.config.ts's test.setupFiles + this file's own vi.mock() calls below, so ANY test that
// imports AppContext (directly or via a screen) gets this instead of the real SDK — real
// onAuthStateChanged/onSnapshot/etc. would otherwise try to reach the actual production
// Firestore project this app's config points at (see src/firebase.ts's own comment: the
// config is public/non-secret, so nothing stops a test process from actually connecting).
// Never let a test suite talk to that project for real.
//
// Model: `onSnapshot`/`onAuthStateChanged` calls register a callback keyed by the collection/
// doc path string; this module exposes fireCollection()/fireDoc()/fireAuth() so a test can
// drive those callbacks itself and see how a screen reacts, with no real backend involved.
import { vi } from 'vitest';
import { waitFor } from '@testing-library/dom';

export type FakeDoc = { id: string; data: () => Record<string, unknown> };
type CollectionCb = (snap: { docs: FakeDoc[]; forEach: (fn: (d: FakeDoc) => void) => void }) => void;
type DocCb = (snap: { exists: () => boolean; id: string; data: () => Record<string, unknown> | undefined; metadata: { fromCache: boolean } }) => void;

interface Registered { path: string; cb: CollectionCb | DocCb }

const listeners: Registered[] = [];
let authListener: ((user: { uid: string } | null) => void) | null = null;

// A real doc/collection ref only needs to be an opaque, comparable token here — nothing in
// AppContext inspects its shape, it just threads it through to onSnapshot/getDoc/etc., all of
// which are mocked below to key off this same `.path` string instead of any real SDK internals.
function ref(path: string) { return { path }; }

// Backing store for one-shot reads (getDoc/getDocs, and a transaction's own trx.get()) — a
// SEPARATE thing from the onSnapshot listeners above, since AppContext's live-correctness fixes
// (FEFO lot lookups, the last-admin guard, phantom-stock rechecks) specifically read fresh via
// getDoc/getDocs/trx.get rather than trusting the onSnapshot cache. Keyed by the same `.path`
// string every ref resolves to; query()/where() stay no-ops (see the firestore/firestore mock
// below), so a getDocs() against a collection returns whatever was seeded for that exact path
// regardless of the where() clause used — same "supply exactly the rows you want" philosophy
// fireCollection() already uses for onSnapshot, and the reason every test using this keeps its
// queries against one collection path scoped to a single med/id at a time.
const docStore = new Map<string, Record<string, unknown> | null>();
const collectionStore = new Map<string, { id: string; data: Record<string, unknown> }[]>();

export function resetFirebaseTestDouble() {
  listeners.length = 0;
  authListener = null;
  docStore.clear();
  collectionStore.clear();
  lastTransactionWrites = [];
}

/** Seeds what a one-shot `getDoc(doc(db, ...segments))` or a transaction's `trx.get(...)` on
 * that same path returns. `data: null` simulates the doc not existing (`snap.exists() === false`
 * ). Path is the segments joined with '/', matching how `doc()` is mocked below (e.g.
 * `seedDoc('meds/m1', {...})`, `seedDoc('users/u2', {...})`). */
export function seedDoc(path: string, data: Record<string, unknown> | null) {
  docStore.set(path, data);
}

/** Seeds what a one-shot `getDocs(query(collection(db, path), where(...)))` returns for that
 * collection path — the where()/query() wrapper is a no-op here (see the mock below), so this
 * is the ONLY thing that determines the result; it does not re-filter by whatever `where()`
 * arguments the real code passed. `rows` are plain objects, `id` becomes the doc id (a generated
 * one if omitted). */
export function seedCollection(path: string, rows: (Record<string, unknown> & { id?: string })[]) {
  collectionStore.set(path, rows.map((r, i) => {
    const { id, ...data } = r;
    return { id: id ?? `${path}-seed-${i}`, data };
  }));
}

function readSeededDoc(path: string) {
  const data = docStore.has(path) ? docStore.get(path) : undefined;
  return { exists: () => data != null, id: path.split('/').pop() ?? path, data: () => data ?? undefined };
}

// Recorded update()/set() calls from the MOST RECENT runTransaction() — replaced fresh on
// every call, not accumulated across several actions in one test, so a test can commit one
// action and immediately assert exactly what it wrote (which doc, what fields) without needing
// to hand-thread a spy through AppContext itself.
export type TrxWrite = { kind: 'update' | 'set'; path: string; data: Record<string, unknown> };
let lastTransactionWrites: TrxWrite[] = [];
export function getLastTransactionWrites(): TrxWrite[] {
  return lastTransactionWrites;
}

/** Simulates the given COLLECTION path's live data changing — drives every onSnapshot
 * callback registered for that exact path via onSnapshot(collection(db, path), ...).
 * `rows` are plain objects; `id` (if present) becomes the doc id, otherwise one is generated. */
export function fireCollection(path: string, rows: (Record<string, unknown> & { id?: string })[]) {
  const docs: FakeDoc[] = rows.map((r, i) => {
    const { id, ...data } = r;
    return { id: id ?? `${path}-${i}`, data: () => data };
  });
  const snap = { docs, forEach: (fn: (d: FakeDoc) => void) => docs.forEach(fn) };
  for (const l of listeners) if (l.path === path) (l.cb as CollectionCb)(snap);
}

/** Simulates the given DOCUMENT path's live data changing — drives every onSnapshot callback
 * registered for that exact path via onSnapshot(doc(db, ...segments), ...). Pass `data: null`
 * to simulate the doc not existing. `fromCache` defaults to false (a confirmed server read —
 * see AppContext.tsx's own comment on why that matters for its debounce logic). */
export function fireDoc(path: string, data: Record<string, unknown> | null, opts: { fromCache?: boolean } = {}) {
  const id = path.split('/').pop() ?? path;
  const snap = { exists: () => data !== null, id, data: () => data ?? undefined, metadata: { fromCache: !!opts.fromCache } };
  for (const l of listeners) if (l.path === path) (l.cb as DocCb)(snap);
}

/** Simulates Firebase Auth resolving to `user` (or null for signed-out) — drives whatever
 * onAuthStateChanged callback AppContext registered on mount. */
export function fireAuth(user: { uid: string } | null) {
  authListener?.(user);
}

/** True once something has called onSnapshot(collection/doc(db, path), ...) — AppContext only
 * subscribes to most collections (meds, lots, txs, ...) once `authStatus === 'signedIn'`, and
 * that flip happens through a real, async React state update (signInAs()'s own patch() calls
 * aren't wrapped in `act()`, since they're simulating an external Firestore callback, not a
 * user event) — so a test firing a collection snapshot immediately after signInAs() can easily
 * race ahead of the effect that actually registers the listener. `await waitFor(() =>
 * expect(hasListener('meds')).toBe(true))` before firing is the fix; see AdjustScreen.test.tsx
 * for the pattern. */
export function hasListener(path: string): boolean {
  return listeners.some((l) => l.path === path);
}

/** Full happy-path sign-in: fires the auth callback, then — once AppContext has actually
 * subscribed to it (a real async React state update sits between the two, see hasListener()'s
 * doc comment) — the resulting `users/{uid}` doc snapshot as an active user. This is the exact
 * two-step sequence AppContext.tsx's real auth/profile effects wait for. Await this; once it
 * resolves, `state.authStatus === 'signedIn'`. */
export async function signInAs(uid: string, profile: { role: string; name: string; username: string; dept?: string; active?: boolean }) {
  fireAuth({ uid });
  await waitFor(() => { if (!hasListener(`users/${uid}`)) throw new Error('not subscribed yet'); });
  fireDoc(`users/${uid}`, { ...profile, active: profile.active ?? true }, { fromCache: false });
}

vi.mock('../firebase', () => ({
  auth: {},
  db: {},
  USERNAME_RE: /^[a-z0-9_.]{3,20}$/,
  normalizeUsername: (raw: string) => raw.trim().toLowerCase(),
  usernameToEmail: (u: string) => `${u.trim().toLowerCase()}@test.local`,
}));

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (u: { uid: string } | null) => void) => {
    authListener = cb;
    return () => { authListener = null; };
  },
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  signOut: vi.fn(),
  setPersistence: vi.fn(async () => undefined),
  browserLocalPersistence: {},
  browserSessionPersistence: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: (_db: unknown, path: string) => ref(path),
  doc: (_dbOrColl: unknown, ...segs: string[]) => ref(segs.join('/')),
  // query/where/orderBy/limit are no-ops here — tests supply exactly the rows they want via
  // fireCollection()/fireDoc() rather than exercising real filter/sort logic (that's what
  // selectors.test.ts already covers at the unit level).
  query: (base: { path: string }) => base,
  where: () => ({}),
  orderBy: () => ({}),
  limit: () => ({}),
  onSnapshot: (target: { path: string }, cb: CollectionCb | DocCb) => {
    const entry: Registered = { path: target.path, cb };
    listeners.push(entry);
    return () => {
      const i = listeners.indexOf(entry);
      if (i >= 0) listeners.splice(i, 1);
    };
  },
  getDoc: vi.fn(async (target: { path: string }) => readSeededDoc(target.path)),
  getDocs: vi.fn(async (target: { path: string }) => {
    const rows = collectionStore.get(target.path) ?? [];
    const docs: FakeDoc[] = rows.map((r) => ({ id: r.id, data: () => r.data }));
    return { docs, forEach: (fn: (d: FakeDoc) => void) => docs.forEach(fn) };
  }),
  addDoc: vi.fn(async () => ({ id: 'new-doc' })),
  updateDoc: vi.fn(async () => undefined),
  setDoc: vi.fn(async () => undefined),
  writeBatch: vi.fn(() => ({ update: vi.fn(), delete: vi.fn(), set: vi.fn(), commit: vi.fn(async () => undefined) })),
  // A transaction's own trx.get() reads from the same seeded doc store getDoc() does — the real
  // SDK guarantees a transaction sees a consistent snapshot as of when it starts, which matters
  // for real concurrent-write races but not for what these tests check (single-shot correctness
  // of the FEFO/last-admin/phantom-stock logic against a fixed snapshot, not the retry-on-
  // conflict behavior itself — that needs a real emulator, not this mock). update()/set() calls
  // are recorded into lastTransactionWrites so a test can assert exactly what got written.
  runTransaction: vi.fn(async (_db: unknown, fn: (trx: unknown) => unknown) => {
    const writes: TrxWrite[] = [];
    lastTransactionWrites = writes;
    return fn({
      get: vi.fn(async (target: { path: string }) => readSeededDoc(target.path)),
      update: vi.fn((target: { path: string }, data: Record<string, unknown>) => { writes.push({ kind: 'update', path: target.path, data }); }),
      set: vi.fn((target: { path: string }, data: Record<string, unknown>) => { writes.push({ kind: 'set', path: target.path, data }); }),
    });
  }),
  increment: (n: number) => n,
  deleteField: () => undefined,
  serverTimestamp: () => new Date(),
  waitForPendingWrites: vi.fn(async () => undefined),
}));
