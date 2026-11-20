// Fake firebase/auth for the screenshot build; the driver script calls window.__demo.fireAuth().
type Cb = (u: { uid: string } | null) => void;
const w = window as unknown as { __demo: Record<string, unknown> };
w.__demo = w.__demo || {};
let authCb: Cb | null = null;
w.__demo.fireAuth = (u: { uid: string } | null) => authCb?.(u);
w.__demo.hasAuthListener = () => !!authCb;
export const onAuthStateChanged = (_a: unknown, cb: Cb) => { authCb = cb; return () => { authCb = null; }; };
export const signInWithEmailAndPassword = async () => ({});
export const createUserWithEmailAndPassword = async () => ({});
export const signOut = async () => undefined;
export const updatePassword = async () => undefined;
export const setPersistence = async () => undefined;
export const browserLocalPersistence = {};
export const browserSessionPersistence = {};
export const getAuth = () => ({ currentUser: { uid: 'demo' } });
