import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
} from 'firebase/auth';
import {
  collection, doc, onSnapshot, query, orderBy, limit, where, writeBatch, addDoc, updateDoc, setDoc,
  runTransaction, getDocs, getDoc, increment, deleteField, type Transaction,
} from 'firebase/firestore';
import { auth, db, usernameToEmail, normalizeUsername, USERNAME_RE } from '../firebase';
import type {
  AppState, Med, Role, Screen, AdjType, RecvItem, TxType, AuditType, User, AuthMode, PendingReceive, Ward,
} from '../types';
import { seedInitialData } from '../data/seedFirestore';
import { subQty, fefoLot, roleLabelFor, suggestPar, suggestTransferQty, daysUntil, matchHosxpMed, DAY, wardOf, usesSubstock, floorMinOf, isSharedMed, matchesWard, binFor } from './selectors';
import { nf, thDate, isoDate, parseIntSafe, digitsOnly } from '../utils/format';
import { downloadCsv } from '../utils/csv';
import { encodeQr, parseQr } from '../utils/qr';
import { shortLabelName } from '../utils/labelName';
import { printLabelSheet, printPickListSheet, type PrintLabel } from '../utils/print';
import { parseHosxpUsageWorkbook, parseUsageCsvText, type RawUsageRow } from '../utils/usageImport';
import { LOCS } from '../data/locations';
import { withTimeout, TimeoutError } from '../utils/timeout';

// Caps navStack length so a session left open for days (this is a PWA people keep pinned,
// not something reloaded every visit) can't grow it unboundedly — nothing needs more than a
// handful of levels of "back" to make sense.
function pushNav(stack: Screen[], current: Screen): Screen[] {
  const next = stack.concat(current);
  return next.length > 20 ? next.slice(next.length - 20) : next;
}

// A lot's `code` is what a printed "ฉลาก lot" QR encodes AND what the damaged-label manual-
// entry fallback looks up by exact string match after forcing the typed input to uppercase
// (see parseQr/resolveMed) — so it needs to be (a) unique forever, not just within the batch
// it was minted in, and (b) stable under that uppercase normalization.
// Both call sites used to build this from `medId.slice(1) + a per-receive-batch loop index`
// (or Date.now()) — the index resets to 0 on every new receive, so receiving the SAME drug on
// two different days could mint the IDENTICAL lot code; and a Firestore auto-id is mixed-
// case, so a correctly hand-typed code (forced uppercase by the manual-entry path) could
// never match the mixed-case original stored in `code` — "กรอกรหัสด้วยมือ" was silently
// broken for most real lots. Built instead from the med's own human-readable `code` (already
// uppercase, already stable) plus the new lot document's own globally-unique ref id.
function genLotCode(medCode: string | undefined, medId: string, lotRefId: string): string {
  const base = (medCode || medId).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return 'LOT-' + base + '-' + lotRefId.slice(-6).toUpperCase();
}

/** `volatility` is the hidden safety-margin multiplier `suggestPar()` applies on top of the
 * plain daily-usage × cover-days math (see selectors.ts) — previously a fixed 1.1 for every
 * newly-added med and a random 1.05–1.40 for the original seeded formulary, with no UI to see
 * or change it, so a suggested par could never be reproduced by hand. Now user-editable; keep
 * it inside a sane range regardless of what gets typed in — 1.0 (no buffer) to 3.0 (a very
 * erratic-demand drug) covers every real case, and never let it collapse to 0 or negative
 * (which would zero out or invert the suggestion). */
function clampVolatility(v: number): number {
  if (!isFinite(v) || v <= 0) return 1;
  return Math.round(Math.min(3, Math.max(1, v)) * 100) / 100;
}

function normBin(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
}

function freshState(): AppState {
  return {
    meds: [], lots: [], txs: [], users: [], authLog: [], dbReady: false,

    authStatus: 'loading', authMode: 'login', myUid: null,
    authUsername: '', authPassword: '', authName: '', authDept: 'เภสัชกรรม', authError: null, authBusy: false, authRemember: true,

    screen: 'login', navStack: [], role: null, online: navigator.onLine, device: 'phone', pending: 0,

    cart: {}, search: '', filter: 'low', wardFilter: 'all',

    wmFromSearch: '', wmFromMed: null, wmToSearch: '', wmToMed: null, wmQty: '', wmReason: '',

    recvNo: 'REQ-6908-' + (140 + (Date.now() % 9)), recvSearch: '', recvMed: null, recvLot: '', recvExp: '', recvQty: '', recvItems: [],
    pendingReceives: [],

    adjType: null, adjSearch: '', adjMed: null, adjQty: '', adjReason: '', adjNote: '',

    reportTab: 'aging', labelType: 'med',

    qrOpen: false, qrManualOpen: false, qrCode: '', qrManualReason: '', qrPurpose: null, hadOk: {},

    doneKind: null, doneRows: [], toast: null,

    countInputs: {}, hosxpText: '', hosxpRows: null, hosxpConfirmFuzzy: false,

    usageDateFrom: '', usageDateTo: '', usageFileName: null, usageRows: null, usageConfirmFuzzy: false,

    medsFocusId: null,
    substockFocusId: null,

    adminTab: 'users', auditFilter: 'all',
    historyFrom: '', historyTo: '', historyResults: null, historyLoading: false,

    expiryWarnDays: 90, parFloorCoverDays: 3, parSubCoverDays: 21,

    confirmDialog: null,
  } as AppState;
}

export interface AppCtx {
  state: AppState;
  myProfile: User | null;
  theme: 'light' | 'dark';
  toggleTheme: () => void;
  sub: (medId: string) => number;
  fefo: (medId: string) => ReturnType<typeof fefoLot>;
  userName: () => string;
  roleLabel: () => string;
  roleLabelOf: (r: Role) => string;
  warn: () => number;
  toast: (t: string) => void;
  /** Answers the currently-shown in-app confirm dialog (state.confirmDialog) — see
   * ConfirmDialog.tsx. */
  respondConfirm: (v: boolean) => void;
  go: (s: Screen) => void;
  back: () => void;

  // auth
  setAuthMode: (m: AuthMode) => void;
  setAuthUsername: (v: string) => void;
  setAuthPassword: (v: string) => void;
  setAuthName: (v: string) => void;
  setAuthDept: (v: string) => void;
  setAuthRemember: (v: boolean) => void;
  signIn: () => void;
  signUp: () => void;
  logout: () => void;
  setDevice: (d: 'phone' | 'tablet') => void;
  seedDatabase: () => void;

  // transfer
  setSearch: (v: string) => void;
  setFilter: (f: AppState['filter']) => void;
  setWardFilter: (w: AppState['wardFilter']) => void;
  bump: (id: string, d: number) => void;
  setCartQty: (id: string, raw: string) => void;
  fillAll: () => void;
  printPickList: () => void;
  printTodayReplenishList: () => void;
  printWarehouseRequestList: () => void;
  removeFromCart: (id: string) => void;
  commitTransfer: () => void;

  // receive
  setRecvNo: (v: string) => void;
  setRecvSearch: (v: string) => void;
  pickRecvMed: (medId: string) => void;
  setRecvLot: (v: string) => void;
  setRecvExp: (v: string) => void;
  setRecvQty: (v: string) => void;
  addRecv: () => void;
  removeRecvItem: (i: number) => void;
  commitReceive: () => void;
  approvePendingReceive: (id: string) => void;
  rejectPendingReceive: (id: string, reason: string) => void;
  goReceiveFor: (medId: string) => void;

  // ward move
  setWmFromSearch: (v: string) => void;
  pickWmFromMed: (medId: string) => void;
  setWmToSearch: (v: string) => void;
  pickWmToMed: (medId: string) => void;
  setWmQty: (v: string) => void;
  setWmReason: (v: string) => void;
  commitWardMove: () => void;

  // adjust
  pickAdjType: (t: AdjType) => void;
  setAdjSearch: (v: string) => void;
  pickAdjMed: (medId: string) => void;
  setAdjQty: (v: string) => void;
  setAdjReason: (v: string) => void;
  setAdjNote: (v: string) => void;
  commitAdjust: () => void;
  scrapLot: (lotId: string) => void;

  // report
  setReportTab: (t: AppState['reportTab']) => void;
  exportReportCsv: () => void;

  // labels
  setLabelType: (t: AppState['labelType']) => void;
  printLabels: () => void;

  // settings / par
  applyOnePar: (medId: string, which: 'sub' | 'floor') => void;
  applyAllSuggested: () => void;
  setParSub: (medId: string, v: string) => void;
  setParFloor: (medId: string, v: string) => void;
  setMedBin: (medId: string, v: string) => void;
  recomputeUsageStats: () => void;
  updateGlobalSettings: (patch: Partial<{ expiryWarnDays: number; parFloorCoverDays: number; parSubCoverDays: number }>) => void;

  // meds (formulary) management
  addMed: (input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; bin: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility?: number; shared?: boolean; binIpd?: string }) => void;
  updateMedFull: (medId: string, input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; bin: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility: number; shared?: boolean; binIpd?: string }) => void;
  /** Merges an existing OPD/IPD ward-pair (same name, one 'opd' one 'ipd' record) into a
   * single pooled record — see Med.binIpd. Survives as the OPD-ward record with the IPD
   * record's bin code carried over as `binIpd`; floor/used30/usedPrev30 are summed (not
   * re-derived — see mergeWardMeds() for why); the IPD record's lots are reassigned onto the
   * survivor, then it's deactivated with its floor zeroed. Irreversible from the UI. */
  mergeWardMeds: (medIdA: string, medIdB: string) => void;
  /** mergeWardMeds() applied to every still-separate OPD/IPD pair in the formulary at once —
   * "รวมกันเลย" instead of clicking through each pair one at a time. */
  mergeAllWardPairs: () => void;
  /** Flips every active, not-yet-shared med to shared in one go — the fix for a formulary
   * that has no separate IPD records at all yet (mergeAllWardPairs finds nothing to fold
   * together there, since there's no second record's stock to combine). */
  shareAllMeds: () => void;
  toggleMedActive: (medId: string) => void;
  deleteMed: (medId: string) => void;
  deleteAllInactiveMeds: (medIds?: string[]) => void;
  setMedsFocusId: (id: string | null) => void;
  goSubstockCardFor: (medId: string) => void;
  setSubstockFocusId: (id: string | null) => void;

  // count
  fetchSubstockLedger: (medId: string) => Promise<{ ts: number; type: string; qty: number; note: string; by: string; balance: number }[]>;
  setCountInput: (medId: string, v: string) => void;
  commitCount: (medId: string) => void;

  // hosxp reconcile
  setHosxpText: (v: string) => void;
  processHosxp: () => void;
  processHosxpFile: (file: File) => void;
  setHosxpConfirmFuzzy: (v: boolean) => void;
  commitReconcile: () => void;

  // usage-rate import (par)
  setUsageDateFrom: (v: string) => void;
  setUsageDateTo: (v: string) => void;
  importUsageFile: (file: File) => void;
  setUsageConfirmFuzzy: (v: boolean) => void;
  clearUsageImport: () => void;
  commitUsageImport: () => void;

  // qr
  openScanSearch: (purpose: string) => void;
  closeQr: () => void;
  qrDecoded: (raw: string, manual?: boolean) => void;
  qrManual: () => void;
  setQrCode: (v: string) => void;
  setQrManualReason: (v: string) => void;
  startHadScan: (medId: string) => void;

  // done
  doneAgain: () => void;

  // admin
  setAdminTab: (t: AppState['adminTab']) => void;
  setAuditFilter: (f: AppState['auditFilter']) => void;
  setUserRole: (id: string, r: Role) => void;
  toggleUserActive: (id: string) => void;
  exportAudit: () => void;
  setHistoryFrom: (v: string) => void;
  setHistoryTo: (v: string) => void;
  searchHistory: () => void;
  clearHistorySearch: () => void;
}

const Ctx = createContext<AppCtx | null>(null);

const AUTH_ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'ชื่อผู้ใช้ไม่ถูกต้อง',
  'auth/user-disabled': 'บัญชีนี้ถูกปิดใช้งาน',
  'auth/user-not-found': 'ไม่พบบัญชีนี้',
  'auth/wrong-password': 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
  'auth/invalid-credential': 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
  'auth/email-already-in-use': 'ชื่อผู้ใช้นี้มีคนใช้แล้ว',
  'auth/weak-password': 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร',
  'auth/too-many-requests': 'ลองผิดหลายครั้งเกินไป กรุณารอสักครู่แล้วลองใหม่',
  'auth/network-request-failed': 'เชื่อมต่อเครือข่ายไม่ได้ ลองใหม่อีกครั้ง',
};
function authErrorMessage(e: unknown): string {
  if (e instanceof TimeoutError) return e.message;
  const code = (e as { code?: string })?.code || '';
  return AUTH_ERROR_MESSAGES[code] || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(freshState);
  const [myProfile, setMyProfile] = useState<User | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const parDebounce = useRef<Record<string, number>>({});
  const binDebounce = useRef<Record<string, number>>({});
  // par/bin edits are debounced 500ms so typing a new number doesn't fire a write per
  // keystroke — but a debounce is a real data-loss window: someone types a new par level,
  // taps back or locks the phone within that 500ms, and on many mobile browsers a
  // backgrounded tab's pending setTimeout just never fires. Every debounced write below
  // registers its not-yet-fired callback here (keyed the same as its timer) so the
  // visibility/pagehide flush effect further down can run it immediately instead of losing
  // it, whenever the page is about to actually disappear.
  const pendingFlush = useRef<Record<string, () => void>>({});

  // Every write-side commit action below runs its Firestore work through this instead of
  // calling runTransaction directly. A bare runTransaction can hang indefinitely when the
  // browser reports "online" but can't actually reach Firestore (hospital wifi captive
  // portal, a flaky access point) — the SDK just keeps retrying internally with no ceiling of
  // its own, leaving a "กำลังบันทึก" action spinning forever with no way to know if it worked.
  // withTimeout races it against a 15s clock so that failure mode surfaces as a clear error
  // instead of a silent hang.
  const runTx = useCallback(<T,>(fn: (trx: Transaction) => Promise<T>) => withTimeout(runTransaction(db, fn)), []);

  // None of the commit-style buttons (ยืนยันการเติมหน้างาน, อนุมัติรับเข้า, บันทึกปรับยอด,
  // etc.) disabled themselves while their async Firestore work was in flight — a fast double
  // tap (very real on a touchscreen, more likely still with any network latency before the
  // screen navigates away) could fire the same commit function twice before React ever
  // re-renders, running two independent transactions against the same cart/lot/floor and
  // silently double-deducting real stock. Wrapping the function itself (not just the button)
  // closes this regardless of how a second invocation might happen — a stray double bind, a
  // second event listener, not just a literal double-tap. Keyed so unrelated items (e.g.
  // approving two different pending receives) don't block each other, only a genuine repeat
  // of the exact same action.
  const busyKeys = useRef<Set<string>>(new Set());
  const guardOnce = useCallback(<A extends unknown[]>(key: string, fn: (...args: A) => Promise<void>) => {
    return async (...args: A) => {
      const k = args.length ? key + ':' + String(args[0]) : key;
      if (busyKeys.current.has(k)) return;
      busyKeys.current.add(k);
      try { await fn(...args); } finally { busyKeys.current.delete(k); }
    };
  }, []);

  // ---------- theme (light/dark) — a per-device UI preference, not app data, so it lives in
  // localStorage rather than Firestore. Defaults to the OS/browser preference on first visit,
  // then whatever the person picked via the toggle from then on. ----------
  const [theme, setThemeState] = useState<'light' | 'dark'>(() => {
    try {
      const saved = localStorage.getItem('opd-theme');
      if (saved === 'light' || saved === 'dark') return saved;
    } catch { /* localStorage unavailable (private mode etc.) — fall through to OS preference */ }
    return typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  });
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    try { localStorage.setItem('opd-theme', theme); } catch { /* ignore */ }
  }, [theme]);
  const toggleTheme = useCallback(() => setThemeState((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const patch = useCallback((p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
  }, []);

  // ---------- network status (real, not simulated) ----------
  useEffect(() => {
    const on = () => patch({ online: true });
    const off = () => patch({ online: false });
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, [patch]);

  // ---------- flush any debounced par/bin write immediately once the page is about to
  // disappear (tab closed, app backgrounded, phone locked) — see pendingFlush above. This is
  // the only defense against losing the tail end of a 500ms debounce; 'pagehide' covers the
  // actual close/navigate-away, 'visibilitychange' additionally covers a phone browser that
  // suspends timers the instant a tab is backgrounded, before pagehide would otherwise fire.
  useEffect(() => {
    const flushAll = () => {
      const fns = Object.values(pendingFlush.current);
      pendingFlush.current = {};
      fns.forEach((fn) => fn());
    };
    const onVisibility = () => { if (document.visibilityState === 'hidden') flushAll(); };
    window.addEventListener('pagehide', flushAll);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('pagehide', flushAll);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  // ---------- auth: who is signed in ----------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (!fbUser) {
        patch({ authStatus: 'signedOut', myUid: null, role: null, screen: 'login', navStack: [] });
        setMyProfile(null);
      } else {
        patch({ myUid: fbUser.uid });
      }
    });
    return unsub;
  }, [patch]);

  // ---------- auth: my own profile doc (works even before approval) ----------
  useEffect(() => {
    if (!state.myUid) return;
    // The Firestore client here runs on a persistent (IndexedDB) local cache, which can
    // legitimately serve a STALE or incomplete cached copy of this exact doc for the very
    // first snapshot — e.g. cached from before this account was approved on this device, or
    // a partial write that hadn't fully synced — and correct itself moments later once the
    // real server snapshot arrives. Left ungated, that shows "รอ Admin อนุมัติบัญชี" for a
    // flash on every single login before self-correcting into the app, which reads as a bug
    // even though it resolves on its own. So: a snapshot that upgrades to signedIn applies
    // immediately (no reason to delay good news), but one that downgrades to pendingApproval/
    // signedOut is debounced — only committed if a better snapshot doesn't show up shortly
    // after to cancel it. A genuine pending/deactivated account still lands there correctly,
    // just ~0.6s later; nothing here can mask a real, lasting deactivation.
    let downgradeTimer: number | undefined;
    const clearDowngrade = () => window.clearTimeout(downgradeTimer);
    const unsub = onSnapshot(
      doc(db, 'users', state.myUid),
      (snap) => {
        if (!snap.exists()) {
          clearDowngrade();
          downgradeTimer = window.setTimeout(() => patch({ authStatus: 'signedOut' }), 600);
          return;
        }
        const profile = { id: snap.id, ...snap.data() } as User;
        if (profile.active) {
          clearDowngrade();
          setMyProfile(profile);
          // Bug fixed previously: authStatus flipping to 'signedIn' never moved `screen` off
          // its initial/post-logout value of 'login', landing on a blank home screen until
          // the person tapped "หน้าหลัก" themselves. Land on 'home' only from that specific
          // state, so a live profile update mid-workflow doesn't yank them back to home.
          patch((st) => ({ role: profile.role, authStatus: 'signedIn', screen: st.screen === 'login' ? 'home' : st.screen }));
          return;
        }
        clearDowngrade();
        downgradeTimer = window.setTimeout(() => {
          setMyProfile(profile);
          patch({ role: null, authStatus: 'pendingApproval' });
        }, 600);
      },
      () => { clearDowngrade(); patch({ authStatus: 'signedOut' }); },
    );
    return () => { clearDowngrade(); unsub(); };
  }, [state.myUid, patch]);

  const sub = useCallback((medId: string) => subQty(state, medId), [state]);
  const fefo = useCallback((medId: string) => fefoLot(state, medId), [state]);
  const userName = useCallback(() => myProfile?.name || '', [myProfile]);
  const canEditPar = myProfile?.role !== 'tech';
  const roleLabel = useCallback(() => roleLabelFor(state.role), [state.role]);
  const roleLabelOf = useCallback((r: Role) => roleLabelFor(r), []);
  const warn = useCallback(() => state.expiryWarnDays, [state.expiryWarnDays]);

  const toast = useCallback((t: string) => {
    patch({ toast: t });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => patch({ toast: null }), 2600);
  }, [patch]);

  // In-app replacement for window.confirm() — see confirmDialog's doc comment in types.ts for
  // why: the native dialog can silently no-op inside some embedded WebView/PWA contexts,
  // which reads to the person tapping the button as "nothing happened", not as an error (there
  // is no error — the promise just resolves false, or the call never even shows a prompt,
  // depending on the host). ConfirmDialog.tsx renders the actual UI; this just parks the
  // resolver until respondConfirm() fires it.
  const confirmResolveRef = useRef<((v: boolean) => void) | null>(null);
  const confirmAsync = useCallback((message: string) => {
    return new Promise<boolean>((resolve) => {
      // A second confirm requested while one's already showing would leak the first
      // resolver forever (never called) — resolve it false first so nothing hangs.
      if (confirmResolveRef.current) confirmResolveRef.current(false);
      confirmResolveRef.current = resolve;
      patch({ confirmDialog: { message } });
    });
  }, [patch]);
  const respondConfirm = useCallback((v: boolean) => {
    const resolve = confirmResolveRef.current;
    confirmResolveRef.current = null;
    patch({ confirmDialog: null });
    if (resolve) resolve(v);
  }, [patch]);

  // ---------- live data: only once approved ----------
  useEffect(() => {
    if (state.authStatus !== 'signedIn') return;
    // Every listener here used to have no error callback — a permission-denied (e.g. rules
    // edited without redeploying the app) or a persistent-cache fault would fail the
    // subscription silently, with nothing on screen ever explaining why data stopped
    // updating. The 'meds' one is the worst case: it's what flips dbReady, so a silent
    // failure there left the person stuck on "กำลังโหลดข้อมูล…" forever with no way out
    // short of knowing to reload — the same class of bug as the earlier stuck-loading report,
    // just from a different cause. Now every listener logs and surfaces one shared toast (not
    // one per collection, which would just be noise if several fail from the same root cause),
    // and 'meds' failing still flips dbReady so the person at least reaches a real screen
    // instead of an infinite spinner, where the "ยังไม่มีข้อมูลยาในระบบ"/reload path can recover.
    let toasted = false;
    const onErr = (label: string) => (e: unknown) => {
      console.error(`onSnapshot(${label}) failed:`, e);
      if (!toasted) {
        toasted = true;
        toast('เชื่อมต่อข้อมูลบางส่วนไม่สำเร็จ — ลองโหลดหน้าใหม่ ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบ');
      }
      if (label === 'meds') patch({ dbReady: true });
    };
    const unsubs = [
      onSnapshot(collection(db, 'meds'), (snap) => {
        patch({ meds: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Med[], dbReady: true });
      }, onErr('meds')),
      onSnapshot(collection(db, 'lots'), (snap) => {
        patch({ lots: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AppState['lots'] });
      }, onErr('lots')),
      onSnapshot(query(collection(db, 'txs'), orderBy('ts', 'desc'), limit(300)), (snap) => {
        patch({ txs: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AppState['txs'] });
      }, onErr('txs')),
      onSnapshot(query(collection(db, 'auditLog'), orderBy('ts', 'desc'), limit(300)), (snap) => {
        patch({ authLog: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AppState['authLog'] });
      }, onErr('auditLog')),
      // Receives submitted by a ผู้ช่วยเภสัชกร (tech) sit here until a pharmacist/admin
      // approves them — everyone who can see the receive screen needs the live list (tech
      // to see their own request's status, pharm/admin to actually act on it).
      onSnapshot(query(collection(db, 'pendingReceives'), orderBy('ts', 'desc'), limit(200)), (snap) => {
        const rows = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as PendingReceive[];
        patch({ pendingReceives: rows, pending: rows.filter((r) => r.status === 'pending').length });
      }, onErr('pendingReceives')),
      // Bug fix: expiryWarnDays/parFloorCoverDays/parSubCoverDays used to be pure client-side
      // constants baked into freshState() with no way to ever change them — the "เกณฑ์แจ้งเตือน
      // วันหมดอายุ"/"par อัตโนมัติ" cards in หน้าตั้งค่า displayed them as if they were real,
      // saved settings (that's literally what the screen is called) but were just showing
      // dead numbers. Missing doc on a fresh project is expected and not an error — freshState
      // already has sane defaults, so a snapshot with no data simply leaves them as-is.
      onSnapshot(doc(db, 'meta', 'settings'), (snap) => {
        if (!snap.exists()) return;
        const d = snap.data() as Partial<{ expiryWarnDays: number; parFloorCoverDays: number; parSubCoverDays: number }>;
        patch((st) => ({
          expiryWarnDays: typeof d.expiryWarnDays === 'number' ? d.expiryWarnDays : st.expiryWarnDays,
          parFloorCoverDays: typeof d.parFloorCoverDays === 'number' ? d.parFloorCoverDays : st.parFloorCoverDays,
          parSubCoverDays: typeof d.parSubCoverDays === 'number' ? d.parSubCoverDays : st.parSubCoverDays,
        }));
      }, onErr('settings')),
    ];
    if (myProfile?.role === 'admin') {
      unsubs.push(onSnapshot(collection(db, 'users'), (snap) => {
        patch({ users: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as User[] });
      }, onErr('users')));
    }
    return () => unsubs.forEach((u) => u());
  }, [state.authStatus, myProfile?.role, patch, toast]);

  const go = useCallback((s: Screen) => setState((st) => ({ ...st, screen: s, navStack: pushNav(st.navStack, st.screen) })), []);
  // Pops the real history stack instead of a single fixed "came from" pointer — see navStack
  // on AppState. Bug this replaced: back() used to hardcode every screen except tconfirm to
  // return to 'more', which only happened to be right for screens always opened from the More
  // menu — pressing back from ปรับยอด after tapping Home's "ตัดออก" landed on the More menu (a
  // screen the person never visited) instead of back on Home, same for จัดการรายการยา opened
  // from ตั้งค่า, and บัตรสต็อก substock opened from the "สำเร็จ" screen after a เติมหน้างาน.
  const back = useCallback(() => setState((st) => {
    const stack = st.navStack.slice();
    const prev = stack.pop();
    return { ...st, screen: prev || 'more', navStack: stack };
  }), []);

  const logAudit = useCallback(async (entry: { type: AuditType; note: string }) => {
    try { await addDoc(collection(db, 'auditLog'), { ...entry, by: userName(), ts: Date.now() }); }
    catch (e) { console.error('audit log write failed:', e); toast('บันทึกลง audit log ไม่สำเร็จ — รายการหลักบันทึกแล้ว แต่ประวัตินี้อาจหายไป'); }
  }, [userName, toast]);

  const logTx = useCallback(async (tx: Omit<import('../types').Tx, 'id' | 'ts' | 'by'>) => {
    try { await addDoc(collection(db, 'txs'), { ...tx, by: userName(), ts: Date.now() }); }
    catch (e) { console.error('tx log write failed:', e); toast('บันทึกประวัติธุรกรรมไม่สำเร็จ — ยอดสต็อกอัปเดตแล้ว แต่ไม่มีบันทึกรายการนี้ในประวัติ'); }
  }, [userName, toast]);

  // Shared tail for every commit-style catch block below — logs the real error, but shows
  // the person a TimeoutError's specific "connection stalled" message instead of the
  // function's usual generic failure message, since that one case has a genuinely different
  // recommended action (check your connection) than "something went wrong, try again".
  const toastErr = useCallback((e: unknown, fallback: string) => {
    console.error(e);
    toast(e instanceof TimeoutError ? e.message : fallback);
  }, [toast]);

  // ---------- auth actions ----------
  const setAuthMode = useCallback((m: AuthMode) => patch({ authMode: m, authError: null }), [patch]);
  const setAuthUsername = useCallback((v: string) => patch({ authUsername: v }), [patch]);
  const setAuthPassword = useCallback((v: string) => patch({ authPassword: v }), [patch]);
  const setAuthName = useCallback((v: string) => patch({ authName: v }), [patch]);
  const setAuthDept = useCallback((v: string) => patch({ authDept: v }), [patch]);
  const setAuthRemember = useCallback((v: boolean) => patch({ authRemember: v }), [patch]);

  const signIn = useCallback(async () => {
    const username = normalizeUsername(state.authUsername);
    const password = state.authPassword;
    if (!username || !password) { patch({ authError: 'กรอกชื่อผู้ใช้และรหัสผ่าน' }); return; }
    patch({ authBusy: true, authError: null });
    try {
      // "จดจำการเข้าใช้" — a real choice, not decoration: local persistence survives closing
      // the browser/tab (the default, and what most shared ward devices want); session
      // persistence signs out the moment the tab/browser closes, for a shared/kiosk device
      // where staying logged in would hand the next person someone else's session.
      await setPersistence(auth, state.authRemember ? browserLocalPersistence : browserSessionPersistence);
      const cred = await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
      await setDoc(doc(db, 'users', cred.user.uid), { lastLogin: Date.now() }, { merge: true });
    } catch (e) {
      patch({ authError: authErrorMessage(e) });
    } finally {
      patch({ authBusy: false });
    }
  }, [state.authUsername, state.authPassword, state.authRemember, patch]);

  const signUp = useCallback(async () => {
    const username = normalizeUsername(state.authUsername);
    const password = state.authPassword;
    const name = state.authName.trim();
    const dept = state.authDept.trim() || 'เภสัชกรรม';
    if (!username || !password || !name) { patch({ authError: 'กรอกชื่อ ชื่อผู้ใช้ และรหัสผ่านให้ครบ' }); return; }
    if (!USERNAME_RE.test(username)) { patch({ authError: 'ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษเล็ก ตัวเลข . หรือ _ ยาว 3-20 ตัว' }); return; }
    if (password.length < 6) { patch({ authError: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' }); return; }
    patch({ authBusy: true, authError: null });
    try {
      const takenSnap = await getDoc(doc(db, 'usernames', username));
      if (takenSnap.exists()) { patch({ authError: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' }); return; }

      const cred = await createUserWithEmailAndPassword(auth, usernameToEmail(username), password);
      try {
        const profile: Omit<User, 'id'> = { username, name, role: 'tech', dept, active: false, createdAt: Date.now(), lastLogin: null };
        const batch = writeBatch(db);
        batch.set(doc(db, 'users', cred.user.uid), profile);
        batch.set(doc(db, 'usernames', username), { uid: cred.user.uid });
        await withTimeout(batch.commit());
      } catch (inner) {
        // Someone else claimed this username in the split second between our
        // check and here — undo the orphaned Auth account so they can retry.
        await cred.user.delete().catch(() => {});
        throw inner;
      }
    } catch (e) {
      patch({ authError: authErrorMessage(e) });
    } finally {
      patch({ authBusy: false });
    }
  }, [state.authUsername, state.authPassword, state.authName, state.authDept, patch]);

  const logout = useCallback(() => { signOut(auth); patch({ cart: {}, authUsername: '', authPassword: '' }); }, [patch]);
  const setDevice = useCallback((d: 'phone' | 'tablet') => patch({ device: d }), [patch]);

  const seedDatabase = useCallback(async () => {
    toast('กำลังโหลดข้อมูลตั้งต้น…');
    try {
      const r = await seedInitialData();
      toast(`โหลดข้อมูลตั้งต้นแล้ว: ยา ${r.meds} รายการ, lot ${r.lots} รายการ`);
      logAudit({ type: 'par_updated', note: 'เริ่มต้นฐานข้อมูลยา (' + r.meds + ' รายการ) และ lot (' + r.lots + ' รายการ)' });
    } catch (e) {
      toast('โหลดข้อมูลตั้งต้นไม่สำเร็จ: ' + authErrorMessage(e));
    }
  }, [toast, logAudit]);

  // ---------- transfer ----------
  const setSearch = useCallback((v: string) => patch({ search: v }), [patch]);
  const setFilter = useCallback((f: AppState['filter']) => patch({ filter: f }), [patch]);
  const setWardFilter = useCallback((w: AppState['wardFilter']) => patch({ wardFilter: w }), [patch]);

  const bump = useCallback((id: string, d: number) => {
    setState((st) => {
      const m = st.meds.find((x) => x.id === id);
      if (!m) return st;
      const cap = subQty(st, id);
      const step = m.parFloor >= 500 ? 100 : m.parFloor >= 100 ? 10 : 1;
      const cur = st.cart[id] || 0;
      let v = cur === 0 && d > 0 ? suggestTransferQty(st, m) : cur + d * step;
      v = Math.max(0, Math.min(cap, v));
      const cart = { ...st.cart };
      if (v <= 0) delete cart[id]; else cart[id] = v;
      return { ...st, cart };
    });
  }, []);

  const setCartQty = useCallback((id: string, raw: string) => {
    setState((st) => {
      const cap = subQty(st, id);
      const v = Math.max(0, Math.min(cap, parseIntSafe(raw)));
      const cart = { ...st.cart };
      if (v <= 0) delete cart[id]; else cart[id] = v;
      return { ...st, cart };
    });
  }, []);

  const removeFromCart = useCallback((id: string) => {
    setState((st) => { const c = { ...st.cart }; delete c[id]; return { ...st, cart: c }; });
  }, []);

  const fillAll = useCallback(() => {
    setState((st) => {
      const cart = { ...st.cart };
      // Ward-scoped on purpose: OPD and IPD shelves are stocked by different people at
      // different times with different drugs (this is the actual morning routine being
      // digitized) — "เติมตาม par ทั้งหมด" while looking at the IPD tab should never quietly
      // queue up OPD items too, or vice versa. Respects whatever ward tab is currently open;
      // 'all' (no ward filter applied) fills everything, matching the old behavior.
      st.meds.forEach((m) => {
        if (!matchesWard(m, st.wardFilter)) return;
        // Real min-max: only pick items actually at/below their reorder point (Min), not
        // anything a hair under capacity (Max) — that's the whole point of having the two be
        // different numbers instead of one target chasing two jobs.
        if (m.floor < floorMinOf(m)) { const q = suggestTransferQty(st, m); if (q > 0) cart[m.id] = q; }
      });
      return { ...st, cart, filter: 'low' };
    });
    toast('ใส่จำนวนตาม par ให้ทุกรายการที่ต่ำกว่าเกณฑ์แล้ว — ปรับได้ก่อนยืนยัน');
  }, [toast]);

  // "Auto Pick-List" — a printable, sorted-by-bin checklist of exactly what's in the current
  // fill cart, meant to be carried while walking the substock shelves so nobody has to
  // re-read the app screen-by-screen mid-walk (or worse, re-estimate by eye, the exact habit
  // this whole cart/fillAll flow exists to replace).
  const printPickList = useCallback(() => {
    const ids = Object.keys(state.cart);
    if (!ids.length) { toast('ยังไม่มีรายการในตะกร้า — เติมจำนวนหรือกด "เติมตาม par ทั้งหมด" ก่อน'); return; }
    const rows = ids
      .map((id) => state.meds.find((m) => m.id === id))
      .filter((m): m is Med => !!m)
      .map((m) => ({ bin: binFor(m, state.wardFilter === 'ipd' ? 'ipd' : 'opd'), name: m.name, qty: state.cart[m.id], unit: m.unit }));
    const wardLabel = state.wardFilter === 'opd' ? 'OPD' : state.wardFilter === 'ipd' ? 'IPD' : 'ทุกหอผู้ป่วย';
    const ok = printPickListSheet(rows, 'ใบจัดยาเติมชั้น — ' + wardLabel, 'หอผู้ป่วย: ' + wardLabel);
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state.cart, state.meds, state.wardFilter, toast]);

  // The daily version of the above — "วันนี้ต้องเติมอะไรบ้าง" printed straight from current
  // floor-vs-Min numbers, with zero dependence on the cart. A จพ.เภสัช doing the morning walk
  // shouldn't have to open the app, tap "เติมตาม par ทั้งหมด" to build a cart, then print,
  // just to get a checklist to carry — this is that same suggested-qty logic (same target:
  // parFloor/"Max", same cap: what substock actually has), one tap, cart untouched. Same
  // ward-scoping as fillAll: only the currently-selected ward tab's items print.
  const printTodayReplenishList = useCallback(() => {
    const wardLabel = state.wardFilter === 'opd' ? 'OPD' : state.wardFilter === 'ipd' ? 'IPD' : 'ทุกหอผู้ป่วย';
    const items = state.meds.filter((m) => m.active && usesSubstock(m)
      && matchesWard(m, state.wardFilter)
      && m.floor < floorMinOf(m));
    if (!items.length) { toast('วันนี้ไม่มีรายการที่ต่ำกว่าจุดต้องเติม (Min) — ยังไม่ต้องเติมหน้างาน'); return; }
    const labelWard = state.wardFilter === 'ipd' ? 'ipd' : 'opd';
    const rows = items
      .map((m) => {
        const need = Math.max(0, m.parFloor - m.floor);
        const qty = suggestTransferQty(state, m);
        // suggestTransferQty caps at what's actually in substock — flag it on the sheet
        // itself when that cap bit, so picking every row here still won't quietly leave the
        // shelf under par; the person carrying this sheet should know to also flag it for
        // the next "เบิกจากคลังใหญ่" run instead of assuming the job's done.
        const note = qty < need ? 'substock เหลือไม่พอเติมเต็ม par (ขาดอีก ' + nf(need - qty) + ' ' + m.unit + ')' : undefined;
        return { bin: binFor(m, labelWard), name: m.name, qty, unit: m.unit, note };
      })
      .filter((r) => r.qty > 0);
    if (!rows.length) { toast('รายการที่ต่ำกว่า Min ไม่มีของเหลือใน substock ให้เติมเลยสักรายการ — ต้องเบิกจากคลังใหญ่ก่อน'); return; }
    const ok = printPickListSheet(rows, 'ใบเติมหน้างานประจำวัน — ' + wardLabel, thDate(Date.now()) + ' · หอผู้ป่วย: ' + wardLabel);
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state, toast]);

  // "ระบบเตือนเบิก Substock (2 Weeks Cycle)" — since central-warehouse pickup only happens
  // once every two weeks (not daily like the shelf fill), what's actually needed is a
  // standing requisition list of everything under its substock par right now, ready to bring
  // along whenever that cycle comes up — not a scheduled notification demanding a specific
  // day (nothing here can page anyone; this is a static site with no backend to run a timer).
  const printWarehouseRequestList = useCallback(() => {
    const items = state.meds.filter((m) => m.active && subQty(state, m.id) < m.parSub);
    if (!items.length) { toast('ทุกรายการยังสูงกว่า par substock — ยังไม่ต้องเบิกเพิ่ม'); return; }
    const rows = items.map((m) => ({ bin: m.code, name: m.name, qty: Math.max(0, m.parSub - subQty(state, m.id)), unit: m.unit }));
    const ok = printPickListSheet(rows, 'ใบขอเบิกจากคลังใหญ่', 'รายการที่ต่ำกว่า par substock ทั้งระบบ', { bin: 'รหัสยา', qty: 'จำนวนที่ควรเบิก' });
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state, toast]);

  const commitTransfer = useCallback(guardOnce('transfer', async () => {
    const cart = { ...state.cart };
    const ids = Object.keys(cart);
    if (!ids.length) return;
    const meds = state.meds, lotsCache = state.lots;
    let resultRows: AppState['doneRows'] = [];
    const txPayloads: { medId: string; name: string; qty: number; unit: string; used: string[] }[] = [];
    try {
      await runTx(async (trx) => {
        const rows: AppState['doneRows'] = [];
        const medReads: Record<string, number> = {};
        const lotReads: Record<string, { qty: number; lotNo: string }> = {};
        const lotIdsByMed: Record<string, string[]> = {};
        for (const medId of ids) {
          const medSnap = await trx.get(doc(db, 'meds', medId));
          medReads[medId] = (medSnap.data() as { floor?: number } | undefined)?.floor ?? 0;
          const lotIds = lotsCache.filter((l) => l.medId === medId && l.qty > 0).sort((a, b) => a.exp - b.exp).map((l) => l.id);
          lotIdsByMed[medId] = lotIds;
          for (const lotId of lotIds) {
            const lotSnap = await trx.get(doc(db, 'lots', lotId));
            const data = lotSnap.data() as { qty?: number; lotNo?: string } | undefined;
            lotReads[lotId] = { qty: data?.qty ?? 0, lotNo: data?.lotNo ?? '' };
          }
        }
        // Real bug this closes: the cart's qty is capped against substock at the moment it
        // was typed (see bump()/setCartQty()), but nothing re-checked that against what's
        // actually still in the lots by the time this transaction runs — plausible any time
        // there's a real gap between building the cart and confirming (walking to the shelf,
        // the extra HAD scan step, or simply someone else's transfer/adjust/scrap landing on
        // the same lots first). Without this check the write below always credited floor with
        // the full originally-typed qty regardless of how much the lot loop actually found,
        // manufacturing floor stock substock never had. Check every item BEFORE writing
        // anything — a Firestore transaction only commits if this function returns without
        // throwing, so aborting here leaves nothing partially written.
        const shortages: string[] = [];
        // A cart is purely local state, never reflected in Firestore until commit — nothing
        // stops the med from being deleted (by someone else, another device) in the gap
        // between adding it to the cart and confirming here. Check for that too, same
        // pre-write pass as the stock-shortage check right below.
        const missing = ids.filter((medId) => !meds.find((x) => x.id === medId));
        if (missing.length) throw new Error('missing-med');
        for (const medId of ids) {
          const avail = lotIdsByMed[medId].reduce((s, lotId) => s + (lotReads[lotId]?.qty || 0), 0);
          if (avail < cart[medId]) {
            const m = meds.find((x) => x.id === medId);
            shortages.push((m?.name || medId) + ' (เหลือ ' + nf(avail) + ' ต้องการ ' + nf(cart[medId]) + ')');
          }
        }
        if (shortages.length) throw new Error('insufficient:' + shortages.join(', '));

        txPayloads.length = 0;
        for (const medId of ids) {
          let need = cart[medId];
          const used: string[] = [];
          for (const lotId of lotIdsByMed[medId]) {
            if (need <= 0) break;
            const lotData = lotReads[lotId];
            if (!lotData || lotData.qty <= 0) continue;
            const take = Math.min(need, lotData.qty);
            trx.update(doc(db, 'lots', lotId), { qty: lotData.qty - take });
            need -= take;
            used.push(lotData.lotNo + ' (' + nf(take) + ')');
          }
          // Safe: the missing-med check above already threw before this loop could run for
          // any medId that doesn't resolve, so every lookup here is guaranteed to hit.
          const m = meds.find((x) => x.id === medId)!;
          trx.update(doc(db, 'meds', medId), { floor: medReads[medId] + cart[medId] });
          rows.push({ name: m.name, sub: 'lot ' + used.join(', '), qty: nf(cart[medId]) + ' ' + m.unit, medId });
          txPayloads.push({ medId, name: m.name, qty: cart[medId], unit: m.unit, used });
        }
        resultRows = rows;
      });
      const batch = writeBatch(db);
      txPayloads.forEach((p) => {
        batch.set(doc(collection(db, 'txs')), {
          type: 'transfer_to_floor', name: p.name, medId: p.medId, qty: p.qty, unit: p.unit, from: 'substock', to: 'floor',
          note: 'FEFO lot ' + p.used.join(', '), by: userName(), ts: Date.now(),
        } satisfies Omit<import('../types').Tx, 'id'>);
      });
      await withTimeout(batch.commit());
      setState((st) => ({ ...st, cart: {}, hadOk: {}, screen: 'done', navStack: pushNav(st.navStack, st.screen), doneKind: 'transfer', doneRows: resultRows }));
    } catch (e) {
      const msg = (e as Error)?.message || '';
      if (msg === 'missing-med') { toast('มีรายการในตะกร้าที่ถูกลบออกจากระบบไปแล้ว — กลับไปที่ตะกร้าแล้วลบรายการนั้นออกก่อน'); return; }
      if (msg.startsWith('insufficient:')) { toast('substock เหลือไม่พอสำหรับ ' + msg.slice('insufficient:'.length) + ' — น่าจะมีคนอื่นเบิกไปพร้อมกัน กลับไปปรับจำนวนในตะกร้าแล้วลองใหม่'); return; }
      toastErr(e, 'เติมหน้างานไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [state.cart, state.meds, state.lots, userName, toast, toastErr, guardOnce]);

  // ---------- receive ----------
  const setRecvNo = useCallback((v: string) => patch({ recvNo: v }), [patch]);
  const setRecvSearch = useCallback((v: string) => patch({ recvSearch: v, recvMed: v ? null : state.recvMed }), [patch, state.recvMed]);
  const pickRecvMed = useCallback((medId: string) => {
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    patch({ recvMed: medId, recvSearch: m.name, recvLot: '', recvExp: '', recvQty: '' });
  }, [patch, state.meds]);
  const goReceiveFor = useCallback((medId: string) => {
    const m = state.meds.find((x) => x.id === medId);
    setState((st) => ({ ...st, screen: 'receive', navStack: pushNav(st.navStack, st.screen), recvMed: medId, recvSearch: m ? m.name : '', recvLot: '', recvExp: '', recvQty: '' }));
  }, [state.meds]);
  const setRecvLot = useCallback((v: string) => patch({ recvLot: v }), [patch]);
  const setRecvExp = useCallback((v: string) => patch({ recvExp: v }), [patch]);
  const setRecvQty = useCallback((v: string) => patch({ recvQty: digitsOnly(v) }), [patch]);

  const addRecv = useCallback(() => {
    const m = state.meds.find((x) => x.id === state.recvMed);
    const q = parseIntSafe(state.recvQty);
    if (!m || !q || !state.recvLot || !state.recvExp) { toast('กรอก lot, วันหมดอายุ และจำนวนให้ครบก่อนเพิ่มรายการ'); return; }
    const item: RecvItem = { medId: m.id, name: m.name, unit: m.unit, lotNo: state.recvLot, exp: new Date(state.recvExp).getTime(), qty: q };
    patch((st) => ({ recvItems: [...st.recvItems, item], recvMed: null, recvLot: '', recvExp: '', recvQty: '', recvSearch: '' }));
  }, [state, patch, toast]);

  const removeRecvItem = useCallback((i: number) => patch((st) => ({ recvItems: st.recvItems.filter((_, j) => j !== i) })), [patch]);

  const commitReceive = useCallback(guardOnce('receive', async () => {
    const approve = myProfile?.role !== 'tech';
    const items = state.recvItems;
    if (!items.length) return;
    try {
      const batch = writeBatch(db);
      if (!approve) {
        // Structured pending record per item — carries the actual medId/lot/exp/qty needed
        // to create real stock later, not just a human-readable note. A pharmacist/admin
        // approves each one from the "รออนุมัติ" list on this same screen (or rejects it
        // with a reason); nothing here touches meds/lots stock until that happens.
        items.forEach((it) => {
          batch.set(doc(collection(db, 'pendingReceives')), {
            recvNo: state.recvNo, medId: it.medId, name: it.name, unit: it.unit, lotNo: it.lotNo, exp: it.exp, qty: it.qty,
            requestedBy: userName(), requestedByUid: state.myUid, status: 'pending', ts: Date.now(),
          });
        });
        await withTimeout(batch.commit());
        await logAudit({ type: 'receive_pending', note: 'ใบเบิก ' + state.recvNo + ' · ' + items.length + ' รายการ — รออนุมัติ' });
        setState((st) => ({
          ...st, screen: 'done', navStack: pushNav(st.navStack, st.screen), doneKind: 'recvPending',
          doneRows: items.map((it) => ({ name: it.name, sub: 'lot ' + it.lotNo + ' · exp ' + thDate(it.exp), qty: nf(it.qty) + ' ' + it.unit, medId: it.medId })),
          recvItems: [],
        }));
        return;
      }
      items.forEach((it) => {
        // Liquids/inhalers/sprays — some meds skip substock entirely and go straight from
        // the central warehouse to the shelf (see noSubstock on Med). No lot is created for
        // these (the floor number already carries no per-lot expiry tracking of its own,
        // same limitation the rest of the app already accepts for regular transferred
        // stock) — just credit the shelf directly instead of a substock lot nobody would
        // ever transfer out of.
        const m = state.meds.find((x) => x.id === it.medId);
        if (m && !usesSubstock(m)) {
          batch.update(doc(db, 'meds', it.medId), { floor: increment(it.qty) });
          batch.set(doc(collection(db, 'txs')), {
            type: 'receive_from_central', name: it.name, medId: it.medId, qty: it.qty, unit: it.unit, from: 'คลังยาใหญ่', to: 'floor',
            note: 'ใบเบิก ' + state.recvNo + ' · lot ' + it.lotNo + ' exp ' + thDate(it.exp) + ' — ไม่มี substock ขึ้นหน้างานทันที', by: userName(), ts: Date.now(),
          });
          return;
        }
        const lotRef = doc(collection(db, 'lots'));
        batch.set(lotRef, { code: genLotCode(m?.code, it.medId, lotRef.id), medId: it.medId, lotNo: it.lotNo, exp: it.exp, qty: it.qty, loc: 'ชั้น bulk' });
        batch.set(doc(collection(db, 'txs')), {
          type: 'receive_from_central', name: it.name, medId: it.medId, qty: it.qty, unit: it.unit, from: 'คลังยาใหญ่', to: 'substock',
          note: 'ใบเบิก ' + state.recvNo + ' · lot ' + it.lotNo + ' exp ' + thDate(it.exp), by: userName(), ts: Date.now(),
        });
      });
      await withTimeout(batch.commit());
      setState((st) => ({
        ...st, screen: 'done', navStack: pushNav(st.navStack, st.screen), doneKind: 'receive',
        doneRows: items.map((it) => ({ name: it.name, sub: 'lot ' + it.lotNo + ' · exp ' + thDate(it.exp), qty: nf(it.qty) + ' ' + it.unit, medId: it.medId })),
        recvItems: [],
      }));
    } catch (e) {
      toastErr(e, 'บันทึกใบรับไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [state.recvItems, state.recvNo, state.myUid, state.meds, myProfile, userName, toastErr, logAudit, guardOnce]);

  // Approve a pending receive — creates the real lot + receive_from_central tx, exactly
  // what the immediate (pharm/admin) receive path does. Wrapped in a transaction so two
  // people approving the same request at once can't both create the stock twice: the
  // second one sees status is no longer 'pending' and aborts cleanly.
  const approvePendingReceive = useCallback(guardOnce('approveReceive', async (id: string) => {
    if (!canEditPar) return;
    try {
      await runTx(async (trx) => {
        const ref = doc(db, 'pendingReceives', id);
        const snap = await trx.get(ref);
        const pr = snap.data() as PendingReceive | undefined;
        if (!pr || pr.status !== 'pending') throw new Error('already-resolved');
        const m = state.meds.find((x) => x.id === pr.medId);
        if (m && !usesSubstock(m)) {
          trx.update(doc(db, 'meds', pr.medId), { floor: increment(pr.qty) });
          trx.set(doc(collection(db, 'txs')), {
            type: 'receive_from_central' as TxType, name: pr.name, medId: pr.medId, qty: pr.qty, unit: pr.unit, from: 'คลังยาใหญ่', to: 'floor',
            note: 'ใบเบิก ' + pr.recvNo + ' · lot ' + pr.lotNo + ' exp ' + thDate(pr.exp) + ' — ไม่มี substock ขึ้นหน้างานทันที — อนุมัติคำขอของ ' + pr.requestedBy, by: userName(), ts: Date.now(),
          });
        } else {
          const lotRef = doc(collection(db, 'lots'));
          trx.set(lotRef, { code: genLotCode(m?.code, pr.medId, lotRef.id), medId: pr.medId, lotNo: pr.lotNo, exp: pr.exp, qty: pr.qty, loc: 'ชั้น bulk' });
          trx.set(doc(collection(db, 'txs')), {
            type: 'receive_from_central' as TxType, name: pr.name, medId: pr.medId, qty: pr.qty, unit: pr.unit, from: 'คลังยาใหญ่', to: 'substock',
            note: 'ใบเบิก ' + pr.recvNo + ' · lot ' + pr.lotNo + ' exp ' + thDate(pr.exp) + ' — อนุมัติคำขอของ ' + pr.requestedBy, by: userName(), ts: Date.now(),
          });
        }
        trx.update(ref, { status: 'approved', resolvedBy: userName(), resolvedTs: Date.now() });
      });
      toast('อนุมัติรับเข้าแล้ว');
    } catch (e) {
      if ((e as Error)?.message === 'already-resolved') { toast('รายการนี้ถูกอนุมัติหรือปฏิเสธไปแล้ว'); return; }
      toastErr(e, 'อนุมัติไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [canEditPar, state.meds, userName, toast, toastErr, guardOnce]);

  const rejectPendingReceive = useCallback(guardOnce('rejectReceive', async (id: string, reason: string) => {
    if (!canEditPar) return;
    const pr = state.pendingReceives.find((r) => r.id === id);
    if (!pr) return;
    try {
      await runTx(async (trx) => {
        const ref = doc(db, 'pendingReceives', id);
        const snap = await trx.get(ref);
        const cur = snap.data() as PendingReceive | undefined;
        if (!cur || cur.status !== 'pending') throw new Error('already-resolved');
        trx.update(ref, { status: 'rejected', resolvedBy: userName(), resolvedTs: Date.now(), rejectReason: reason || '—' });
      });
      await logAudit({ type: 'receive_rejected', note: 'ปฏิเสธใบเบิก ' + pr.recvNo + ' · ' + pr.name + ' ' + nf(pr.qty) + ' ' + pr.unit + ' (คำขอของ ' + pr.requestedBy + ') — เหตุผล: ' + (reason || '—') });
      toast('ปฏิเสธรายการแล้ว');
    } catch (e) {
      if ((e as Error)?.message === 'already-resolved') { toast('รายการนี้ถูกอนุมัติหรือปฏิเสธไปแล้ว'); return; }
      toastErr(e, 'ปฏิเสธไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [canEditPar, state.pendingReceives, userName, toast, toastErr, logAudit, guardOnce]);

  // ---------- ward move (shelf-to-shelf, e.g. IPD injectable locked drawer -> OPD stat
  // drawer subset) — since OPD and IPD versions of the same drug are separate med records
  // (separate QR/bin/par each), physically moving units from one shelf to the other means
  // decrementing one med's floor and incrementing another's. Not a receive (nothing new
  // entered the hospital) and not a substock transfer (neither side is substock) — its own
  // small flow, logged as a linked pair of tx entries so the audit trail shows both sides. ----
  // Search box is only ever shown while nothing's picked yet, and the only other caller
  // ("เปลี่ยน") clears the selection first — so unconditionally clearing wmFromMed here (not
  // the pointless `v ? null : null` this used to read) matches every actual call site.
  const setWmFromSearch = useCallback((v: string) => patch({ wmFromSearch: v, wmFromMed: null }), [patch]);
  const pickWmFromMed = useCallback((medId: string) => {
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    patch({ wmFromMed: medId, wmFromSearch: m.name });
  }, [patch, state.meds]);
  const setWmToSearch = useCallback((v: string) => patch({ wmToSearch: v, wmToMed: null }), [patch]);
  const pickWmToMed = useCallback((medId: string) => {
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    patch({ wmToMed: medId, wmToSearch: m.name });
  }, [patch, state.meds]);
  const setWmQty = useCallback((v: string) => patch({ wmQty: digitsOnly(v) }), [patch]);
  const setWmReason = useCallback((v: string) => patch({ wmReason: v }), [patch]);

  const commitWardMove = useCallback(guardOnce('wardMove', async () => {
    const from = state.meds.find((x) => x.id === state.wmFromMed);
    const to = state.meds.find((x) => x.id === state.wmToMed);
    const q = parseIntSafe(state.wmQty);
    if (!from || !to || !q) { toast('เลือกยาต้นทาง ปลายทาง และจำนวนให้ครบ'); return; }
    if (from.id === to.id) { toast('ต้นทางและปลายทางต้องเป็นคนละรายการ'); return; }
    if (!state.wmReason.trim()) { toast('กรอกเหตุผลก่อนบันทึก'); return; }
    // Escapes the transaction closure below so the "ไม่พอ" error message can report the
    // real just-read floor instead of the stale value from before the transaction ran —
    // matters when someone else's transfer/adjust landed on this same med in between.
    let latestFloor = from.floor;
    try {
      await runTx(async (trx) => {
        const fromRef = doc(db, 'meds', from.id);
        const toRef = doc(db, 'meds', to.id);
        const fromSnap = await trx.get(fromRef);
        const curFloor = (fromSnap.data() as { floor?: number } | undefined)?.floor ?? from.floor;
        latestFloor = curFloor;
        if (curFloor < q) throw new Error('insufficient');
        trx.update(fromRef, { floor: curFloor - q });
        trx.update(toRef, { floor: increment(q) });
        trx.set(doc(collection(db, 'txs')), {
          type: 'ward_move_out' as TxType, name: from.name, medId: from.id, qty: -q, unit: from.unit, to: to.name,
          reason: state.wmReason.trim(), note: 'ย้ายไป ' + to.name + ' — ' + state.wmReason.trim(), by: userName(), ts: Date.now(), loc: 'floor',
        });
        trx.set(doc(collection(db, 'txs')), {
          type: 'ward_move_in' as TxType, name: to.name, medId: to.id, qty: q, unit: to.unit, from: from.name,
          reason: state.wmReason.trim(), note: 'ย้ายมาจาก ' + from.name + ' — ' + state.wmReason.trim(), by: userName(), ts: Date.now(), loc: 'floor',
        });
      });
      toast('ย้าย ' + nf(q) + ' ' + from.unit + ' จาก ' + from.name + ' ไป ' + to.name + ' แล้ว');
      patch({ wmFromMed: null, wmFromSearch: '', wmToMed: null, wmToSearch: '', wmQty: '', wmReason: '' });
    } catch (e) {
      if ((e as Error)?.message === 'insufficient') { toast('ต้นทางมีไม่พอ — เหลือ ' + nf(latestFloor) + ' ' + from.unit); return; }
      toastErr(e, 'ย้ายไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [state.meds, state.wmFromMed, state.wmToMed, state.wmQty, state.wmReason, userName, toast, toastErr, patch, guardOnce]);

  // ---------- adjust ----------
  const pickAdjType = useCallback((t: AdjType) => patch({ adjType: t, adjMed: null, adjReason: '' }), [patch]);
  // Editing the search box after a med is already picked needs to re-open the dropdown, or
  // there's no way to fix a wrong selection short of switching the adjustment type away and
  // back — this used to just patch adjSearch with nothing clearing adjMed, so options (which
  // only ever renders while !state.adjMed) could never reappear once something was picked.
  const setAdjSearch = useCallback((v: string) => patch((st) => ({ adjSearch: v, adjMed: v ? null : st.adjMed })), [patch]);
  const pickAdjMed = useCallback((medId: string) => {
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    patch({ adjMed: medId, adjSearch: m.name });
  }, [patch, state.meds]);
  const setAdjQty = useCallback((v: string) => patch({ adjQty: digitsOnly(v) }), [patch]);
  const setAdjReason = useCallback((v: string) => patch({ adjReason: v }), [patch]);
  const setAdjNote = useCallback((v: string) => patch({ adjNote: v }), [patch]);

  const commitAdjust = useCallback(guardOnce('adjust', async () => {
    const m = state.meds.find((x) => x.id === state.adjMed);
    const q = parseIntSafe(state.adjQty);
    if (!m || !q || !state.adjReason) { toast('ต้องเลือกยา จำนวน และเหตุผลให้ครบ'); return; }
    const t = state.adjType!;
    const sign = t === 'return' ? 1 : -1;
    try {
      await runTx(async (trx) => {
        const ref = doc(db, 'meds', m.id);
        const snap = await trx.get(ref);
        const curFloor = (snap.data() as { floor?: number } | undefined)?.floor ?? m.floor;
        trx.update(ref, { floor: Math.max(0, curFloor + sign * q) });
      });
      await logTx({ type: t, name: m.name, medId: m.id, qty: sign * q, unit: m.unit, reason: state.adjReason, note: state.adjNote || '—', loc: 'floor' });
      patch({ adjQty: '', adjReason: '', adjNote: '', adjMed: null, adjSearch: '' });
      toast('บันทึกแล้ว · ' + m.name + ' ' + (sign > 0 ? '+' : '−') + nf(q) + ' ' + m.unit);
    } catch (e) {
      toastErr(e, 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [state, logTx, toast, toastErr, patch, guardOnce]);

  const scrapLot = useCallback(guardOnce('scrapLot', async (lotId: string) => {
    const l = state.lots.find((x) => x.id === lotId);
    if (!l) return;
    const m = state.meds.find((x) => x.id === l.medId);
    if (!m) return;
    try {
      await updateDoc(doc(db, 'lots', lotId), { qty: 0 });
      await logTx({ type: 'expired', name: m.name, medId: m.id, qty: -l.qty, unit: m.unit, reason: 'หมดอายุ / ใกล้หมดอายุ', note: 'lot ' + l.lotNo + ' exp ' + thDate(l.exp) + ' · มูลค่า ' + nf(l.qty * m.price) + ' บาท', loc: 'substock' });
      toast('ตัด lot ' + l.lotNo + ' ออกจาก substock แล้ว · บันทึกลง discrepancy log');
    } catch (e) {
      console.error(e);
      toast('ตัด lot ไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [state.lots, state.meds, logTx, toast, guardOnce]);

  // ---------- report ----------
  const setReportTab = useCallback((t: AppState['reportTab']) => patch({ reportTab: t }), [patch]);

  const exportReportCsv = useCallback(async () => {
    const st = state;
    const names = { aging: 'stock_aging.csv', turn: 'turnover.csv', disc: 'discrepancy_log.csv' };
    // Matches whatever ward tab is open on screen — exporting "everything" while the screen
    // shows only OPD (or vice versa) would be a silently misleading report.
    const wardMeds = st.meds.filter((m) => matchesWard(m, st.wardFilter));
    const wardMedIds = new Set(wardMeds.map((m) => m.id));
    const wardNames = new Set(wardMeds.map((m) => m.name));
    // A name in wardNames isn't necessarily ward-exclusive — OPD and IPD versions of the same
    // drug deliberately share a name (see wardOf/Ward), so a plain name-set filter would also
    // pull in the OTHER ward's tx rows for any name that happens to exist on both shelves.
    // Only drop into name-matching for a name that's genuinely unambiguous; an ambiguous name
    // is trusted only via its tagged medId (see Tx.medId — older rows predating that field
    // just won't appear for an ambiguous name, same tradeoff as the substock ledger).
    const otherWardNames = new Set(st.meds.filter((m) => st.wardFilter !== 'all' && !isSharedMed(m) && wardOf(m) !== st.wardFilter).map((m) => m.name));
    let outcome: Awaited<ReturnType<typeof downloadCsv>>;
    if (st.reportTab === 'aging') {
      const bDef: [string, number, number][] = [['หมดอายุแล้ว', -99999, 0], ['เหลือ ≤ 30 วัน', 0, 30], ['31–90 วัน', 30, 90], ['91–180 วัน', 90, 180], ['มากกว่า 180 วัน', 180, 99999]];
      const rows = bDef.map(([label, lo, hi]) => {
        const ls = st.lots.filter((l) => wardMedIds.has(l.medId) && l.qty > 0 && daysUntil(l.exp) > lo && daysUntil(l.exp) <= hi);
        const val = ls.reduce((s, l) => s + l.qty * (st.meds.find((m) => m.id === l.medId)?.price || 0), 0);
        return [label, ls.length, Math.round(val)];
      });
      outcome = await downloadCsv([['bucket', 'lots', 'value_thb'], ...rows], names.aging);
    } else if (st.reportTab === 'turn') {
      const rows = wardMeds.filter((m) => m.active).map((m) => {
        const oh = m.floor + subQty(st, m.id);
        // A drug with no recorded usage yet (used30 === 0 — new, or never HOSxP-reconciled)
        // divides by zero here; the on-screen "รายงาน" tab already guards this with
        // isFinite(doh), but this CSV export didn't, so it used to write the literal text
        // "Infinity" (or "NaN" when on-hand is also 0) into a real exported spreadsheet.
        const doh = Math.round(oh / (m.used30 / 30));
        return [m.name, m.unit, oh, m.used30, isFinite(doh) ? doh : ''];
      });
      outcome = await downloadCsv([['medication', 'unit', 'on_hand', 'used_30d', 'days_on_hand'], ...rows], names.turn);
    } else {
      // The live txs subscription is capped at the most recent 300 (kept small on purpose —
      // it only backs the "recent activity" UI). A compliance report can't silently drop
      // everything before that, so re-fetch the full collection fresh at export time.
      toast('กำลังดึงประวัติทั้งหมด…');
      const types = ['adjust', 'return', 'damaged', 'expired', 'count', 'reconcile_hosxp'];
      let rows: (string | number)[][];
      try {
        const snap = await withTimeout(getDocs(query(collection(db, 'txs'), orderBy('ts', 'desc'))));
        rows = snap.docs
          .map((d) => d.data() as { type: string; ts: number; name: string; qty: number; unit: string; loc?: string; reason?: string; note?: string; by: string; medId?: string })
          .filter((x) => {
            if (types.indexOf(x.type) < 0) return false;
            if (st.wardFilter === 'all') return true;
            if (x.medId) return wardMedIds.has(x.medId);
            return wardNames.has(x.name) && !otherWardNames.has(x.name);
          })
          .map((x) => [isoDate(x.ts), x.name, x.type, x.qty, x.unit, x.loc || '', x.reason || '', x.note || '', x.by]);
      } catch (e) { toastErr(e, 'ดึงประวัติไม่สำเร็จ ลองใหม่อีกครั้ง'); return; }
      outcome = await downloadCsv([['date', 'medication', 'type', 'qty', 'unit', 'location', 'reason', 'note', 'performed_by'], ...rows], names.disc);
    }
    if (outcome === 'saved') toast('ดาวน์โหลด ' + names[state.reportTab] + ' แล้ว');
    else if (outcome === 'unavailable') toast('ดาวน์โหลดไฟล์ไม่ได้ในเบราว์เซอร์นี้');
  }, [state, toast, toastErr]);

  // ---------- labels ----------
  const setLabelType = useCallback((t: AppState['labelType']) => patch({ labelType: t }), [patch]);
  const printLabels = useCallback(() => {
    // OPD and IPD shelves are physically different rooms with different bin codes — printing
    // a combined batch would mix labels meant for two different places onto one sheet.
    // Respects whatever ward tab the labels screen currently has open ('all' prints both).
    const meds = state.meds.filter((m) => m.active && matchesWard(m, state.wardFilter));
    // Which side of a shared med's two shelf codes to print — the tab actually open, or its
    // own OPD/IPD side (never ambiguous) for a non-shared med. Only matters for `bin`/`sub`
    // text; the `ward` badge below still shows each label's own real ward, same as before.
    const labelWard = state.wardFilter === 'ipd' ? 'ipd' : 'opd';
    let labels: PrintLabel[] = [];
    let heading = 'ฉลากตัวยา';
    if (state.labelType === 'med') {
      labels = meds.map((m) => ({ payload: encodeQr('med', m.code), id: m.code, title: shortLabelName(m.name), sub: 'หน่วย ' + m.unit + ' · ชั้น ' + binFor(m, labelWard), tag: m.had ? 'HIGH ALERT' : undefined, bin: binFor(m, labelWard), ward: wardOf(m) }));
    } else if (state.labelType === 'lot') {
      heading = 'ฉลาก lot';
      // Bug fix: this used to iterate state.lots directly, ignoring both the active-only and
      // ward-scoped `meds` set the med-label branch already correctly used — printing "ฉลาก
      // lot" while the OPD tab was open would still include IPD (and inactive-med) lots on
      // the same sheet, silently ignoring the ward tab shown right above the print button.
      const medIds = new Set(meds.map((m) => m.id));
      labels = state.lots.filter((l) => medIds.has(l.medId)).map((l) => {
        const m = meds.find((x) => x.id === l.medId)!;
        return { payload: encodeQr('lot', l.code), id: l.code, title: m.name, sub: 'lot ' + l.lotNo + ' · exp ' + thDate(l.exp), tag: daysUntil(l.exp) < state.expiryWarnDays ? 'ใกล้หมดอายุ' : undefined, ward: wardOf(m) };
      });
    } else {
      heading = 'ฉลากชั้นวาง';
      labels = LOCS.map((b) => ({ payload: encodeQr('loc', 'LOC-' + b), id: 'LOC-' + b, title: 'ชั้นจ่ายยา ' + b, sub: 'หน้างาน OPD · สแกนเพื่อเปิดรายการในชั้นนี้' }));
    }
    if (!labels.length) { toast('ไม่มีรายการให้พิมพ์ฉลาก'); return; }
    const ok = printLabelSheet(labels, heading);
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว — เลือกกระดาษสติกเกอร์ A4 แล้วสั่งพิมพ์' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state.meds, state.lots, state.labelType, state.wardFilter, state.expiryWarnDays, toast]);

  // ---------- settings / par ----------
  const applyOnePar = useCallback(async (medId: string, which: 'sub' | 'floor') => {
    if (!canEditPar) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    const sug = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
    if (!sug) { toast(m.name + ' ยังไม่มีสถิติการใช้ ไม่สามารถแนะนำ par ได้'); return; }
    try {
      await updateDoc(doc(db, 'meds', medId), which === 'sub' ? { parSub: sug.sub } : { parFloor: sug.floor });
      logAudit({ type: 'par_updated', note: 'ปรับ par' + (which === 'sub' ? 'substock' : 'หน้างาน') + ' ' + m.name + ' เป็น ' + nf(which === 'sub' ? sug.sub : sug.floor) + ' ตามค่าแนะนำจากสถิติ' });
    } catch (e) { console.error(e); toast('ปรับ par ไม่สำเร็จ'); }
  }, [canEditPar, state.meds, state.parFloorCoverDays, state.parSubCoverDays, logAudit, toast]);

  const applyAllSuggested = useCallback(guardOnce('applyAllSuggested', async () => {
    if (!canEditPar) return;
    const targets = state.meds.filter((m) => {
      if (!m.active) return false;
      const s = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
      return !!s && (s.sub !== m.parSub || s.floor !== m.parFloor);
    });
    try {
      for (let i = 0; i < targets.length; i += 400) {
        const batch = writeBatch(db);
        targets.slice(i, i + 400).forEach((m) => {
          const sug = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
          if (!sug) return; // ไม่มีสถิติการใช้ ข้าม ห้ามเขียนทับ par เดิม
          batch.update(doc(db, 'meds', m.id), { parSub: sug.sub, parFloor: sug.floor });
        });
        await withTimeout(batch.commit());
      }
      logAudit({ type: 'par_updated', note: 'ใช้ค่า par แนะนำจากสถิติทั้งหมด (' + targets.length + ' รายการเปลี่ยนแปลง)' });
      toast('ปรับ par ตามค่าแนะนำแล้ว ' + targets.length + ' รายการ');
    } catch (e) { toastErr(e, 'ปรับ par ไม่สำเร็จ'); }
  }), [canEditPar, state.meds, state.parFloorCoverDays, state.parSubCoverDays, logAudit, toast, toastErr, guardOnce]);

  const debouncedParWrite = useCallback((medId: string, field: 'parSub' | 'parFloor', val: number) => {
    const key = 'par:' + medId + field;
    window.clearTimeout(parDebounce.current[medId + field]);
    const fire = () => {
      delete pendingFlush.current[key];
      updateDoc(doc(db, 'meds', medId), { [field]: val }).catch(() => toast('บันทึกค่า par ไม่สำเร็จ'));
    };
    pendingFlush.current[key] = fire;
    parDebounce.current[medId + field] = window.setTimeout(fire, 500);
  }, [toast]);

  const setParSub = useCallback((medId: string, v: string) => {
    if (!canEditPar) return;
    const val = parseIntSafe(v);
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, parSub: val } : x)) }));
    debouncedParWrite(medId, 'parSub', val);
  }, [canEditPar, debouncedParWrite]);

  const setParFloor = useCallback((medId: string, v: string) => {
    if (!canEditPar) return;
    const val = parseIntSafe(v);
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, parFloor: val } : x)) }));
    debouncedParWrite(medId, 'parFloor', val);
  }, [canEditPar, debouncedParWrite]);

  const setMedBin = useCallback((medId: string, v: string) => {
    if (!canEditPar) return;
    const val = v.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8);
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, bin: val } : x)) }));
    const key = 'bin:' + medId;
    window.clearTimeout(binDebounce.current[medId]);
    const fire = () => {
      delete pendingFlush.current[key];
      updateDoc(doc(db, 'meds', medId), { bin: val }).catch(() => toast('บันทึกชั้นวางไม่สำเร็จ'));
    };
    pendingFlush.current[key] = fire;
    binDebounce.current[medId] = window.setTimeout(fire, 500);
  }, [canEditPar, toast]);

  /**
   * `used30`/`usedPrev30` (the daily-usage stats behind "แนะนำ par" and the turnover report)
   * come from the seed data and are never touched again on their own — there's no server to
   * run a nightly rollup. This recomputes them from real dispensing history: every
   * `reconcile_hosxp` tx (the only place patient dispensing is actually recorded — see
   * README) in the last 30 days, and the 30 days before that, summed per drug by name.
   * A drug with no reconcile history yet in a given window computes to 0 for it — expected
   * right after go-live, before HOSxP reconcile has been run daily for a while.
   */
  const recomputeUsageStats = useCallback(guardOnce('recomputeUsageStats', async () => {
    if (!canEditPar) return;
    toast('กำลังคำนวณสถิติการใช้ยาใหม่จากประวัติ HOSxP…');
    try {
      const snap = await withTimeout(getDocs(query(collection(db, 'txs'), where('type', '==', 'reconcile_hosxp'))));
      const now = Date.now();
      // Same OPD/IPD name-twin hazard as fetchSubstockLedger/matchHosxpMed — aggregating by
      // name alone would sum both wards' dispensing into one number and then write that same
      // (wrong) total onto BOTH the OPD and IPD copy, silently poisoning "แนะนำ par" for both.
      // Every reconcile_hosxp tx has carried medId since v2.20.0, so: a drug with no name-twin
      // among active meds keeps the simple name aggregation (covers tx rows from before medId
      // existed too); a drug that does have a twin only counts rows explicitly tagged with its
      // own medId — an old, medId-less row for a duplicated name is skipped rather than guessed.
      const dupNames = new Set<string>();
      const seenNames = new Set<string>();
      state.meds.forEach((m) => { if (seenNames.has(m.name)) dupNames.add(m.name); seenNames.add(m.name); });
      const curByName: Record<string, number> = {};
      const prevByName: Record<string, number> = {};
      const curById: Record<string, number> = {};
      const prevById: Record<string, number> = {};
      snap.docs.forEach((d) => {
        const x = d.data() as { name?: string; medId?: string; qty?: number; ts?: number };
        if (!x.name || typeof x.qty !== 'number' || x.qty >= 0 || typeof x.ts !== 'number') return; // only dispensed (negative) entries
        const ageDays = (now - x.ts) / DAY;
        if (ageDays < 0) return;
        const bucket = ageDays <= 30 ? 30 : ageDays <= 60 ? 60 : 0;
        if (!bucket) return;
        if (dupNames.has(x.name)) {
          if (!x.medId) return;
          const map = bucket === 30 ? curById : prevById;
          map[x.medId] = (map[x.medId] || 0) + Math.abs(x.qty);
        } else {
          const map = bucket === 30 ? curByName : prevByName;
          map[x.name] = (map[x.name] || 0) + Math.abs(x.qty);
        }
      });
      const targets = state.meds.filter((m) => m.active);
      for (let i = 0; i < targets.length; i += 400) {
        const batch = writeBatch(db);
        targets.slice(i, i + 400).forEach((m) => {
          const used30 = dupNames.has(m.name) ? (curById[m.id] || 0) : (curByName[m.name] || 0);
          const usedPrev30 = dupNames.has(m.name) ? (prevById[m.id] || 0) : (prevByName[m.name] || 0);
          batch.update(doc(db, 'meds', m.id), { used30: Math.round(used30), usedPrev30: Math.round(usedPrev30) });
        });
        await withTimeout(batch.commit());
      }
      logAudit({ type: 'par_updated', note: 'คำนวณสถิติการใช้ยาใหม่จากประวัติ HOSxP 60 วันล่าสุด (' + targets.length + ' รายการ)' });
      toast('คำนวณสถิติใหม่แล้ว ' + targets.length + ' รายการ — กด "ใช้ค่าแนะนำทั้งหมด" ด้านบนอีกครั้งเพื่ออัปเดต par ตามสถิติใหม่');
    } catch (e) { toastErr(e, 'คำนวณสถิติไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }), [canEditPar, state.meds, logAudit, toast, toastErr, guardOnce]);

  // Persists to meta/settings (see the onSnapshot listener above) — a merge write so this
  // can be called with just the one field that changed without clobbering the other two.
  const updateGlobalSettings = useCallback(async (patchFields: Partial<{ expiryWarnDays: number; parFloorCoverDays: number; parSubCoverDays: number }>) => {
    if (!canEditPar) return;
    try {
      await setDoc(doc(db, 'meta', 'settings'), patchFields, { merge: true });
      logAudit({ type: 'par_updated', note: 'แก้ไขการตั้งค่า: ' + Object.entries(patchFields).map(([k, v]) => k + '=' + v).join(', ') });
      toast('บันทึกการตั้งค่าแล้ว');
    } catch (e) { console.error(e); toast('บันทึกการตั้งค่าไม่สำเร็จ'); }
  }, [canEditPar, logAudit, toast]);

  // ---------- meds (formulary) management ----------
  const addMed = useCallback(guardOnce('addMed', async (input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; bin: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility?: number; shared?: boolean; binIpd?: string }) => {
    if (!canEditPar) return;
    const name = input.name.trim();
    if (!name) { toast('กรอกชื่อยาก่อน'); return; }
    try {
      // The QR printed on a shelf label encodes this `code` — two meds ever ending up with
      // the same code would mean two different drugs' labels both resolve to whichever one
      // got queried first. Computing "current max + 1" from the client's own local `meds`
      // list (the old approach) has a real race: two people adding a med at nearly the same
      // moment can both read the same max before either write lands, and both mint the same
      // code. A Firestore transaction against a single counter doc makes the increment atomic
      // regardless of how many people are adding meds at once — Firestore itself retries the
      // transaction if another client's commit lands first.
      const code = await runTx(async (trx) => {
        const seqRef = doc(db, 'meta', 'medSeq');
        const seqSnap = await trx.get(seqRef);
        let next: number;
        if (seqSnap.exists()) {
          next = (seqSnap.data() as { next?: number }).next || 1;
        } else {
          // First ever add since this counter existed — seed it from the highest code
          // already in the (locally-synced, presumed up to date) formulary. Safe even under
          // a concurrent race: if two clients hit this branch at once, Firestore's
          // transaction retry re-reads seqRef after the loser's next attempt and takes the
          // branch above instead, using the winner's freshly-written value.
          let max = 0;
          state.meds.forEach((m) => {
            const mm = /^MED-(\d+)$/.exec(m.code);
            if (mm) max = Math.max(max, parseInt(mm[1], 10));
          });
          next = max + 1;
        }
        trx.set(seqRef, { next: next + 1 }, { merge: true });
        const c = 'MED-' + String(next).padStart(4, '0');
        const binIpd = input.binIpd ? normBin(input.binIpd) : '';
        trx.set(doc(collection(db, 'meds')), {
          code: c, name, unit: input.unit.trim() || 'หน่วย', dosageForm: input.dosageForm.trim(),
          price: input.price || 0, had: input.had, active: true,
          parSub: Math.max(0, input.parSub || 0), parFloor: Math.max(0, input.parFloor || 0), floor: 0,
          floorMin: Math.max(0, input.floorMin || 0),
          bin: normBin(input.bin),
          used30: 0, usedPrev30: 0, volatility: clampVolatility(input.volatility ?? 1.1), lastCountTs: Date.now(),
          ward: input.ward, noSubstock: input.noSubstock,
          ...(input.shared ? { shared: true } : {}),
          ...(binIpd ? { binIpd } : {}),
        });
        return c;
      });
      logAudit({ type: 'med_added', note: 'เพิ่มยาใหม่ ' + name + ' (' + code + ')' });
      toast('เพิ่ม ' + name + ' แล้ว');
    } catch (e) { toastErr(e, 'เพิ่มยาไม่สำเร็จ'); }
  }), [canEditPar, state.meds, logAudit, toast, toastErr, guardOnce]);

  // One consolidated save for everything about a med someone would want to fix in one place
  // — name/strength (kept together in `name`, same as everywhere else), dosage form, unit,
  // price, high-alert flag, shelf/bin, and both par levels — instead of hunting across
  // separate screens. `code` (the QR/label identifier) is deliberately never touched here —
  // labels already printed with it must keep resolving to this med.
  const updateMedFull = useCallback(guardOnce('updateMedFull', async (medId: string, input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; bin: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility: number; shared?: boolean; binIpd?: string }) => {
    if (!canEditPar) return;
    const name = input.name.trim();
    if (!name) { toast('กรอกชื่อยาก่อน'); return; }
    const binIpd = input.binIpd ? normBin(input.binIpd) : '';
    const patch = {
      name, unit: input.unit.trim() || 'หน่วย', dosageForm: input.dosageForm.trim(),
      price: input.price || 0, had: input.had,
      bin: normBin(input.bin),
      parSub: Math.max(0, input.parSub || 0), parFloor: Math.max(0, input.parFloor || 0),
      floorMin: Math.max(0, input.floorMin || 0),
      ward: input.ward, noSubstock: input.noSubstock,
      volatility: clampVolatility(input.volatility),
      // Toggling the form's "ใช้ยอดร่วมกัน" checkbox off un-shares a med with no separate-stock
      // sibling to worry about (see MedsScreen) — deleteField both so isSharedMed() reads
      // false cleanly and no dangling IPD bin code survives the un-share.
      shared: input.shared ? true : deleteField(),
      binIpd: binIpd ? binIpd : deleteField(),
    };
    try {
      await updateDoc(doc(db, 'meds', medId), patch);
      logAudit({ type: 'med_edited', note: 'แก้ไขข้อมูลยา ' + name });
      toast('บันทึกข้อมูล ' + name + ' แล้ว');
    } catch (e) { console.error(e); toast('บันทึกไม่สำเร็จ'); }
  }), [canEditPar, logAudit, toast, guardOnce]);

  // Merges a still-separate OPD/IPD ward pair (same name — see the "ยาตัวเดียวกันที่วางทั้งสอง
  // ชั้น" note in MedsScreen) into one pooled record, for the real workflow at this hospital:
  // IPD one-day-dose almost always pulls straight off the OPD shelf, so keeping two separate
  // floor counts for the same physical pile of pills was actively wrong, not just redundant.
  // Per the pharmacist's own call on how to handle the merge: floor/used30/usedPrev30 are
  // summed rather than picking one side or trying to reconcile which was "more correct" —
  // today's on-screen numbers don't match the real shelf count anyway (that's the reason this
  // exists), so summing is a reasonable starting point and a physical count right after
  // merging (see CountScreen) is expected to correct it for real, not any arithmetic here.
  // The survivor is always the 'opd'-ward record (wardOf() default for legacy meds with no
  // `ward` field makes this the natural "base" identity too) — its own `bin` stays the OPD
  // shelf code, the other record's `bin` becomes `binIpd`. Drugs that genuinely keep separate
  // stock (e.g. IPD's locked injectable cabinet) simply never call this — WardMoveScreen still
  // covers moving stock between two still-separate records exactly as before.
  const mergeWardMeds = useCallback(guardOnce('mergeWardMeds', async (medIdA: string, medIdB: string) => {
    if (!canEditPar) return;
    const a = state.meds.find((x) => x.id === medIdA);
    const b = state.meds.find((x) => x.id === medIdB);
    if (!a || !b) { toast('ไม่พบยาที่จะรวม'); return; }
    if (a.name !== b.name) { toast('รวมได้เฉพาะยาชื่อเดียวกัน (คนละ ward)'); return; }
    if (wardOf(a) === wardOf(b)) { toast('ต้องเป็นคู่ OPD/IPD คนละฝั่งเท่านั้น'); return; }
    if (isSharedMed(a) || isSharedMed(b)) { toast('มีรายการหนึ่งรวมสต็อกไปแล้ว'); return; }
    const opdMed = wardOf(a) === 'opd' ? a : b;
    const ipdMed = opdMed === a ? b : a;
    if (!(await confirmAsync(
      'รวมสต็อก "' + opdMed.name + '" ฝั่ง OPD (หน้างาน ' + nf(opdMed.floor) + ') กับฝั่ง IPD (หน้างาน ' + nf(ipdMed.floor) + ') '
      + 'เป็นยอดเดียวกัน (' + nf(opdMed.floor + ipdMed.floor) + ') พร้อมชั้นวางแยก OPD/IPD?\n\n'
      + 'ย้อนกลับไม่ได้จากหน้านี้ — แนะนำให้นับสต็อกจริงทันทีหลังรวมเพื่อยืนยันยอด'
    ))) return;
    try {
      const lotSnap = await withTimeout(getDocs(query(collection(db, 'lots'), where('medId', '==', ipdMed.id))));
      const batch = writeBatch(db);
      lotSnap.docs.forEach((d) => batch.update(d.ref, { medId: opdMed.id }));
      batch.update(doc(db, 'meds', opdMed.id), {
        shared: true,
        binIpd: ipdMed.bin,
        floor: opdMed.floor + ipdMed.floor,
        used30: opdMed.used30 + ipdMed.used30,
        usedPrev30: opdMed.usedPrev30 + ipdMed.usedPrev30,
        ward: 'opd',
      });
      batch.update(doc(db, 'meds', ipdMed.id), { active: false, floor: 0 });
      await withTimeout(batch.commit());
      logAudit({
        type: 'med_edited',
        note: 'รวมสต็อก OPD/IPD ของ ' + opdMed.name + ' เป็นยอดเดียวกัน (' + nf(opdMed.floor + ipdMed.floor) + ' ' + opdMed.unit + ') ชั้นวาง OPD ' + (opdMed.bin || '—') + ' / IPD ' + (ipdMed.bin || '—'),
      });
      toast('รวมสต็อก ' + opdMed.name + ' แล้ว — แนะนำให้นับสต็อกจริงเพื่อยืนยันยอด');
    } catch (e) { toastErr(e, 'รวมสต็อกไม่สำเร็จ'); }
  }), [canEditPar, state.meds, logAudit, toast, toastErr, confirmAsync, guardOnce]);

  // "รวมกันเลย" — do mergeWardMeds() for every still-separate OPD/IPD pair across the whole
  // formulary in one go, instead of clicking through each pair one at a time in MedsScreen.
  // Same rule mergeWardMeds already enforces per-pair, applied to the whole list: only a name
  // with EXACTLY one 'opd' and one 'ipd' active record qualifies — a name with, say, two 'opd'
  // records (a real data-entry duplicate) is left alone rather than guessing which one to
  // pair, same caution matchHosxpMed() already takes with an ambiguous name.
  const mergeAllWardPairs = useCallback(guardOnce('mergeAllWardPairs', async () => {
    if (!canEditPar) return;
    const active = state.meds.filter((m) => m.active && !isSharedMed(m));
    const byName = new Map<string, Med[]>();
    active.forEach((m) => {
      const arr = byName.get(m.name);
      if (arr) arr.push(m); else byName.set(m.name, [m]);
    });
    const pairs: { opdMed: Med; ipdMed: Med }[] = [];
    byName.forEach((arr) => {
      if (arr.length !== 2) return;
      const opdMed = arr.find((m) => wardOf(m) === 'opd');
      const ipdMed = arr.find((m) => wardOf(m) === 'ipd');
      if (opdMed && ipdMed) pairs.push({ opdMed, ipdMed });
    });
    if (!pairs.length) { toast('ไม่มีคู่ OPD/IPD ที่ยังแยกกันอยู่ให้รวม'); return; }
    if (!(await confirmAsync(
      'รวมสต็อก OPD+IPD เป็นยอดเดียวกันทั้งหมด ' + pairs.length + ' คู่ (' + pairs.length * 2 + ' รายการยา)?\n\n'
      + 'แต่ละคู่จะบวกยอดหน้างานเข้าด้วยกัน พร้อมเก็บชั้นวางแยก OPD/IPD ไว้ — ย้อนกลับไม่ได้จากหน้านี้\n'
      + 'แนะนำให้นับสต็อกจริงทุกตัวหลังรวมเพื่อยืนยันยอด'
    ))) return;
    try {
      const ipdIds = pairs.map((p) => p.ipdMed.id);
      const lotUpdates: { ref: ReturnType<typeof doc>; opdId: string }[] = [];
      for (let i = 0; i < ipdIds.length; i += 30) {
        const chunk = ipdIds.slice(i, i + 30);
        const opdIdByIpdId = new Map(pairs.filter((p) => chunk.includes(p.ipdMed.id)).map((p) => [p.ipdMed.id, p.opdMed.id]));
        const snap = await withTimeout(getDocs(query(collection(db, 'lots'), where('medId', 'in', chunk))));
        snap.docs.forEach((d) => {
          const medId = (d.data() as { medId?: string }).medId;
          const opdId = medId ? opdIdByIpdId.get(medId) : undefined;
          if (opdId) lotUpdates.push({ ref: d.ref, opdId });
        });
      }
      const ops: { ref: ReturnType<typeof doc>; data: Record<string, unknown> }[] = [
        ...lotUpdates.map((u) => ({ ref: u.ref, data: { medId: u.opdId } })),
        ...pairs.flatMap((p) => [
          { ref: doc(db, 'meds', p.opdMed.id), data: {
            shared: true,
            binIpd: p.ipdMed.bin,
            floor: p.opdMed.floor + p.ipdMed.floor,
            used30: p.opdMed.used30 + p.ipdMed.used30,
            usedPrev30: p.opdMed.usedPrev30 + p.ipdMed.usedPrev30,
            ward: 'opd',
          } },
          { ref: doc(db, 'meds', p.ipdMed.id), data: { active: false, floor: 0 } },
        ]),
      ];
      for (let i = 0; i < ops.length; i += 400) {
        const batch = writeBatch(db);
        ops.slice(i, i + 400).forEach((o) => batch.update(o.ref, o.data));
        await withTimeout(batch.commit());
      }
      const names = pairs.map((p) => p.opdMed.name);
      logAudit({
        type: 'med_edited',
        note: 'รวมสต็อก OPD/IPD ทั้งหมด ' + pairs.length + ' คู่ เป็นยอดเดียวกัน: '
          + names.slice(0, 20).join(', ') + (names.length > 20 ? ' และอีก ' + (names.length - 20) + ' รายการ' : ''),
      });
      toast('รวมสต็อกแล้ว ' + pairs.length + ' คู่ — แนะนำให้นับสต็อกจริงทุกตัวเพื่อยืนยันยอด');
    } catch (e) { toastErr(e, 'รวมสต็อกไม่สำเร็จ'); }
  }), [canEditPar, state.meds, logAudit, toast, toastErr, guardOnce]);

  // The common real starting point: a formulary that has NO separate IPD records at all yet
  // (every med is a plain single 'opd'-ward record) — mergeAllWardPairs() finds nothing to
  // fold together there, because there's no second record's stock to combine. This is the
  // actual fix for that case: just flip every active, not-yet-shared med to `shared: true` in
  // one go, so it shows up under the IPD tab too and both wards draw on the one stock that
  // already exists — no lots to reassign, nothing to sum, because there was never a second
  // pile of stock to begin with. `binIpd` is left unset, so binFor() shows the same one `bin`
  // for both wards until/unless someone gives a drug a distinct IPD shelf code later.
  const shareAllMeds = useCallback(guardOnce('shareAllMeds', async () => {
    if (!canEditPar) return;
    const targets = state.meds.filter((m) => m.active && !isSharedMed(m));
    if (!targets.length) { toast('ยาทุกตัวใช้ร่วมกันทั้ง OPD/IPD อยู่แล้ว'); return; }
    if (!(await confirmAsync(
      'ให้ยาทุกตัว (' + targets.length + ' รายการ) ใช้สต็อกร่วมกันทั้ง OPD และ IPD เลย?\n\n'
      + 'จะขึ้นให้เลือกได้ทั้งในแท็บ OPD และ IPD โดยใช้ยอดคงเหลือ/par ชุดเดียวกัน (ชั้นวางยังเป็นรหัสเดิม '
      + 'จนกว่าจะไปตั้งชั้นวางฝั่ง IPD แยกเองทีหลังในหน้าแก้ไขยา)'
    ))) return;
    try {
      for (let i = 0; i < targets.length; i += 400) {
        const batch = writeBatch(db);
        targets.slice(i, i + 400).forEach((m) => batch.update(doc(db, 'meds', m.id), { shared: true }));
        await withTimeout(batch.commit());
      }
      logAudit({ type: 'med_edited', note: 'ตั้งให้ยาใช้สต็อกร่วมกันทั้ง OPD/IPD ทั้งหมด ' + targets.length + ' รายการ' });
      toast('ตั้งค่าแล้ว ' + targets.length + ' รายการ — ยาทั้งหมดใช้ร่วมกันทั้ง OPD/IPD แล้ว');
    } catch (e) { toastErr(e, 'ตั้งค่าไม่สำเร็จ'); }
  }), [canEditPar, state.meds, logAudit, toast, toastErr, guardOnce]);

  const toggleMedActive = useCallback(async (medId: string) => {
    if (!canEditPar) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    const next = !m.active;
    try {
      await updateDoc(doc(db, 'meds', medId), { active: next });
      logAudit({ type: 'med_status_changed', note: (next ? 'เปิดใช้งานยา ' : 'ปิดใช้งานยา (ตัดออกจากบัญชี) ') + m.name });
      toast((next ? 'เปิดใช้งาน ' : 'ปิดใช้งาน ') + m.name + ' แล้ว');
    } catch (e) { console.error(e); toast('เปลี่ยนสถานะไม่สำเร็จ'); }
  }, [canEditPar, state.meds, logAudit, toast]);

  const deleteMed = useCallback(async (medId: string) => {
    if (!canEditPar) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    if (m.floor > 0 || subQty(state, medId) > 0) { toast('ลบไม่ได้ — ยังมียอดคงเหลือที่หน้างานหรือ substock ต้องปรับยอด/ตัดออกให้เป็น 0 ก่อน'); return; }
    if (!(await confirmAsync('ลบ "' + m.name + '" ออกจากระบบถาวร? ย้อนกลับไม่ได้ — ถ้าแค่เลิกใช้ชั่วคราวแนะนำให้ "ปิดใช้งาน" แทน'))) return;
    try {
      const lotSnap = await withTimeout(getDocs(query(collection(db, 'lots'), where('medId', '==', medId))));
      const batch = writeBatch(db);
      lotSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, 'meds', medId));
      await withTimeout(batch.commit());
      logAudit({ type: 'med_deleted', note: 'ลบยา ' + m.name + ' (' + m.code + ') ออกจากระบบถาวร' });
      toast('ลบ ' + m.name + ' แล้ว');
    } catch (e) { toastErr(e, 'ลบไม่สำเร็จ'); }
  }, [canEditPar, state, logAudit, toast, toastErr, confirmAsync]);

  // One-shot cleanup for a formulary that's accumulated deactivated drugs the hospital
  // doesn't actually carry (e.g. leftover from the initial 585-item seed) — same safety rule
  // as the single-med delete: only ever removes a med that's both inactive AND genuinely
  // empty (0 at the shelf and 0 in substock). A deactivated med someone forgot to zero out
  // first is skipped and named, never silently discarded along with real inventory value.
  // Scoped to whatever the caller passes (MedsScreen passes its currently filtered/searched
  // "ปิดใช้งาน" list) rather than always every inactive med system-wide — the button's shown
  // count and its actual effect need to match, or a ward/search filter on screen would be
  // silently ignored by the delete itself.
  const deleteAllInactiveMeds = useCallback(guardOnce('deleteAllInactiveMeds', async (medIds?: string[]) => {
    if (!canEditPar) return;
    const scope = medIds ? new Set(medIds) : null;
    const inactive = state.meds.filter((m) => !m.active && (!scope || scope.has(m.id)));
    if (!inactive.length) { toast('ไม่มียาที่ปิดใช้งานอยู่'); return; }
    const removable = inactive.filter((m) => m.floor === 0 && subQty(state, m.id) === 0);
    const blocked = inactive.filter((m) => m.floor > 0 || subQty(state, m.id) > 0);
    if (!removable.length) {
      toast('ลบไม่ได้ — ยาที่ปิดใช้งานทั้ง ' + inactive.length + ' รายการยังมียอดคงเหลืออยู่ ต้องปรับยอดให้เป็น 0 ก่อน');
      return;
    }
    const confirmMsg = 'ลบยาที่ปิดใช้งานและยอดเป็น 0 ทั้งหมด ' + removable.length + ' รายการออกจากระบบถาวร? ย้อนกลับไม่ได้'
      + (blocked.length ? ' (อีก ' + blocked.length + ' รายการยังมียอดคงเหลือ จะไม่ถูกลบ)' : '');
    if (!(await confirmAsync(confirmMsg))) return;
    try {
      const lotSnap = await withTimeout(getDocs(query(collection(db, 'lots'), where('medId', 'in', removable.slice(0, 30).map((m) => m.id)))));
      // 'in' queries cap at 30 values — for a formulary-sized cleanup, fetch each remaining
      // med's lots in its own chunk instead of one query that would silently miss the rest.
      const lotDocs = lotSnap.docs.slice();
      for (let i = 30; i < removable.length; i += 30) {
        const chunkIds = removable.slice(i, i + 30).map((m) => m.id);
        const snap = await withTimeout(getDocs(query(collection(db, 'lots'), where('medId', 'in', chunkIds))));
        lotDocs.push(...snap.docs);
      }
      // Combine into one flat list of refs before chunking — chunking meds and lots
      // separately at 400 each could put up to 800 deletes in one batch, over Firestore's
      // hard 500-per-commit limit.
      const allRefs = [...removable.map((m) => doc(db, 'meds', m.id)), ...lotDocs.map((d) => d.ref)];
      for (let i = 0; i < allRefs.length; i += 450) {
        const batch = writeBatch(db);
        allRefs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
        await withTimeout(batch.commit());
      }
      logAudit({ type: 'med_deleted', note: 'ลบยาที่ปิดใช้งานทั้งหมด ' + removable.length + ' รายการ (ยอดเป็น 0) ออกจากระบบถาวร: ' + removable.map((m) => m.name).join(', ') });
      toast('ลบยาที่ปิดใช้งานแล้ว ' + removable.length + ' รายการ' + (blocked.length ? ' · ข้าม ' + blocked.length + ' รายการที่ยังมียอดคงเหลือ' : ''));
    } catch (e) { toastErr(e, 'ลบไม่สำเร็จ'); }
  }), [canEditPar, state, logAudit, toast, toastErr, confirmAsync, guardOnce]);

  const setMedsFocusId = useCallback((id: string | null) => patch({ medsFocusId: id }), [patch]);

  // Jump straight into บัตรสต็อก substock for one med, already open — used from เสร็จสิ้น
  // (DoneScreen) so "รับเข้า/เติมหน้างานสำเร็จ แล้วอยากดูบัตรตอนนี้เลย" is one tap instead of
  // navigating to the screen and searching for the drug by name again.
  const goSubstockCardFor = useCallback((medId: string) => {
    setState((st) => ({ ...st, screen: 'substockcard', navStack: pushNav(st.navStack, st.screen), substockFocusId: medId }));
  }, []);
  const setSubstockFocusId = useCallback((id: string | null) => patch({ substockFocusId: id }), [patch]);

  // ---------- virtual substock card ----------
  // Replaces the paper "ใบเบิกยาจากคลัง-จ่ายเข้าชั้นวางยา" ledger — รับ/จ่าย/คงเหลือ for one
  // med's substock, computed from real tx history instead of a card someone updates by hand.
  // Only these three tx types ever touch substock (adjust/return/damaged/count/reconcile_hosxp
  // /ward_move all only ever touch หน้างาน — see their commit functions): a receive from the
  // central warehouse (+), a FEFO transfer out to the shelf (-, though the tx itself stores a
  // positive "amount moved" — flipped here to read as an outflow), and scrapping an expired
  // lot (already stored negative). Fetched fresh each time (not the capped live 300) so the
  // running balance is correct back to this med's very first substock transaction, however
  // long ago that was.
  const SUBSTOCK_LEDGER_TYPES = new Set(['receive_from_central', 'transfer_to_floor', 'expired']);
  const fetchSubstockLedger = useCallback(async (medId: string) => {
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return [];
    // A name query alone would merge two drugs' history the moment OPD and IPD versions of
    // the same drug share a name (see wardOf/Ward) — every tx write now also tags `medId`
    // (see the Tx type), so when this med has a same-name "twin" in the other ward, trust
    // only rows explicitly tagged for THIS med instead of everything with a matching name.
    // Older tx rows written before medId existed have none, so this narrows to nothing older
    // than that migration for a name-duplicated drug — showing an incomplete-but-correct
    // ledger beats a complete-but-wrong one that silently mixes in the other ward's stock.
    const hasNameTwin = state.meds.some((x) => x.id !== m.id && x.name === m.name);
    const snap = await withTimeout(getDocs(query(collection(db, 'txs'), where('name', '==', m.name))));
    const rows = snap.docs
      .map((d) => d.data() as { type: string; ts: number; qty: number; note?: string; by: string; loc?: string; medId?: string })
      .filter((x) => SUBSTOCK_LEDGER_TYPES.has(x.type) && (x.type !== 'expired' || x.loc === 'substock'))
      .filter((x) => !hasNameTwin || x.medId === m.id)
      .map((x) => ({ ts: x.ts, type: x.type, qty: x.type === 'transfer_to_floor' ? -Math.abs(x.qty) : x.qty, note: x.note || '', by: x.by }))
      .sort((a, b) => a.ts - b.ts);
    let bal = 0;
    return rows.map((r) => { bal += r.qty; return { ...r, balance: bal }; });
  }, [state.meds]);

  // ---------- count ----------
  const setCountInput = useCallback((medId: string, v: string) => patch((st) => ({ countInputs: { ...st.countInputs, [medId]: digitsOnly(v) } })), [patch]);

  const commitCount = useCallback(guardOnce('count', async (medId: string) => {
    const raw = state.countInputs[medId];
    const q = parseInt(raw, 10);
    if (isNaN(q)) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    try {
      let delta = 0;
      await runTx(async (trx) => {
        const ref = doc(db, 'meds', medId);
        const snap = await trx.get(ref);
        const curFloor = (snap.data() as { floor?: number } | undefined)?.floor ?? m.floor;
        delta = q - curFloor;
        trx.update(ref, { floor: q, lastCountTs: Date.now() });
      });
      patch((st) => { const ci = { ...st.countInputs }; delete ci[medId]; return { countInputs: ci }; });
      const note = delta < 0
        ? 'นับได้น้อยกว่าระบบ ' + nf(Math.abs(delta)) + ' ' + m.unit + ' — คาดว่าจ่ายผ่าน HOSxP แต่ยังไม่ reconcile'
        : delta > 0 ? 'นับได้มากกว่าระบบ ' + nf(delta) + ' ' + m.unit + ' — ควรตรวจสอบย้อนหลัง' : 'นับตรงกับระบบ ไม่มีส่วนต่าง';
      await logTx({ type: 'count', name: m.name, medId: m.id, qty: delta, unit: m.unit, reason: 'นับสต็อกหน้างานประจำรอบ', note, loc: 'floor' });
      toast(m.name + ' — ' + note);
    } catch (e) { toastErr(e, 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }), [state.countInputs, state.meds, logTx, toast, toastErr, patch, guardOnce]);

  // ---------- hosxp reconcile ----------
  const setHosxpText = useCallback((v: string) => patch({ hosxpText: v }), [patch]);

  const processHosxp = useCallback(() => {
    const lines = state.hosxpText.split('\n').map((l) => l.trim()).filter(Boolean);
    const rows = lines.map((l) => {
      const idx = l.lastIndexOf(',');
      if (idx < 0) return null;
      const name = l.slice(0, idx).trim();
      const qty = parseIntSafe(l.slice(idx + 1));
      return { name, qty, match: matchHosxpMed(state.meds, name) };
    }).filter((x): x is { name: string; qty: number; match: ReturnType<typeof matchHosxpMed> } => !!x);
    if (!rows.length) { toast('วางข้อมูล CSV รูปแบบ "ชื่อยา,จำนวน" ก่อนประมวลผล'); return; }
    patch({ hosxpRows: rows, hosxpConfirmFuzzy: false });
  }, [state.hosxpText, state.meds, patch, toast]);

  // Lets the daily floor-deduction workflow attach the actual HOSxP "รายงานการใช้ยา" export
  // (.xls/.xlsx) directly instead of hand-copying it into the "ชื่อยา,จำนวน" textarea above —
  // same file shape/parser as the par-suggestion usage import (importUsageFile), just landing
  // in hosxpRows (today's floor deduction) instead of usageRows (the par-suggestion input).
  // Only makes sense when the export was pulled for a single day (yesterday) — the "จำนวนที่ใช้"
  // column becomes that day's real dispensed quantity, which is exactly what a daily reconcile
  // needs; pulling it for a longer range would over-deduct the floor.
  const processHosxpFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onerror = () => toast('อ่านไฟล์ไม่สำเร็จ — ลองใหม่อีกครั้ง');
    const isSpreadsheet = /\.xlsx?$/i.test(file.name);
    reader.onload = async () => {
      let raw: RawUsageRow[];
      try {
        raw = isSpreadsheet
          ? await parseHosxpUsageWorkbook(reader.result as ArrayBuffer)
          : parseUsageCsvText(String(reader.result || ''));
      } catch (e) {
        console.error('hosxp reconcile file parse failed:', e);
        toast('อ่านไฟล์นี้ไม่สำเร็จ — ตรวจสอบว่าเป็นไฟล์ Excel (.xls/.xlsx) จาก HOSxP หรือ CSV ที่ไม่เสียหาย');
        return;
      }
      if (!raw.length) { toast('ไม่พบข้อมูลที่อ่านได้ในไฟล์นี้'); return; }
      const rows = raw.map((r) => ({ name: r.name, qty: Math.round(r.qty), match: matchHosxpMed(state.meds, r.name) }));
      patch({ hosxpRows: rows, hosxpConfirmFuzzy: false, hosxpText: '' });
      toast('อ่านไฟล์ ' + file.name + ' แล้ว ' + rows.length + ' รายการ — ตรวจสอบรายการด้านล่างก่อนตัดยอด');
    };
    if (isSpreadsheet) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }, [state.meds, patch, toast]);

  const setHosxpConfirmFuzzy = useCallback((v: boolean) => patch({ hosxpConfirmFuzzy: v }), [patch]);

  const commitReconcile = useCallback(guardOnce('reconcile', async () => {
    const rows = state.hosxpRows || [];
    const meds = state.meds;
    const hasFuzzy = rows.some((r) => r.match.kind === 'fuzzy');
    if (hasFuzzy && !state.hosxpConfirmFuzzy) { toast('กรุณายืนยันว่าตรวจสอบรายการที่จับคู่แบบไม่ตรงชื่อเป๊ะแล้ว ก่อนตัดยอด'); return; }
    let applied = 0, skipped = 0, zeroQty = 0;
    try {
      for (const r of rows) {
        if (r.qty <= 0) { zeroQty++; continue; }
        // Only 'exact' and 'fuzzy' (human-confirmed above) resolve to a single med — 'ambiguous'
        // and 'none' never touch stock, so a bad name in the source file can't silently
        // deduct from the wrong drug or get dropped without anyone noticing.
        const medId = r.match.kind === 'exact' || r.match.kind === 'fuzzy' ? r.match.medId : null;
        const m = medId ? meds.find((x) => x.id === medId) : null;
        if (!m) { skipped++; continue; }
        let after = 0, before = 0;
        await runTx(async (trx) => {
          const ref = doc(db, 'meds', m.id);
          const snap = await trx.get(ref);
          before = (snap.data() as { floor?: number } | undefined)?.floor ?? m.floor;
          after = Math.max(0, before - r.qty);
          trx.update(ref, { floor: after });
        });
        await logTx({ type: 'reconcile_hosxp', name: m.name, medId: m.id, qty: -(before - after), unit: m.unit, reason: 'นำเข้าจากไฟล์ HOSxP', note: 'จ่ายจริง ' + nf(r.qty) + ' ' + m.unit + ' ตามไฟล์ HOSxP' + (r.match.kind === 'fuzzy' ? ' (จับคู่ชื่อแบบไม่ตรงเป๊ะ — ยืนยันโดยผู้ใช้แล้ว)' : ''), loc: 'floor' });
        applied++;
      }
      patch({ hosxpRows: null, hosxpText: '', hosxpConfirmFuzzy: false });
      // Rows with qty <= 0 were previously silently dropped from this summary entirely —
      // applied + skipped could undercount rows.length with no explanation, which reads as
      // a miscount when a pharmacist checks the math. Named separately from "จับคู่ไม่ได้"
      // since it's a different reason (nothing to deduct, not a matching failure).
      toast(
        'ตัดยอดหน้างานตามไฟล์แล้ว ' + applied + ' รายการ'
        + (skipped ? ' · ข้าม ' + skipped + ' รายการที่จับคู่ไม่ได้' : '')
        + (zeroQty ? ' · ' + zeroQty + ' รายการจำนวน 0 (ไม่ตัดยอด)' : '')
        + ' — บันทึกลง discrepancy log'
      );
    } catch (e) {
      // A failure partway through leaves earlier rows in this same loop already committed —
      // same partial-progress behavior as before this change, just now also reachable via a
      // timeout instead of only a hard Firestore error. `applied` still reflects how many
      // rows actually landed, worth telling the person rather than implying nothing happened.
      toastErr(e, 'ประมวลผลไม่สำเร็จ' + (applied > 0 ? ' — ตัดยอดไปแล้ว ' + applied + ' รายการก่อนเกิดปัญหา ตรวจสอบก่อนลองใหม่' : ' ลองใหม่อีกครั้ง'));
    }
  }), [state.hosxpRows, state.hosxpConfirmFuzzy, state.meds, logTx, toast, toastErr, patch, guardOnce]);

  // ---------- usage-rate import (par) ----------
  // Lets a site whose formulary is too new to have 60 days of in-app HOSxP reconcile history
  // (recomputeUsageStats' only source) still seed used30 with a real number, by importing a
  // usage-total file the pharmacy already has — a real HOSxP "รายงานการใช้ยา" export
  // (.xls/.xlsx) or a plain "ชื่อยา,จำนวน" CSV, covering whatever date range the pharmacy
  // actually has on hand (often a partial, in-progress fiscal year, not a clean 30/90/365-day
  // bucket). Deliberately touches ONLY used30 (a par-suggestion input) via a plain field
  // update, never floor/substock/lot quantities — importing a wrong or badly-matched file can
  // skew a *suggested* par number, never silently move real stock, and even that suggestion
  // only takes effect once someone explicitly clicks "ใช้ค่าแนะนำทั้งหมด" afterward.
  const setUsageDateFrom = useCallback((v: string) => patch({ usageDateFrom: v }), [patch]);
  const setUsageDateTo = useCallback((v: string) => patch({ usageDateTo: v }), [patch]);

  const importUsageFile = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onerror = () => toast('อ่านไฟล์ไม่สำเร็จ — ลองใหม่อีกครั้ง');
    const isSpreadsheet = /\.xlsx?$/i.test(file.name);
    reader.onload = async () => {
      let raw: RawUsageRow[];
      try {
        raw = isSpreadsheet
          ? await parseHosxpUsageWorkbook(reader.result as ArrayBuffer)
          : parseUsageCsvText(String(reader.result || ''));
      } catch (e) {
        console.error('usage file parse failed:', e);
        toast('อ่านไฟล์นี้ไม่สำเร็จ — ตรวจสอบว่าเป็นไฟล์ Excel (.xls/.xlsx) จาก HOSxP หรือ CSV ที่ไม่เสียหาย');
        return;
      }
      if (!raw.length) { toast('ไม่พบข้อมูลที่อ่านได้ในไฟล์นี้'); return; }
      const rows = raw.map((r) => ({ ...r, match: matchHosxpMed(state.meds, r.name) }));
      patch({ usageRows: rows, usageFileName: file.name, usageConfirmFuzzy: false });
    };
    if (isSpreadsheet) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }, [state.meds, patch, toast]);

  const setUsageConfirmFuzzy = useCallback((v: boolean) => patch({ usageConfirmFuzzy: v }), [patch]);

  const clearUsageImport = useCallback(() => patch({ usageRows: null, usageFileName: null, usageConfirmFuzzy: false }), [patch]);

  const commitUsageImport = useCallback(guardOnce('usageImport', async () => {
    const rows = state.usageRows || [];
    if (!state.usageDateFrom || !state.usageDateTo) { toast('ระบุช่วงวันที่ที่ไฟล์นี้ครอบคลุมก่อนนำเข้า'); return; }
    const from = new Date(state.usageDateFrom + 'T00:00:00').getTime();
    const to = new Date(state.usageDateTo + 'T00:00:00').getTime();
    const periodDays = Math.round((to - from) / DAY) + 1; // inclusive of both endpoints
    if (!isFinite(periodDays) || periodDays < 1) { toast('ช่วงวันที่ไม่ถูกต้อง — "จากวันที่" ต้องไม่เกิน "ถึงวันที่"'); return; }
    const hasFuzzy = rows.some((r) => r.match.kind === 'fuzzy');
    if (hasFuzzy && !state.usageConfirmFuzzy) { toast('กรุณายืนยันว่าตรวจสอบรายการที่จับคู่แบบไม่ตรงชื่อเป๊ะแล้ว ก่อนนำเข้า'); return; }
    // Only 'exact'/'fuzzy' (human-confirmed) resolve to one med — same ambiguity rule as HOSxP
    // reconcile, and for the same reason: an OPD/IPD name-twin pair has no ward info in the
    // source file, so guessing which one a row belongs to risks silently applying one ward's
    // real usage rate to the other's par suggestion.
    const targets = rows
      .map((r) => {
        const medId = r.match.kind === 'exact' || r.match.kind === 'fuzzy' ? r.match.medId : null;
        return { r, m: medId ? state.meds.find((x) => x.id === medId) : undefined };
      })
      .filter((x): x is { r: typeof x.r; m: Med } => !!x.m);
    if (!targets.length) { toast('ไม่มีรายการที่จับคู่กับยาในระบบได้ — ตรวจสอบชื่อยาในไฟล์'); return; }
    try {
      for (let i = 0; i < targets.length; i += 400) {
        const batch = writeBatch(db);
        targets.slice(i, i + 400).forEach(({ r, m }) => {
          const used30 = Math.round((r.qty / periodDays) * 30);
          batch.update(doc(db, 'meds', m.id), { used30 });
        });
        await withTimeout(batch.commit());
      }
      logAudit({ type: 'par_updated', note: 'นำเข้าอัตราการใช้จากไฟล์ ' + (state.usageFileName || '') + ' (' + thDate(from) + '–' + thDate(to) + ', ' + periodDays + ' วัน, ' + targets.length + ' รายการ)' });
      patch({ usageRows: null, usageFileName: null, usageConfirmFuzzy: false });
      const skipped = rows.length - targets.length;
      toast('นำเข้าอัตราการใช้แล้ว ' + targets.length + ' รายการ' + (skipped ? ' · ข้าม ' + skipped + ' รายการที่จับคู่ไม่ได้' : '') + ' — กด "ใช้ค่าแนะนำทั้งหมด" เพื่ออัปเดต par');
    } catch (e) { toastErr(e, 'นำเข้าไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }), [state.usageRows, state.usageDateFrom, state.usageDateTo, state.usageConfirmFuzzy, state.usageFileName, state.meds, logAudit, toast, toastErr, patch, guardOnce]);

  // ---------- qr ----------
  const openScanSearch = useCallback((purpose: string) => patch({ qrOpen: true, qrManualOpen: false, qrCode: '', qrManualReason: '', qrPurpose: purpose }), [patch]);
  const closeQr = useCallback(() => patch({ qrOpen: false, qrManualOpen: false }), [patch]);
  const qrManual = useCallback(() => patch((st) => ({ qrManualOpen: !st.qrManualOpen })), [patch]);
  const setQrCode = useCallback((v: string) => patch({ qrCode: v }), [patch]);
  const setQrManualReason = useCallback((v: string) => patch({ qrManualReason: v }), [patch]);

  /** Resolves a scanned/typed code against a specific med/lot label — the label a real
   * printed QR encodes must exist in the current data, or this reports "not found" instead
   * of pretending. Location labels (loc) don't map to one med, so they're resolved by the
   * caller (picks the neediest med in that bin). */
  const resolveMed = useCallback((p: { t: 'med' | 'lot' | 'loc'; id: string }): Med | null => {
    if (p.t === 'med') return state.meds.find((m) => m.code === p.id) || null;
    if (p.t === 'lot') {
      const l = state.lots.find((x) => x.code === p.id);
      return l ? state.meds.find((m) => m.id === l.medId) || null : null;
    }
    return null;
  }, [state.meds, state.lots]);

  const qrDecodedImpl = useCallback((raw: string, manual = false) => {
    const payload = parseQr(raw);
    if (!payload) { toast('อ่าน QR ไม่ได้ — รูปแบบรหัสไม่ถูกต้อง'); return; }
    const purpose = state.qrPurpose;

    if (purpose === 'receive' || purpose === 'transfer') {
      let med: Med | null = null;
      if (payload.t === 'loc') {
        const bin = payload.id.replace(/^LOC-/, '');
        // A shared med (see isSharedMed) has TWO shelf codes — bin (OPD) and binIpd (IPD) —
        // so scanning the physical shelf label on the IPD side must still resolve it, not
        // just the OPD one it happens to be stored under.
        const pool = state.meds.filter((m) => m.active && (m.bin === bin || m.binIpd === bin));
        med = pool.find((m) => (purpose === 'receive' ? subQty(state, m.id) < m.parSub : m.floor < floorMinOf(m))) || pool[0] || null;
        if (!med) { toast('ไม่พบยาที่ผูกกับชั้น ' + bin + ' ในระบบ'); return; }
      } else {
        med = resolveMed(payload);
        if (!med) { toast('ไม่พบรายการนี้ในระบบ — QR อาจมาจากฉลากรุ่นเก่า ลองพิมพ์ฉลากใหม่'); return; }
      }
      if (manual && purpose) logAudit({ type: 'qr_manual', note: 'กรอกรหัส QR ด้วยมือแทนการสแกน (' + med.name + ') — เหตุผล: ' + (state.qrManualReason.trim() || 'ไม่ระบุ') });
      if (purpose === 'receive') {
        pickRecvMed(med.id);
        toast('สแกนพบ ' + med.name + ' ที่ substock — กรอก lot วันหมดอายุ และจำนวนที่รับ');
      } else {
        patch({ search: med.name, filter: 'all' });
        bump(med.id, 1);
        toast('สแกนพบ ' + med.name + ' ที่ชั้นจ่ายยา — ปรับจำนวนแล้วยืนยัน');
      }
      patch({ qrOpen: false, qrManualOpen: false, qrCode: '', qrManualReason: '' });
      return;
    }

    if (purpose === 'viewMed') {
      if (payload.t === 'loc') { toast('QR นี้เป็นตำแหน่งชั้นวาง ไม่ใช่ตัวยา — สแกนที่ฉลากตัวยาแทน'); return; }
      const med = resolveMed(payload);
      if (!med) { toast('ไม่พบรายการนี้ในระบบ — QR อาจมาจากฉลากรุ่นเก่า ลองพิมพ์ฉลากใหม่'); return; }
      patch({ qrOpen: false, qrManualOpen: false, qrCode: '', qrManualReason: '', screen: 'meds', medsFocusId: med.id });
      return;
    }

    // forcing function: qrPurpose holds the exact medId that must be scanned
    const target = state.meds.find((m) => m.id === purpose);
    if (target) {
      if (payload.t === 'med' && payload.id === target.code) {
        if (manual) logAudit({ type: 'qr_manual', note: 'กรอกรหัส QR ด้วยมือแทนการสแกนสำหรับยา high alert ' + target.name + ' — เหตุผล: ' + (state.qrManualReason.trim() || 'ไม่ระบุ') });
        setState((st) => ({ ...st, qrOpen: false, qrManualOpen: false, qrCode: '', qrManualReason: '', hadOk: { ...st.hadOk, [purpose as string]: true } }));
        toast('ยืนยัน QR สำเร็จ — ทำรายการ high alert ต่อได้');
      } else {
        toast('QR ไม่ตรงกับ "' + target.name + '" — สแกนฉลากที่ตัวยาให้ตรงรายการ');
      }
      return;
    }

    toast('อ่าน QR ได้ แต่ไม่พบรายการที่ต้องยืนยันในหน้านี้');
  }, [state, toast, resolveMed, pickRecvMed, bump, patch, logAudit]);

  // Stable identity — <QrScanner> keeps its camera stream open across re-renders (toasts,
  // cart edits, etc.) by depending on this ref-backed wrapper instead of qrDecodedImpl directly.
  const qrDecodedRef = useRef(qrDecodedImpl);
  qrDecodedRef.current = qrDecodedImpl;
  const qrDecoded = useCallback((raw: string, manual = false) => qrDecodedRef.current(raw, manual), []);

  const startHadScan = useCallback((medId: string) => patch({ qrOpen: true, qrManualOpen: false, qrCode: '', qrManualReason: '', qrPurpose: medId }), [patch]);

  // ---------- done ----------
  const doneAgain = useCallback(() => go(state.doneKind === 'transfer' ? 'transfer' : 'receive'), [go, state.doneKind]);

  // ---------- admin ----------
  const setAdminTab = useCallback((t: AppState['adminTab']) => patch({ adminTab: t }), [patch]);
  const setAuditFilter = useCallback((f: AppState['auditFilter']) => patch({ auditFilter: f }), [patch]);

  const setUserRole = useCallback(async (id: string, role: Role) => {
    const u = state.users.find((x) => x.id === id);
    if (!u || u.role === role) return;
    // Demoting the last active admin would lock the hospital out of admin functions
    // entirely (nobody left to approve accounts or promote anyone back) — the only recovery
    // would be hand-editing Firestore in the Firebase console again, same as first bootstrap.
    if (u.role === 'admin' && role !== 'admin') {
      const activeAdmins = state.users.filter((x) => x.role === 'admin' && x.active).length;
      if (activeAdmins <= 1) { toast('เปลี่ยนไม่ได้ — นี่คือ Admin ที่ใช้งานอยู่คนสุดท้าย ต้องมี Admin อย่างน้อย 1 คนเสมอ'); return; }
    }
    if (id === state.myUid && !(await confirmAsync('คุณกำลังจะเปลี่ยนบทบาทของตัวเอง จาก ' + roleLabelFor(u.role) + ' เป็น ' + roleLabelFor(role) + ' — ยืนยันหรือไม่?'))) return;
    try {
      await updateDoc(doc(db, 'users', id), { role });
      logAudit({ type: 'user_role_changed', note: 'เปลี่ยนบทบาท ' + u.name + ' จาก ' + roleLabelFor(u.role) + ' เป็น ' + roleLabelFor(role) });
    } catch (e) { console.error(e); toast('เปลี่ยนบทบาทไม่สำเร็จ'); }
  }, [state.users, state.myUid, logAudit, toast, confirmAsync]);

  const toggleUserActive = useCallback(async (id: string) => {
    const u = state.users.find((x) => x.id === id);
    if (!u) return;
    const next = !u.active;
    if (!next && u.role === 'admin') {
      const activeAdmins = state.users.filter((x) => x.role === 'admin' && x.active).length;
      if (activeAdmins <= 1) { toast('ปิดใช้งานไม่ได้ — นี่คือ Admin ที่ใช้งานอยู่คนสุดท้าย ต้องมี Admin อย่างน้อย 1 คนเสมอ'); return; }
    }
    if (id === state.myUid && !next && !(await confirmAsync('คุณกำลังจะปิดใช้งานบัญชีของตัวเอง — จะออกจากระบบทันที และต้องให้ Admin คนอื่นเปิดให้ใหม่ ยืนยันหรือไม่?'))) return;
    try {
      await updateDoc(doc(db, 'users', id), { active: next });
      logAudit({ type: u.active ? 'user_status_changed' : 'user_approved', note: (next ? (u.active === false && u.createdAt ? 'อนุมัติบัญชี ' : 'เปิดใช้งานบัญชี ') : 'ปิดใช้งานบัญชี ') + u.name });
      toast((next ? 'เปิดใช้งาน' : 'ปิดใช้งาน') + 'บัญชี ' + u.name + ' แล้ว');
    } catch (e) { console.error(e); toast('เปลี่ยนสถานะไม่สำเร็จ'); }
  }, [state.users, state.myUid, logAudit, toast, confirmAsync]);

  const exportAudit = useCallback(async () => {
    const typeLabel: Record<string, string> = {
      login: 'เข้าสู่ระบบ', user_registered: 'สมัครสมาชิก', user_approved: 'อนุมัติบัญชี', user_role_changed: 'เปลี่ยนบทบาท', user_status_changed: 'เปิด/ปิดบัญชี', par_updated: 'ปรับ par level', qr_manual: 'กรอกรหัส QR ด้วยมือ',
      med_added: 'เพิ่มยาใหม่', med_edited: 'แก้ไขข้อมูลยา', med_status_changed: 'เปิด/ปิดใช้งานยา', med_deleted: 'ลบยาถาวร',
      receive_from_central: 'รับเข้า substock', receive_pending: 'รับเข้า (รออนุมัติ)', receive_rejected: 'ปฏิเสธคำขอรับเข้า', transfer_to_floor: 'เติมหน้างาน',
      adjust: 'ปรับยอด', return: 'คืนยา', damaged: 'ยาเสีย/ชำรุด', expired: 'ยาหมดอายุ', count: 'นับสต็อกหน้างาน', reconcile_hosxp: 'นำเข้า HOSxP',
      ward_move_out: 'ย้ายชั้นวาง (ต้นทาง)', ward_move_in: 'ย้ายชั้นวาง (ปลายทาง)',
    };
    // Same reasoning as exportReportCsv — the live subscriptions are capped at 300 each for
    // the on-screen "recent activity" feed; a real audit export needs the full history.
    toast('กำลังดึงประวัติทั้งหมด…');
    type Entry = { type: string; by: string; ts: number; note: string };
    let all: Entry[];
    try {
      const [auditSnap, txSnap] = await withTimeout(Promise.all([
        getDocs(query(collection(db, 'auditLog'), orderBy('ts', 'desc'))),
        getDocs(query(collection(db, 'txs'), orderBy('ts', 'desc'))),
      ]));
      all = [
        ...auditSnap.docs.map((d) => d.data() as Entry),
        ...txSnap.docs.map((d) => d.data() as { type: string; by: string; ts: number; name?: string; note?: string })
          .map((x) => ({ type: x.type, by: x.by, ts: x.ts, note: (x.name ? x.name + ' — ' : '') + (x.note || '') })),
      ];
    } catch (e) { toastErr(e, 'ดึงประวัติไม่สำเร็จ ลองใหม่อีกครั้ง'); return; }
    const outcome = await downloadCsv([['date_time', 'event', 'by', 'detail'], ...all.sort((a, b) => b.ts - a.ts).map((e) => [new Date(e.ts).toISOString(), typeLabel[e.type] || e.type, e.by, e.note])], 'audit_log.csv');
    if (outcome === 'saved') toast('ดาวน์โหลด audit_log.csv แล้ว');
  }, [toast, toastErr]);

  // ---------- audit/tx history search (browse any date range, not just the live 300-cap) ----------
  const setHistoryFrom = useCallback((v: string) => patch({ historyFrom: v }), [patch]);
  const setHistoryTo = useCallback((v: string) => patch({ historyTo: v }), [patch]);
  const clearHistorySearch = useCallback(() => patch({ historyResults: null }), [patch]);

  const searchHistory = useCallback(async () => {
    if (!state.historyFrom || !state.historyTo) { toast('เลือกช่วงวันที่ให้ครบทั้งจากและถึงก่อนค้นหา'); return; }
    const from = new Date(state.historyFrom + 'T00:00:00').getTime();
    const to = new Date(state.historyTo + 'T23:59:59.999').getTime();
    if (isNaN(from) || isNaN(to) || from > to) { toast('ช่วงวันที่ไม่ถูกต้อง — "จาก" ต้องไม่เกิน "ถึง"'); return; }
    patch({ historyLoading: true, historyResults: null });
    const CAP = 1500;
    try {
      const [auditSnap, txSnap] = await withTimeout(Promise.all([
        getDocs(query(collection(db, 'auditLog'), where('ts', '>=', from), where('ts', '<=', to))),
        getDocs(query(collection(db, 'txs'), where('ts', '>=', from), where('ts', '<=', to))),
      ]));
      const all = [
        ...auditSnap.docs.map((d) => d.data() as { type: string; by: string; ts: number; note: string }),
        ...txSnap.docs
          .map((d) => d.data() as { type: string; by: string; ts: number; name?: string; note?: string; qty?: number; unit?: string })
          .map((x) => ({ type: x.type, by: x.by, ts: x.ts, note: (x.name ? x.name + ' — ' : '') + (x.note || '') + (x.qty != null ? ' (' + (x.qty > 0 ? '+' : '') + x.qty + ' ' + (x.unit || '') + ')' : '') })),
      ].sort((a, b) => b.ts - a.ts);
      patch({ historyResults: all.slice(0, CAP), historyLoading: false });
      toast(
        all.length > CAP
          ? 'พบ ' + all.length + ' รายการ — แสดง ' + CAP + ' รายการล่าสุดในช่วงนี้ ลองย่อช่วงวันที่ให้แคบลง'
          : 'พบ ' + all.length + ' รายการในช่วงวันที่เลือก'
      );
    } catch (e) {
      patch({ historyLoading: false });
      toastErr(e, 'ค้นหาไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }, [state.historyFrom, state.historyTo, patch, toast, toastErr]);

  const value = useMemo<AppCtx>(() => ({
    state, myProfile, theme, toggleTheme, sub, fefo, userName, roleLabel, roleLabelOf, warn, toast, respondConfirm, go, back,
    setAuthMode, setAuthUsername, setAuthPassword, setAuthName, setAuthDept, setAuthRemember, signIn, signUp, logout, setDevice, seedDatabase,
    setSearch, setFilter, setWardFilter, bump, setCartQty, fillAll, printPickList, printTodayReplenishList, removeFromCart, commitTransfer,
    setRecvNo, setRecvSearch, pickRecvMed, setRecvLot, setRecvExp, setRecvQty, addRecv, removeRecvItem, commitReceive, printWarehouseRequestList,
    approvePendingReceive, rejectPendingReceive, goReceiveFor,
    setWmFromSearch, pickWmFromMed, setWmToSearch, pickWmToMed, setWmQty, setWmReason, commitWardMove,
    pickAdjType, setAdjSearch, pickAdjMed, setAdjQty, setAdjReason, setAdjNote, commitAdjust, scrapLot,
    setReportTab, exportReportCsv,
    setLabelType, printLabels,
    applyOnePar, applyAllSuggested, setParSub, setParFloor, setMedBin, recomputeUsageStats, updateGlobalSettings,
    addMed, updateMedFull, mergeWardMeds, mergeAllWardPairs, shareAllMeds, toggleMedActive, deleteMed, deleteAllInactiveMeds, setMedsFocusId,
    goSubstockCardFor, setSubstockFocusId,
    fetchSubstockLedger, setCountInput, commitCount,
    setHosxpText, processHosxp, processHosxpFile, setHosxpConfirmFuzzy, commitReconcile,
    setUsageDateFrom, setUsageDateTo, importUsageFile, setUsageConfirmFuzzy, clearUsageImport, commitUsageImport,
    openScanSearch, closeQr, qrDecoded, qrManual, setQrCode, setQrManualReason, startHadScan,
    doneAgain,
    setAdminTab, setAuditFilter, setUserRole, toggleUserActive, exportAudit,
    setHistoryFrom, setHistoryTo, searchHistory, clearHistorySearch,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, myProfile, theme, toggleTheme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
