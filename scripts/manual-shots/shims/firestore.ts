// Fake firebase/firestore for the screenshot build: in-memory docs/collections, live listeners, equality `where`.
// The driver script seeds it through window.__demo (seedCollection / fireCollection / fireDoc / seedDoc).
interface Ref { path: string; id: string; filters?: { f: string; op: string; v: unknown }[] }
type Row = { id: string; data: Record<string, unknown> };
const w = window as unknown as { __demo: Record<string, unknown> };
w.__demo = w.__demo || {};
const listeners: { path: string; cb: (s: unknown) => void }[] = [];
const docStore = new Map<string, Record<string, unknown> | null>();
const collStore = new Map<string, Row[]>();
let auto = 0;
const ref = (path: string): Ref => ({ path, id: path.split('/').pop() ?? path });

function collSnap(path: string) {
  const docs = (collStore.get(path) ?? []).map((r) => ({ id: r.id, data: () => r.data, ref: ref(path + '/' + r.id) }));
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: (d: unknown) => void) => docs.forEach(fn), docChanges: () => [] };
}
function docSnap(path: string) {
  const data = docStore.get(path) ?? null;
  return { exists: () => data !== null, id: path.split('/').pop(), data: () => data ?? undefined, metadata: { fromCache: false } };
}
const d = w.__demo;
d.seedCollection = (path: string, rows: Record<string, unknown>[]) => {
  collStore.set(path, rows.map((r, i) => { const { id, ...data } = r as { id?: string }; return { id: id ?? path + '-' + i, data: data as Record<string, unknown> }; }));
  for (const r of collStore.get(path) ?? []) docStore.set(path + '/' + r.id, r.data);
};
d.fireCollection = (path: string, rows: Record<string, unknown>[]) => {
  (d.seedCollection as (p: string, r: Record<string, unknown>[]) => void)(path, rows);
  const snap = collSnap(path);
  for (const l of listeners) if (l.path === path) l.cb(snap);
};
d.seedDoc = (path: string, data: Record<string, unknown> | null) => { docStore.set(path, data); };
d.fireDoc = (path: string, data: Record<string, unknown> | null) => {
  docStore.set(path, data);
  for (const l of listeners) if (l.path === path) l.cb(docSnap(path));
};
d.hasListener = (path: string) => listeners.some((l) => l.path === path);
d.listenerPaths = () => listeners.map((l) => l.path);

export const collection = (_db: unknown, path: string) => ref(path);
export const doc = (a: unknown, ...segs: string[]) => {
  if (segs.length) return ref(segs.join('/'));
  return ref(((a as Ref | undefined)?.path ?? '') + '/auto-' + (++auto));
};
export const query = (base: Ref, ...clauses: unknown[]) => ({ ...base, filters: [...(base.filters ?? []), ...(clauses.filter((c) => c && (c as { f?: string }).f) as { f: string; op: string; v: unknown }[])] });
export const where = (f: string, op: string, v: unknown) => ({ f, op, v });
export const orderBy = () => ({});
export const limit = () => ({});
export const onSnapshot = (target: Ref, cb: (s: unknown) => void) => {
  const entry = { path: target.path, cb };
  listeners.push(entry);
  // collections that were already seeded answer immediately, like a real cache hit
  if (collStore.has(target.path)) setTimeout(() => cb(collSnap(target.path)), 0);
  else if (docStore.has(target.path)) setTimeout(() => cb(docSnap(target.path)), 0);
  return () => { const i = listeners.indexOf(entry); if (i >= 0) listeners.splice(i, 1); };
};
export const getDoc = async (t: Ref) => docSnap(t.path);
export const getDocs = async (t: Ref) => {
  let rows = collStore.get(t.path) ?? [];
  for (const f of t.filters ?? []) {
    if (f.op === '==') rows = rows.filter((r) => r.data[f.f] === f.v);
    else if (f.op === 'in') rows = rows.filter((r) => (f.v as unknown[]).includes(r.data[f.f]));
  }
  const docs = rows.map((r) => ({ id: r.id, data: () => r.data, ref: ref(t.path + '/' + r.id) }));
  return { docs, size: docs.length, empty: docs.length === 0, forEach: (fn: (x: unknown) => void) => docs.forEach(fn) };
};
export const getCountFromServer = async (t: Ref) => ({ data: () => ({ count: (collStore.get(t.path) ?? []).length }) });
export const addDoc = async () => ({ id: 'new-doc' });
export const updateDoc = async () => undefined;
export const setDoc = async () => undefined;
export const writeBatch = () => ({ update() {}, delete() {}, set() {}, commit: async () => undefined });
export const runTransaction = async (_db: unknown, fn: (t: unknown) => unknown) => fn({ get: async (t: Ref) => docSnap(t.path), update() {}, set() {} });
export const increment = (n: number) => n;
export const deleteField = () => undefined;
export const serverTimestamp = () => new Date();
export const waitForPendingWrites = async () => undefined;
export const initializeFirestore = () => ({});
export const persistentLocalCache = () => ({});
export const persistentMultipleTabManager = () => ({});
export const getFirestore = () => ({});
export type DocumentReference = Ref; export type DocumentSnapshot = unknown; export type FirestoreError = Error; export type Unsubscribe = () => void; export type Query = Ref;
