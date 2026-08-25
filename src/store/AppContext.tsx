import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
} from 'firebase/auth';
import {
  collection, doc, onSnapshot, query, orderBy, limit, writeBatch, addDoc, updateDoc, setDoc,
  runTransaction, getDocs,
} from 'firebase/firestore';
import { auth, db } from '../firebase';
import type {
  AppState, Med, Role, Screen, AdjType, RecvItem, TxType, User, AuthMode,
} from '../types';
import { seedInitialData } from '../data/seedFirestore';
import { subQty, fefoLot, roleLabelFor, suggestPar, suggestTransferQty, daysUntil } from './selectors';
import { nf, thDate, isoDate, parseIntSafe, digitsOnly } from '../utils/format';
import { downloadCsv } from '../utils/csv';

function freshState(): AppState {
  return {
    meds: [], lots: [], txs: [], users: [], authLog: [], dbReady: false,

    authStatus: 'loading', authMode: 'login', myUid: null,
    authEmail: '', authPassword: '', authName: '', authDept: 'เภสัชกรรม', authError: null, authBusy: false,

    screen: 'login', prevScreen: 'home', role: null, online: navigator.onLine, device: 'phone', pending: 0,

    cart: {}, search: '', filter: 'low',

    recvNo: 'REQ-6908-' + (140 + (Date.now() % 9)), recvSearch: '', recvMed: null, recvLot: '', recvExp: '', recvQty: '', recvItems: [],

    adjType: null, adjSearch: '', adjMed: null, adjQty: '', adjReason: '', adjNote: '',

    reportTab: 'aging', labelType: 'med',

    qrOpen: false, qrManualOpen: false, qrCode: '', qrPurpose: null, hadOk: {}, scanCycle: 0,

    doneKind: null, doneRows: [], toast: null,

    countInputs: {}, hosxpText: '', hosxpRows: null,

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
  setAuthEmail: (v: string) => void;
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

  // count
  setCountInput: (medId: string, v: string) => void;
  commitCount: (medId: string) => void;

  // hosxp reconcile
  setHosxpText: (v: string) => void;
  loadHosxpSample: () => void;
  processHosxp: () => void;
  commitReconcile: () => void;

  // qr
  openScanSearch: (purpose: string) => void;
  closeQr: () => void;
  qrSuccess: () => void;
  qrManual: () => void;
  setQrCode: (v: string) => void;
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
  'auth/invalid-email': 'อีเมลไม่ถูกต้อง',
  'auth/user-disabled': 'บัญชีนี้ถูกปิดใช้งาน',
  'auth/user-not-found': 'ไม่พบบัญชีนี้',
  'auth/wrong-password': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'auth/invalid-credential': 'อีเมลหรือรหัสผ่านไม่ถูกต้อง',
  'auth/email-already-in-use': 'อีเมลนี้ถูกใช้สมัครไปแล้ว',
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
    try { await addDoc(collection(db, 'auditLog'), { ...entry, by: userName(), ts: Date.now() }); } catch { /* best-effort */ }
  }, [userName]);

  const logTx = useCallback(async (tx: Omit<import('../types').Tx, 'id' | 'ts' | 'by'>) => {
    try { await addDoc(collection(db, 'txs'), { ...tx, by: userName(), ts: Date.now() }); } catch { /* best-effort */ }
  }, [userName]);

  // ---------- auth actions ----------
  const setAuthMode = useCallback((m: AuthMode) => patch({ authMode: m, authError: null }), [patch]);
  const setAuthEmail = useCallback((v: string) => patch({ authEmail: v }), [patch]);
  const setAuthPassword = useCallback((v: string) => patch({ authPassword: v }), [patch]);
  const setAuthName = useCallback((v: string) => patch({ authName: v }), [patch]);
  const setAuthDept = useCallback((v: string) => patch({ authDept: v }), [patch]);

  const signIn = useCallback(async () => {
    const email = state.authEmail.trim();
    const password = state.authPassword;
    if (!email || !password) { patch({ authError: 'กรอกอีเมลและรหัสผ่าน' }); return; }
    patch({ authBusy: true, authError: null });
    try {
      const cred = await signInWithEmailAndPassword(auth, email, password);
      await setDoc(doc(db, 'users', cred.user.uid), { lastLogin: Date.now() }, { merge: true });
    } catch (e) {
      patch({ authError: authErrorMessage(e) });
    } finally {
      patch({ authBusy: false });
    }
  }, [state.authEmail, state.authPassword, patch]);

  const signUp = useCallback(async () => {
    const email = state.authEmail.trim();
    const password = state.authPassword;
    const name = state.authName.trim();
    const dept = state.authDept.trim() || 'เภสัชกรรม';
    if (!email || !password || !name) { patch({ authError: 'กรอกชื่อ อีเมล และรหัสผ่านให้ครบ' }); return; }
    if (password.length < 6) { patch({ authError: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' }); return; }
    patch({ authBusy: true, authError: null });
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, password);
      const profile: Omit<User, 'id'> = { email, name, role: 'tech', dept, active: false, createdAt: Date.now(), lastLogin: null };
      await setDoc(doc(db, 'users', cred.user.uid), profile);
    } catch (e) {
      patch({ authError: authErrorMessage(e) });
    } finally {
      patch({ authBusy: false });
    }
  }, [state.authEmail, state.authPassword, state.authName, state.authDept, patch]);

  const logout = useCallback(() => { signOut(auth); patch({ cart: {}, authEmail: '', authPassword: '' }); }, [patch]);
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
      const types = ['adjust', 'return', 'damaged', 'expired', 'count', 'reconcile_hosxp'];
      const rows = st.txs.filter((x) => types.indexOf(x.type) >= 0).map((x) => [isoDate(x.ts), x.name, x.type, x.qty, x.unit, x.loc || '', x.reason || '', x.note || '', x.by]);
      outcome = await downloadCsv([['date', 'medication', 'type', 'qty', 'unit', 'location', 'reason', 'note', 'performed_by'], ...rows], names.disc);
    }
    if (outcome === 'saved') toast('ดาวน์โหลด ' + names[state.reportTab] + ' แล้ว');
    else if (outcome === 'unavailable') toast('ดาวน์โหลดไฟล์ไม่ได้ในเบราว์เซอร์นี้');
  }, [state, toast]);

  // ---------- labels ----------
  const setLabelType = useCallback((t: AppState['labelType']) => patch({ labelType: t }), [patch]);
  const printLabels = useCallback(() => toast('ส่งไปยังคิวพิมพ์ — ระบบจริงสร้าง PDF A4 ตามขนาดสติกเกอร์ที่ตั้งไว้'), [toast]);

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
  const loadHosxpSample = useCallback(() => patch({ hosxpText: hosxpSample, hosxpRows: null }), [patch]);

  const processHosxp = useCallback(() => {
    const lines = state.hosxpText.split('\n').map((l) => l.trim()).filter(Boolean);
    const rows = lines.map((l) => {
      const idx = l.lastIndexOf(',');
      if (idx < 0) return null;
      const name = l.slice(0, idx).trim();
      const qty = parseIntSafe(l.slice(idx + 1));
      return { name, qty };
    }).filter((x): x is { name: string; qty: number } => !!x);
    if (!rows.length) { toast('วางข้อมูล CSV รูปแบบ "ชื่อยา,จำนวน" ก่อนประมวลผล'); return; }
    patch({ hosxpRows: rows });
  }, [state.hosxpText, patch, toast]);

  const commitReconcile = useCallback(async () => {
    const rows = state.hosxpRows || [];
    const meds = state.meds;
    let applied = 0;
    try {
      for (const r of rows) {
        const m = meds.find((x) => x.name.toLowerCase().indexOf(r.name.toLowerCase()) >= 0 || r.name.toLowerCase().indexOf(x.name.toLowerCase()) >= 0);
        if (!m || r.qty <= 0) continue;
        let after = 0, before = 0;
        await runTransaction(db, async (trx) => {
          const ref = doc(db, 'meds', m.id);
          const snap = await trx.get(ref);
          before = (snap.data() as { floor?: number } | undefined)?.floor ?? m.floor;
          after = Math.max(0, before - r.qty);
          trx.update(ref, { floor: after });
        });
        await logTx({ type: 'reconcile_hosxp', name: m.name, qty: -(before - after), unit: m.unit, reason: 'นำเข้าจากไฟล์ HOSxP', note: 'จ่ายจริง ' + nf(r.qty) + ' ' + m.unit + ' ตามไฟล์ HOSxP', loc: 'floor' });
        applied++;
      }
      patch({ hosxpRows: null, hosxpText: '' });
      toast('ตัดยอดหน้างานตามไฟล์แล้ว ' + applied + ' รายการ — บันทึกลง discrepancy log');
    } catch (e) { console.error(e); toast('ประมวลผลไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }, [state.hosxpRows, state.meds, logTx, toast, patch]);

  // ---------- qr ----------
  const openScanSearch = useCallback((purpose: string) => patch({ qrOpen: true, qrPurpose: purpose }), [patch]);
  const closeQr = useCallback(() => patch({ qrOpen: false, qrManualOpen: false }), [patch]);
  const qrManual = useCallback(() => patch((st) => ({ qrManualOpen: !st.qrManualOpen })), [patch]);
  const setQrCode = useCallback((v: string) => patch({ qrCode: v }), [patch]);

  const pickScan = useCallback((kind: 'receive' | 'transfer') => {
    setState((st) => {
      const meds = st.meds.filter((m) => m.active);
      let pool = kind === 'receive' ? meds.filter((m) => subQty(st, m.id) < m.parSub) : meds.filter((m) => m.floor < m.parFloor);
      if (!pool.length) pool = meds;
      if (!pool.length) return { ...st, qrOpen: false, qrManualOpen: false, qrCode: '' };
      const cyc = st.scanCycle || 0;
      const m = pool[cyc % pool.length];
      const next = { ...st, qrOpen: false, qrManualOpen: false, qrCode: '', scanCycle: cyc + 1 };
      if (kind === 'receive') {
        window.setTimeout(() => toast('สแกนพบ ' + m.name + ' ที่ substock — กรอก lot วันหมดอายุ และจำนวนที่รับ'), 0);
        return { ...next, recvMed: m.id, recvSearch: m.name, recvLot: '', recvExp: '', recvQty: '' };
      }
      window.setTimeout(() => toast('สแกนพบ ' + m.name + ' ที่ชั้นจ่ายยา — ปรับจำนวนแล้วยืนยัน'), 0);
      window.setTimeout(() => bumpRef.current?.(m.id, 1), 0);
      return { ...next, search: m.name, filter: 'all' };
    });
  }, [toast]);
  const bumpRef = useRef<typeof bump>(undefined);
  bumpRef.current = bump;

  const qrSuccess = useCallback(() => {
    const p = state.qrPurpose;
    if (p === 'receive' || p === 'transfer') { pickScan(p); return; }
    setState((st) => ({ ...st, qrOpen: false, qrManualOpen: false, qrCode: '', hadOk: { ...st.hadOk, [p as string]: true } }));
    toast('ยืนยัน QR สำเร็จ — ทำรายการ high alert ต่อได้');
  }, [state.qrPurpose, pickScan, toast]);

  const startHadScan = useCallback((medId: string) => patch({ qrOpen: true, qrPurpose: medId }), [patch]);

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
      login: 'เข้าสู่ระบบ', user_registered: 'สมัครสมาชิก', user_approved: 'อนุมัติบัญชี', user_role_changed: 'เปลี่ยนบทบาท', user_status_changed: 'เปิด/ปิดบัญชี', par_updated: 'ปรับ par level',
      receive_from_central: 'รับเข้า substock', receive_pending: 'รับเข้า (รออนุมัติ)', transfer_to_floor: 'เติมหน้างาน',
      adjust: 'ปรับยอด', return: 'คืนยา', damaged: 'ยาเสีย/ชำรุด', expired: 'ยาหมดอายุ', count: 'นับสต็อกหน้างาน', reconcile_hosxp: 'นำเข้า HOSxP',
    };
    const all = [
      ...state.authLog,
      ...state.txs.map((x) => ({ type: x.type, by: x.by, ts: x.ts, note: (x.name ? x.name + ' — ' : '') + (x.note || '') })),
    ];
    const outcome = await downloadCsv([['date_time', 'event', 'by', 'detail'], ...all.sort((a, b) => b.ts - a.ts).map((e) => [new Date(e.ts).toISOString(), typeLabel[e.type] || e.type, e.by, e.note])], 'audit_log.csv');
    if (outcome === 'saved') toast('ดาวน์โหลด audit_log.csv แล้ว');
  }, [state.authLog, state.txs, toast]);

  const value = useMemo<AppCtx>(() => ({
    state, myProfile, sub, fefo, userName, roleLabel, roleLabelOf, warn, toast, go, back,
    setAuthMode, setAuthEmail, setAuthPassword, setAuthName, setAuthDept, signIn, signUp, logout, setDevice, seedDatabase, resetData,
    setSearch, setFilter, bump, setCartQty, fillAll, removeFromCart, commitTransfer,
    setRecvNo, setRecvSearch, pickRecvMed, setRecvLot, setRecvExp, setRecvQty, addRecv, removeRecvItem, commitReceive, goReceiveFor,
    pickAdjType, setAdjSearch, pickAdjMed, setAdjQty, setAdjReason, setAdjNote, commitAdjust, scrapLot,
    setReportTab, exportReportCsv,
    setLabelType, printLabels,
    applyOnePar, applyAllSuggested, setParSub, setParFloor,
    setCountInput, commitCount,
    setHosxpText, loadHosxpSample, processHosxp, commitReconcile,
    openScanSearch, closeQr, qrSuccess, qrManual, setQrCode, startHadScan,
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
