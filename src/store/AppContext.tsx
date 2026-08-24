import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AppState, Med, Role, Screen, AdjType, AuditEntry, RecvItem, TxType,
} from '../types';
import { loadMasterMeds, seedLots, seedTxs, seedUsers } from '../data/seed';
import { subQty, fefoLot, userNameFor, roleLabelFor, roundStep, suggestPar, suggestTransferQty, daysUntil } from './selectors';
import { nf, thDate, isoDate, parseIntSafe, digitsOnly } from '../utils/format';
import { downloadCsv } from '../utils/csv';

const STORAGE_KEY = 'opd-stock-state-v1';

function freshState(): AppState {
  const meds = loadMasterMeds();
  return {
    meds,
    lots: seedLots(meds),
    txs: seedTxs(meds),
    users: seedUsers(),
    authLog: [],

    screen: 'login',
    prevScreen: 'home',
    role: null,
    online: true,
    device: 'phone',
    pending: 0,

    cart: {},
    search: '',
    filter: 'low',

    recvNo: 'REQ-6908-' + (140 + (Date.now() % 9)),
    recvSearch: '',
    recvMed: null,
    recvLot: '',
    recvExp: '',
    recvQty: '',
    recvItems: [],

    adjType: null,
    adjSearch: '',
    adjMed: null,
    adjQty: '',
    adjReason: '',
    adjNote: '',

    reportTab: 'aging',
    labelType: 'med',

    qrOpen: false,
    qrManualOpen: false,
    qrCode: '',
    qrPurpose: null,
    hadOk: {},
    scanCycle: 0,

    doneKind: null,
    doneRows: [],
    toast: null,

    countInputs: {},
    hosxpText: '',
    hosxpRows: null,

    newUserName: '',
    newUserRole: 'tech',
    newUserDept: 'เภสัชกรรม',

    adminTab: 'users',
    auditFilter: 'all',

    expiryWarnDays: 90,
    parFloorCoverDays: 3,
    parSubCoverDays: 21,
  };
}

function loadState(): AppState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AppState;
      if (parsed && Array.isArray(parsed.meds) && parsed.meds.length) return parsed;
    }
  } catch {
    /* ignore corrupt storage */
  }
  return freshState();
}

export interface AppCtx {
  state: AppState;
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
  doLogin: (role: Role) => void;
  logout: () => void;
  setRole: (role: Role) => void;
  setDevice: (d: 'phone' | 'tablet') => void;
  setOnline: () => void;
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
  setNewUserName: (v: string) => void;
  setNewUserDept: (v: string) => void;
  setNewUserRole: (r: Role) => void;
  addUser: () => void;
  setUserRole: (id: string, r: Role) => void;
  toggleUserActive: (id: string) => void;
  exportAudit: () => void;
}

const Ctx = createContext<AppCtx | null>(null);

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AppState>(loadState);
  const toastTimer = useRef<number | undefined>(undefined);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      /* storage full/unavailable — app still works, just won't persist */
    }
  }, [state]);

  const patch = useCallback((p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
  }, []);

  const sub = useCallback((medId: string) => subQty(state, medId), [state]);
  const fefo = useCallback((medId: string) => fefoLot(state, medId), [state]);
  const userName = useCallback(() => userNameFor(state.role), [state.role]);
  const roleLabel = useCallback(() => roleLabelFor(state.role), [state.role]);
  const roleLabelOf = useCallback((r: Role) => roleLabelFor(r), []);
  const warn = useCallback(() => state.expiryWarnDays, [state.expiryWarnDays]);

  const toast = useCallback((t: string) => {
    patch({ toast: t });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => patch({ toast: null }), 2600);
  }, [patch]);

  const go = useCallback((s: Screen) => {
    setState((st) => ({ ...st, screen: s, prevScreen: st.screen }));
  }, []);

  const back = useCallback(() => {
    setState((st) => ({ ...st, screen: st.screen === 'tconfirm' ? 'transfer' : 'more', prevScreen: st.screen }));
  }, []);

  const logAudit = useCallback((entry: Omit<AuditEntry, 'id' | 'ts' | 'by'> & { by?: string }) => {
    setState((st) => ({
      ...st,
      authLog: [{ id: 'A' + Date.now() + Math.random(), ts: Date.now(), by: entry.by || userNameFor(st.role), ...entry }, ...st.authLog],
    }));
  }, []);

  const logTx = useCallback((tx: Omit<Tx0, 'id' | 'ts' | 'by'>) => {
    setState((st) => {
      const pending = st.online ? st.pending : st.pending + 1;
      return {
        ...st,
        txs: [{ id: 'T' + Date.now() + Math.random(), ts: Date.now(), by: userNameFor(st.role), ...tx }, ...st.txs],
        pending,
      };
    });
  }, []);

  // ---------- auth ----------
  const doLogin = useCallback((role: Role) => {
    setState((st) => ({ ...st, role, screen: 'home' }));
    logAudit({ type: 'login', by: userNameFor(role), note: 'เข้าสู่ระบบในบทบาท ' + roleLabelFor(role) });
  }, [logAudit]);

  const logout = useCallback(() => patch({ role: null, screen: 'login', cart: {} }), [patch]);
  const setRole = useCallback((role: Role) => setState((st) => ({ ...st, role, screen: st.screen === 'login' ? 'home' : st.screen })), []);
  const setDevice = useCallback((d: 'phone' | 'tablet') => patch({ device: d }), [patch]);

  const setOnline = useCallback(() => {
    setState((st) => {
      const on = !st.online;
      if (on && st.pending > 0) {
        const n = st.pending;
        window.setTimeout(() => {
          patch({ pending: 0 });
          toast('sync สำเร็จ ' + n + ' รายการถูกส่งขึ้นระบบกลาง');
        }, 900);
      } else if (!on) {
        window.setTimeout(() => toast('โหมดออฟไลน์ — บันทึกรายการไว้ในเครื่องและ sync ให้เมื่อกลับมาออนไลน์'), 0);
      }
      return { ...st, online: on };
    });
  }, [patch, toast]);

  const resetData = useCallback(() => {
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* noop */ }
    setState(freshState());
  }, []);

  // ---------- transfer ----------
  const setSearch = useCallback((v: string) => patch({ search: v }), [patch]);
  const setFilter = useCallback((f: AppState['filter']) => patch({ filter: f }), [patch]);

  const bump = useCallback((id: string, d: number) => {
    setState((st) => {
      const m = st.meds.find((x) => x.id === id)!;
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
      st.meds.forEach((m) => {
        if (m.floor < m.parFloor) {
          const q = suggestTransferQty(st, m);
          if (q > 0) cart[m.id] = q;
        }
      });
      return { ...st, cart, filter: 'low' };
    });
    toast('ใส่จำนวนตาม par ให้ทุกรายการที่ต่ำกว่าเกณฑ์แล้ว — ปรับได้ก่อนยืนยัน');
  }, [toast]);

  const commitTransfer = useCallback(() => {
    setState((st) => {
      const lots = st.lots.map((l) => ({ ...l }));
      const meds = st.meds.map((m) => ({ ...m }));
      const rows: AppState['doneRows'] = [];
      const txs: AppState['txs'] = [];
      Object.keys(st.cart).forEach((id) => {
        let need = st.cart[id];
        const m = meds.find((x) => x.id === id)!;
        const mine = lots.filter((l) => l.medId === id && l.qty > 0).sort((a, b) => a.exp - b.exp);
        const used: string[] = [];
        for (const l of mine) {
          if (need <= 0) break;
          const take = Math.min(need, l.qty);
          l.qty -= take; need -= take;
          used.push(l.lotNo + ' (' + nf(take) + ')');
        }
        const q = st.cart[id];
        m.floor += q;
        rows.push({ name: m.name, sub: 'lot ' + used.join(', '), qty: nf(q) + ' ' + m.unit });
        txs.push({ id: 'T' + Math.random(), type: 'transfer_to_floor', name: m.name, qty: q, unit: m.unit, from: 'substock', to: 'floor', note: 'FEFO lot ' + used.join(', '), by: userNameFor(st.role), ts: Date.now() });
      });
      const pending = st.online ? st.pending : st.pending + txs.length;
      return { ...st, lots, meds, txs: [...txs, ...st.txs], cart: {}, hadOk: {}, pending, screen: 'done', prevScreen: st.screen, doneKind: 'transfer', doneRows: rows };
    });
  }, []);

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

  const removeRecvItem = useCallback((i: number) => {
    patch((st) => ({ recvItems: st.recvItems.filter((_, j) => j !== i) }));
  }, [patch]);

  const commitReceive = useCallback(() => {
    setState((st) => {
      const approve = st.role !== 'tech';
      if (!approve) {
        const txs = st.recvItems.map((it) => ({ id: 'T' + Date.now() + Math.random(), type: 'receive_pending' as TxType, name: it.name, qty: it.qty, unit: it.unit, note: 'ใบเบิก ' + st.recvNo + ' · lot ' + it.lotNo + ' — รออนุมัติ', loc: 'substock' as const, by: userNameFor(st.role), ts: Date.now() }));
        const pending = st.online ? st.pending : st.pending + txs.length;
        return {
          ...st, txs: [...txs, ...st.txs], pending,
          screen: 'done', prevScreen: st.screen, doneKind: 'recvPending',
          doneRows: st.recvItems.map((it) => ({ name: it.name, sub: 'lot ' + it.lotNo + ' · exp ' + thDate(it.exp), qty: nf(it.qty) + ' ' + it.unit })),
          recvItems: [],
        };
      }
      const lots = st.lots.slice();
      const txs: AppState['txs'] = [];
      st.recvItems.forEach((it, i) => {
        lots.push({ id: 'L' + Date.now() + i, code: 'LOT-' + it.medId.slice(1) + '-n' + i, medId: it.medId, lotNo: it.lotNo, exp: it.exp, qty: it.qty, loc: 'ชั้น bulk' });
        txs.push({ id: 'T' + Math.random() + i, type: 'receive_from_central', name: it.name, qty: it.qty, unit: it.unit, from: 'คลังยาใหญ่', to: 'substock', note: 'ใบเบิก ' + st.recvNo + ' · lot ' + it.lotNo + ' exp ' + thDate(it.exp), by: userNameFor(st.role), ts: Date.now() });
      });
      const pending = st.online ? st.pending : st.pending + txs.length;
      return {
        ...st, lots, txs: [...txs, ...st.txs], pending,
        screen: 'done', prevScreen: st.screen, doneKind: 'receive',
        doneRows: st.recvItems.map((it) => ({ name: it.name, sub: 'lot ' + it.lotNo + ' · exp ' + thDate(it.exp), qty: nf(it.qty) + ' ' + it.unit })),
        recvItems: [],
      };
    });
  }, []);

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

  const commitAdjust = useCallback(() => {
    const m = state.meds.find((x) => x.id === state.adjMed);
    const q = parseIntSafe(state.adjQty);
    if (!m || !q || !state.adjReason) { toast('ต้องเลือกยา จำนวน และเหตุผลให้ครบ'); return; }
    const t = state.adjType!;
    const sign = t === 'return' ? 1 : -1;
    setState((st) => ({
      ...st,
      meds: st.meds.map((x) => (x.id === m.id ? { ...x, floor: Math.max(0, x.floor + sign * q) } : x)),
      adjQty: '', adjReason: '', adjNote: '', adjMed: null, adjSearch: '',
    }));
    logTx({ type: t, name: m.name, qty: sign * q, unit: m.unit, reason: state.adjReason, note: state.adjNote || '—', loc: 'floor' });
    toast('บันทึกแล้ว · ' + m.name + ' ' + (sign > 0 ? '+' : '−') + nf(q) + ' ' + m.unit);
  }, [state, logTx, toast]);

  const scrapLot = useCallback((lotId: string) => {
    const l = state.lots.find((x) => x.id === lotId);
    if (!l) return;
    const m = state.meds.find((x) => x.id === l.medId)!;
    setState((st) => ({ ...st, lots: st.lots.map((x) => (x.id === lotId ? { ...x, qty: 0 } : x)) }));
    logTx({ type: 'expired', name: m.name, qty: -l.qty, unit: m.unit, reason: 'หมดอายุ / ใกล้หมดอายุ', note: 'lot ' + l.lotNo + ' exp ' + thDate(l.exp) + ' · มูลค่า ' + nf(l.qty * m.price) + ' บาท', loc: 'substock' });
    toast('ตัด lot ' + l.lotNo + ' ออกจาก substock แล้ว · บันทึกลง discrepancy log');
  }, [state, logTx, toast]);

  // ---------- report ----------
  const setReportTab = useCallback((t: AppState['reportTab']) => patch({ reportTab: t }), [patch]);

  const exportReportCsv = useCallback(() => {
    const st = state;
    const names = { aging: 'stock_aging.csv', turn: 'turnover.csv', disc: 'discrepancy_log.csv' };
    if (st.reportTab === 'aging') {
      const bDef: [string, number, number][] = [['หมดอายุแล้ว', -99999, 0], ['เหลือ ≤ 30 วัน', 0, 30], ['31–90 วัน', 30, 90], ['91–180 วัน', 90, 180], ['มากกว่า 180 วัน', 180, 99999]];
      const rows = bDef.map(([label, lo, hi]) => {
        const ls = st.lots.filter((l) => l.qty > 0 && daysUntil(l.exp) > lo && daysUntil(l.exp) <= hi);
        const val = ls.reduce((s, l) => s + l.qty * (st.meds.find((m) => m.id === l.medId)?.price || 0), 0);
        return [label, ls.length, Math.round(val)];
      });
      downloadCsv([['bucket', 'lots', 'value_thb'], ...rows], names.aging);
    } else if (st.reportTab === 'turn') {
      const rows = st.meds.filter((m) => m.active).map((m) => {
        const oh = m.floor + subQty(st, m.id);
        return [m.name, m.unit, oh, m.used30, Math.round(oh / (m.used30 / 30))];
      });
      downloadCsv([['medication', 'unit', 'on_hand', 'used_30d', 'days_on_hand'], ...rows], names.turn);
    } else {
      const types = ['adjust', 'return', 'damaged', 'expired', 'count', 'reconcile_hosxp'];
      const rows = st.txs.filter((x) => types.indexOf(x.type) >= 0).map((x) => [isoDate(x.ts), x.name, x.type, x.qty, x.unit, x.loc || '', x.reason || '', x.note || '', x.by]);
      downloadCsv([['date', 'medication', 'type', 'qty', 'unit', 'location', 'reason', 'note', 'performed_by'], ...rows], names.disc);
    }
    toast('ดาวน์โหลด ' + names[state.reportTab] + ' แล้ว');
  }, [state, toast]);

  // ---------- labels ----------
  const setLabelType = useCallback((t: AppState['labelType']) => patch({ labelType: t }), [patch]);
  const printLabels = useCallback(() => toast('ส่งไปยังคิวพิมพ์ — ระบบจริงสร้าง PDF A4 ตามขนาดสติกเกอร์ที่ตั้งไว้'), [toast]);

  // ---------- settings / par ----------
  const applyOnePar = useCallback((medId: string, which: 'sub' | 'floor') => {
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    const sug = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, ...(which === 'sub' ? { parSub: sug.sub } : { parFloor: sug.floor }) } : x)) }));
    logAudit({ type: 'par_updated', note: 'ปรับ par' + (which === 'sub' ? 'substock' : 'หน้างาน') + ' ' + m.name + ' เป็น ' + nf(which === 'sub' ? sug.sub : sug.floor) + ' ตามค่าแนะนำจากสถิติ' });
  }, [state, logAudit]);

  const applyAllSuggested = useCallback(() => {
    let n = 0;
    setState((st) => {
      const meds = st.meds.map((m) => {
        if (!m.active) return m;
        const sug = suggestPar(m, st.parFloorCoverDays, st.parSubCoverDays);
        if (sug.sub !== m.parSub || sug.floor !== m.parFloor) n++;
        return { ...m, parSub: sug.sub, parFloor: sug.floor };
      });
      return { ...st, meds };
    });
    logAudit({ type: 'par_updated', note: 'ใช้ค่า par แนะนำจากสถิติทั้งหมด (' + n + ' รายการเปลี่ยนแปลง)' });
    toast('ปรับ par ตามค่าแนะนำแล้ว ' + n + ' รายการ');
  }, [logAudit, toast]);

  const setParSub = useCallback((medId: string, v: string) => {
    if (state.role === 'tech') return;
    const val = parseIntSafe(v);
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, parSub: val } : x)) }));
  }, [state.role]);

  const setParFloor = useCallback((medId: string, v: string) => {
    if (state.role === 'tech') return;
    const val = parseIntSafe(v);
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, parFloor: val } : x)) }));
  }, [state.role]);

  // ---------- count ----------
  const setCountInput = useCallback((medId: string, v: string) => {
    patch((st) => ({ countInputs: { ...st.countInputs, [medId]: digitsOnly(v) } }));
  }, [patch]);

  const commitCount = useCallback((medId: string) => {
    const raw = state.countInputs[medId];
    const q = parseInt(raw, 10);
    if (isNaN(q)) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    const delta = q - m.floor;
    setState((st) => {
      const ci = { ...st.countInputs };
      delete ci[medId];
      return { ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, floor: q, lastCountTs: Date.now() } : x)), countInputs: ci };
    });
    const note = delta < 0
      ? 'นับได้น้อยกว่าระบบ ' + nf(Math.abs(delta)) + ' ' + m.unit + ' — คาดว่าจ่ายผ่าน HOSxP แต่ยังไม่ reconcile'
      : delta > 0 ? 'นับได้มากกว่าระบบ ' + nf(delta) + ' ' + m.unit + ' — ควรตรวจสอบย้อนหลัง' : 'นับตรงกับระบบ ไม่มีส่วนต่าง';
    logTx({ type: 'count', name: m.name, qty: delta, unit: m.unit, reason: 'นับสต็อกหน้างานประจำรอบ', note, loc: 'floor' });
    toast(m.name + ' — ' + note);
  }, [state, logTx, toast]);

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

  const commitReconcile = useCallback(() => {
    setState((st) => {
      const meds = st.meds.slice();
      const applied: AppState['txs'] = [];
      (st.hosxpRows || []).forEach((r) => {
        const m = meds.find((x) => x.name.toLowerCase().indexOf(r.name.toLowerCase()) >= 0 || r.name.toLowerCase().indexOf(x.name.toLowerCase()) >= 0);
        if (!m || r.qty <= 0) return;
        const idx = meds.indexOf(m);
        const before = m.floor, after = Math.max(0, before - r.qty);
        meds[idx] = { ...m, floor: after };
        applied.push({ id: 'R' + Math.random(), type: 'reconcile_hosxp', name: m.name, qty: -(before - after), unit: m.unit, reason: 'นำเข้าจากไฟล์ HOSxP', note: 'จ่ายจริง ' + nf(r.qty) + ' ' + m.unit + ' ตามไฟล์ HOSxP', loc: 'floor', by: userNameFor(st.role), ts: Date.now() });
      });
      return { ...st, meds, txs: [...applied, ...st.txs], hosxpRows: null, hosxpText: '' };
    });
    toast('ตัดยอดหน้างานตามไฟล์แล้ว — บันทึกลง discrepancy log');
  }, [toast]);

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
      // bump after state settles
      window.setTimeout(() => bumpRef.current?.(m.id, 1), 0);
      return { ...next, search: m.name, filter: 'all' };
    });
  }, [toast]);
  const bumpRef = useRef<typeof bump>();
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
  const setNewUserName = useCallback((v: string) => patch({ newUserName: v }), [patch]);
  const setNewUserDept = useCallback((v: string) => patch({ newUserDept: v }), [patch]);
  const setNewUserRole = useCallback((r: Role) => patch({ newUserRole: r }), [patch]);

  const addUser = useCallback(() => {
    const name = state.newUserName.trim();
    if (!name) { toast('กรอกชื่อผู้ใช้ก่อน'); return; }
    const u = { id: 'U' + Date.now(), name, role: state.newUserRole, dept: state.newUserDept.trim() || 'เภสัชกรรม', active: true, lastLogin: null };
    setState((st) => ({ ...st, users: [u, ...st.users], newUserName: '', newUserDept: 'เภสัชกรรม' }));
    logAudit({ type: 'user_added', note: 'เพิ่มผู้ใช้ ' + u.name + ' (' + roleLabelFor(u.role) + ', ' + u.dept + ')' });
    toast('เพิ่มผู้ใช้ ' + u.name + ' แล้ว');
  }, [state, logAudit, toast]);

  const setUserRole = useCallback((id: string, role: Role) => {
    const u = state.users.find((x) => x.id === id);
    if (!u || u.role === role) return;
    setState((st) => ({ ...st, users: st.users.map((x) => (x.id === id ? { ...x, role } : x)) }));
    logAudit({ type: 'user_role_changed', note: 'เปลี่ยนบทบาท ' + u.name + ' จาก ' + roleLabelFor(u.role) + ' เป็น ' + roleLabelFor(role) });
  }, [state.users, logAudit]);

  const toggleUserActive = useCallback((id: string) => {
    const u = state.users.find((x) => x.id === id);
    if (!u) return;
    const next = !u.active;
    setState((st) => ({ ...st, users: st.users.map((x) => (x.id === id ? { ...x, active: next } : x)) }));
    logAudit({ type: 'user_status_changed', note: (next ? 'เปิดใช้งานบัญชี ' : 'ปิดใช้งานบัญชี ') + u.name });
    toast((next ? 'เปิด' : 'ปิด') + 'ใช้งานบัญชี ' + u.name + ' แล้ว');
  }, [state.users, logAudit, toast]);

  const exportAudit = useCallback(() => {
    const typeLabel: Record<string, string> = { login: 'เข้าสู่ระบบ', user_added: 'เพิ่มผู้ใช้', user_role_changed: 'เปลี่ยนบทบาท', user_status_changed: 'เปิด/ปิดบัญชี', par_updated: 'ปรับ par level', receive_from_central: 'รับเข้า substock', receive_pending: 'รับเข้า (รออนุมัติ)', transfer_to_floor: 'เติมหน้างาน', adjust: 'ปรับยอด', return: 'คืนยา', damaged: 'ยาเสีย/ชำรุด', expired: 'ยาหมดอายุ', count: 'นับสต็อกหน้างาน', reconcile_hosxp: 'นำเข้า HOSxP' };
    const all = [
      ...state.authLog,
      ...state.txs.map((x) => ({ type: x.type, by: x.by, ts: x.ts, note: (x.name ? x.name + ' — ' : '') + (x.note || '') })),
    ];
    downloadCsv([['date_time', 'event', 'by', 'detail'], ...all.sort((a, b) => b.ts - a.ts).map((e) => [new Date(e.ts).toISOString(), typeLabel[e.type] || e.type, e.by, e.note])], 'audit_log.csv');
    toast('ดาวน์โหลด audit_log.csv แล้ว');
  }, [state.authLog, state.txs, toast]);

  const value = useMemo<AppCtx>(() => ({
    state, sub, fefo, userName, roleLabel, roleLabelOf, warn, toast, go, back,
    doLogin, logout, setRole, setDevice, setOnline, resetData,
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
    setAdminTab, setAuditFilter, setNewUserName, setNewUserDept, setNewUserRole, addUser, setUserRole, toggleUserActive, exportAudit,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}

// local alias to avoid importing Tx type name clash above
type Tx0 = import('../types').Tx;
