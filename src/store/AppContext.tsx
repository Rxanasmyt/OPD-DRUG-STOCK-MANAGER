import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from 'firebase/auth';
import {
  collection, doc, onSnapshot, query, orderBy, limit, where, writeBatch, addDoc, updateDoc, setDoc,
  runTransaction, getDocs, getDoc,
} from 'firebase/firestore';
import { auth, db, usernameToEmail, normalizeUsername, USERNAME_RE } from '../firebase';
import type {
  AppState, Med, Role, Screen, AdjType, RecvItem, TxType, User, AuthMode,
} from '../types';
import { seedInitialData } from '../data/seedFirestore';
import { subQty, fefoLot, roleLabelFor, suggestPar, suggestTransferQty, daysUntil, matchHosxpMed, DAY } from './selectors';
import { nf, thDate, isoDate, parseIntSafe, digitsOnly } from '../utils/format';
import { downloadCsv } from '../utils/csv';
import { encodeQr, parseQr } from '../utils/qr';
import { printLabelSheet, type PrintLabel } from '../utils/print';
import { LOCS } from '../data/locations';

function freshState(): AppState {
  return {
    meds: [], lots: [], txs: [], users: [], authLog: [], dbReady: false,

    authStatus: 'loading', authMode: 'login', myUid: null,
    authUsername: '', authPassword: '', authName: '', authDept: 'เภสัชกรรม', authError: null, authBusy: false,

    screen: 'login', prevScreen: 'home', role: null, online: navigator.onLine, device: 'phone', pending: 0,

    cart: {}, search: '', filter: 'low',

    recvNo: 'REQ-6908-' + (140 + (Date.now() % 9)), recvSearch: '', recvMed: null, recvLot: '', recvExp: '', recvQty: '', recvItems: [],

    adjType: null, adjSearch: '', adjMed: null, adjQty: '', adjReason: '', adjNote: '',

    reportTab: 'aging', labelType: 'med',

    qrOpen: false, qrManualOpen: false, qrCode: '', qrManualReason: '', qrPurpose: null, hadOk: {},

    doneKind: null, doneRows: [], toast: null,

    countInputs: {}, hosxpText: '', hosxpRows: null, hosxpConfirmFuzzy: false,

    adminTab: 'users', auditFilter: 'all',

    expiryWarnDays: 90, parFloorCoverDays: 3, parSubCoverDays: 21,
  } as AppState;
}

export interface AppCtx {
  state: AppState;
  myProfile: User | null;
  sub: (medId: string) => number;
  fefo: (medId: string) => ReturnType<typeof fefoLot>;
  userName: () => string;
  roleLabel: () => string;
  roleLabelOf: (r: Role) => string;
  warn: () => number;
  toast: (t: string) => void;
  go: (s: Screen) => void;
  back: () => void;

  // auth
  setAuthMode: (m: AuthMode) => void;
  setAuthUsername: (v: string) => void;
  setAuthPassword: (v: string) => void;
  setAuthName: (v: string) => void;
  setAuthDept: (v: string) => void;
  signIn: () => void;
  signUp: () => void;
  logout: () => void;
  setDevice: (d: 'phone' | 'tablet') => void;
  seedDatabase: () => void;
  resetData: () => void;

  // transfer
  setSearch: (v: string) => void;
  setFilter: (f: AppState['filter']) => void;
  bump: (id: string, d: number) => void;
  setCartQty: (id: string, raw: string) => void;
  fillAll: () => void;
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
  goReceiveFor: (medId: string) => void;

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

  // meds (formulary) management
  addMed: (input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; bin: string; parSub: number; parFloor: number }) => void;
  toggleMedActive: (medId: string) => void;
  deleteMed: (medId: string) => void;

  // count
  setCountInput: (medId: string, v: string) => void;
  commitCount: (medId: string) => void;

  // hosxp reconcile
  setHosxpText: (v: string) => void;
  loadHosxpSample: () => void;
  processHosxp: () => void;
  setHosxpConfirmFuzzy: (v: boolean) => void;
  commitReconcile: () => void;

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
  const code = (e as { code?: string })?.code || '';
  return AUTH_ERROR_MESSAGES[code] || 'เกิดข้อผิดพลาด ลองใหม่อีกครั้ง';
}

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(freshState);
  const [myProfile, setMyProfile] = useState<User | null>(null);
  const toastTimer = useRef<number | undefined>(undefined);
  const parDebounce = useRef<Record<string, number>>({});
  const binDebounce = useRef<Record<string, number>>({});

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

  // ---------- auth: who is signed in ----------
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (fbUser) => {
      if (!fbUser) {
        patch({ authStatus: 'signedOut', myUid: null, role: null, screen: 'login' });
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
    const unsub = onSnapshot(
      doc(db, 'users', state.myUid),
      (snap) => {
        if (!snap.exists()) { patch({ authStatus: 'signedOut' }); return; }
        const profile = { id: snap.id, ...snap.data() } as User;
        setMyProfile(profile);
        patch({ role: profile.active ? profile.role : null, authStatus: profile.active ? 'signedIn' : 'pendingApproval' });
      },
      () => patch({ authStatus: 'signedOut' }),
    );
    return unsub;
  }, [state.myUid, patch]);

  // ---------- live data: only once approved ----------
  useEffect(() => {
    if (state.authStatus !== 'signedIn') return;
    const unsubs = [
      onSnapshot(collection(db, 'meds'), (snap) => {
        patch({ meds: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Med[], dbReady: true });
      }),
      onSnapshot(collection(db, 'lots'), (snap) => {
        patch({ lots: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AppState['lots'] });
      }),
      onSnapshot(query(collection(db, 'txs'), orderBy('ts', 'desc'), limit(300)), (snap) => {
        patch({ txs: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AppState['txs'] });
      }),
      onSnapshot(query(collection(db, 'auditLog'), orderBy('ts', 'desc'), limit(300)), (snap) => {
        patch({ authLog: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as AppState['authLog'] });
      }),
    ];
    if (myProfile?.role === 'admin') {
      unsubs.push(onSnapshot(collection(db, 'users'), (snap) => {
        patch({ users: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as User[] });
      }));
    }
    return () => unsubs.forEach((u) => u());
  }, [state.authStatus, myProfile?.role, patch]);

  const sub = useCallback((medId: string) => subQty(state, medId), [state]);
  const fefo = useCallback((medId: string) => fefoLot(state, medId), [state]);
  const userName = useCallback(() => myProfile?.name || '', [myProfile]);
  const roleLabel = useCallback(() => roleLabelFor(state.role), [state.role]);
  const roleLabelOf = useCallback((r: Role) => roleLabelFor(r), []);
  const warn = useCallback(() => state.expiryWarnDays, [state.expiryWarnDays]);

  const toast = useCallback((t: string) => {
    patch({ toast: t });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => patch({ toast: null }), 2600);
  }, [patch]);

  const go = useCallback((s: Screen) => setState((st) => ({ ...st, screen: s, prevScreen: st.screen })), []);
  const back = useCallback(() => setState((st) => ({ ...st, screen: st.screen === 'tconfirm' ? 'transfer' : 'more', prevScreen: st.screen })), []);

  const logAudit = useCallback(async (entry: { type: string; note: string }) => {
    try { await addDoc(collection(db, 'auditLog'), { ...entry, by: userName(), ts: Date.now() }); }
    catch (e) { console.error('audit log write failed:', e); toast('บันทึกลง audit log ไม่สำเร็จ — รายการหลักบันทึกแล้ว แต่ประวัตินี้อาจหายไป'); }
  }, [userName, toast]);

  const logTx = useCallback(async (tx: Omit<import('../types').Tx, 'id' | 'ts' | 'by'>) => {
    try { await addDoc(collection(db, 'txs'), { ...tx, by: userName(), ts: Date.now() }); }
    catch (e) { console.error('tx log write failed:', e); toast('บันทึกประวัติธุรกรรมไม่สำเร็จ — ยอดสต็อกอัปเดตแล้ว แต่ไม่มีบันทึกรายการนี้ในประวัติ'); }
  }, [userName, toast]);

  // ---------- auth actions ----------
  const setAuthMode = useCallback((m: AuthMode) => patch({ authMode: m, authError: null }), [patch]);
  const setAuthUsername = useCallback((v: string) => patch({ authUsername: v }), [patch]);
  const setAuthPassword = useCallback((v: string) => patch({ authPassword: v }), [patch]);
  const setAuthName = useCallback((v: string) => patch({ authName: v }), [patch]);
  const setAuthDept = useCallback((v: string) => patch({ authDept: v }), [patch]);

  const signIn = useCallback(async () => {
    const username = normalizeUsername(state.authUsername);
    const password = state.authPassword;
    if (!username || !password) { patch({ authError: 'กรอกชื่อผู้ใช้และรหัสผ่าน' }); return; }
    patch({ authBusy: true, authError: null });
    try {
      const cred = await signInWithEmailAndPassword(auth, usernameToEmail(username), password);
      await setDoc(doc(db, 'users', cred.user.uid), { lastLogin: Date.now() }, { merge: true });
    } catch (e) {
      patch({ authError: authErrorMessage(e) });
    } finally {
      patch({ authBusy: false });
    }
  }, [state.authUsername, state.authPassword, patch]);

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
        await batch.commit();
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

  const resetData = useCallback(async () => {
    if (myProfile?.role !== 'admin') return;
    if (!window.confirm('รีเซ็ตข้อมูลยาและ lot ทั้งหมดกลับเป็นชุดตั้งต้น? ธุรกรรม/ผู้ใช้จะไม่ถูกลบ')) return;
    toast('กำลังรีเซ็ตข้อมูล…');
    try {
      for (const colName of ['meds', 'lots']) {
        const snap = await getDocs(collection(db, colName));
        const ids = snap.docs.map((d) => d.id);
        for (let i = 0; i < ids.length; i += 400) {
          const batch = writeBatch(db);
          ids.slice(i, i + 400).forEach((id) => batch.delete(doc(db, colName, id)));
          await batch.commit();
        }
      }
      await seedInitialData();
      toast('รีเซ็ตข้อมูลตัวอย่างแล้ว');
    } catch (e) {
      toast('รีเซ็ตไม่สำเร็จ: ' + authErrorMessage(e));
    }
  }, [myProfile, toast]);

  // ---------- transfer ----------
  const setSearch = useCallback((v: string) => patch({ search: v }), [patch]);
  const setFilter = useCallback((f: AppState['filter']) => patch({ filter: f }), [patch]);

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
      st.meds.forEach((m) => { if (m.floor < m.parFloor) { const q = suggestTransferQty(st, m); if (q > 0) cart[m.id] = q; } });
      return { ...st, cart, filter: 'low' };
    });
    toast('ใส่จำนวนตาม par ให้ทุกรายการที่ต่ำกว่าเกณฑ์แล้ว — ปรับได้ก่อนยืนยัน');
  }, [toast]);

  const commitTransfer = useCallback(async () => {
    const cart = { ...state.cart };
    const ids = Object.keys(cart);
    if (!ids.length) return;
    const meds = state.meds, lotsCache = state.lots;
    let resultRows: AppState['doneRows'] = [];
    const txPayloads: { name: string; qty: number; unit: string; used: string[] }[] = [];
    try {
      await runTransaction(db, async (trx) => {
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
          const m = meds.find((x) => x.id === medId)!;
          trx.update(doc(db, 'meds', medId), { floor: medReads[medId] + cart[medId] });
          rows.push({ name: m.name, sub: 'lot ' + used.join(', '), qty: nf(cart[medId]) + ' ' + m.unit });
          txPayloads.push({ name: m.name, qty: cart[medId], unit: m.unit, used });
        }
        resultRows = rows;
      });
      const batch = writeBatch(db);
      txPayloads.forEach((p) => {
        batch.set(doc(collection(db, 'txs')), {
          type: 'transfer_to_floor', name: p.name, qty: p.qty, unit: p.unit, from: 'substock', to: 'floor',
          note: 'FEFO lot ' + p.used.join(', '), by: userName(), ts: Date.now(),
        } satisfies Omit<import('../types').Tx, 'id'>);
      });
      await batch.commit();
      setState((st) => ({ ...st, cart: {}, hadOk: {}, screen: 'done', prevScreen: st.screen, doneKind: 'transfer', doneRows: resultRows }));
    } catch (e) {
      console.error(e);
      toast('เติมหน้างานไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }, [state.cart, state.meds, state.lots, userName, toast]);

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
    setState((st) => ({ ...st, screen: 'receive', prevScreen: st.screen, recvMed: medId, recvSearch: m ? m.name : '', recvLot: '', recvExp: '', recvQty: '' }));
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

  const commitReceive = useCallback(async () => {
    const approve = myProfile?.role !== 'tech';
    const items = state.recvItems;
    if (!items.length) return;
    try {
      const batch = writeBatch(db);
      if (!approve) {
        items.forEach((it) => {
          batch.set(doc(collection(db, 'txs')), {
            type: 'receive_pending' as TxType, name: it.name, qty: it.qty, unit: it.unit,
            note: 'ใบเบิก ' + state.recvNo + ' · lot ' + it.lotNo + ' — รออนุมัติ', loc: 'substock', by: userName(), ts: Date.now(),
          });
        });
        await batch.commit();
        setState((st) => ({
          ...st, screen: 'done', prevScreen: st.screen, doneKind: 'recvPending',
          doneRows: items.map((it) => ({ name: it.name, sub: 'lot ' + it.lotNo + ' · exp ' + thDate(it.exp), qty: nf(it.qty) + ' ' + it.unit })),
          recvItems: [],
        }));
        return;
      }
      items.forEach((it, i) => {
        batch.set(doc(collection(db, 'lots')), { code: 'LOT-' + it.medId.slice(1) + '-n' + i, medId: it.medId, lotNo: it.lotNo, exp: it.exp, qty: it.qty, loc: 'ชั้น bulk' });
        batch.set(doc(collection(db, 'txs')), {
          type: 'receive_from_central', name: it.name, qty: it.qty, unit: it.unit, from: 'คลังยาใหญ่', to: 'substock',
          note: 'ใบเบิก ' + state.recvNo + ' · lot ' + it.lotNo + ' exp ' + thDate(it.exp), by: userName(), ts: Date.now(),
        });
      });
      await batch.commit();
      setState((st) => ({
        ...st, screen: 'done', prevScreen: st.screen, doneKind: 'receive',
        doneRows: items.map((it) => ({ name: it.name, sub: 'lot ' + it.lotNo + ' · exp ' + thDate(it.exp), qty: nf(it.qty) + ' ' + it.unit })),
        recvItems: [],
      }));
    } catch (e) {
      console.error(e);
      toast('บันทึกใบรับไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }, [state.recvItems, state.recvNo, myProfile, userName, toast]);

  // ---------- adjust ----------
  const pickAdjType = useCallback((t: AdjType) => patch({ adjType: t, adjMed: null, adjReason: '' }), [patch]);
  const setAdjSearch = useCallback((v: string) => patch({ adjSearch: v }), [patch]);
  const pickAdjMed = useCallback((medId: string) => {
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    patch({ adjMed: medId, adjSearch: m.name });
  }, [patch, state.meds]);
  const setAdjQty = useCallback((v: string) => patch({ adjQty: digitsOnly(v) }), [patch]);
  const setAdjReason = useCallback((v: string) => patch({ adjReason: v }), [patch]);
  const setAdjNote = useCallback((v: string) => patch({ adjNote: v }), [patch]);

  const commitAdjust = useCallback(async () => {
    const m = state.meds.find((x) => x.id === state.adjMed);
    const q = parseIntSafe(state.adjQty);
    if (!m || !q || !state.adjReason) { toast('ต้องเลือกยา จำนวน และเหตุผลให้ครบ'); return; }
    const t = state.adjType!;
    const sign = t === 'return' ? 1 : -1;
    try {
      await runTransaction(db, async (trx) => {
        const ref = doc(db, 'meds', m.id);
        const snap = await trx.get(ref);
        const curFloor = (snap.data() as { floor?: number } | undefined)?.floor ?? m.floor;
        trx.update(ref, { floor: Math.max(0, curFloor + sign * q) });
      });
      await logTx({ type: t, name: m.name, qty: sign * q, unit: m.unit, reason: state.adjReason, note: state.adjNote || '—', loc: 'floor' });
      patch({ adjQty: '', adjReason: '', adjNote: '', adjMed: null, adjSearch: '' });
      toast('บันทึกแล้ว · ' + m.name + ' ' + (sign > 0 ? '+' : '−') + nf(q) + ' ' + m.unit);
    } catch (e) {
      console.error(e);
      toast('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }, [state, logTx, toast, patch]);

  const scrapLot = useCallback(async (lotId: string) => {
    const l = state.lots.find((x) => x.id === lotId);
    if (!l) return;
    const m = state.meds.find((x) => x.id === l.medId);
    if (!m) return;
    try {
      await updateDoc(doc(db, 'lots', lotId), { qty: 0 });
      await logTx({ type: 'expired', name: m.name, qty: -l.qty, unit: m.unit, reason: 'หมดอายุ / ใกล้หมดอายุ', note: 'lot ' + l.lotNo + ' exp ' + thDate(l.exp) + ' · มูลค่า ' + nf(l.qty * m.price) + ' บาท', loc: 'substock' });
      toast('ตัด lot ' + l.lotNo + ' ออกจาก substock แล้ว · บันทึกลง discrepancy log');
    } catch (e) {
      console.error(e);
      toast('ตัด lot ไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }, [state.lots, state.meds, logTx, toast]);

  // ---------- report ----------
  const setReportTab = useCallback((t: AppState['reportTab']) => patch({ reportTab: t }), [patch]);

  const exportReportCsv = useCallback(async () => {
    const st = state;
    const names = { aging: 'stock_aging.csv', turn: 'turnover.csv', disc: 'discrepancy_log.csv' };
    let outcome: Awaited<ReturnType<typeof downloadCsv>>;
    if (st.reportTab === 'aging') {
      const bDef: [string, number, number][] = [['หมดอายุแล้ว', -99999, 0], ['เหลือ ≤ 30 วัน', 0, 30], ['31–90 วัน', 30, 90], ['91–180 วัน', 90, 180], ['มากกว่า 180 วัน', 180, 99999]];
      const rows = bDef.map(([label, lo, hi]) => {
        const ls = st.lots.filter((l) => l.qty > 0 && daysUntil(l.exp) > lo && daysUntil(l.exp) <= hi);
        const val = ls.reduce((s, l) => s + l.qty * (st.meds.find((m) => m.id === l.medId)?.price || 0), 0);
        return [label, ls.length, Math.round(val)];
      });
      outcome = await downloadCsv([['bucket', 'lots', 'value_thb'], ...rows], names.aging);
    } else if (st.reportTab === 'turn') {
      const rows = st.meds.filter((m) => m.active).map((m) => {
        const oh = m.floor + subQty(st, m.id);
        return [m.name, m.unit, oh, m.used30, Math.round(oh / (m.used30 / 30))];
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
        const snap = await getDocs(query(collection(db, 'txs'), orderBy('ts', 'desc')));
        rows = snap.docs
          .map((d) => d.data() as { type: string; ts: number; name: string; qty: number; unit: string; loc?: string; reason?: string; note?: string; by: string })
          .filter((x) => types.indexOf(x.type) >= 0)
          .map((x) => [isoDate(x.ts), x.name, x.type, x.qty, x.unit, x.loc || '', x.reason || '', x.note || '', x.by]);
      } catch (e) { console.error(e); toast('ดึงประวัติไม่สำเร็จ ลองใหม่อีกครั้ง'); return; }
      outcome = await downloadCsv([['date', 'medication', 'type', 'qty', 'unit', 'location', 'reason', 'note', 'performed_by'], ...rows], names.disc);
    }
    if (outcome === 'saved') toast('ดาวน์โหลด ' + names[state.reportTab] + ' แล้ว');
    else if (outcome === 'unavailable') toast('ดาวน์โหลดไฟล์ไม่ได้ในเบราว์เซอร์นี้');
  }, [state, toast]);

  // ---------- labels ----------
  const setLabelType = useCallback((t: AppState['labelType']) => patch({ labelType: t }), [patch]);
  const printLabels = useCallback(() => {
    const meds = state.meds.filter((m) => m.active);
    let labels: PrintLabel[] = [];
    let heading = 'ฉลากตัวยา';
    if (state.labelType === 'med') {
      labels = meds.map((m) => ({ payload: encodeQr('med', m.code), id: m.code, title: m.name, sub: 'หน่วย ' + m.unit + ' · ชั้น ' + m.bin, tag: m.had ? 'HIGH ALERT' : undefined, bin: m.bin }));
    } else if (state.labelType === 'lot') {
      heading = 'ฉลาก lot';
      labels = state.lots.map((l) => {
        const m = meds.find((x) => x.id === l.medId);
        return { payload: encodeQr('lot', l.code), id: l.code, title: m ? m.name : '—', sub: 'lot ' + l.lotNo + ' · exp ' + thDate(l.exp), tag: daysUntil(l.exp) < state.expiryWarnDays ? 'ใกล้หมดอายุ' : undefined };
      });
    } else {
      heading = 'ฉลากชั้นวาง';
      labels = LOCS.map((b) => ({ payload: encodeQr('loc', 'LOC-' + b), id: 'LOC-' + b, title: 'ชั้นจ่ายยา ' + b, sub: 'หน้างาน OPD · สแกนเพื่อเปิดรายการในชั้นนี้' }));
    }
    if (!labels.length) { toast('ไม่มีรายการให้พิมพ์ฉลาก'); return; }
    const ok = printLabelSheet(labels, heading);
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว — เลือกกระดาษสติกเกอร์ A4 แล้วสั่งพิมพ์' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state.meds, state.lots, state.labelType, state.expiryWarnDays, toast]);

  // ---------- settings / par ----------
  const canEditPar = myProfile?.role !== 'tech';

  const applyOnePar = useCallback(async (medId: string, which: 'sub' | 'floor') => {
    if (!canEditPar) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    const sug = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
    try {
      await updateDoc(doc(db, 'meds', medId), which === 'sub' ? { parSub: sug.sub } : { parFloor: sug.floor });
      logAudit({ type: 'par_updated', note: 'ปรับ par' + (which === 'sub' ? 'substock' : 'หน้างาน') + ' ' + m.name + ' เป็น ' + nf(which === 'sub' ? sug.sub : sug.floor) + ' ตามค่าแนะนำจากสถิติ' });
    } catch (e) { console.error(e); toast('ปรับ par ไม่สำเร็จ'); }
  }, [canEditPar, state.meds, state.parFloorCoverDays, state.parSubCoverDays, logAudit, toast]);

  const applyAllSuggested = useCallback(async () => {
    if (!canEditPar) return;
    const targets = state.meds.filter((m) => {
      if (!m.active) return false;
      const s = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
      return s.sub !== m.parSub || s.floor !== m.parFloor;
    });
    try {
      for (let i = 0; i < targets.length; i += 400) {
        const batch = writeBatch(db);
        targets.slice(i, i + 400).forEach((m) => {
          const sug = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
          batch.update(doc(db, 'meds', m.id), { parSub: sug.sub, parFloor: sug.floor });
        });
        await batch.commit();
      }
      logAudit({ type: 'par_updated', note: 'ใช้ค่า par แนะนำจากสถิติทั้งหมด (' + targets.length + ' รายการเปลี่ยนแปลง)' });
      toast('ปรับ par ตามค่าแนะนำแล้ว ' + targets.length + ' รายการ');
    } catch (e) { console.error(e); toast('ปรับ par ไม่สำเร็จ'); }
  }, [canEditPar, state.meds, state.parFloorCoverDays, state.parSubCoverDays, logAudit, toast]);

  const debouncedParWrite = useCallback((medId: string, field: 'parSub' | 'parFloor', val: number) => {
    window.clearTimeout(parDebounce.current[medId + field]);
    parDebounce.current[medId + field] = window.setTimeout(() => {
      updateDoc(doc(db, 'meds', medId), { [field]: val }).catch(() => toast('บันทึกค่า par ไม่สำเร็จ'));
    }, 500);
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
    window.clearTimeout(binDebounce.current[medId]);
    binDebounce.current[medId] = window.setTimeout(() => {
      updateDoc(doc(db, 'meds', medId), { bin: val }).catch(() => toast('บันทึกชั้นวางไม่สำเร็จ'));
    }, 500);
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
  const recomputeUsageStats = useCallback(async () => {
    if (!canEditPar) return;
    toast('กำลังคำนวณสถิติการใช้ยาใหม่จากประวัติ HOSxP…');
    try {
      const snap = await getDocs(query(collection(db, 'txs'), where('type', '==', 'reconcile_hosxp')));
      const now = Date.now();
      const cur: Record<string, number> = {};
      const prev: Record<string, number> = {};
      snap.docs.forEach((d) => {
        const x = d.data() as { name?: string; qty?: number; ts?: number };
        if (!x.name || typeof x.qty !== 'number' || x.qty >= 0 || typeof x.ts !== 'number') return; // only dispensed (negative) entries
        const ageDays = (now - x.ts) / DAY;
        if (ageDays < 0) return;
        if (ageDays <= 30) cur[x.name] = (cur[x.name] || 0) + Math.abs(x.qty);
        else if (ageDays <= 60) prev[x.name] = (prev[x.name] || 0) + Math.abs(x.qty);
      });
      const targets = state.meds.filter((m) => m.active);
      for (let i = 0; i < targets.length; i += 400) {
        const batch = writeBatch(db);
        targets.slice(i, i + 400).forEach((m) => {
          batch.update(doc(db, 'meds', m.id), { used30: Math.round(cur[m.name] || 0), usedPrev30: Math.round(prev[m.name] || 0) });
        });
        await batch.commit();
      }
      logAudit({ type: 'par_updated', note: 'คำนวณสถิติการใช้ยาใหม่จากประวัติ HOSxP 60 วันล่าสุด (' + targets.length + ' รายการ)' });
      toast('คำนวณสถิติใหม่แล้ว ' + targets.length + ' รายการ — กด "ใช้ค่าแนะนำทั้งหมด" ด้านบนอีกครั้งเพื่ออัปเดต par ตามสถิติใหม่');
    } catch (e) { console.error(e); toast('คำนวณสถิติไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }, [canEditPar, state.meds, logAudit, toast]);

  // ---------- meds (formulary) management ----------
  const addMed = useCallback(async (input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; bin: string; parSub: number; parFloor: number }) => {
    if (!canEditPar) return;
    const name = input.name.trim();
    if (!name) { toast('กรอกชื่อยาก่อน'); return; }
    let max = 0;
    state.meds.forEach((m) => {
      const mm = /^MED-(\d+)$/.exec(m.code);
      if (mm) max = Math.max(max, parseInt(mm[1], 10));
    });
    const code = 'MED-' + String(max + 1).padStart(4, '0');
    const med = {
      code, name, unit: input.unit.trim() || 'หน่วย', dosageForm: input.dosageForm.trim(),
      price: input.price || 0, had: input.had, active: true,
      parSub: Math.max(0, input.parSub || 0), parFloor: Math.max(0, input.parFloor || 0), floor: 0,
      bin: input.bin.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8),
      used30: 0, usedPrev30: 0, volatility: 1.1, lastCountTs: Date.now(),
    };
    try {
      await addDoc(collection(db, 'meds'), med);
      logAudit({ type: 'med_added', note: 'เพิ่มยาใหม่ ' + name + ' (' + code + ')' });
      toast('เพิ่ม ' + name + ' แล้ว');
    } catch (e) { console.error(e); toast('เพิ่มยาไม่สำเร็จ'); }
  }, [canEditPar, state.meds, logAudit, toast]);

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
    if (!window.confirm('ลบ "' + m.name + '" ออกจากระบบถาวร? ย้อนกลับไม่ได้ — ถ้าแค่เลิกใช้ชั่วคราวแนะนำให้ "ปิดใช้งาน" แทน')) return;
    try {
      const lotSnap = await getDocs(query(collection(db, 'lots'), where('medId', '==', medId)));
      const batch = writeBatch(db);
      lotSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, 'meds', medId));
      await batch.commit();
      logAudit({ type: 'med_deleted', note: 'ลบยา ' + m.name + ' (' + m.code + ') ออกจากระบบถาวร' });
      toast('ลบ ' + m.name + ' แล้ว');
    } catch (e) { console.error(e); toast('ลบไม่สำเร็จ'); }
  }, [canEditPar, state, logAudit, toast]);

  // ---------- count ----------
  const setCountInput = useCallback((medId: string, v: string) => patch((st) => ({ countInputs: { ...st.countInputs, [medId]: digitsOnly(v) } })), [patch]);

  const commitCount = useCallback(async (medId: string) => {
    const raw = state.countInputs[medId];
    const q = parseInt(raw, 10);
    if (isNaN(q)) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    try {
      let delta = 0;
      await runTransaction(db, async (trx) => {
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
      await logTx({ type: 'count', name: m.name, qty: delta, unit: m.unit, reason: 'นับสต็อกหน้างานประจำรอบ', note, loc: 'floor' });
      toast(m.name + ' — ' + note);
    } catch (e) { console.error(e); toast('บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }, [state.countInputs, state.meds, logTx, toast, patch]);

  // ---------- hosxp reconcile ----------
  const hosxpSample = 'PARACETAMOL 500 mg,340\namlodipine 5 mg,95\nAMOXICILlin 500 mg,140\nCPM 4 mg,60\nEnalapril 5 mg,80\nIbuprofen 400 mg,55\nWARFARIN (สีส้ม) 2 mg,18';
  const setHosxpText = useCallback((v: string) => patch({ hosxpText: v }), [patch]);
  const loadHosxpSample = useCallback(() => patch({ hosxpText: hosxpSample, hosxpRows: null, hosxpConfirmFuzzy: false }), [patch]);

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

  const setHosxpConfirmFuzzy = useCallback((v: boolean) => patch({ hosxpConfirmFuzzy: v }), [patch]);

  const commitReconcile = useCallback(async () => {
    const rows = state.hosxpRows || [];
    const meds = state.meds;
    const hasFuzzy = rows.some((r) => r.match.kind === 'fuzzy');
    if (hasFuzzy && !state.hosxpConfirmFuzzy) { toast('กรุณายืนยันว่าตรวจสอบรายการที่จับคู่แบบไม่ตรงชื่อเป๊ะแล้ว ก่อนตัดยอด'); return; }
    let applied = 0, skipped = 0;
    try {
      for (const r of rows) {
        if (r.qty <= 0) continue;
        // Only 'exact' and 'fuzzy' (human-confirmed above) resolve to a single med — 'ambiguous'
        // and 'none' never touch stock, so a bad name in the source file can't silently
        // deduct from the wrong drug or get dropped without anyone noticing.
        const medId = r.match.kind === 'exact' || r.match.kind === 'fuzzy' ? r.match.medId : null;
        const m = medId ? meds.find((x) => x.id === medId) : null;
        if (!m) { skipped++; continue; }
        let after = 0, before = 0;
        await runTransaction(db, async (trx) => {
          const ref = doc(db, 'meds', m.id);
          const snap = await trx.get(ref);
          before = (snap.data() as { floor?: number } | undefined)?.floor ?? m.floor;
          after = Math.max(0, before - r.qty);
          trx.update(ref, { floor: after });
        });
        await logTx({ type: 'reconcile_hosxp', name: m.name, qty: -(before - after), unit: m.unit, reason: 'นำเข้าจากไฟล์ HOSxP', note: 'จ่ายจริง ' + nf(r.qty) + ' ' + m.unit + ' ตามไฟล์ HOSxP' + (r.match.kind === 'fuzzy' ? ' (จับคู่ชื่อแบบไม่ตรงเป๊ะ — ยืนยันโดยผู้ใช้แล้ว)' : ''), loc: 'floor' });
        applied++;
      }
      patch({ hosxpRows: null, hosxpText: '', hosxpConfirmFuzzy: false });
      toast('ตัดยอดหน้างานตามไฟล์แล้ว ' + applied + ' รายการ' + (skipped ? ' · ข้าม ' + skipped + ' รายการที่จับคู่ไม่ได้' : '') + ' — บันทึกลง discrepancy log');
    } catch (e) { console.error(e); toast('ประมวลผลไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }, [state.hosxpRows, state.hosxpConfirmFuzzy, state.meds, logTx, toast, patch]);

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
        const pool = state.meds.filter((m) => m.active && m.bin === bin);
        med = pool.find((m) => (purpose === 'receive' ? subQty(state, m.id) < m.parSub : m.floor < m.parFloor)) || pool[0] || null;
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
    try {
      await updateDoc(doc(db, 'users', id), { role });
      logAudit({ type: 'user_role_changed', note: 'เปลี่ยนบทบาท ' + u.name + ' จาก ' + roleLabelFor(u.role) + ' เป็น ' + roleLabelFor(role) });
    } catch (e) { console.error(e); toast('เปลี่ยนบทบาทไม่สำเร็จ'); }
  }, [state.users, logAudit, toast]);

  const toggleUserActive = useCallback(async (id: string) => {
    const u = state.users.find((x) => x.id === id);
    if (!u) return;
    const next = !u.active;
    try {
      await updateDoc(doc(db, 'users', id), { active: next });
      logAudit({ type: u.active ? 'user_status_changed' : 'user_approved', note: (next ? (u.active === false && u.createdAt ? 'อนุมัติบัญชี ' : 'เปิดใช้งานบัญชี ') : 'ปิดใช้งานบัญชี ') + u.name });
      toast((next ? 'เปิดใช้งาน' : 'ปิดใช้งาน') + 'บัญชี ' + u.name + ' แล้ว');
    } catch (e) { console.error(e); toast('เปลี่ยนสถานะไม่สำเร็จ'); }
  }, [state.users, logAudit, toast]);

  const exportAudit = useCallback(async () => {
    const typeLabel: Record<string, string> = {
      login: 'เข้าสู่ระบบ', user_registered: 'สมัครสมาชิก', user_approved: 'อนุมัติบัญชี', user_role_changed: 'เปลี่ยนบทบาท', user_status_changed: 'เปิด/ปิดบัญชี', par_updated: 'ปรับ par level', qr_manual: 'กรอกรหัส QR ด้วยมือ',
      med_added: 'เพิ่มยาใหม่', med_status_changed: 'เปิด/ปิดใช้งานยา', med_deleted: 'ลบยาถาวร',
      receive_from_central: 'รับเข้า substock', receive_pending: 'รับเข้า (รออนุมัติ)', transfer_to_floor: 'เติมหน้างาน',
      adjust: 'ปรับยอด', return: 'คืนยา', damaged: 'ยาเสีย/ชำรุด', expired: 'ยาหมดอายุ', count: 'นับสต็อกหน้างาน', reconcile_hosxp: 'นำเข้า HOSxP',
    };
    // Same reasoning as exportReportCsv — the live subscriptions are capped at 300 each for
    // the on-screen "recent activity" feed; a real audit export needs the full history.
    toast('กำลังดึงประวัติทั้งหมด…');
    type Entry = { type: string; by: string; ts: number; note: string };
    let all: Entry[];
    try {
      const [auditSnap, txSnap] = await Promise.all([
        getDocs(query(collection(db, 'auditLog'), orderBy('ts', 'desc'))),
        getDocs(query(collection(db, 'txs'), orderBy('ts', 'desc'))),
      ]);
      all = [
        ...auditSnap.docs.map((d) => d.data() as Entry),
        ...txSnap.docs.map((d) => d.data() as { type: string; by: string; ts: number; name?: string; note?: string })
          .map((x) => ({ type: x.type, by: x.by, ts: x.ts, note: (x.name ? x.name + ' — ' : '') + (x.note || '') })),
      ];
    } catch (e) { console.error(e); toast('ดึงประวัติไม่สำเร็จ ลองใหม่อีกครั้ง'); return; }
    const outcome = await downloadCsv([['date_time', 'event', 'by', 'detail'], ...all.sort((a, b) => b.ts - a.ts).map((e) => [new Date(e.ts).toISOString(), typeLabel[e.type] || e.type, e.by, e.note])], 'audit_log.csv');
    if (outcome === 'saved') toast('ดาวน์โหลด audit_log.csv แล้ว');
  }, [toast]);

  const value = useMemo<AppCtx>(() => ({
    state, myProfile, sub, fefo, userName, roleLabel, roleLabelOf, warn, toast, go, back,
    setAuthMode, setAuthUsername, setAuthPassword, setAuthName, setAuthDept, signIn, signUp, logout, setDevice, seedDatabase, resetData,
    setSearch, setFilter, bump, setCartQty, fillAll, removeFromCart, commitTransfer,
    setRecvNo, setRecvSearch, pickRecvMed, setRecvLot, setRecvExp, setRecvQty, addRecv, removeRecvItem, commitReceive, goReceiveFor,
    pickAdjType, setAdjSearch, pickAdjMed, setAdjQty, setAdjReason, setAdjNote, commitAdjust, scrapLot,
    setReportTab, exportReportCsv,
    setLabelType, printLabels,
    applyOnePar, applyAllSuggested, setParSub, setParFloor, setMedBin, recomputeUsageStats,
    addMed, toggleMedActive, deleteMed,
    setCountInput, commitCount,
    setHosxpText, loadHosxpSample, processHosxp, setHosxpConfirmFuzzy, commitReconcile,
    openScanSearch, closeQr, qrDecoded, qrManual, setQrCode, setQrManualReason, startHadScan,
    doneAgain,
    setAdminTab, setAuditFilter, setUserRole, toggleUserActive, exportAudit,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, myProfile]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
