// Stand-in for src/firebase.ts when building the manual-screenshot bundle (no network, no real project).
export const app = {};
export const auth = { currentUser: { uid: 'demo' } };
export const db = {};
export const USERNAME_RE = /^[a-z0-9_.]{3,20}$/;
export const normalizeUsername = (raw: string) => raw.trim().toLowerCase();
export const usernameToEmail = (u: string) => `${u.trim().toLowerCase()}@demo.local`;
