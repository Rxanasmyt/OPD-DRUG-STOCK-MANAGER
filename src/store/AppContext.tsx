import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import {
  onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut,
  setPersistence, browserLocalPersistence, browserSessionPersistence,
} from 'firebase/auth';
import {
  collection, doc, onSnapshot, query, orderBy, limit, where, writeBatch, addDoc, updateDoc, setDoc,
  runTransaction, getDocs, getDoc, getCountFromServer, increment, deleteField, serverTimestamp, waitForPendingWrites, type Transaction,
} from 'firebase/firestore';
import { auth, db, usernameToEmail, normalizeUsername, USERNAME_RE } from '../firebase';
import type {
  AppState, Med, Role, Screen, AdjType, RecvItem, TxType, AuditType, User, AuthMode, PendingReceive, Ward, DailyMetrics, UsageHistoryRecord, ParAdjustmentRecord,
} from '../types';
import { seedInitialData } from '../data/seedFirestore';
import { subQty, fefoLot, roleLabelFor, suggestPar, suggestTransferQty, daysUntil, matchHosxpMed, DAY, wardOf, wardLabel, usesSubstock, floorMinOf, halfOfMaxRounded, isUrgentLow, needsWarehouseRequest, lastReconcileDateIso, isSharedMed, matchesWard, binFor, binDisplayAll, usageAnomalies, daysOfStockLeft, categoryStats, dailyUsageRate, toneFor, packStep, isOnStockHold, categoryOf } from './selectors';
import { nf, thDate, isoDate, parseIntSafe, digitsOnly } from '../utils/format';
import { downloadCsv } from '../utils/csv';
import { encodeQr, parseQr } from '../utils/qr';
import { shortLabelName } from '../utils/labelName';
import { printLabelSheet, printPickListSheet, printExecutiveSummarySheet, type PrintLabel, type ExecSummaryStat, type ExecSummaryRow } from '../utils/print';
import { parseHosxpUsageWorkbook, parseUsageCsvTextWithSkipped, splitNameQty, type RawUsageRow } from '../utils/usageImport';
import { LOCS, FRIDGE_LOCS } from '../data/locations';
import { suggestCategoryId } from '../data/categorySuggest';
import { suggestRoute } from '../data/routeSuggest';
import { categoryLabel } from '../data/categories';
import { withTimeout, TimeoutError } from '../utils/timeout';
import { readNotifyEnabled, writeNotifyEnabled, readLowStockNotifyEnabled, writeLowStockNotifyEnabled, requestPermission, currentPermission, maybeNotifyExpiring, maybeNotifyLowStock } from '../utils/notify';
import { hapticSuccess, hapticError } from '../utils/haptic';

// Caps navStack length so a session left open for days (this is a PWA people keep pinned,
// not something reloaded every visit) can't grow it unboundedly — nothing needs more than a
// handful of levels of "back" to make sense.
function pushNav(stack: Screen[], current: Screen): Screen[] {
  const next = stack.concat(current);
  return next.length > 20 ? next.slice(next.length - 20) : next;
}

// Bug fix (real data-loss risk — audit finding): the เติมหน้างาน cart and the รับเข้า recvItems
// list are the two forms where real staff TIME, not just typed text, is at stake — the
// comments right next to both already describe this as "several minutes of walking the
// shelves deciding quantities" — yet both lived purely in this component's in-memory state,
// never written anywhere until the final commit button. A crashed tab, an accidental
// swipe-back/refresh, or the tablet's own hourly SW-update check landing badly meant the whole
// batch vanished with no warning and no way back, forcing a full re-walk of the shelves. Mirrors
// the theme-preference localStorage pattern already used elsewhere in this file, but keyed by
// Firebase uid (not just "this device") so a shared tablet handed to a different person never
// shows them someone else's half-built cart — see readPersisted/writePersisted's own callers for
// exactly where each is read/written and cleared.
const PERSIST_MAX_AGE_MS = 8 * 60 * 60 * 1000; // one work shift — older than this reads as abandoned, not worth restoring
function cartStorageKey(uid: string): string { return 'opd-cart-' + uid; }
function recvStorageKey(uid: string): string { return 'opd-recv-' + uid; }
function writePersisted<T>(key: string, value: T): void {
  try {
    localStorage.setItem(key, JSON.stringify({ ts: Date.now(), value }));
  } catch { /* localStorage unavailable (private mode, quota) — in-memory state still works, just unprotected */ }
}
function readPersisted<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { ts?: number; value?: T };
    if (typeof parsed.ts !== 'number' || Date.now() - parsed.ts > PERSIST_MAX_AGE_MS) {
      localStorage.removeItem(key); // stale — clear it so it never resurfaces on some future login
      return null;
    }
    return parsed.value ?? null;
  } catch { return null; }
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

// Bug fix (usability): bin/binIpd/binSub text is never itself encoded into a QR — the
// printed labels' QR always carries the med's own code, this is just the display text on
// the tag (and what a scanned FLOOR location QR, a separate fixed LOCS list, gets matched
// against) — so there was never a real QR-format reason to reject Thai script or "-", even
// though staff naturally write shelf codes like "ตู้ยา-1" in Thai. Widened to match sanitizeBin
// (MedsScreen.tsx) exactly, so the client-side preview and this server-side write can never
// disagree about what's a valid shelf code.
function normBin(v: string): string {
  return v.trim().toUpperCase().replace(/[^A-Z0-9\u0E00-\u0E7F-]/g, '').slice(0, 10);
}

// Thai label for every TxType/AuditType this app ever logs — shared by exportAudit() and
// exportAllReports() (both need to turn a raw type string into something a person reading a
// spreadsheet actually understands) so a newly added type only ever needs a label added once,
// in one place. Module-scope (not per-render state) since it's a pure constant.
const EVENT_TYPE_LABEL: Record<string, string> = {
  login: 'เข้าสู่ระบบ', user_registered: 'สมัครสมาชิก', user_approved: 'อนุมัติบัญชี', user_role_changed: 'เปลี่ยนบทบาท', user_status_changed: 'เปิด/ปิดบัญชี', par_updated: 'ปรับ par level', qr_manual: 'กรอกรหัส QR ด้วยมือ',
  med_added: 'เพิ่มยาใหม่', med_edited: 'แก้ไขข้อมูลยา', med_status_changed: 'เปิด/ปิดใช้งานยา', med_deleted: 'ลบยาถาวร',
  receive_from_central: 'รับเข้า substock', receive_pending: 'รับเข้า (รออนุมัติ)', receive_rejected: 'ปฏิเสธคำขอรับเข้า', transfer_to_floor: 'เติมหน้างาน',
  adjust: 'ปรับยอด', return: 'คืนยา', damaged: 'ยาเสีย/ชำรุด', expired: 'ยาหมดอายุ', count: 'นับสต็อกหน้างาน', reconcile_hosxp: 'นำเข้า HOSxP',
  hosxp_unmatched: 'ยาที่จับคู่ไม่ได้จาก HOSxP',
  ward_move_out: 'ย้ายชั้นวาง (ต้นทาง)', ward_move_in: 'ย้ายชั้นวาง (ปลายทาง)',
  stock_drift_detected: 'ตรวจพบความเพี้ยนของยอดคงคลัง (ตรวจสอบอัตโนมัติ)',
};

function freshState(): AppState {
  return {
    meds: [], lots: [], txs: [], users: [], authLog: [], dbReady: false,

    authStatus: 'loading', authMode: 'login', myUid: null,
    authUsername: '', authPassword: '', authName: '', authDept: 'เภสัชกรรม', authError: null, authBusy: false, authRemember: true,

    screen: 'login', navStack: [], role: null, online: navigator.onLine, syncing: false, device: 'phone', pending: 0,

    cart: {}, search: '', filter: 'low', wardFilter: 'all',

    wmFromSearch: '', wmFromMed: null, wmToSearch: '', wmToMed: null, wmQty: '', wmReason: '',

    recvNo: 'REQ-6908-' + (140 + (Date.now() % 9)), recvSearch: '', recvMed: null, recvLot: '', recvExp: '', recvQty: '', recvItems: [],
    pendingReceives: [],

    adjType: null, adjSearch: '', adjMed: null, adjQty: '', adjReason: '', adjNote: '',

    reportTab: 'aging', labelType: 'med', labelSelected: {}, locScope: 'floor', labelWardScope: 'all',

    qrOpen: false, qrManualOpen: false, qrCode: '', qrManualReason: '', qrPurpose: null, scanConfirmMedId: null, hadOk: {},

    doneKind: null, doneRows: [], toast: null,

    countInputs: {}, subCountInputs: {}, hosxpText: '', hosxpRows: null, hosxpConfirmFuzzy: false, hosxpConfirmSingleDay: false,

    usageDateFrom: '', usageDateTo: '', usageFileName: null, usageRows: null, usageConfirmFuzzy: false,

    medsFocusId: null,
    substockFocusId: null,

    adminTab: 'users', auditFilter: 'all',
    historyFrom: '', historyTo: '', historyResults: null, historyLoading: false, historyTruncated: false,

    // Bug fix (real-world safety margin): parSubCoverDays was a flat 21 days — exactly the
    // worst-case gap between two central-warehouse deliveries (this hospital's real cycle is
    // weeks 1 and 3 of the month, up to ~2-3 weeks apart depending on the calendar) with ZERO
    // room left for the supplier delay this hospital actually experiences (up to ~1 more week
    // when a manufacturer doesn't ship on time). 21 days meant substock could hit zero exactly
    // when everything was going right, with no buffer for when it doesn't. Bumped to 28 days
    // (~4 weeks: the ~3-week worst-case cycle + about a week of delay buffer, rounded to a
    // clean number) — a fresh/reset deployment starts with real headroom baked in. This is only
    // the default for a project with no meta/settings doc yet; an existing hospital deployment
    // keeps whatever it already has saved until someone updates "par substock สำรอง (วัน)" in
    // หน้าตั้งค่า themselves (see updateGlobalSettings below).
    //
    // parFloorCoverDays similarly bumped 3 → 4: the shelf (หน้างาน) is topped up from substock
    // every weekday but never on เสาร์-อาทิตย์ — a Friday top-up has to last through Friday AND
    // the whole weekend until Monday's top-up, a real 3-calendar-day gap even when everything
    // goes perfectly. 3 days of cover was exactly that gap with zero slack; 4 leaves a day of
    // real margin for the weekend gap plus the ordinary variance of a short-staffed team not
    // always managing every single weekday top-up (see the "เร่งด่วนวันนี้" fill mode above —
    // deferring a merely-below-Min item a day or two is the whole point of that feature, so Max
    // needs enough room to absorb that without the shelf actually running dry).
    expiryWarnDays: 90, parFloorCoverDays: 4, parSubCoverDays: 28,

    confirmDialog: null,
    promptDialog: null,
    updateAvailable: false,
    busy: {},
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
  /** In-app replacement for window.prompt() — see promptDialog's doc comment in types.ts.
   * Resolves the trimmed text on confirm, null on cancel. Used directly by screens (unlike
   * confirmAsync, which only AppContext's own actions call internally). */
  promptAsync: (message: string) => Promise<string | null>;
  /** Answers the currently-shown in-app prompt dialog (state.promptDialog) — see
   * PromptDialog.tsx. */
  respondPrompt: (v: string | null) => void;
  /** Activates the new service worker waiting since state.updateAvailable went true, then
   * reloads once it takes over — see UpdateBanner.tsx. The only place this app ever reloads
   * itself on a version change; never automatic. */
  applyUpdate: () => void;
  /** Dismisses the "มีเวอร์ชันใหม่" banner without applying it — the update stays downloaded
   * and waiting; applyUpdate() (or just closing/reopening the app later) picks it up whenever. */
  dismissUpdate: () => void;
  // ยาใกล้หมดอายุ notification — per-device opt-in, see utils/notify.ts.
  notifyEnabled: boolean;
  notifyPermission: NotificationPermission;
  enableExpiryNotify: () => void;
  disableExpiryNotify: () => void;
  // ยาต่ำกว่า Min notification — same per-device opt-in shape, independent toggle.
  lowStockNotifyEnabled: boolean;
  enableLowStockNotify: () => void;
  disableLowStockNotify: () => void;
  go: (s: Screen) => void;
  back: () => void;
  /** Marks whether a form with real unsaved edits is currently open — see go()'s own doc
   * comment. Call with `true` while dirty, `false` once saved/cancelled/reset (including on
   * unmount, so a stale `true` can't outlive the form itself). */
  setFormDirty: (dirty: boolean) => void;
  /** For any dismiss path other than go() that can close a dirty form — resolves true (safe to
   * proceed) immediately if nothing's dirty, otherwise asks first. See BottomSheet usage in
   * MedsScreen.tsx for the intended caller. */
  confirmLeaveIfDirty: () => Promise<boolean>;

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
  fillUrgent: () => void;
  printPickList: () => void;
  printTodayReplenishList: () => void;
  printWarehouseRequestList: () => void;
  removeFromCart: (id: string) => void;
  /** Empties the whole fill cart in one action — the only way out of a mis-built cart used
   * to be removing rows one at a time (or committing a transfer nobody wanted). */
  clearCart: () => void;
  commitTransfer: () => void;

  // receive
  setRecvNo: (v: string) => void;
  setRecvSearch: (v: string) => void;
  pickRecvMed: (medId: string) => void;
  setRecvLot: (v: string) => void;
  setRecvExp: (v: string) => void;
  setRecvQty: (v: string) => void;
  /** `scanNext: true` adds the item then reopens the camera for the next receive scan — see
   * ReceiveConfirmSheet.tsx (same "one scan, one confirm" request as ScanConfirmSheet). */
  addRecv: (opts?: { scanNext?: boolean }) => void;
  /** Closes ReceiveConfirmSheet without adding — resets the in-progress pick/lot/exp/qty. */
  cancelReceivePick: () => void;
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
  exportAllReports: () => void;
  printExecutiveSummary: () => void;

  // labels
  setLabelType: (t: AppState['labelType']) => void;
  /** Switches the "ฉลากตัวยา"-style shelf-strip labels the "ฉลากชั้นวาง" tab's substock mode
   * builds between the floor's own bin/binIpd and substock's binSub — see AppState.locScope. */
  setLocScope: (s: AppState['locScope']) => void;
  /** Scopes the "ฉลากตัวยา" tab to one ward's shelf-strip labels only — see
   * AppState.labelWardScope. */
  setLabelWardScope: (s: AppState['labelWardScope']) => void;
  /** Toggle one med in the label picker (see LabelsScreen.tsx). */
  toggleLabelSelected: (medId: string) => void;
  /** Check every one of the given med ids at once — used for the picker's "เลือกทั้งหมด" over
   * whatever's currently matching the search box, not literally every med in the formulary. */
  selectAllLabels: (medIds: string[]) => void;
  clearLabelSelected: () => void;
  printLabels: () => void;

  // settings / par
  applyOnePar: (medId: string, which: 'sub' | 'floor') => void;
  applyAllSuggested: () => void;
  setAllMinHalfOfMax: () => void;
  setParSub: (medId: string, v: string) => void;
  setParFloor: (medId: string, v: string) => void;
  setMedBin: (medId: string, v: string) => void;
  /** Quick-fix counterpart to setMedBin for the substock shelf code — see its own doc comment
   * at the implementation. Used by MedsScreen's "ข้อมูลยังไม่ครบ" filtered list. */
  setMedBinSub: (medId: string, v: string) => void;
  /** Quick-fix counterpart for category — see its own doc comment at the implementation. */
  setMedCategory: (medId: string, categoryId: string) => void;
  /** Quick-fix counterpart for route (ยากิน/ยาฉีด/อื่นๆ) — see its own doc comment at the
   * implementation. */
  setMedRoute: (medId: string, route: '' | 'oral' | 'injection' | 'other') => void;
  recomputeUsageStats: () => void;
  updateGlobalSettings: (patch: Partial<{ expiryWarnDays: number; parFloorCoverDays: number; parSubCoverDays: number }>) => void;

  // meds (formulary) management
  // Bug fix (flow friction): returns whether the add actually succeeded — MedsScreen's "add
  // med" form used to close (discarding every field just typed) right after firing this,
  // regardless of outcome, since it had no way to tell a failure apart from a success without
  // awaiting a real signal back.
  addMed: (input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; fridge?: boolean; bin: string; binSub?: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility?: number; shared?: boolean; binIpd?: string; category?: string; packSize?: number; route?: 'oral' | 'injection' | 'other' }) => Promise<boolean | undefined>;
  // Bug fix (flow friction): same shape as addMed above — MedsScreen's edit-med sheet used to
  // close (discarding every edited field) right after firing this, regardless of outcome.
  // `baseline`: the med record as it looked when the edit form was first opened (frozen by the
  // caller — see MedsScreen.tsx's editBaselineRef — since a live-updating read taken only at
  // submit time would already reflect a concurrent edit, masking the exact race this exists to
  // catch). Pass null when there's no meaningful baseline to compare against (there shouldn't
  // be a legitimate caller of updateMedFull without one, but it's optional rather than required
  // so a future caller can't be forced to fabricate one).
  updateMedFull: (medId: string, input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; fridge?: boolean; bin: string; binSub?: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility: number; shared?: boolean; binIpd?: string; category?: string; packSize?: number; route?: 'oral' | 'injection' | 'other' }, baseline: Med | null) => Promise<boolean | undefined>;
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
  /** Bulk-fills Med.category from each med's own name via the keyword engine in
   * data/categorySuggest.ts — only touches meds with no category set yet, only when a
   * keyword actually matches. Never overwrites a human's existing choice. */
  autoCategorizeAll: () => void;
  autoRouteAll: () => void;
  toggleMedActive: (medId: string) => void;
  /** Flags a med's supply chain as temporarily broken — see Med.outOfStockSince's own doc
   * comment and startStockHold()'s. `reason` is required; `expectedReturnAt` is optional. */
  startStockHold: (medId: string, reason: string, expectedReturnAt?: number) => void;
  /** Clears an active hold started by startStockHold() above, with an optional resolution
   * note (e.g. "ได้ของจากบริษัทใหม่แล้ว") carried into the audit log alongside how long it
   * lasted. No-ops if the med has no active hold. */
  endStockHold: (medId: string, note?: string) => void;
  deleteMed: (medId: string) => void;
  deleteAllInactiveMeds: (medIds?: string[]) => void;
  /** Admin-only, permanently deletes every tx document (substock card ledger, report stats,
   * usage-rate history) without touching current floor/lot quantities — see its doc comment
   * in AppContext.tsx for the full "why" and scope. Double-confirmed (confirmAsync + a typed
   * "RESET" via promptAsync) since it's the widest-blast-radius destructive action in the app. */
  resetAllStockLedgers: () => void;
  /** Admin-only, permanently zeroes every med's floor and deletes every lots document (so
   * substock, floor's exact counterpart, goes to 0 too) — never touches name/code/par/bin/
   * price/etc. See its doc comment in AppContext.tsx. Same double-confirmation as
   * resetAllStockLedgers(). */
  resetAllQuantities: () => void;
  setMedsFocusId: (id: string | null) => void;
  goSubstockCardFor: (medId: string) => void;
  setSubstockFocusId: (id: string | null) => void;

  // count
  fetchSubstockLedger: (medId: string) => Promise<{ ts: number; type: string; qty: number; note: string; by: string; balance: number }[]>;
  fetchFloorLedger: (medId: string) => Promise<{ ts: number; type: string; qty: number; note: string; by: string; balance: number }[]>;
  /** dateMs: reconstructed stock as of that instant — see fetchStockAsOf's own doc comment for
   * the backward-from-live-value method and its accuracy caveat. */
  fetchStockAsOf: (dateMs: number) => Promise<{ medId: string; medName: string; unit: string; category: string; floor: number; sub: number; value: number }[]>;
  exportStockAsOfCsv: (rows: { medName: string; unit: string; category: string; floor: number; sub: number; value: number }[], dateIso: string) => Promise<void>;
  /** date/date2 are inclusive ISO (YYYY-MM-DD) bounds — see DailyMetrics in types.ts and
   * scripts/collect-daily-metrics.mjs for what populates this collection and how. */
  fetchDailyMetrics: (fromDate: string, toDate: string) => Promise<DailyMetrics[]>;
  exportDailyMetricsCsv: (rows: DailyMetrics[]) => Promise<void>;
  /** fromDate/toDate are inclusive ISO (YYYY-MM-DD) bounds matched against each record's
   * periodFrom — see UsageHistoryRecord in types.ts and commitUsageImport for what populates
   * this collection and how. */
  fetchUsageHistory: (fromDate: string, toDate: string) => Promise<UsageHistoryRecord[]>;
  exportUsageHistoryCsv: (records: UsageHistoryRecord[]) => Promise<void>;
  /** sinceMs: only records adjusted at/after this ms epoch — see ParAdjustmentRecord in
   * types.ts and applyOnePar/applyAllSuggested for what populates this collection and how. */
  fetchParAdjustments: (sinceMs: number) => Promise<ParAdjustmentRecord[]>;
  setCountInput: (medId: string, v: string) => void;
  commitCount: (medId: string) => void;
  /** Commits every count typed on the นับสต็อก screen in one action — same per-med
   * transaction + discrepancy-log line as commitCount(), just without making someone
   * tap "บันทึก" once per row down a 40-item cycle count. */
  commitAllCounts: () => void;

  /** Substock's counterpart to the floor count above — same "type what you physically
   * counted, system fixes the difference" idea, but against the aggregate substock quantity
   * (the sum of this med's lots) instead of `floor`. Substock isn't tracked as one plain
   * number the way floor is (see Lot/subQty in selectors.ts) — a lot carries its own real
   * lotNo/exp — so a counted surplus can't be attributed to any specific real lot and lands
   * in one generic adjustment lot instead (see commitSubCount's comment for why its exp is a
   * deliberate "unknown" sentinel, never a guessed date); a counted shortfall is real
   * shrinkage and comes out of the actual lots FEFO, the same order transfer_to_floor already
   * consumes them in. */
  setSubCountInput: (medId: string, v: string) => void;
  commitSubCount: (medId: string) => void;
  /** Batch version of commitSubCount(), mirroring commitAllCounts(). */
  commitAllSubCounts: () => void;

  // hosxp reconcile
  setHosxpText: (v: string) => void;
  processHosxp: () => Promise<void>;
  processHosxpFile: (file: File) => void;
  setHosxpConfirmFuzzy: (v: boolean) => void;
  setHosxpConfirmSingleDay: (v: boolean) => void;
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
  /** ScanConfirmSheet's three actions — see qrDecodedImpl's transfer branch for how
   * scanConfirmMedId gets set in the first place. */
  confirmScanAndNext: () => void;
  confirmScanAndStop: () => void;
  cancelScanConfirm: (medId: string) => void;

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
  fetchExecTxsThisMonth: () => Promise<number | null>;
}

const Ctx = createContext<AppCtx | null>(null);

// Bug fix (security): 'auth/user-not-found' used to get its own distinct message
// ("ไม่พบบัญชีนี้") separate from the wrong-password/invalid-credential message — telling an
// unauthenticated attacker (no account needed) exactly whether a guessed username exists at
// all. Combined with the /usernames enumeration gap fixed in firestore.rules, that made
// building a valid-username list, then focusing password-guessing effort on it, trivial. One
// shared message for "no such account" and "wrong password" gives no such signal — this is the
// same reasoning most login forms use ("invalid username or password", never distinguishing
// which half was wrong).
const AUTH_ERROR_MESSAGES: Record<string, string> = {
  'auth/invalid-email': 'ชื่อผู้ใช้ไม่ถูกต้อง',
  'auth/user-disabled': 'บัญชีนี้ถูกปิดใช้งาน',
  'auth/user-not-found': 'ชื่อผู้ใช้หรือรหัสผ่านไม่ถูกต้อง',
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
  // Bug fix: the continuous เติมหน้างาน QR scan (scanner stays open across items — see
  // qrDecodedImpl) relies on QrScanner's own debounce to not re-fire the SAME decoded code
  // more than once per 1.5s — but that's a "don't spam every video frame" guard, not a "don't
  // double-add this item" one. If a shelf label lingers in frame past 1.5s (pausing to read
  // the confirmation toast, a shaky hand, or deliberately holding on a shelf-location QR),
  // bump() would run again on a cart entry that's no longer 0, ADDING another step on top of
  // the already-set suggested quantity — silently overshooting par with no indication anything
  // doubled up. This tracks the last medId actually bumped by a scan and how long ago, so a
  // lingering repeat of the exact same drug is ignored; scanning it again after actually
  // moving on and coming back (the real "I need more of this" case) still works normally.
  const lastScanBump = useRef<{ medId: string; ts: number } | null>(null);
  // Bug fix: cancelScanConfirm() used to zero the med's WHOLE cart quantity, not just undo this
  // one scan's increment — scanning the same med twice (e.g. split across two bins), confirming
  // the first 20, then scanning again and cancelling THAT second scan wiped the already-confirmed
  // 20 along with it, silently shipping 0 of that drug instead of the intended amount. This
  // tracks what the med's cart quantity was right before the scan that's currently pending
  // confirmation, so cancelling restores exactly that (a no-op if this was a debounced repeat
  // that never bumped anything) instead of always zeroing.
  const lastScanConfirm = useRef<{ medId: string; prevQty: number } | null>(null);
  const parDebounce = useRef<Record<string, number>>({});
  const binDebounce = useRef<Record<string, number>>({});
  const binSubDebounce = useRef<Record<string, number>>({});
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

  // ---------- ยาใกล้หมดอายุ notification (per-device opt-in, see utils/notify.ts) ----------
  const [notifyEnabled, setNotifyEnabledState] = useState<boolean>(readNotifyEnabled);
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission>(currentPermission);
  // Same OS permission as above (one browser permission, not per-topic) — independent opt-in.
  const [lowStockNotifyEnabled, setLowStockNotifyEnabledState] = useState<boolean>(readLowStockNotifyEnabled);

  const patch = useCallback((p: Partial<AppState> | ((s: AppState) => Partial<AppState>)) => {
    setState((s) => ({ ...s, ...(typeof p === 'function' ? p(s) : p) }));
  }, []);

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
  // Bug fix (double-submit on network timeout) support state — declared here (rather than
  // right next to guardOnce/toastErr below, which each need to be defined elsewhere for their
  // own reasons — see their own comments) so both can close over the same refs regardless of
  // definition order. activeGuardKeys tracks which guardOnce key(s) are actively running their
  // wrapped fn() right now; toastErr reads it to attribute a TimeoutError to the right key even
  // though every commit function catches/handles that error INSIDE its own fn body and never
  // rethrows to guardOnce's own try/catch — there'd be nothing for guardOnce to catch otherwise.
  const activeGuardKeys = useRef<string[]>([]);
  const recentTimeouts = useRef<Map<string, number>>(new Map());
  const TIMEOUT_RETRY_WINDOW_MS = 60000;
  // guardOnce itself is defined further down (right after confirmAsync/respondConfirm), since
  // its own timeout-retry-warning fix needs confirmAsync in scope.

  // ---------- network status (real, not simulated) ----------
  useEffect(() => {
    const on = () => {
      patch({ online: true, syncing: true });
      // Bug fix: the offline banner used to flip straight back to a plain "ออนไลน์" the
      // instant the browser's own online event fired — with no signal that any writes queued
      // while offline (via persistentLocalCache — see firebase.ts) were still being flushed to
      // Firestore in the background. waitForPendingWrites() resolves once that flush actually
      // completes, so "กำลังซิงค์..." only clears once it's genuinely safe to close the app.
      waitForPendingWrites(db).catch(() => {}).finally(() => patch({ syncing: false }));
    };
    const off = () => patch({ online: false, syncing: false });
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
        // Bug-hardening for a shared ward/kiosk device: sign-out used to leave the previous
        // account's meds/lots/txs/users/pendingReceives arrays sitting in memory untouched —
        // never actually WRONG data (every approved account reads the same shared formulary,
        // so it's not a privacy leak), but a stale snapshot from before this device's
        // connection resubscribes could in principle flash for a frame while the next person
        // signs in, before their own fresh onSnapshot delivers. Clearing everything here (and
        // dropping dbReady back to false) means every sign-in — same account or a different
        // one — always starts from the same clean "กำลังโหลดข้อมูล…" state and only ever shows
        // data that arrived AFTER this specific session's listeners went live.
        patch({
          authStatus: 'signedOut', myUid: null, role: null, screen: 'login', navStack: [],
          meds: [], lots: [], txs: [], users: [], authLog: [], pendingReceives: [], pending: 0, dbReady: false,
        });
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
    // just briefly later; nothing here can mask a real, lasting deactivation.
    // Bug fix (real report): a flat 600ms debounce assumed the real server round-trip always
    // beats it — true on a fast connection, not out at this hospital's actual signal (5G bars
    // shown, but rural/patchy real throughput), where the corrected snapshot can easily take
    // several seconds. 600ms wasn't a flash-suppressor there, it just always fired first,
    // landing on "รอ Admin อนุมัติบัญชี" for an already-approved account every time. Use
    // snap.metadata.fromCache instead of guessing a bigger flat number: a cache-served
    // snapshot (the actual source of the stale/wrong read) gets real room for the network
    // round-trip; a snapshot the server has already confirmed is trustworthy right away.
    let downgradeTimer: number | undefined;
    const clearDowngrade = () => window.clearTimeout(downgradeTimer);
    const unsub = onSnapshot(
      doc(db, 'users', state.myUid),
      (snap) => {
        const downgradeDelay = snap.metadata.fromCache ? 4000 : 300;
        if (!snap.exists()) {
          clearDowngrade();
          downgradeTimer = window.setTimeout(() => patch({ authStatus: 'signedOut' }), downgradeDelay);
          return;
        }
        const profile = { id: snap.id, ...snap.data() } as User;
        // Bug fix (observed live): under a badly unstable connection, a reconnecting listen
        // stream can deliver a snapshot where exists() is true but the document fields are
        // still incomplete/not yet hydrated (the profile write itself mid-sync) — treated the
        // same as !exists() before this, it went straight through as a real "pending approval"
        // profile with empty name/username, rendering the broken "บัญชี (@) สมัครสำเร็จแล้ว".
        // A real profile (however written) always has a username; treat one without it exactly
        // like a not-yet-existing doc — wait for a snapshot that actually has real data, rather
        // than committing to a state built from a half-synced read.
        if (!profile.username) {
          clearDowngrade();
          downgradeTimer = window.setTimeout(() => patch({ authStatus: 'signedOut' }), downgradeDelay);
          return;
        }
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
        }, downgradeDelay);
      },
      // Bug fix (real report class — see the fromCache/downgradeDelay and half-synced-profile
      // fixes right above): this used to sign out silently on ANY listener error, including a
      // transient one (permission-denied during a token refresh, a backend blip, a flaky
      // connection dropping mid-stream) — indistinguishable from an intentional logout, with
      // nothing telling the person their account wasn't actually disabled. Logs it at least
      // (toast() isn't declared yet at this point in the component body, so this can't reuse
      // it without reordering a lot of other hooks) so a real occurrence shows up in the
      // console instead of vanishing with zero trace.
      (e) => { console.error('onSnapshot(myProfile) failed:', e); clearDowngrade(); patch({ authStatus: 'signedOut' }); },
    );
    return () => { clearDowngrade(); unsub(); };
  }, [state.myUid, patch]);

  const sub = useCallback((medId: string) => subQty(state, medId), [state]);
  const fefo = useCallback((medId: string) => fefoLot(state, medId), [state]);
  const userName = useCallback(() => myProfile?.name || '', [myProfile]);
  // Real-world request: editing the master drug record (name/price/par/bin/active) and system
  // settings (par cover days, expiry warning threshold) is Admin-only now — pharm keeps every
  // day-to-day action (floor/count/transfer/adjust/reconcile, approving a tech's receive
  // request) but no longer the formulary/settings edit surface itself. Separate from
  // canApproveReceive below (approving a เบิก request is unrelated and unchanged — still
  // pharm+admin) even though both used to be the same flag; splitting them means this change
  // can't silently also take away pharm's receive-approval ability.
  const canEditMeds = myProfile?.role === 'admin';
  // Real-world request: จพ.เภสัชกรรม (tech) now receives directly from the central warehouse
  // without waiting for approval (short-staffed right now — see commitReceive's `approve`
  // below, now always true). This flag still gates approving/rejecting any already-pending
  // request left over from before that change, or one a future role might submit.
  const canApproveReceive = myProfile?.role !== 'tech';
  const roleLabel = useCallback(() => roleLabelFor(state.role), [state.role]);
  const roleLabelOf = useCallback((r: Role) => roleLabelFor(r), []);
  const warn = useCallback(() => state.expiryWarnDays, [state.expiryWarnDays]);

  const toast = useCallback((t: string) => {
    patch({ toast: t });
    window.clearTimeout(toastTimer.current);
    toastTimer.current = window.setTimeout(() => patch({ toast: null }), 2600);
  }, [patch]);

  // ---------- cart/recvItems crash recovery (see PERSIST_MAX_AGE_MS's own comment above for the
  // real risk this closes) ----------
  // One-shot per sign-in: restores whatever this exact uid last had in progress, the moment
  // their uid becomes known — before they've had a chance to add anything new, so this can
  // never clobber a fresh cart with stale data. restoredForUid guards against the effect
  // re-firing on every unrelated state change (it only depends on myUid, but re-running the
  // SAME restore a second time for the same uid would re-apply a cart the person may have
  // already intentionally emptied back out since).
  const restoredForUid = useRef<string | null>(null);
  useEffect(() => {
    if (!state.myUid || restoredForUid.current === state.myUid) return;
    restoredForUid.current = state.myUid;
    const cart = readPersisted<Record<string, number>>(cartStorageKey(state.myUid));
    const recvItems = readPersisted<RecvItem[]>(recvStorageKey(state.myUid));
    const hasCart = cart && Object.keys(cart).length > 0;
    const hasRecv = recvItems && recvItems.length > 0;
    if (!hasCart && !hasRecv) return;
    patch({ ...(hasCart ? { cart: cart! } : {}), ...(hasRecv ? { recvItems: recvItems! } : {}) });
    toast(
      (hasCart && hasRecv) ? 'กู้ตะกร้าเติมหน้างานและรายการรับเข้าที่ยังไม่บันทึกจากก่อนหน้านี้คืนแล้ว'
        : hasCart ? 'กู้ตะกร้าเติมหน้างานที่ยังไม่บันทึกจากก่อนหน้านี้คืนแล้ว'
        : 'กู้รายการรับเข้าที่ยังไม่บันทึกจากก่อนหน้านี้คืนแล้ว'
    );
  }, [state.myUid, patch, toast]);
  // Persists on every change, not debounced — both of these change at most once per button tap
  // (not per keystroke), so there's no meaningful write-volume cost to saving immediately, and
  // immediately is what actually closes the crash/refresh window (a debounced write would just
  // reopen a smaller version of the same gap this exists to close).
  useEffect(() => {
    if (!state.myUid) return;
    writePersisted(cartStorageKey(state.myUid), state.cart);
  }, [state.myUid, state.cart]);
  useEffect(() => {
    if (!state.myUid) return;
    writePersisted(recvStorageKey(state.myUid), state.recvItems);
  }, [state.myUid, state.recvItems]);

  const enableExpiryNotify = useCallback(async () => {
    const perm = await requestPermission();
    setNotifyPermission(perm);
    if (perm === 'granted') {
      writeNotifyEnabled(true);
      setNotifyEnabledState(true);
      toast('เปิดแจ้งเตือนยาใกล้หมดอายุแล้ว — จะแจ้งตอนเปิดแอพถ้ามีรายการที่ต้องดู');
    } else {
      writeNotifyEnabled(false);
      setNotifyEnabledState(false);
      toast(perm === 'denied' ? 'เบราว์เซอร์บล็อกการแจ้งเตือน — ไปเปิดสิทธิ์แจ้งเตือนให้เว็บนี้ในตั้งค่าเบราว์เซอร์ก่อน' : 'ยังไม่ได้อนุญาตการแจ้งเตือน');
    }
  }, [toast]);
  const disableExpiryNotify = useCallback(() => {
    writeNotifyEnabled(false);
    setNotifyEnabledState(false);
  }, []);

  const enableLowStockNotify = useCallback(async () => {
    const perm = await requestPermission();
    setNotifyPermission(perm);
    if (perm === 'granted') {
      writeLowStockNotifyEnabled(true);
      setLowStockNotifyEnabledState(true);
      toast('เปิดแจ้งเตือนยาต่ำกว่า Min แล้ว — จะแจ้งตอนเปิดแอพถ้ามีรายการที่ควรเติมหน้างานวันนั้น');
    } else {
      writeLowStockNotifyEnabled(false);
      setLowStockNotifyEnabledState(false);
      toast(perm === 'denied' ? 'เบราว์เซอร์บล็อกการแจ้งเตือน — ไปเปิดสิทธิ์แจ้งเตือนให้เว็บนี้ในตั้งค่าเบราว์เซอร์ก่อน' : 'ยังไม่ได้อนุญาตการแจ้งเตือน');
    }
  }, [toast]);
  const disableLowStockNotify = useCallback(() => {
    writeLowStockNotifyEnabled(false);
    setLowStockNotifyEnabledState(false);
  }, []);

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

  // Bug fix (double-submit on network timeout): withTimeout's ~15s clock only stops the CLIENT
  // from waiting on a hung Firestore call (runTransaction/batch.commit/etc.) — it has no way to
  // actually cancel that call, so the real write can still land on the server seconds after the
  // client gives up and shows an error toast. guardOnce's busy-guard (below) has to clear the
  // instant that timeout fires, or the button would stay stuck "กำลังบันทึก…" forever on a
  // connection that never recovers — but that means an immediate retry after the error runs as
  // a fully independent write. For an absolute-value write derived from a client-held DELTA
  // (e.g. commitAdjust's floor = before + sign*qty, not a Firestore increment()), a retry that
  // lands on top of an original write that also eventually lands double-applies the delta
  // silently — a real stock-count corruption, not just a duplicate log row. Tracks the most
  // recent timeout per guardOnce key (via activeGuardKeys/recentTimeouts, declared up near
  // busyKeys — see that comment for why toastErr, not this catch block, is what actually
  // records the timeout: every commit function catches/handles its own errors internally and
  // never rethrows here) and asks for confirmation before letting that exact action fire again
  // within a short window — a soft check (only the user knows whether a "บันทึกแล้ว" toast
  // actually landed moments after the error), not a hard block that could itself strand a
  // legitimate retry after a connection that's now fine.
  const guardOnce = useCallback(<A extends unknown[], R>(key: string, fn: (...args: A) => Promise<R>) => {
    return async (...args: A): Promise<R | undefined> => {
      // Bug fix: the ':' + String(args[0]) suffix exists so per-item actions (scrapLot(lotId),
      // commitCount(medId), approveReceive(id)) key on that one item and don't block unrelated
      // items — but String() on anything that isn't already a primitive silently does the
      // wrong thing instead of erroring. deleteAllInactiveMeds(medIds: string[]) is the real
      // case this bit: args[0] is an ARRAY, and String(anArray) joins it with commas — a
      // formulary-sized cleanup call turned into a single busyKeys/state.busy entry keyed on a
      // multi-hundred-character comma-joined id list. Not a crash, but it defeated the whole
      // point of a stable, referenceable key (no screen could show busy state for it) and
      // bloated state.busy for no reason. Only a genuine scalar id (string/number) gets the
      // per-item suffix now; anything else (an array, object, undefined) falls back to the
      // plain action key, same as a zero-arg bulk action like mergeAllWardPairs/shareAllMeds.
      const first = args[0];
      const isScalarId = typeof first === 'string' || typeof first === 'number';
      const k = isScalarId ? key + ':' + first : key;
      if (busyKeys.current.has(k)) return;
      const lastTimeout = recentTimeouts.current.get(k);
      if (lastTimeout !== undefined && Date.now() - lastTimeout < TIMEOUT_RETRY_WINDOW_MS) {
        const ok = await confirmAsync('รายการก่อนหน้าอาจยังไม่เสร็จสมบูรณ์ (การเชื่อมต่อช้า/หลุด) ระบบตรวจสอบไม่ได้ว่าบันทึกไปแล้วหรือยัง ถ้าเพิ่งเห็นข้อความ "บันทึกแล้ว" ไม่ต้องทำซ้ำ — ต้องการทำรายการนี้อีกครั้งหรือไม่?');
        if (!ok) return;
      }
      recentTimeouts.current.delete(k);
      busyKeys.current.add(k);
      // Makes `k` visible to toastErr while fn() is running (see the fix's own comment up near
      // busyKeys) — toastErr is what actually calls recentTimeouts.current.set(k, ...) on a
      // TimeoutError, since fn() itself never rethrows one out to this level.
      activeGuardKeys.current.push(k);
      // Bug fix: guardOnce already prevented a double-tap from running the same commit twice
      // (see the comment above) — but nothing about that busy state was ever REACTIVE, so a
      // commit button gave zero visual feedback while its real Firestore round trip was in
      // flight on a slow connection. Mirroring the same key into state.busy lets any screen
      // show "กำลังบันทึก…"/disable the button for exactly as long as guardOnce is actually
      // blocking a repeat — same lifetime, just made visible.
      patch((st) => ({ busy: { ...st.busy, [k]: true } }));
      try {
        return await fn(...args);
      } finally {
        activeGuardKeys.current = activeGuardKeys.current.filter((x) => x !== k);
        busyKeys.current.delete(k);
        patch((st) => { const b = { ...st.busy }; delete b[k]; return { busy: b }; });
      }
    };
  }, [patch, confirmAsync]);

  // Same reasoning as confirmAsync above, for window.prompt() — also unreliable inside the
  // same embedded contexts, also with no visible error when it silently no-ops. Resolves the
  // trimmed text on confirm, null on cancel (matching window.prompt()'s own null-on-cancel
  // contract so call sites didn't need to change their `if (reason !== null)` checks).
  const promptResolveRef = useRef<((v: string | null) => void) | null>(null);
  const promptAsync = useCallback((message: string) => {
    return new Promise<string | null>((resolve) => {
      if (promptResolveRef.current) promptResolveRef.current(null);
      promptResolveRef.current = resolve;
      patch({ promptDialog: { message } });
    });
  }, [patch]);
  const respondPrompt = useCallback((v: string | null) => {
    const resolve = promptResolveRef.current;
    promptResolveRef.current = null;
    patch({ promptDialog: null });
    if (resolve) resolve(v);
  }, [patch]);

  // Bug fix (stability): vite-plugin-pwa's 'autoUpdate' mode used to reload the page the
  // instant it detected a new deployed version, with zero regard for whether someone was
  // mid-scan, mid-form, or mid-transaction right then — this app gets redeployed often, so
  // that was a real, recurring disruption, not a one-off. registerType is now 'prompt' (see
  // vite.config.ts): the new service worker still downloads in the background exactly the
  // same, it just waits for updateSWRef.current() to be called instead of firing itself.
  const updateSWRef = useRef<((reloadPage?: boolean) => Promise<void>) | null>(null);
  // Bug fix (stability): registerSW() only ever checks for a new service worker once, at the
  // moment this hook mounts. This app is a client-routed SPA meant to be opened once on a ward
  // tablet and left on for an entire multi-day shift rotation (see this comment's sibling note
  // on registerType: 'prompt') — with no full-page navigation ever happening, nothing after that
  // first check would ever notice a new deploy, so a stale tablet could run an already-superseded
  // build (missing a since-shipped safety fix) indefinitely with the "มีแอพเวอร์ชันใหม่" banner
  // never appearing. registration.update() re-checks the SW script against the network; calling
  // it hourly and whenever the tab becomes visible again catches a new deploy within one shift
  // without polling so often it's wasteful.
  const swRegistrationRef = useRef<ServiceWorkerRegistration | null>(null);
  useEffect(() => {
    let cancelled = false;
    // Loaded lazily and only in the actual built PWA — this virtual module doesn't exist in
    // plain `vite dev`, so importing it eagerly at module scope would break local dev.
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (cancelled) return;
        updateSWRef.current = registerSW({
          onNeedRefresh() { patch({ updateAvailable: true }); },
          // Real-world request: "หากมีการอัพเดตเวอชั่นในแอพ ช่วยแจ้งเตือนให้เดตเป็นเวอร์ชั่นใหม่
          // ให้รวดเร็ว" — the OLD behavior only ever checked for a new deploy on the hourly
          // timer/visibility-change effect below, so opening the app fresh (the single most
          // common moment a new version has actually just shipped, since this app redeploys via
          // ci.yml on every push to main) could sit for up to a full hour before the very first
          // re-check even happened — a genuinely slow "มีแอพเวอร์ชันใหม่" banner, not a fast one.
          // registration.update() re-checks the SW script against the network the moment the
          // registration itself resolves, so a deploy that already landed before this tab opened
          // (or during the time it was loading) surfaces the banner immediately instead of
          // waiting for the next scheduled poll.
          onRegisteredSW(_swUrl, registration) {
            swRegistrationRef.current = registration ?? null;
            registration?.update().catch(() => {});
          },
        });
      })
      .catch(() => { /* not running as an installed/built PWA (e.g. plain dev server) — no-op */ });
    return () => { cancelled = true; };
  }, [patch]);
  useEffect(() => {
    const checkForUpdate = () => { swRegistrationRef.current?.update().catch(() => {}); };
    // Real-world request: "อยากให้...update version ได้รวดเร็วครับ" — 15 minutes between polls
    // (itself a prior fix, down from 60) still meant a deploy landing mid-shift could sit
    // unnoticed for up to a quarter-hour on a tablet left open and idle on one screen (no
    // visibilitychange to piggyback on in that case). 3 minutes catches a new deploy within
    // minutes of it actually going live instead — the "มีแอพเวอร์ชันใหม่" banner still only ever
    // PROMPTS (see registerType: 'prompt' above — never reloads on its own mid-task), so a
    // faster check just means that banner itself shows up sooner, not a faster/more disruptive
    // reload. A single GET of the SW script every 3 minutes is negligible bandwidth/battery
    // cost for a device left on all shift.
    const intervalId = setInterval(checkForUpdate, 3 * 60 * 1000);
    const onVisible = () => { if (document.visibilityState === 'visible') checkForUpdate(); };
    document.addEventListener('visibilitychange', onVisible);
    return () => { clearInterval(intervalId); document.removeEventListener('visibilitychange', onVisible); };
  }, []);
  const applyUpdate = useCallback(() => {
    patch({ updateAvailable: false });
    updateSWRef.current?.(true);
  }, [patch]);
  const dismissUpdate = useCallback(() => patch({ updateAvailable: false }), [patch]);

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
    // Bug fix (real report): the onErr() safety net above only fires for a snapshot that
    // actively FAILS (permission-denied, rules error) — it does nothing for one that just
    // never fires at all, success or error, which a genuinely stalled connection (this
    // hospital's real rural signal, not the "5G" bars shown) can do to a *first-ever* login on
    // a device with no local IndexedDB cache yet to serve instantly while the network catches
    // up. That left the person stuck on the SkeletonHome loading screen indefinitely with no
    // toast, no error, nothing to act on. A 20s bound is generous for even a slow connection
    // (well past the redirect delay/effect-remount case this is guarding against) but still
    // eventually lands somewhere real instead of never. Cleared the instant 'meds' actually
    // resolves either way, so this never fires on a normal-speed connection.
    const stallTimer = window.setTimeout(() => {
      if (!toasted) {
        toasted = true;
        toast('เชื่อมต่อข้อมูลช้าผิดปกติ — ลองโหลดหน้าใหม่ ถ้ายังไม่หายให้แจ้งผู้ดูแลระบบ');
      }
      patch({ dbReady: true });
    }, 20000);
    const unsubs = [
      onSnapshot(collection(db, 'meds'), (snap) => {
        window.clearTimeout(stallTimer);
        patch({ meds: snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Med[], dbReady: true });
      }, (e) => { window.clearTimeout(stallTimer); onErr('meds')(e); }),
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
    return () => { window.clearTimeout(stallTimer); unsubs.forEach((u) => u()); };
  }, [state.authStatus, myProfile?.role, patch, toast]);

  // Checks real lot data for anything near/past expiry and, if the person opted in and granted
  // OS permission, shows a local notification — at most once a day (see maybeNotifyExpiring's
  // own throttle). Runs once meds/lots have actually loaded; re-running on later data changes
  // is harmless since the day-level throttle makes every call after the first a no-op unless
  // it's a genuinely new day. This is the ONLY place this check happens — see utils/notify.ts's
  // doc comment for why a real background push isn't possible on this static site.
  useEffect(() => {
    if (state.authStatus !== 'signedIn' || !state.dbReady || !notifyEnabled) return;
    const activeLots = state.lots.filter((l) => l.qty > 0 && state.meds.some((m) => m.id === l.medId && m.active));
    // Bug fix (consistency): matches the aging report's own "หมดอายุแล้ว" bucket boundary (`<=
    // hi` with hi=0) — a lot expiring TODAY is already counted as expired there, but this
    // notification used `< 0`, so a lot that just crossed into "expired" on the report could
    // still be silently bucketed as "near expiry" here and never get the more urgent notice.
    const expiredCount = activeLots.filter((l) => daysUntil(l.exp) <= 0).length;
    const nearCount = activeLots.filter((l) => { const d = daysUntil(l.exp); return d > 0 && d < state.expiryWarnDays; }).length;
    void maybeNotifyExpiring(nearCount, expiredCount);
  }, [state.authStatus, state.dbReady, state.meds, state.lots, state.expiryWarnDays, notifyEnabled]);

  // Same shape as the expiry check above, independent topic/opt-in (see utils/notify.ts) —
  // counts active substock-backed meds (see usesSubstock()) at/below their own Min. noSubstock
  // meds are excluded here the same way TransferScreen's own "ต่ำกว่า Min"/"เร่งด่วนวันนี้" lists
  // are — this notification is specifically about "ควรเติมหน้างานวันนี้", which for a noSubstock
  // med isn't a เติมหน้างาน action at all (see ReceiveScreen's warehouse-request list instead).
  useEffect(() => {
    if (state.authStatus !== 'signedIn' || !state.dbReady || !lowStockNotifyEnabled) return;
    const floorMeds = state.meds.filter((m) => m.active && usesSubstock(m));
    const belowMinCount = floorMeds.filter((m) => m.floor < floorMinOf(m)).length;
    const urgentCount = floorMeds.filter(isUrgentLow).length;
    void maybeNotifyLowStock(belowMinCount, urgentCount);
  }, [state.authStatus, state.dbReady, state.meds, lowStockNotifyEnabled]);

  // Bug fix: a form with real unsaved edits (currently just MedForm's add/edit — see
  // setFormDirty below) used to vanish silently the moment someone tapped a different
  // bottom-nav tab, since App.tsx's Screens() switch unmounts the current screen outright on
  // navigation. `go()` is the one function every such navigation funnels through, so gate it
  // here rather than in each individual form: ask once, and only navigate through if confirmed.
  const unsavedFormRef = useRef(false);
  const setFormDirty = useCallback((dirty: boolean) => { unsavedFormRef.current = dirty; }, []);
  // Shared by go() below AND by any other UI that can dismiss a dirty form without going
  // through onCancel — e.g. MedsScreen's BottomSheet backdrop tap/✕ button. Resolves true (safe
  // to proceed) immediately if nothing's dirty; otherwise asks once, same wording either way.
  const confirmLeaveIfDirty = useCallback(async () => {
    if (!unsavedFormRef.current) return true;
    const ok = await confirmAsync('มีข้อมูลที่ยังไม่ได้บันทึก ออกจากหน้านี้เลยไหม? การแก้ไขที่ทำไว้จะหายไป');
    if (ok) unsavedFormRef.current = false;
    return ok;
  }, [confirmAsync]);
  const go = useCallback((s: Screen) => {
    if (unsavedFormRef.current) {
      void (async () => {
        if (!(await confirmLeaveIfDirty())) return;
        setState((st) => ({ ...st, screen: s, navStack: pushNav(st.navStack, st.screen) }));
      })();
      return;
    }
    setState((st) => ({ ...st, screen: s, navStack: pushNav(st.navStack, st.screen) }));
  }, [confirmLeaveIfDirty]);
  // Pops the real history stack instead of a single fixed "came from" pointer — see navStack
  // on AppState. Bug this replaced: back() used to hardcode every screen except tconfirm to
  // return to 'more', which only happened to be right for screens always opened from the More
  // menu — pressing back from ปรับยอด after tapping Home's "ตัดออก" landed on the More menu (a
  // screen the person never visited) instead of back on Home, same for จัดการรายการยา opened
  // from ตั้งค่า, and บัตรสต็อก substock opened from the "สำเร็จ" screen after a เติมหน้างาน.
  const back = useCallback(() => setState((st) => {
    const stack = st.navStack.slice();
    const prev = stack.pop();
    return {
      ...st, screen: prev || 'more', navStack: stack,
      // Bug fix: a real back-navigation (hardware/browser back button, swipe-back gesture, or
      // the in-app ← chevron — all funnel through here, see the popstate handler below) used to
      // leave ScanConfirmSheet/ReceiveConfirmSheet open and covering whatever screen this landed
      // on, since neither is tied to st.screen. Close them the same way their own ✕/backdrop-tap
      // already does: scanConfirmMedId just clears (same as "ยืนยัน · กลับไปหน้ารายการ" — keeps
      // the cart qty already confirmed), recvMed resets the whole in-progress pick (same as
      // ReceiveConfirmSheet's onClose -> cancelReceivePick, since an in-progress lot/exp/qty
      // draft for a med you're now navigating away from isn't safe to leave half-filled).
      scanConfirmMedId: null,
      recvMed: null, recvSearch: '', recvLot: '', recvExp: '', recvQty: '',
    };
  }), []);

  // Bug fix: navStack (above) is a purely in-memory "came from" stack — it never touched the
  // browser's real history, so the physical/hardware back button (or a swipe-back gesture) on
  // mobile bypassed it entirely and left the PWA outright instead of popping one in-app screen,
  // even from three levels deep. Fix: mirror every in-app forward navigation as one real
  // history entry (one push per navStack growth, since a single tap can occasionally chain two
  // screen changes — e.g. goReceiveFor), and treat every real "back" (hardware button, browser
  // back, swipe gesture — all surface as a popstate event) as a pop of the SAME in-app stack.
  // The one in-app back button (App.tsx's ← chevron) now calls history.back() instead of back()
  // directly, so it funnels through this same popstate handler too — one source of truth, no
  // risk of the two stacks drifting out of sync with each other.
  const navDepthRef = useRef(state.navStack.length);
  // Set right before back() runs FROM a real popstate (physical/browser back, or the in-app ←
  // button via history.back()), so the length-effect below can tell "the stack shrank because a
  // real history entry was just consumed" apart from "the stack shrank some other way" (e.g.
  // sign-out resetting navStack straight to [] — a plain state reset, not a back-navigation).
  // Only the latter needs correcting: without this, signing out three screens deep would leave
  // 3 orphaned entries in the browser's real history, silently eating the next 3 back-button
  // presses on a shared/kiosk device before the button does anything again.
  const navShrinkFromPopstateRef = useRef(false);
  useEffect(() => {
    const cur = state.navStack.length;
    const prev = navDepthRef.current;
    if (cur > prev) {
      for (let i = prev; i < cur; i++) history.pushState({ opdNav: true }, '');
    } else if (cur < prev && !navShrinkFromPopstateRef.current) {
      history.go(-(prev - cur));
    }
    navShrinkFromPopstateRef.current = false;
    navDepthRef.current = cur;
  }, [state.navStack.length]);
  useEffect(() => {
    const onPopState = () => { if (navDepthRef.current > 0) { navShrinkFromPopstateRef.current = true; back(); } };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, [back]);

  // Bug fix: this used a bare (unwrapped) addDoc() — unlike every write that goes through
  // runTx (which wraps runTransaction in withTimeout right at its own definition, above). On a
  // hung connection (the exact hospital-wifi-captive-portal case withTimeout's own doc comment
  // describes) that await would never resolve OR reject, so this function would never reach its
  // catch block, and since logAudit() is called by several commit actions, the calling
  // guardOnce-protected function's busy state would stay stuck forever with no error shown,
  // even though the real stock write moments earlier (via the properly-timed-out runTx)
  // already succeeded. Wrapped in withTimeout so this fails fast with a message instead.
  //
  // Note: every stock-mutating commit function used to also have a standalone logTx() twin of
  // this, called right after its own runTx() resolved — two separate network round trips for
  // what's really one logical write. That left a real gap: a dropped connection between the two
  // could change stock with no matching txs history row (or vice versa). Every such call site
  // has since been folded into the SAME transaction as its stock write (trx.set(doc(collection
  // (db, 'txs')), {...}) inline — see commitTransfer/commitAdjust/commitCount/commitSubCount/
  // commitReconcile/scrapLot/commitWardMove/approvePendingReceive), so logTx() no longer has a
  // reason to exist — audit trail entries (a human-readable note, not a stock-affecting ledger
  // row) are the only thing still logged outside a transaction, via logAudit() below.
  const logAudit = useCallback(async (entry: { type: AuditType; note: string }) => {
    try { await withTimeout(addDoc(collection(db, 'auditLog'), { ...entry, by: userName(), ts: Date.now() })); }
    catch (e) { console.error('audit log write failed:', e); toast('บันทึกลง audit log ไม่สำเร็จ — รายการหลักบันทึกแล้ว แต่ประวัตินี้อาจหายไป'); }
  }, [userName, toast]);

  // Shared tail for every commit-style catch block below — logs the real error, but shows
  // the person a TimeoutError's specific "connection stalled" message instead of the
  // function's usual generic failure message, since that one case has a genuinely different
  // recommended action (check your connection) than "something went wrong, try again".
  // Bug fix (offline clarity): a Firestore transaction (runTx — every commit* function uses it)
  // doesn't work offline at all — with zero signal it rejects near-instantly with a plain
  // FirebaseError (code 'unavailable', occasionally 'failed-precondition'), not a TimeoutError,
  // so this used to fall through to each caller's generic fallback message ("บันทึกไม่สำเร็จ ลอง
  // ใหม่อีกครั้ง") — reading like something's wrong with the data, not "you have no signal". The
  // header already shows a persistent offline banner (state.online), but the toast itself gave
  // no such context. Same clear "check your connection" message TimeoutError already gets.
  const toastErr = useCallback((e: unknown, fallback: string) => {
    console.error(e);
    hapticError();
    const code = (e as { code?: string } | null)?.code;
    if (e instanceof TimeoutError) {
      // Bug fix (double-submit on network timeout): attributes this timeout to whichever
      // guardOnce-wrapped commit function is currently running (see activeGuardKeys' own
      // comment up near busyKeys) so a retry of that SAME action gets the confirm-before-retry
      // warning — this is the only place that error is actually observed, since every commit
      // function's own try/catch handles it right here instead of rethrowing to guardOnce.
      activeGuardKeys.current.forEach((k) => recentTimeouts.current.set(k, Date.now()));
      toast(e.message);
    }
    else if (code === 'unavailable' || code === 'failed-precondition') toast('ไม่มีสัญญาณอินเทอร์เน็ต — ยังไม่ได้บันทึก ลองใหม่อีกครั้งเมื่อเชื่อมต่อได้');
    else toast(fallback);
  }, [toast]);

  // ---------- auth actions ----------
  const setAuthMode = useCallback((m: AuthMode) => patch({ authMode: m, authError: null }), [patch]);
  const setAuthUsername = useCallback((v: string) => patch({ authUsername: v }), [patch]);
  const setAuthPassword = useCallback((v: string) => patch({ authPassword: v }), [patch]);
  const setAuthName = useCallback((v: string) => patch({ authName: v }), [patch]);
  const setAuthDept = useCallback((v: string) => patch({ authDept: v }), [patch]);
  const setAuthRemember = useCallback((v: boolean) => patch({ authRemember: v }), [patch]);

  // Bug fix (double-submit consistency): every other write action in this app is wrapped in
  // guardOnce, which blocks a repeat call SYNCHRONOUSLY (a ref checked before any await) — this
  // relied only on state.authBusy (a React state update, applied on next render) to disable the
  // submit button, so a fast double-tap/double-Enter on the login form (realistic on a laggy
  // hospital connection — exactly when someone is likely to tap again) could fire two concurrent
  // sign-in attempts before React ever flushed the disabled state.
  const signIn = useCallback(guardOnce('signIn', async () => {
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
      // Bug fix: this call itself used to be unwrapped — the very thing it warns about two
      // lines down (a hung connection that never resolves or rejects, leaving `authBusy` stuck
      // forever with no error) applied just as much to signInWithEmailAndPassword itself as to
      // the setDoc that follows it, and this IS the highest-frequency network call in the whole
      // app — every sign-in, every device, every day. Confirmed live: on a badly unstable
      // connection the button spun on "กำลังดำเนินการ" indefinitely with nothing to tell the
      // person to retry or walk away.
      const cred = await withTimeout(signInWithEmailAndPassword(auth, usernameToEmail(username), password));
      await withTimeout(setDoc(doc(db, 'users', cred.user.uid), { lastLogin: Date.now() }, { merge: true }));
    } catch (e) {
      patch({ authError: authErrorMessage(e) });
    } finally {
      patch({ authBusy: false });
    }
  }), [state.authUsername, state.authPassword, state.authRemember, patch, guardOnce]);

  // Bug fix (double-submit consistency): same gap as signIn above.
  const signUp = useCallback(guardOnce('signUp', async () => {
    const username = normalizeUsername(state.authUsername);
    const password = state.authPassword;
    const name = state.authName.trim();
    const dept = state.authDept.trim() || 'เภสัชกรรม';
    if (!username || !password || !name) { patch({ authError: 'กรอกชื่อ ชื่อผู้ใช้ และรหัสผ่านให้ครบ' }); return; }
    if (!USERNAME_RE.test(username)) { patch({ authError: 'ชื่อผู้ใช้ต้องเป็นตัวอักษรอังกฤษเล็ก ตัวเลข . หรือ _ ยาว 3-20 ตัว' }); return; }
    if (password.length < 6) { patch({ authError: 'รหัสผ่านต้องยาวอย่างน้อย 6 ตัวอักษร' }); return; }
    patch({ authBusy: true, authError: null });
    try {
      const takenSnap = await withTimeout(getDoc(doc(db, 'usernames', username)));
      if (takenSnap.exists()) { patch({ authError: 'ชื่อผู้ใช้นี้มีคนใช้แล้ว' }); return; }

      // Same fix as signIn(): unwrapped, this could hang forever on a stuck connection with
      // authBusy never clearing and no error shown — the account-creation counterpart of the
      // sign-in bug above.
      const cred = await withTimeout(createUserWithEmailAndPassword(auth, usernameToEmail(username), password));
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
  }), [state.authUsername, state.authPassword, state.authName, state.authDept, patch, guardOnce]);

  // Bug fix (shared-device data leak): this used to reset only cart/authUsername/authPassword
  // — every OTHER in-progress form field (recvItems, adjQty/adjNote, wmReason, search/filter,
  // hosxpText, usageRows, ...) stayed live in this context state straight through to the next
  // person's session on the same tab. This app is routinely handed off between staff on one
  // shared tablet (shift change, mid-task interruption) — a real risk that the next person opens
  // Receive/Adjust/WardMove and finds the previous person's half-entered lot/qty/reason still
  // sitting there, then commits a transaction under their own name using someone else's stale
  // data. Resets every ephemeral form/filter/selection field a screen can leave populated;
  // deliberately leaves meds/lots/txs/users (repopulated by the same live listeners regardless
  // of who's signed in) and settings like expiryWarnDays/device untouched.
  const logout = useCallback(() => {
    signOut(auth);
    patch({
      cart: {}, authUsername: '', authPassword: '',
      search: '', filter: 'low', wardFilter: 'all',
      wmFromSearch: '', wmFromMed: null, wmToSearch: '', wmToMed: null, wmQty: '', wmReason: '',
      recvSearch: '', recvMed: null, recvLot: '', recvExp: '', recvQty: '', recvItems: [],
      adjType: null, adjSearch: '', adjMed: null, adjQty: '', adjReason: '', adjNote: '',
      qrOpen: false, qrManualOpen: false, qrCode: '', qrManualReason: '', qrPurpose: null, scanConfirmMedId: null, hadOk: {},
      countInputs: {}, subCountInputs: {}, hosxpText: '', hosxpRows: null, hosxpConfirmFuzzy: false, hosxpConfirmSingleDay: false,
      usageDateFrom: '', usageDateTo: '', usageFileName: null, usageRows: null, usageConfirmFuzzy: false,
      labelSelected: {}, medsFocusId: null, substockFocusId: null, doneKind: null, doneRows: [],
    });
  }, [patch]);
  const setDevice = useCallback((d: 'phone' | 'tablet') => patch({ device: d }), [patch]);

  // Bug fix: this was the only bulk-write action in the app neither wrapped in guardOnce nor
  // backed by a state.busy[...] flag — every other bulk button (MedsScreen/SettingsScreen)
  // disables itself and shows "กำลัง…" via state.busy while its write is in flight. A double-tap
  // here (easy on a slow first-run connection loading 585 meds across chunked batches) fired
  // seedInitialData() twice concurrently — harmless since seed.ts's doc IDs are deterministic
  // ("M0001"...), so the second run just re-writes the same docs, but still a real missing
  // double-submit guard inconsistent with the rest of the codebase's own pattern.
  const seedDatabase = useCallback(guardOnce('seedDatabase', async () => {
    toast('กำลังโหลดข้อมูลตั้งต้น…');
    try {
      const r = await seedInitialData();
      // ยอดหน้างาน/substock ทุกตัวเริ่มที่ 0 โดยตั้งใจ (ดู seed.ts) — ระบบนี้ไม่มีทางรู้ว่าจริงๆ
      // มีของอยู่บนชั้น/ในคลังย่อยเท่าไรจนกว่าจะมีคนนับจริง บอกไว้ตรงนี้กันคนเข้าใจผิดว่า "โหลด
      // ข้อมูลตั้งต้นแล้วทำไมยอดเป็น 0 หมด" คิดว่าเป็นบัค ทั้งที่เป็นพฤติกรรมที่ถูกต้อง
      toast(`โหลดข้อมูลตั้งต้นแล้ว: ยา ${r.meds} รายการ — ยอดหน้างาน/substock เริ่มที่ 0 ทุกตัว ต้องนับจริงแล้วกรอกเข้าระบบก่อนเริ่มใช้งาน`);
      logAudit({ type: 'par_updated', note: 'เริ่มต้นฐานข้อมูลยา (' + r.meds + ' รายการ) — ยอดหน้างาน/substock เริ่มที่ 0 ทุกตัว รอการนับจริง' });
    } catch (e) {
      toast('โหลดข้อมูลตั้งต้นไม่สำเร็จ: ' + authErrorMessage(e));
    }
  }), [toast, logAudit, guardOnce]);

  // ---------- transfer ----------
  const setSearch = useCallback((v: string) => patch({ search: v }), [patch]);
  const setFilter = useCallback((f: AppState['filter']) => patch({ filter: f }), [patch]);
  const setWardFilter = useCallback((w: AppState['wardFilter']) => patch({ wardFilter: w }), [patch]);

  const bump = useCallback((id: string, d: number) => {
    setState((st) => {
      const m = st.meds.find((x) => x.id === id);
      if (!m) return st;
      const cap = subQty(st, id);
      const step = packStep(m);
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
      const m = st.meds.find((x) => x.id === id);
      const cap = subQty(st, id);
      let v = Math.max(0, Math.min(cap, parseIntSafe(raw)));
      // Real-world request: "เติมยาหน้างาน...ต้องเติมหรือเบิกเป็นจำนวนกล่อง เพื่อง่ายต่อการหยิบยา
      // ขนยาเติมยา" — bump()'s own +/- stepper already steps by packStep(m) (a whole box for a
      // box-only med), but typing a number directly into this field had nothing enforcing the
      // same rule — a typo or an arbitrary hand-typed number could land a non-whole-box quantity
      // in the cart with no correction. Rounds UP to the next whole box (never under what was
      // actually typed), then folds back down to the largest whole-box amount that still fits
      // within what substock actually has, if rounding up overshot the cap. A non-boxed med
      // (Med.packSize unset) is untouched — its real/actual unit count IS the quantity to
      // request, not an artificial box count.
      if (m && m.packSize && m.packSize > 1) {
        const boxed = Math.ceil(v / m.packSize) * m.packSize;
        v = boxed > cap ? Math.floor(cap / m.packSize) * m.packSize : boxed;
      }
      const cart = { ...st.cart };
      if (v <= 0) delete cart[id]; else cart[id] = v;
      return { ...st, cart };
    });
  }, []);

  const removeFromCart = useCallback((id: string) => {
    setState((st) => { const c = { ...st.cart }; delete c[id]; return { ...st, cart: c }; });
  }, []);

  const clearCart = useCallback(async () => {
    // Asks first: a cart can represent several minutes of walking the shelves deciding
    // quantities, and this throws all of it away with no undo (nothing is written to
    // Firestore until commitTransfer, so there is no history to restore it from).
    if (!(await confirmAsync('ล้างตะกร้าเติมหน้างานทั้งหมด? จำนวนที่ใส่ไว้ทุกรายการจะหายไป (ยังไม่ได้บันทึกลงระบบ กู้คืนไม่ได้)'))) return;
    patch({ cart: {}, hadOk: {} });
    toast('ล้างตะกร้าแล้ว');
  }, [patch, toast]);
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
        // Bug fix (user-reported): a med flagged isOnStockHold() ("ยาขาดชั่วคราว") would still
        // get silently queued into the cart here if it happened to have any leftover substock
        // — same gap TransferScreen's own list had (see its `meds` filter's own comment).
        if (isOnStockHold(m)) return;
        // Real min-max: only pick items actually at/below their reorder point (Min), not
        // anything a hair under capacity (Max) — that's the whole point of having the two be
        // different numbers instead of one target chasing two jobs.
        if (m.floor < floorMinOf(m)) { const q = suggestTransferQty(st, m); if (q > 0) cart[m.id] = q; }
      });
      return { ...st, cart, filter: 'low' };
    });
    toast('ใส่จำนวนตาม par ให้ทุกรายการที่ต่ำกว่าเกณฑ์แล้ว — ปรับได้ก่อนยืนยัน');
  }, [toast]);
  // "เติมเฉพาะเร่งด่วนวันนี้" — a deliberately SMALLER bulk-fill than fillAll(): only queues
  // items already at/below half their Min (isUrgentLow(), selectors.ts), not everything under
  // Min. The real problem this solves: with one person covering เติมหน้างาน on top of everything
  // else some days, "เติมตาม par ทั้งหมด" can dump dozens of items into one cart at once — the
  // exact "เติมทีละเยอะๆ" pileup that's hard to actually get through in a short shift. Doing
  // just the genuinely urgent subset today, and letting the merely-below-Min rest ride until
  // there's more time (still visible, still trackable, just not forced into today's cart), is
  // what keeps daily replenishment sized to whoever's actually covering it that day.
  const fillUrgent = useCallback(() => {
    setState((st) => {
      const cart = { ...st.cart };
      st.meds.forEach((m) => {
        if (!matchesWard(m, st.wardFilter)) return;
        if (isOnStockHold(m)) return;
        if (isUrgentLow(m)) { const q = suggestTransferQty(st, m); if (q > 0) cart[m.id] = q; }
      });
      return { ...st, cart, filter: 'urgent' };
    });
    toast('ใส่จำนวนตาม par ให้เฉพาะรายการเร่งด่วน (ต่ำกว่าครึ่งหนึ่งของ Min) แล้ว — ที่เหลือยังรอได้');
  }, [toast]);

  // "Auto Pick-List" — a printable, sorted-by-bin checklist of exactly what's in the current
  // fill cart, meant to be carried while walking the substock shelves so nobody has to
  // re-read the app screen-by-screen mid-walk (or worse, re-estimate by eye, the exact habit
  // this whole cart/fillAll flow exists to replace).
  const printPickList = useCallback(() => {
    const ids = Object.keys(state.cart);
    if (!ids.length) { toast('ยังไม่มีรายการในตะกร้า — เติมจำนวนหรือกด "เติมตาม par ทั้งหมด" ก่อน'); return; }
    // Bug fix: this used to pick one side of a shared med's shelf code via state.wardFilter —
    // dead ever since the OPD/IPD ward tab UI was removed (nothing sets it away from 'all'
    // any more), so it silently always showed the OPD-side bin and never mentioned a shared
    // med's separate IPD shelf spot at all. binDisplayAll() shows both codes when they differ.
    const rows = ids
      .map((id) => state.meds.find((m) => m.id === id))
      .filter((m): m is Med => !!m)
      .map((m) => ({ bin: binDisplayAll(m), name: m.name, qty: state.cart[m.id], unit: m.unit }));
    const ok = printPickListSheet(rows, 'ใบจัดยาเติมชั้น', 'จัดทำตามรายการที่คัดเลือกไว้ในระบบเติมหน้างาน', undefined, { printedBy: userName() });
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state.cart, state.meds, toast, userName]);

  // The daily version of the above — "วันนี้ต้องเติมอะไรบ้าง" printed straight from current
  // floor-vs-Min numbers, with zero dependence on the cart. A จพ.เภสัช doing the morning walk
  // shouldn't have to open the app, tap "เติมตาม par ทั้งหมด" to build a cart, then print,
  // just to get a checklist to carry — this is that same suggested-qty logic (same target:
  // parFloor/"Max", same cap: what substock actually has), one tap, cart untouched. Same
  // Bug fix: state.wardFilter has been permanently stuck at 'all' since the OPD/IPD ward tab
  // UI was removed — the matchesWard()/labelWard reads this used to have acted as if it could
  // still be 'opd'/'ipd', which in practice meant "every med" here (harmless) but always
  // showed a shared med's OPD-side bin only, same gap as printPickList above.
  const printTodayReplenishList = useCallback(() => {
    // Bug fix (user-reported): a med flagged isOnStockHold() ("ยาขาดชั่วคราว") still landed in
    // the main pick rows below whenever it happened to have leftover substock — same gap
    // TransferScreen's own list had. It belongs in the separate "ยาขาดชั่วคราว" section only
    // (see heldMeds below), never mixed into today's actionable checklist.
    const items = state.meds.filter((m) => m.active && usesSubstock(m) && m.floor < floorMinOf(m) && !isOnStockHold(m));
    // Every active, substock-backed med currently below its own Min — held or not — so the
    // early-return message below can tell "genuinely nothing to do" apart from "the only
    // things below Min right now are all on hold" (see heldMeds below).
    const heldMeds = state.meds.filter((m) => m.active && isOnStockHold(m) && usesSubstock(m) && m.floor < floorMinOf(m));
    if (!items.length && !heldMeds.length) { toast('วันนี้ไม่มีรายการที่ต่ำกว่าจุดต้องเติม (Min) — ยังไม่ต้องเติมหน้างาน'); return; }
    const rows = items
      .map((m) => {
        const need = Math.max(0, m.parFloor - m.floor);
        const qty = suggestTransferQty(state, m);
        // suggestTransferQty caps at what's actually in substock — flag it on the sheet
        // itself when that cap bit, so picking every row here still won't quietly leave the
        // shelf under par; the person carrying this sheet should know to also flag it for
        // the next "เบิกจากคลังใหญ่" run instead of assuming the job's done.
        const shortNote = qty < need ? 'substock เหลือไม่พอเติมเต็ม par (ขาดอีก ' + nf(need - qty) + ' ' + m.unit + ')' : undefined;
        // Bug fix: unlike printWarehouseRequestList (which rounds its own qty UP to a packStep
        // multiple before computing this note, so qty/packSize is always a clean integer), qty
        // here is suggestTransferQty()'s result — capped at whatever substock actually has,
        // which is NOT guaranteed to be a whole number of boxes. nf()'s rounding used to hide
        // that gap: e.g. packSize 30 with only 47 units actually available printed "2 กล่อง"
        // (implying 60 units) instead of the true 1 full box + 17 loose — a wrong count on an
        // official pick-list. Show the exact split instead of ever rounding it away.
        const boxNote = (() => {
          if (!m.packSize || m.packSize <= 1) return undefined;
          const boxes = Math.floor(qty / m.packSize);
          const rem = qty % m.packSize;
          const boxesLabel = boxes + ' กล่อง' + (rem > 0 ? ' + ' + nf(rem) + ' ' + m.unit + ' (ไม่ครบกล่อง)' : '');
          return 'บรรจุกล่องละ ' + nf(m.packSize) + ' ' + m.unit + ' — หยิบ ' + boxesLabel;
        })();
        const note = [boxNote, shortNote].filter(Boolean).join(' · ') || undefined;
        // Real-world request: this sheet already says where the qty is headed (bin, the floor
        // shelf) but gave no clue where to physically go pick it from — add the substock shelf
        // code (Med.binSub) so the person walking the floor also knows where in substock to go.
        return { bin: binDisplayAll(m), name: m.name, qty, unit: m.unit, note, pickBin: m.binSub || undefined };
      })
      .filter((r) => r.qty > 0);
    // Only bail out with the old "nothing available to transfer" toast when there's truly
    // nothing to show at all — a held med still means there's something worth printing (the
    // heads-up section below), even with zero actual pick rows.
    if (!rows.length && !heldMeds.length) { toast('รายการที่ต่ำกว่า Min ไม่มีของเหลือใน substock ให้เติมเลยสักรายการ — ต้องเบิกจากคลังใหญ่ก่อน'); return; }
    const heldRows = heldMeds.map((m) => ({
      name: m.name,
      reason: m.outOfStockReason || '—',
      since: thDate(m.outOfStockSince as number),
      expectedReturn: m.outOfStockExpectedReturn ? thDate(m.outOfStockExpectedReturn) : undefined,
    }));
    const ok = printPickListSheet(rows, 'ใบเติมหน้างานประจำวัน', 'รายการยาที่มีปริมาณต่ำกว่าจุดสั่งเติมขั้นต่ำ (Min) ประจำวันที่จัดพิมพ์เอกสาร', undefined, { printedBy: userName() }, undefined, heldRows);
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state, toast, userName]);

  // "ระบบเตือนเบิก Substock (2 Weeks Cycle)" — since central-warehouse pickup only happens
  // once every two weeks (not daily like the shelf fill), what's actually needed is a
  // standing requisition list of everything under its substock par right now, ready to bring
  // along whenever that cycle comes up — not a scheduled notification demanding a specific
  // day (nothing here can page anyone; this is a static site with no backend to run a timer).
  const printWarehouseRequestList = useCallback(() => {
    // Bug fix: unlike printTodayReplenishList right above (which already guards with
    // usesSubstock(m)), this was missing the same check — a med marked noSubstock (liquids/
    // inhalers/sprays that go straight from the central warehouse to the shelf, see
    // commitReceive) never gets substock lots, so subQty() is permanently 0 for it, but its
    // parSub field is deliberately NOT cleared when noSubstock is toggled on (see MedsScreen's
    // form, kept in case someone unchecks it later) — any such med with a leftover nonzero
    // parSub from before it was marked noSubstock showed up on this print sheet forever,
    // telling staff to request substock replenishment for a stage that doesn't exist for it.
    //
    // Bug fix (follow-up): that guard ended up silently DROPPING noSubstock meds from this
    // list entirely — wrong the other way. A noSubstock med has no substock stage, but it's
    // refilled from the exact same central-warehouse request, on the exact same 2-week cycle
    // (see this screen's own "รอบ 2 สัปดาห์" label) — its shelf (floor) IS its substock for
    // requisitioning purposes, and suggestPar() already sizes its floor par (parFloor) off the
    // same longer cover-days basis a real substock par gets (see selectors.ts). So: a med with
    // a substock stage is judged against substock/parSub as before; one without is judged
    // against floor/parFloor instead — every active med lands in exactly one of those checks,
    // never both, so nothing doubles up and nothing that actually needs requesting is missing.
    const items = state.meds.filter((m) => m.active && needsWarehouseRequest(m, subQty(state, m.id)));
    // Real-world request: a med flagged isOnStockHold() (supplier delay/discontinuation,
    // warehouse closed for fiscal year-end) is already excluded from `items` above via
    // needsWarehouseRequest() — correctly, since requesting it again does nothing — but
    // whoever carries this sheet to the warehouse should still see it listed as an open
    // question, not have it silently vanish as if the shortage were resolved.
    const heldMeds = state.meds.filter((m) => m.active && isOnStockHold(m));
    if (!items.length && !heldMeds.length) { toast('ทุกรายการยังสูงกว่า par — ยังไม่ต้องเบิกเพิ่ม'); return; }
    const rows = items.map((m) => {
      const short = usesSubstock(m);
      const need = Math.max(0, (short ? m.parSub - subQty(state, m.id) : m.parFloor - m.floor));
      // Round the raw shortfall up to a whole multiple of this med's requisition step — for a
      // box-only med (Med.packSize set) that's real box count, never a fractional box; for
      // everything else it's the same generic magnitude step packStep() already falls back to.
      const step = packStep(m);
      const qty = Math.ceil(need / step) * step;
      const note = m.packSize && m.packSize > 1 ? 'เบิกเป็นกล่อง กล่องละ ' + nf(m.packSize) + ' ' + m.unit + ' (' + nf(qty / m.packSize) + ' กล่อง)' : undefined;
      // Real-world request: รหัสยา (m.code, e.g. MED-0002) isn't actually used in practice — what
      // staff actually need on this sheet is where to put the stock once the warehouse releases
      // it, i.e. the substock shelf code. A med with its own substock stage uses that shelf
      // (Med.binSub); a noSubstock med has no substock stage at all — its floor shelf IS the
      // place this requisition lands (see this function's own comment above on why noSubstock
      // meds are judged against floor par here), so fall back to its floor bin for those.
      return { bin: short ? (m.binSub || '—') : binDisplayAll(m), name: m.name + (short ? '' : ' (ไม่มี substock)'), qty, unit: m.unit, note };
    });
    const heldRows = heldMeds.map((m) => ({
      name: m.name,
      reason: m.outOfStockReason || '—',
      since: thDate(m.outOfStockSince as number),
      expectedReturn: m.outOfStockExpectedReturn ? thDate(m.outOfStockExpectedReturn) : undefined,
    }));
    const ok = printPickListSheet(rows, 'ใบขอเบิกจากคลังใหญ่', 'รายการยาที่มีปริมาณคงคลังต่ำกว่าเกณฑ์มาตรฐาน (Par) ทั้งระบบ รวมถึงรายการยาที่ไม่มีการสำรองคลังย่อย (Substock)', { bin: 'ชั้นวาง substock', qty: 'จำนวนที่ควรเบิก' }, { printedBy: userName() }, ['ผู้จัดทำคำขอ (ห้องยา)', 'ผู้อนุมัติคำขอ (ห้องยา)', 'ผู้จ่ายยา (คลังใหญ่)'], heldRows);
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state, toast, userName]);

  const commitTransfer = useCallback(guardOnce('transfer', async () => {
    const cart = { ...state.cart };
    const ids = Object.keys(cart);
    if (!ids.length) return;
    const meds = state.meds;
    let resultRows: AppState['doneRows'] = [];
    try {
      await runTx(async (trx) => {
        const rows: AppState['doneRows'] = [];
        const medReads: Record<string, number> = {};
        const lotReads: Record<string, { qty: number; lotNo: string }> = {};
        const lotIdsByMed: Record<string, string[]> = {};
        // Bug fix (flow latency): this used to walk `ids` with a plain `for` loop — every med's
        // med-doc read, live lot query, and per-lot reads all awaited one after another, with
        // zero data dependency between different meds in the cart. A 4-5 item cart (an entirely
        // normal multi-drug transfer) meant 4-5 fully serialized round trips on top of each
        // other before any write even started — 1-2+ real seconds of pure waiting on hospital
        // wifi, repeated on every transaction retry. Firing all meds' work concurrently (and each
        // med's own lot reads concurrently too, since they don't depend on each other either)
        // collapses this phase to roughly one round-trip's worth of latency regardless of cart
        // size.
        await Promise.all(ids.map(async (medId) => {
          const medSnap = await trx.get(doc(db, 'meds', medId));
          medReads[medId] = (medSnap.data() as { floor?: number } | undefined)?.floor ?? 0;
          // Bug fix (false "substock ไม่พอ" rejection + FEFO-skip risk): lotsCache (state.lots,
          // the onSnapshot cache) could miss a lot created between building the cart and
          // confirming here — e.g. a receive landing on this exact med mid-transfer. A live
          // query right before reading each lot shrinks that window to a single round trip;
          // the Firestore client SDK can't query inside the transaction itself (trx.get() only
          // takes a doc ref), so this runs just outside it, freshly on every retry.
          const liveLotDocs = (await getDocs(query(collection(db, 'lots'), where('medId', '==', medId)))).docs;
          // Bug fix (FEFO correctness): a lot doc missing/lacking `exp` (legacy import, manual
          // Firestore edit) used to default to `exp: 0` — 1970 — which sorts FIRST, ahead of
          // every lot with a real near-term expiry. That's exactly backwards for FEFO: an
          // unknown-expiry lot should never outrank one that's genuinely expiring soon.
          // Infinity sorts it LAST instead — treated as "no known urgency", not "most urgent".
          //
          // Bug fix (patient safety): an already-expired lot (exp <= now) used to sort FIRST
          // under plain soonest-expiry ordering — the most "due" lot by date is exactly the
          // one that's due to be scrapped, not transferred to the floor for dispensing to a
          // patient. Excluding it here from the actual write path means a real transfer can
          // never draw real floor stock from an expired lot — if every remaining lot for a med
          // is expired, this now correctly reports a shortage (forcing a scrapLot first)
          // instead of silently drawing from one of them. fefoLot (selectors.ts), the separate
          // UI-hint selector TransferScreen's own expiry warning reads from, deliberately keeps
          // including an expired lot — that warning is what makes this exclusion visible
          // *before* someone hits the shortage, not something this fix should hide.
          const now = Date.now();
          const lotIds = liveLotDocs
            .map((d) => ({ id: d.id, qty: (d.data() as { qty?: number }).qty ?? 0, exp: (d.data() as { exp?: number }).exp ?? Infinity }))
            .filter((l) => l.qty > 0 && !(l.exp && l.exp <= now)).sort((a, b) => a.exp - b.exp).map((l) => l.id);
          lotIdsByMed[medId] = lotIds;
          await Promise.all(lotIds.map(async (lotId) => {
            const lotSnap = await trx.get(doc(db, 'lots', lotId));
            const data = lotSnap.data() as { qty?: number; lotNo?: string } | undefined;
            lotReads[lotId] = { qty: data?.qty ?? 0, lotNo: data?.lotNo ?? '' };
          }));
        }));
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

        // Bug fix (data integrity): this used to write the tx-log doc for each item in a
        // SEPARATE writeBatch after this transaction committed — two round trips, not one
        // atomic unit. A dropped connection or thrown error in that second batch (network
        // blip right after this transaction lands, same device or not) left floor/lots
        // updated but the corresponding transfer_to_floor tx row silently missing — the exact
        // kind of gap that shows up later as "ยอดจากประวัติธุรกรรมไม่ตรงกับยอดจริง" on บัตร
        // สต็อก (SubstockCardScreen's mismatch warning), with no way to tell it apart from a
        // real out-of-band adjustment. A Firestore transaction can `set` a brand-new doc just
        // like a batch can — moving the tx-log write in here makes "stock moved" and "history
        // recorded" one all-or-nothing commit, so that specific class of ledger drift can no
        // longer happen from this path.
        const ts = Date.now();
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
          // Real-world request: "ประวัติของการรับยาจาก substock ว่ารับมากี่กล่อง จำนวนกี่เม็ด" —
          // the stock-card ledger (fetchSubstockLedger/fetchFloorLedger) reads this exact `note`
          // field, so a box-only med's history line can show the real box count it was actually
          // moved in, not just a raw unit total — same split printTodayReplenishList's own print
          // sheet already shows (boxes, never rounded away since cart[medId] isn't guaranteed to
          // land on a clean multiple of packSize).
          const boxNote = m.packSize && m.packSize > 1 ? (() => {
            const boxes = Math.floor(cart[medId] / m.packSize!);
            const rem = cart[medId] % m.packSize!;
            return boxes > 0 ? nf(boxes) + ' กล่อง' + (rem > 0 ? '+' + nf(rem) : '') + ' (กล่องละ ' + nf(m.packSize!) + ')' : undefined;
          })() : undefined;
          trx.set(doc(collection(db, 'txs')), {
            type: 'transfer_to_floor', name: m.name, medId, qty: cart[medId], unit: m.unit, from: 'substock', to: 'floor',
            note: 'FEFO lot ' + used.join(', ') + (boxNote ? ' · ' + boxNote : ''), by: userName(), ts,
          } satisfies Omit<import('../types').Tx, 'id'>);
          rows.push({ name: m.name, sub: 'lot ' + used.join(', '), qty: nf(cart[medId]) + ' ' + m.unit, medId });
        }
        resultRows = rows;
      });
      hapticSuccess();
      setState((st) => ({ ...st, cart: {}, hadOk: {}, screen: 'done', navStack: pushNav(st.navStack, st.screen), doneKind: 'transfer', doneRows: resultRows }));
    } catch (e) {
      const msg = (e as Error)?.message || '';
      if (msg === 'missing-med') { toast('มีรายการในตะกร้าที่ถูกลบออกจากระบบไปแล้ว — กลับไปที่ตะกร้าแล้วลบรายการนั้นออกก่อน'); return; }
      if (msg.startsWith('insufficient:')) { toast('substock เหลือไม่พอสำหรับ ' + msg.slice('insufficient:'.length) + ' — น่าจะมีคนอื่นเบิกไปพร้อมกัน กลับไปปรับจำนวนในตะกร้าแล้วลองใหม่'); return; }
      toastErr(e, 'เติมหน้างานไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [state.cart, state.meds, userName, toast, toastErr, guardOnce]);

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

  const addRecv = useCallback(async (opts?: { scanNext?: boolean }) => {
    const m = state.meds.find((x) => x.id === state.recvMed);
    const q = parseIntSafe(state.recvQty);
    if (!m || !q || !state.recvLot || !state.recvExp) { toast('กรอก lot, วันหมดอายุ และจำนวนให้ครบก่อนเพิ่มรายการ'); return; }
    const expMs = new Date(state.recvExp).getTime();
    // Bug fix (typo safety net): receiving is the one place in this app's stock flows that
    // creates a brand-new lot from scratch with no live number to sanity-check it against — a
    // NEW lot arriving today should never legitimately have an expiry already in the past, but
    // nothing here ever caught a mistyped year (e.g. 2024 instead of 2026) or a misread faded
    // label before this. commitCount/commitAllCounts/commitAllSubCounts already confirm an
    // implausible number before committing; this exact flow had no equivalent at all, even
    // though a wrong expiry here goes straight into FEFO's own pick order (see TransferScreen's
    // own expTone fix) with no further checkpoint downstream.
    if (daysUntil(expMs) < 0 && !(await confirmAsync(
      'วันหมดอายุที่กรอก (' + thDate(expMs) + ') เป็นวันที่ผ่านไปแล้ว — ยานี้เพิ่งรับเข้าใหม่วันนี้ พิมพ์วันถูกต้องแล้วใช่ไหม?'
    ))) return;
    // Same typo-safety-net idea as the expiry check above, sized off this med's own par — a
    // fat-fingered extra digit in the quantity (digitsOnly only caps total length, not
    // plausibility) sails into a committed lot otherwise, unlike the equivalent count flows.
    const par = usesSubstock(m) ? m.parSub : m.parFloor;
    if (q > Math.max(par, 20) * 8 && !(await confirmAsync(
      'จำนวนที่กรอก (' + nf(q) + ' ' + m.unit + ') มากผิดปกติเมื่อเทียบกับ par (' + nf(par) + ') ของ ' + m.name + ' พิมพ์จำนวนถูกต้องแล้วใช่ไหม?'
    ))) return;
    const item: RecvItem = { medId: m.id, name: m.name, unit: m.unit, lotNo: state.recvLot, exp: expMs, qty: q };
    patch((st) => ({
      recvItems: [...st.recvItems, item], recvLot: '', recvExp: '', recvQty: '', recvSearch: '',
      // scanNext: real-world request, same reasoning as ScanConfirmSheet's "ยืนยัน · สแกนตัวต่อไป"
      // — receiving a whole delivery is naturally a run of items, so going straight back into the
      // camera after confirming this one saves reopening it by hand for every item in the box.
      ...(opts?.scanNext
        ? { recvMed: null, qrOpen: true, qrManualOpen: false, qrCode: '', qrManualReason: '', qrPurpose: 'receive' }
        : { recvMed: null }),
    }));
  }, [state, patch, toast, confirmAsync]);

  const cancelReceivePick = useCallback(() => {
    patch({ recvMed: null, recvSearch: '', recvLot: '', recvExp: '', recvQty: '' });
  }, [patch]);

  const removeRecvItem = useCallback((i: number) => patch((st) => ({ recvItems: st.recvItems.filter((_, j) => j !== i) })), [patch]);

  const commitReceive = useCallback(guardOnce('receive', async () => {
    // Real-world request: every role (including tech) now receives from the central
    // warehouse directly — short-staffed right now, no one to wait on for approval. The
    // pending-approval path below (and approvePendingReceive/rejectPendingReceive,
    // canApproveReceive above) is left in place rather than deleted, so any request already
    // sitting pending from before this change still gets a normal approve/reject flow, and
    // the whole mechanism is there again with a one-line change if staffing recovers.
    const approve = true;
    const items = state.recvItems;
    if (!items.length) return;
    // Bug fix (data integrity): recvItems is purely local state, never reflected in Firestore
    // until this commit — nothing stops the med from being deleted (by someone else, another
    // device) in the gap between adding it here and confirming. Without this check, the
    // `m && !usesSubstock(m)` test below is FALSE for a deleted med (m is undefined), which
    // falls into the substock branch and creates a real lots doc + receive_from_central tx
    // pointing at a medId that no longer exists in `meds` — an orphaned "phantom stock" entry
    // invisible to FEFO pickers and every substock-balance view, with no error shown to the
    // user at all. Same pre-write guard commitTransfer already has for its cart.
    const missingMed = items.some((it) => !state.meds.find((x) => x.id === it.medId));
    if (missingMed) { toast('มีรายการที่ถูกลบออกจากระบบไปแล้ว — กลับไปลบรายการนั้นออกจากรายการรับเข้าก่อน'); return; }
    try {
      // Bug fix (phantom stock): the missingMed check above only guards against state.meds (the
      // client cache) already being stale by the time this screen was opened — but the
      // substock branch below never writes to the med doc itself (only a new lots doc + txs
      // row), so a med deleted by another device in the narrower gap between that check and
      // this commit wouldn't be caught by Firestore either (writeBatch only fails on doc-level
      // errors of documents it actually references, and a brand-new lots doc has no such
      // reference to fail on). Re-fetching each item's med doc live, right before building the
      // batch, closes that gap the same way deleteMed/deleteAllInactiveMeds re-check live right
      // before their own writes.
      // Bug fix (flow latency): this used to fetch each unique med with a separate sequential
      // `await getDoc` — a delivery of 8-10 distinct meds (a normal central-warehouse receive)
      // cost 8-10 round trips in a row before the batch write even started. These reads don't
      // depend on each other, so firing them concurrently cuts that wait from ~1-2s down to
      // roughly one round trip regardless of how many distinct meds are in the delivery.
      const uniqueMedIds = [...new Set(items.map((it) => it.medId))];
      const liveMedEntries = await Promise.all(uniqueMedIds.map(async (medId) => {
        const snap = await getDoc(doc(db, 'meds', medId));
        return snap.exists() ? [medId, snap.data() as { code?: string; noSubstock?: boolean }] as const : null;
      }));
      const liveMeds = new Map(liveMedEntries.filter((e): e is readonly [string, { code?: string; noSubstock?: boolean }] => e !== null));
      if (items.some((it) => !liveMeds.has(it.medId))) {
        toast('มีรายการที่ถูกลบออกจากระบบไปแล้ว — กลับไปลบรายการนั้นออกจากรายการรับเข้าก่อน');
        return;
      }
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
        hapticSuccess();
        setState((st) => ({
          ...st, screen: 'done', navStack: pushNav(st.navStack, st.screen), doneKind: 'recvPending',
          doneRows: items.map((it) => ({ name: it.name, sub: 'lot ' + it.lotNo + ' · exp ' + thDate(it.exp), qty: nf(it.qty) + ' ' + it.unit, medId: it.medId })),
          recvItems: [],
        }));
        return;
      }
      // Bug fix (lot duplication race, closes the gap left open in CHANGELOG v3.92.9): a
      // delivery of the exact same physical batch (same lotNo + same exp date, for the same
      // med) that arrives on a later date than an earlier one still sitting on the shelf used
      // to always create a BRAND NEW lots doc rather than adding into the one already there —
      // the pharmacist merges both boxes under one paper lot card on the physical shelf, but
      // the database kept two independently-drifting rows for what's one real stack. The old
      // code decided merge-vs-create from a plain getDocs query and then wrote via a separate,
      // non-transactional writeBatch — two devices receiving the same med+lot at the same
      // moment could each run that query, each see no conflict yet, and each create their own
      // duplicate lot doc. Moving the whole decide+write into runTx closes that for the common
      // case (merging into an EXISTING lot): both transactions now read-then-write the SAME lot
      // doc, so Firestore serializes them — the second one sees the first's increment and
      // merges on top of it instead of racing. The live lot query itself still can't run inside
      // the transaction (same query-then-get workaround approvePendingReceive already uses
      // above), so it reruns fresh on every automatic retry; only merges into a lot that's
      // still genuinely active (qty > 0), never resurrects an old zeroed-out lot kept around
      // purely for its own history (see scrapLot's own comment on why depleted lots aren't
      // deleted).
      const substockMedIds = [...new Set(items.filter((it) => !(liveMeds.get(it.medId)?.noSubstock)).map((it) => it.medId))];
      await runTx(async (trx) => {
        const liveLotEntries = await Promise.all(substockMedIds.map(async (medId) => {
          const snap = await getDocs(query(collection(db, 'lots'), where('medId', '==', medId)));
          return [medId, snap.docs.map((d) => ({ id: d.id, ...(d.data() as { lotNo?: string; exp?: number; qty?: number }) }))] as const;
        }));
        const liveLotsByMed = new Map(liveLotEntries);
        // All of a Firestore transaction's reads must happen before any of its writes, so the
        // per-item candidate confirmation (trx.get, making each candidate doc part of this
        // transaction's tracked read set — the thing that actually causes the serialization
        // above) runs as its own pass first, keyed the same way the write pass below groups
        // items, before any trx.set/trx.update fires.
        const candidateByKey = new Map<string, { id: string; qty: number } | null>();
        for (const it of items) {
          const m = liveMeds.get(it.medId);
          if (m && m.noSubstock) continue;
          const key = it.medId + '|' + it.lotNo + '|' + it.exp;
          if (candidateByKey.has(key)) continue;
          const existing = (liveLotsByMed.get(it.medId) || []).find((l) => l.lotNo === it.lotNo && l.exp === it.exp && (l.qty || 0) > 0);
          if (!existing) { candidateByKey.set(key, null); continue; }
          const lotSnap = await trx.get(doc(db, 'lots', existing.id));
          const data = lotSnap.data() as { qty?: number } | undefined;
          candidateByKey.set(key, data && (data.qty || 0) > 0 ? { id: existing.id, qty: data.qty || 0 } : null);
        }
        // Also merges two rows of THIS SAME receipt sharing a lotNo/exp for one med — neither
        // the live query nor the trx.get pass above can see a lot this same batch is about to
        // create, so track it locally too.
        const stagedLotRefs = new Map<string, ReturnType<typeof doc>>();
        items.forEach((it) => {
          // Liquids/inhalers/sprays — some meds skip substock entirely and go straight from
          // the central warehouse to the shelf (see noSubstock on Med). No lot is created for
          // these (the floor number already carries no per-lot expiry tracking of its own,
          // same limitation the rest of the app already accepts for regular transferred
          // stock) — just credit the shelf directly instead of a substock lot nobody would
          // ever transfer out of.
          const m = liveMeds.get(it.medId);
          if (m && m.noSubstock) {
            trx.update(doc(db, 'meds', it.medId), { floor: increment(it.qty) });
            trx.set(doc(collection(db, 'txs')), {
              type: 'receive_from_central', name: it.name, medId: it.medId, qty: it.qty, unit: it.unit, from: 'คลังยาใหญ่', to: 'floor',
              note: 'ใบเบิก ' + state.recvNo + ' · lot ' + it.lotNo + ' exp ' + thDate(it.exp) + ' — ไม่มี substock ขึ้นหน้างานทันที', by: userName(), ts: Date.now(),
            });
            return;
          }
          const key = it.medId + '|' + it.lotNo + '|' + it.exp;
          const staged = stagedLotRefs.get(key);
          const candidate = candidateByKey.get(key);
          if (staged) {
            trx.update(staged, { qty: increment(it.qty) });
          } else if (candidate) {
            const ref = doc(db, 'lots', candidate.id);
            trx.update(ref, { qty: increment(it.qty) });
            stagedLotRefs.set(key, ref);
          } else {
            const lotRef = doc(collection(db, 'lots'));
            trx.set(lotRef, { code: genLotCode(m?.code, it.medId, lotRef.id), medId: it.medId, lotNo: it.lotNo, exp: it.exp, qty: it.qty, loc: 'ชั้น bulk' });
            stagedLotRefs.set(key, lotRef);
          }
          trx.set(doc(collection(db, 'txs')), {
            type: 'receive_from_central', name: it.name, medId: it.medId, qty: it.qty, unit: it.unit, from: 'คลังยาใหญ่', to: 'substock',
            note: 'ใบเบิก ' + state.recvNo + ' · lot ' + it.lotNo + ' exp ' + thDate(it.exp), by: userName(), ts: Date.now(),
          });
        });
      });
      hapticSuccess();
      setState((st) => ({
        ...st, screen: 'done', navStack: pushNav(st.navStack, st.screen), doneKind: 'receive',
        doneRows: items.map((it) => ({ name: it.name, sub: 'lot ' + it.lotNo + ' · exp ' + thDate(it.exp), qty: nf(it.qty) + ' ' + it.unit, medId: it.medId })),
        recvItems: [],
      }));
    } catch (e) {
      toastErr(e, 'บันทึกใบรับไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [state.recvItems, state.recvNo, state.myUid, state.meds, userName, toastErr, logAudit, guardOnce, runTx]);

  // Approve a pending receive — creates the real lot + receive_from_central tx, exactly
  // what the immediate (pharm/admin) receive path does. Wrapped in a transaction so two
  // people approving the same request at once can't both create the stock twice: the
  // second one sees status is no longer 'pending' and aborts cleanly.
  const approvePendingReceive = useCallback(guardOnce('approveReceive', async (id: string) => {
    if (!canApproveReceive) return;
    try {
      await runTx(async (trx) => {
        const ref = doc(db, 'pendingReceives', id);
        const snap = await trx.get(ref);
        const pr = snap.data() as PendingReceive | undefined;
        if (!pr || pr.status !== 'pending') throw new Error('already-resolved');
        // Bug fix (data integrity): same class of bug as commitReceive above — a pending
        // request can sit for a while before anyone approves it, long enough for the med it
        // references to get deleted in the meantime. This used to read `m` from state.meds (the
        // client cache), which is falsy for a deleted med purely because it's missing from the
        // cache — but that check ran BEFORE this transaction, not inside it, so a delete landing
        // during the transaction's own retries wasn't caught: `trx.get()` here instead makes the
        // med doc part of this transaction's live read set, so Firestore retries (and then
        // correctly throws) if it's deleted concurrently, the same guarantee every other
        // transactional read in this file relies on.
        const mSnap = await trx.get(doc(db, 'meds', pr.medId));
        const m = mSnap.exists() ? (mSnap.data() as { code?: string; noSubstock?: boolean }) : undefined;
        if (!m) throw new Error('missing-med');
        if (m.noSubstock) {
          trx.update(doc(db, 'meds', pr.medId), { floor: increment(pr.qty) });
          trx.set(doc(collection(db, 'txs')), {
            type: 'receive_from_central' as TxType, name: pr.name, medId: pr.medId, qty: pr.qty, unit: pr.unit, from: 'คลังยาใหญ่', to: 'floor',
            note: 'ใบเบิก ' + pr.recvNo + ' · lot ' + pr.lotNo + ' exp ' + thDate(pr.exp) + ' — ไม่มี substock ขึ้นหน้างานทันที — อนุมัติคำขอของ ' + pr.requestedBy, by: userName(), ts: Date.now(),
          });
        } else {
          // Bug fix (lot duplication): same fix as commitReceive's own — merge into an existing
          // ACTIVE lot with the same lotNo/exp for this med instead of always creating a new lot
          // doc for what's physically the same batch. Transactions can only trx.get() a ref
          // already known, not run a query, so the lookup runs untransacted right here (fresh on
          // every retry, same query-then-get workaround commitTransfer's FEFO lot lookup already
          // uses above) and only the one candidate doc it finds gets a proper trx.get() to
          // confirm it's still live before writing to it.
          const liveLotDocs = (await getDocs(query(collection(db, 'lots'), where('medId', '==', pr.medId)))).docs;
          const candidate = liveLotDocs.find((d) => { const l = d.data() as { lotNo?: string; exp?: number; qty?: number }; return l.lotNo === pr.lotNo && l.exp === pr.exp && (l.qty || 0) > 0; });
          let merged = false;
          if (candidate) {
            const lotSnap = await trx.get(doc(db, 'lots', candidate.id));
            const existing = lotSnap.data() as { qty?: number } | undefined;
            if (existing && (existing.qty || 0) > 0) {
              trx.update(doc(db, 'lots', candidate.id), { qty: increment(pr.qty) });
              merged = true;
            }
          }
          if (!merged) {
            const lotRef = doc(collection(db, 'lots'));
            trx.set(lotRef, { code: genLotCode(m?.code, pr.medId, lotRef.id), medId: pr.medId, lotNo: pr.lotNo, exp: pr.exp, qty: pr.qty, loc: 'ชั้น bulk' });
          }
          trx.set(doc(collection(db, 'txs')), {
            type: 'receive_from_central' as TxType, name: pr.name, medId: pr.medId, qty: pr.qty, unit: pr.unit, from: 'คลังยาใหญ่', to: 'substock',
            note: 'ใบเบิก ' + pr.recvNo + ' · lot ' + pr.lotNo + ' exp ' + thDate(pr.exp) + ' — อนุมัติคำขอของ ' + pr.requestedBy, by: userName(), ts: Date.now(),
          });
        }
        trx.update(ref, { status: 'approved', resolvedBy: userName(), resolvedTs: Date.now() });
      });
      toast('อนุมัติรับเข้าแล้ว');
    } catch (e) {
      const msg = (e as Error)?.message || '';
      if (msg === 'already-resolved') { toast('รายการนี้ถูกอนุมัติหรือปฏิเสธไปแล้ว'); return; }
      if (msg === 'missing-med') { toast('ยาในคำขอนี้ถูกลบออกจากระบบไปแล้ว — อนุมัติไม่ได้ ให้ปฏิเสธคำขอนี้แทน'); return; }
      toastErr(e, 'อนุมัติไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [canApproveReceive, userName, toast, toastErr, guardOnce]);

  const rejectPendingReceive = useCallback(guardOnce('rejectReceive', async (id: string, reason: string) => {
    if (!canApproveReceive) return;
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
  }), [canApproveReceive, state.pendingReceives, userName, toast, toastErr, logAudit, guardOnce]);

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
    // Bug fix (data integrity): this screen (see its own doc comment) deliberately allows
    // moving between ANY two active meds, not just an OPD/IPD ward pair of the same drug — but
    // nothing checked that the two meds share the same dispensing unit before applying the same
    // raw integer `q` to both sides. Moving "50" from a med tracked in เม็ด (tablets) into one
    // tracked in ขวด (bottles) would silently add 50 BOTTLES to the destination's floor for 50
    // TABLETS actually removed from the source — a real on-hand-count corruption with no
    // conversion the app has any way to compute, and nothing in the confirm UI ever shows the
    // destination's unit to catch it by eye (only fromMed.unit is displayed).
    if (from.unit !== to.unit) { toast('หน่วยยาไม่ตรงกัน (' + from.unit + ' ≠ ' + to.unit + ') — ย้ายข้ามหน่วยไม่ได้'); return; }
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
      // Bug fix (flow friction): this used to also clear wmReason — but the real use case this
      // screen's own doc comment describes is a RECURRING move (e.g. the same weekly "เติม stat
      // drawer OPD ประจำสัปดาห์" reason, logged repeatedly for the same from→to pair), so
      // clearing it forced retyping the same text from scratch every single time. Same fix
      // shape as commitAdjust's own flow-friction fix (only clears what actually needs
      // clearing between actions, not the med selected) — only med/qty need resetting for a
      // genuinely new move; the reason is very likely the same one again.
      patch({ wmFromMed: null, wmFromSearch: '', wmToMed: null, wmToSearch: '', wmQty: '' });
    } catch (e) {
      if ((e as Error)?.message === 'insufficient') { toast('ต้นทางมีไม่พอ — เหลือ ' + nf(latestFloor) + ' ' + from.unit); return; }
      toastErr(e, 'ย้ายไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [state.meds, state.wmFromMed, state.wmToMed, state.wmQty, state.wmReason, userName, toast, toastErr, patch, guardOnce]);

  // ---------- adjust ----------
  // Bug fix (flow friction): re-tapping the already-active type chip (e.g. confirming "ปรับยอด"
  // is still selected) used to wipe out adjMed/adjReason too, even though nothing about the
  // workflow actually changed — only switching to a genuinely DIFFERENT type needs to clear
  // those, since the reason list and qty-field meaning differ by type.
  const pickAdjType = useCallback((t: AdjType) => patch((st) => (t === st.adjType ? {} : { adjType: t, adjMed: null, adjReason: '' })), [patch]);
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
    // Bug fix (ledger accuracy): a 'damaged'/'adjust' deduction (sign -1) used to log qty as a
    // flat `sign * q` regardless of what actually happened to floor — but the write below
    // clamps at 0 (Math.max(0, ...)), same guard commitReconcile already needed for the exact
    // same reason. A real, easy-to-hit case: floor reads 3 (already partly dispensed since the
    // last sync) and someone enters "damaged 10" for what they physically found — floor really
    // only drops 3→0 (delta -3), but the old code logged qty:-10 to the discrepancy log/audit
    // trail regardless, a permanent record that overstates the write-off by 7 units against a
    // floor that never held them. Track before/after like commitReconcile does and log the
    // real applied delta, not the raw typed amount.
    let before = 0, after = 0;
    try {
      // Bug fix (data integrity): the stock write and its tx-log entry used to be two separate
      // network operations (runTx here, then a standalone logTx() after it resolved) — same
      // "ledger drift" gap commitTransfer's own fix comment describes: a dropped connection
      // between the two left floor changed with no matching history row. Folded the tx-log
      // write into the same transaction (trx.set, not logTx()) so both commit atomically.
      await runTx(async (trx) => {
        const ref = doc(db, 'meds', m.id);
        const snap = await trx.get(ref);
        before = (snap.data() as { floor?: number } | undefined)?.floor ?? m.floor;
        after = Math.max(0, before + sign * q);
        trx.update(ref, { floor: after });
        trx.set(doc(collection(db, 'txs')), {
          type: t, name: m.name, medId: m.id, qty: after - before, unit: m.unit,
          reason: state.adjReason, note: state.adjNote || '—', loc: 'floor', by: userName(), ts: Date.now(),
        } satisfies Omit<import('../types').Tx, 'id'>);
      });
      const appliedQty = after - before;
      // Bug fix (flow friction): this used to also clear adjMed/adjSearch, forcing a full
      // retype-and-repick of the same med to log a second, unrelated adjustment right after the
      // first (e.g. a "damaged" entry right after a "return" for the same drug, or several
      // patient returns of the same item back-to-back) — a real extra search+tap on every single
      // commit, several times a shift, with no safety benefit: only qty/reason/note actually
      // need clearing between adjustments, not which med is selected.
      patch({ adjQty: '', adjReason: '', adjNote: '' });
      hapticSuccess();
      toast('บันทึกแล้ว · ' + m.name + ' ' + (appliedQty > 0 ? '+' : appliedQty < 0 ? '−' : '') + nf(Math.abs(appliedQty)) + ' ' + m.unit);
    } catch (e) {
      toastErr(e, 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [state, userName, toast, toastErr, patch, guardOnce]);

  const scrapLot = useCallback(guardOnce('scrapLot', async (lotId: string) => {
    const l = state.lots.find((x) => x.id === lotId);
    if (!l) return;
    const m = state.meds.find((x) => x.id === l.medId);
    if (!m) return;
    // Bug fix (workflow safety): this zeroes a real lot's qty permanently with no undo — every
    // other destructive action in the app (delete med, full reset, merge wards) confirms first,
    // but this one, despite being the single most common destructive tap on the floor (scrapping
    // an expired lot), fired instantly. One line, not the heavier typed-confirmation used for
    // bulk/admin actions, since this is routine day-to-day work, not a rare admin operation.
    if (!(await confirmAsync('ตัด lot ' + l.lotNo + ' (' + m.name + ') จำนวน ' + nf(l.qty) + ' หน่วย ออกจาก substock ถาวร?\nกู้คืนไม่ได้'))) return;
    try {
      // Bug fix (data integrity): re-read the lot's real qty inside the same transaction that
      // zeroes it and logs the write-off — the old plain updateDoc + separate logTx() could
      // both use a stale local l.qty (understating/overstating the logged write-off value if
      // someone else's transfer/count had already changed this lot) AND leave the two writes
      // non-atomic (see commitAdjust's note on this exact class of gap).
      let realQty = l.qty;
      await runTx(async (trx) => {
        const ref = doc(db, 'lots', lotId);
        const snap = await trx.get(ref);
        realQty = (snap.data() as { qty?: number } | undefined)?.qty ?? l.qty;
        trx.update(ref, { qty: 0 });
        trx.set(doc(collection(db, 'txs')), {
          type: 'expired', name: m.name, medId: m.id, qty: -realQty, unit: m.unit,
          reason: 'หมดอายุ / ใกล้หมดอายุ', note: 'lot ' + l.lotNo + ' exp ' + thDate(l.exp) + ' · มูลค่า ' + nf(realQty * m.price) + ' บาท',
          loc: 'substock', by: userName(), ts: Date.now(),
        } satisfies Omit<import('../types').Tx, 'id'>);
      });
      hapticSuccess();
      toast('ตัด lot ' + l.lotNo + ' ออกจาก substock แล้ว · บันทึกลง discrepancy log');
    } catch (e) {
      toastErr(e, 'ตัด lot ไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [state.lots, state.meds, userName, toast, toastErr, guardOnce, confirmAsync]);

  // ---------- report ----------
  const setReportTab = useCallback((t: AppState['reportTab']) => patch({ reportTab: t }), [patch]);

  const exportReportCsv = useCallback(async () => {
    const st = state;
    // 'kpi'/'usage'/'stockasof' never actually reach here — ReportScreen hides this generic
    // export button for all three in favor of their own date-range-scoped export
    // (exportDailyMetricsCsv / exportUsageHistoryCsv / exportStockAsOfCsv) — but the map still
    // needs every ReportTab key to satisfy state.reportTab's type below.
    const names = { aging: 'stock_aging.csv', category: 'stock_by_category.csv', turn: 'turnover.csv', disc: 'discrepancy_log.csv', insights: 'usage_insights.csv', exec: 'executive_summary.csv', kpi: 'kpi_metrics.csv', usage: 'usage_history.csv', stockasof: 'stock_as_of.csv' };
    // Bug fix (report accuracy): ReportScreen.tsx dropped OPD/IPD ward tabs a while back ("reports
    // always cover the whole formulary" — see its own comment) and every on-screen computation
    // there (aging/category/turn/insights/exec/disc) reads straight from state.meds.filter(active)
    // or state.txs with NO ward filtering at all — but this export kept scoping every branch to
    // st.wardFilter, a value ReportScreen.tsx itself never reads or sets. That value is just
    // whatever wardFilter happens to be left over from another screen (e.g. MedsScreen) — a
    // pharmacist could open Report, look at the whole-formulary aging/category/turnover numbers
    // on screen, click "Export CSV", and get a spreadsheet silently re-scoped to only OPD (or
    // only IPD) because that's what wardFilter happened to be set to elsewhere, with no visual
    // cue on this screen that anything was filtered. Matching the on-screen source of truth
    // exactly: every branch now uses the same plain active-med set ReportScreen.tsx computes.
    const meds = st.meds.filter((m) => m.active);
    let outcome: Awaited<ReturnType<typeof downloadCsv>>;
    if (st.reportTab === 'aging') {
      const medIds = new Set(meds.map((m) => m.id));
      const bDef: [string, number, number][] = [['หมดอายุแล้ว', -99999, 0], ['เหลือ ≤ 30 วัน', 0, 30], ['31–90 วัน', 30, 90], ['91–180 วัน', 90, 180], ['มากกว่า 180 วัน', 180, 99999]];
      const rows = bDef.map(([label, lo, hi]) => {
        const ls = st.lots.filter((l) => medIds.has(l.medId) && l.qty > 0 && daysUntil(l.exp) > lo && daysUntil(l.exp) <= hi);
        const val = ls.reduce((s, l) => s + l.qty * (meds.find((m) => m.id === l.medId)?.price || 0), 0);
        return [label, ls.length, Math.round(val)];
      });
      outcome = await downloadCsv([['bucket', 'lots', 'value_thb'], ...rows], names.aging);
    } else if (st.reportTab === 'category') {
      // Same categoryStats() the on-screen table renders from — one source of truth, so an
      // exported spreadsheet can never quietly disagree with what the pharmacist just read.
      const rows = categoryStats(st, meds, st.expiryWarnDays)
        .map((r) => [r.label, r.meds, r.low, Math.round(r.value), Math.round(r.atRisk), r.used30]);
      outcome = await downloadCsv([['category', 'medications', 'below_min', 'stock_value_thb', 'expiry_risk_value_thb', 'used_30d'], ...rows], names.category);
    } else if (st.reportTab === 'turn') {
      const rows = meds.map((m) => {
        const oh = m.floor + subQty(st, m.id);
        // A drug with no recorded usage yet (used30 === 0 — new, or never HOSxP-reconciled)
        // divides by zero here; the on-screen "รายงาน" tab already guards this with
        // isFinite(doh), but this CSV export didn't, so it used to write the literal text
        // "Infinity" (or "NaN" when on-hand is also 0) into a real exported spreadsheet.
        const doh = Math.round(oh / dailyUsageRate(m));
        return [m.name, m.unit, oh, m.used30, isFinite(doh) ? doh : ''];
      });
      outcome = await downloadCsv([['medication', 'unit', 'on_hand', 'used_30d', 'days_on_hand'], ...rows], names.turn);
    } else if (st.reportTab === 'insights') {
      const anomalies = usageAnomalies(meds);
      const rows = anomalies.map((a) => [
        a.med.name, a.med.used30, a.med.usedPrev30, Math.round(a.changePct * 100),
        daysOfStockLeft(st, a.med) ?? '',
      ]);
      outcome = await downloadCsv([['medication', 'used_30d', 'used_prev_30d', 'change_pct', 'days_of_stock_left'], ...rows], names.insights);
    } else if (st.reportTab === 'exec') {
      const rows = meds.map((m) => {
        const oh = m.floor + subQty(st, m.id);
        return [m.name, m.unit, oh, Math.round(oh * m.price), m.used30];
      }).sort((a, b) => (b[3] as number) - (a[3] as number));
      outcome = await downloadCsv([['medication', 'unit', 'on_hand', 'value_thb', 'used_30d'], ...rows], names.exec);
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
          .filter((x) => types.indexOf(x.type) >= 0)
          .map((x) => [isoDate(x.ts), x.name, x.type, x.qty, x.unit, x.loc || '', x.reason || '', x.note || '', x.by]);
      } catch (e) { toastErr(e, 'ดึงประวัติไม่สำเร็จ ลองใหม่อีกครั้ง'); return; }
      outcome = await downloadCsv([['date', 'medication', 'type', 'qty', 'unit', 'location', 'reason', 'note', 'performed_by'], ...rows], names.disc);
    }
    if (outcome === 'saved') toast('ดาวน์โหลด ' + names[state.reportTab] + ' แล้ว');
    else if (outcome === 'unavailable') toast('ดาวน์โหลดไฟล์ไม่ได้ในเบราว์เซอร์นี้');
  }, [state, toast, toastErr]);

  // "Dashboard สรุปภาพรวมสำหรับผู้บริหาร/หัวหน้าเภสัชกรรม" — same underlying numbers the aging/
  // category/turnover tabs already compute on screen, rolled into one headline-first printout
  // meant for someone who wants the whole-formulary picture in one glance, not to operate the
  // app. Deliberately its own function (not routed through exportReportCsv's per-tab branches)
  // since a PTC-meeting printout and a spreadsheet export serve different readers.
  const printExecutiveSummary = useCallback(async () => {
    const meds = state.meds.filter((m) => m.active);
    const totalValue = meds.reduce((s, m) => s + (m.floor + subQty(state, m.id)) * m.price, 0);
    const healthy = meds.filter((m) => toneFor(m) === 'var(--green)').length;
    const warn = meds.filter((m) => toneFor(m) === 'var(--amber)').length;
    const critical = meds.length - healthy - warn;
    const healthyPct = meds.length ? Math.round((healthy / meds.length) * 100) : 100;
    const riskValue = state.lots.reduce((s, l) => {
      const m = meds.find((x) => x.id === l.medId);
      return m && l.qty > 0 && daysUntil(l.exp) <= state.expiryWarnDays ? s + l.qty * m.price : s;
    }, 0);
    const monthAgo = Date.now() - 30 * DAY;
    // state.txs is the realtime cache capped to the 300 most-recent rows across ALL types — a
    // busy month can blow past that cap long before 30 days are covered. A printed PTC document
    // needs the real count, so fetch it server-side and only fall back to the capped estimate
    // (which can only ever under-count, never over-count) if that fetch fails.
    let txsThisMonth: number;
    try {
      const snap = await withTimeout(getCountFromServer(query(collection(db, 'txs'), where('ts', '>=', monthAgo))));
      txsThisMonth = snap.data().count;
    } catch {
      txsThisMonth = state.txs.filter((x) => x.ts >= monthAgo).length;
    }

    const stats: ExecSummaryStat[] = [
      { label: 'มูลค่าคงคลังยาคงเหลือรวมทั้งหมด (หน้างานและสำรองคลังย่อย)', value: nf(Math.round(totalValue)) + ' บาท' },
      { label: 'สถานภาพคลังยาโดยรวม', value: healthyPct + '% ปกติ', note: `ระดับวิกฤต ${nf(critical)} รายการ · ระดับเริ่มต่ำ ${nf(warn)} รายการ`, tone: healthyPct >= 80 ? 'green' : healthyPct >= 50 ? 'amber' : 'red' },
      { label: `มูลค่ายาที่มีความเสี่ยงหมดอายุภายใน ${state.expiryWarnDays} วัน`, value: nf(Math.round(riskValue)) + ' บาท', tone: riskValue > 0 ? 'amber' : 'green' },
      { label: 'จำนวนธุรกรรมในรอบ 30 วันที่ผ่านมา', value: nf(txsThisMonth) + ' รายการ', note: 'จำนวนรายการยาที่เปิดใช้งาน ' + nf(meds.length) + ' รายการ' },
    ];

    const byValue = meds
      .map((m) => ({ m, oh: m.floor + subQty(state, m.id), value: (m.floor + subQty(state, m.id)) * m.price }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10)
      .map((r): ExecSummaryRow => ({ name: r.m.name, unit: r.m.unit, a: nf(r.oh), b: nf(Math.round(r.value)) }));

    const byUsage = meds
      .filter((m) => m.used30 > 0)
      .map((m) => {
        const oh = m.floor + subQty(state, m.id);
        const doh = Math.round(oh / dailyUsageRate(m));
        return { m, doh };
      })
      .sort((a, b) => b.m.used30 - a.m.used30)
      .slice(0, 10)
      .map((r): ExecSummaryRow => ({ name: r.m.name, unit: r.m.unit, a: nf(r.m.used30), b: isFinite(r.doh) ? nf(r.doh) : '—' }));

    const ok = printExecutiveSummarySheet(stats, byValue, byUsage, { printedBy: userName(), periodLabel: 'ข้อมูล ณ วันที่ ' + thDate(Date.now()) });
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state, toast, userName]);

  // "ดึงข้อมูลได้ทุกอย่างที่เกี่ยวข้องกับข้อมูลในแอพ" — ก่อนหน้านี้ (v2.89.0) รวมแค่รายงานสำเร็จรูป
  // 4 ชุด + master data ยา/lot; รอบนี้ขยายให้ครบทุกคอลเลกชันจริงใน Firestore ที่แอพนี้เก็บ ไม่ใช่แค่
  // ส่วนที่มีหน้าจอ "รายงาน" ให้ดูอยู่แล้ว — ธุรกรรมทุกประเภท (ไม่ใช่แค่ discrepancy), audit log
  // เต็ม (login/อนุมัติบัญชี/แก้ไขยา ฯลฯ), รายชื่อผู้ใช้ (เฉพาะ Admin ที่มีสิทธิ์เห็นอยู่แล้ว), และ
  // ใบรับที่รออนุมัติ — เป็นไฟล์ .xlsx เดียว คนละ sheet ต่อชุดข้อมูล ไม่ต้องเปิดหลายไฟล์
  const exportAllReports = useCallback(guardOnce('exportAll', async () => {
    toast('กำลังรวบรวมข้อมูลทั้งหมด…');
    try {
      const XLSX = await import('xlsx');
      const st = state;
      const activeMeds = st.meds.filter((m) => m.active);
      const wb = XLSX.utils.book_new();
      const addSheet = (name: string, rows: (string | number)[][]) => {
        XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), name);
      };

      // 1) Stock aging (มูลค่ายาตามช่วงอายุคงเหลือ)
      // Bug fix (report accuracy): used to scan st.lots with no medId/active filtering at all —
      // a lot belonging to a discontinued med (active:false, unscrapped stock still physically
      // sitting on a shelf) would count here even though the on-screen aging report (and the
      // per-tab CSV export, fixed the same way above) both restrict to active meds only. Same
      // activeMeds set every other sheet in this export already uses.
      const activeMedIds = new Set(activeMeds.map((m) => m.id));
      const bDef: [string, number, number][] = [['หมดอายุแล้ว', -99999, 0], ['เหลือ ≤ 30 วัน', 0, 30], ['31–90 วัน', 30, 90], ['91–180 วัน', 90, 180], ['มากกว่า 180 วัน', 180, 99999]];
      addSheet('stock_aging', [['bucket', 'lots', 'value_thb'], ...bDef.map(([label, lo, hi]) => {
        const ls = st.lots.filter((l) => activeMedIds.has(l.medId) && l.qty > 0 && daysUntil(l.exp) > lo && daysUntil(l.exp) <= hi);
        const val = ls.reduce((s, l) => s + l.qty * (activeMeds.find((m) => m.id === l.medId)?.price || 0), 0);
        return [label, ls.length, Math.round(val)];
      })]);

      // 1b) Stock by therapeutic category (มูลค่าคงคลังแยกตามหมวดกลุ่มยา) — same
      // categoryStats() the on-screen report and the per-tab CSV both use.
      addSheet('stock_by_category', [['category', 'medications', 'below_min', 'stock_value_thb', 'expiry_risk_value_thb', 'used_30d'],
        ...categoryStats(st, activeMeds, st.expiryWarnDays).map((r) => [r.label, r.meds, r.low, Math.round(r.value), Math.round(r.atRisk), r.used30])]);

      // 2) Turnover
      addSheet('turnover', [['medication', 'unit', 'on_hand', 'used_30d', 'days_on_hand'], ...activeMeds.map((m) => {
        const oh = m.floor + subQty(st, m.id);
        const doh = Math.round(oh / dailyUsageRate(m));
        return [m.name, m.unit, oh, m.used30, isFinite(doh) ? doh : ''];
      })]);

      // 3) Usage insights — anomalies + stockout forecast, same on-device computations as the
      // "🧠 วิเคราะห์อัตโนมัติ" report tab (see selectors.ts — no external AI call involved).
      const anomalies = usageAnomalies(activeMeds);
      addSheet('usage_anomalies', [['medication', 'used_30d', 'used_prev_30d', 'change_pct', 'direction'],
        ...anomalies.map((a) => [a.med.name, a.med.used30, a.med.usedPrev30, Math.round(a.changePct * 100), a.direction])]);
      const stockout = activeMeds
        .map((m) => ({ m, days: daysOfStockLeft(st, m) }))
        .filter((x): x is { m: Med; days: number } => x.days !== null)
        .sort((a, b) => a.days - b.days);
      addSheet('stockout_forecast', [['medication', 'days_of_stock_left'], ...stockout.map((x) => [x.m.name, x.days])]);

      // 4) Every transaction ever logged (receive/transfer/ward-move/adjust/return/damaged/
      // expired/count/reconcile — the FULL txs collection) + 5) the full audit log (login/
      // สมัครสมาชิก/อนุมัติบัญชี/แก้ไขข้อมูลยา ฯลฯ, which never shows up in txs at all) — both
      // fetched fresh rather than the capped-300 live feeds, so nothing before that cutoff
      // silently goes missing from a "ทั้งหมด" export. Bug fix (speed): these two independent
      // collections used to fetch one after the other (await, then await again) — two full
      // round trips back-to-back for no reason, since neither query depends on the other's
      // result. Promise.all runs them concurrently instead, same pattern exportAudit() already
      // uses for the same two collections — the whole export finishes in however long the
      // SLOWER of the two queries takes, not both added together.
      toast('กำลังดึงประวัติธุรกรรมและ audit log ทั้งหมด…');
      const [txSnap, auditSnap] = await withTimeout(Promise.all([
        getDocs(query(collection(db, 'txs'), orderBy('ts', 'desc'))),
        getDocs(query(collection(db, 'auditLog'), orderBy('ts', 'desc'))),
      ]));
      const txDocs = txSnap.docs.map((d) => d.data() as {
        type: string; ts: number; name: string; qty: number; unit: string; loc?: string;
        reason?: string; note?: string; by: string; from?: string; to?: string;
      });
      const discTypes = ['adjust', 'return', 'damaged', 'expired', 'count', 'reconcile_hosxp'];
      addSheet('discrepancy_log', [['date', 'medication', 'type', 'qty', 'unit', 'location', 'reason', 'note', 'performed_by'],
        ...txDocs.filter((x) => discTypes.indexOf(x.type) >= 0)
          .map((x) => [isoDate(x.ts), x.name, x.type, x.qty, x.unit, x.loc || '', x.reason || '', x.note || '', x.by])]);
      addSheet('all_transactions', [['date_time', 'type', 'type_label', 'medication', 'qty', 'unit', 'from', 'to', 'location', 'reason', 'note', 'performed_by'],
        ...txDocs.map((x) => [new Date(x.ts).toISOString(), x.type, EVENT_TYPE_LABEL[x.type] || x.type, x.name, x.qty, x.unit, x.from || '', x.to || '', x.loc || '', x.reason || '', x.note || '', x.by])]);
      addSheet('audit_log', [['date_time', 'type', 'type_label', 'by', 'note'],
        ...auditSnap.docs.map((d) => d.data() as { type: string; by: string; ts: number; note: string })
          .map((x) => [new Date(x.ts).toISOString(), x.type, EVENT_TYPE_LABEL[x.type] || x.type, x.by, x.note])]);

      // 6) Pending receives — ใบรับที่ยังรออนุมัติ ณ ตอนนี้ (already live-synced for every role
      // that can see the receive screen, no extra fetch needed).
      addSheet('pending_receives', [['status', 'recv_no', 'medication', 'lot_no', 'expiry', 'qty', 'unit', 'requested_by', 'requested_at'],
        ...st.pendingReceives.map((r) => [r.status, r.recvNo, r.name, r.lotNo, isoDate(r.exp), r.qty, r.unit, r.requestedBy, new Date(r.ts).toISOString()])]);

      // 7) User accounts — Admin only, same restriction the live subscription itself already
      // enforces (state.users is only ever populated for role === 'admin' — see the live-data
      // effect above), so this sheet comes out simply empty for every other role, no extra guard.
      if (st.users.length) {
        addSheet('users', [['username', 'name', 'dept', 'role', 'active', 'created_at', 'last_login'],
          ...st.users.map((u) => [u.username, u.name, u.dept, u.role, u.active ? 'Y' : 'N', new Date(u.createdAt).toISOString(), u.lastLogin ? new Date(u.lastLogin).toISOString() : ''])]);
      }

      // 8) Full formulary master data — every field on Med, not just the subset the pre-built
      // reports happen to need, so this sheet alone is a complete point-in-time dump of the
      // whole formulary (dosage form, min/max par, noSubstock/shared flags, volatility — the
      // par-suggestion multiplier — and last period's usage for a real week-over-week
      // comparison, not just this period's used_30d).
      addSheet('meds_master', [
        ['code', 'name', 'dosage_form', 'ward', 'unit', 'price', 'bin', 'bin_ipd', 'shared',
         'floor', 'floor_min', 'par_floor', 'par_sub', 'substock', 'used_30d', 'used_prev_30d',
         'volatility', 'no_substock', 'high_alert', 'active'],
        ...st.meds.map((m) => [
          m.code, m.name, m.dosageForm, wardOf(m), m.unit, m.price, m.bin, m.binIpd || '', isSharedMed(m) ? 'Y' : 'N',
          m.floor, floorMinOf(m), m.parFloor, m.parSub, subQty(st, m.id), m.used30, m.usedPrev30,
          m.volatility, m.noSubstock ? 'Y' : 'N', m.had ? 'Y' : 'N', m.active ? 'Y' : 'N',
        ]),
      ]);

      // 9) EVERY lot ever received, not just the ones still holding stock — scrapLot()/a fully-
      // transferred-out lot sets qty to 0 rather than deleting the doc (see scrapLot's own
      // comment), so a qty>0 filter here would silently drop real historical records (when a
      // lot arrived, what it was scrapped for) from a sheet whose whole point is "everything".
      addSheet('lots', [['medication', 'lot_no', 'expiry', 'qty_remaining', 'status'],
        ...st.lots
          .slice()
          .sort((a, b) => a.exp - b.exp)
          .map((l) => [st.meds.find((m) => m.id === l.medId)?.name || l.medId, l.lotNo, isoDate(l.exp), l.qty, l.qty > 0 ? 'คงเหลือ' : 'หมด/ตัดออกแล้ว'])]);

      // 10) Global settings (หน้าตั้งค่า → เกณฑ์แจ้งเตือน/par อัตโนมัติ) — real, saved app
      // configuration (see the meta/settings Firestore doc this app writes via
      // updateGlobalSettings), never included in any export before this.
      addSheet('settings', [
        ['setting', 'value'],
        ['expiry_warn_days', st.expiryWarnDays],
        ['par_floor_cover_days', st.parFloorCoverDays],
        ['par_sub_cover_days', st.parSubCoverDays],
      ]);

      const fname = 'ข้อมูลทั้งหมด_' + isoDate(Date.now()) + '.xlsx';
      XLSX.writeFile(wb, fname);
      toast('ดาวน์โหลด ' + fname + ' แล้ว — รวมข้อมูลทุกอย่างในแอพเป็นไฟล์เดียว คนละ sheet');
    } catch (e) { toastErr(e, 'รวบรวมข้อมูลไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }), [state, toast, toastErr, guardOnce]);

  // ---------- labels ----------
  const setLabelType = useCallback((t: AppState['labelType']) => patch({ labelType: t }), [patch]);
  const setLocScope = useCallback((s: AppState['locScope']) => patch({ locScope: s }), [patch]);
  const setLabelWardScope = useCallback((s: AppState['labelWardScope']) => patch({ labelWardScope: s }), [patch]);
  const toggleLabelSelected = useCallback((medId: string) => patch((st) => ({ labelSelected: { ...st.labelSelected, [medId]: !st.labelSelected[medId] } })), [patch]);
  const selectAllLabels = useCallback((medIds: string[]) => patch((st) => {
    const next = { ...st.labelSelected };
    medIds.forEach((id) => { next[id] = true; });
    return { labelSelected: next };
  }), [patch]);
  const clearLabelSelected = useCallback(() => patch({ labelSelected: {} }), [patch]);
  const printLabels = useCallback(() => {
    // Bug fix: this used to scope by state.wardFilter (which side's tab was open) to decide
    // which of a shared med's two shelf codes to print — but the OPD/IPD ward TABS were
    // removed from every operational screen (see WardTabs.tsx's deletion), leaving
    // state.wardFilter permanently stuck at 'all' with nothing left to ever change it. That
    // silently made `labelWard` always resolve to 'opd' — a shared med's IPD-side shelf label
    // became flat-out unprintable from here, with no error or indication anything was wrong.
    // Fixed at the source instead of patching the dead wardFilter read: a shared med with a
    // distinct binIpd genuinely has TWO physical shelf spots needing their own sticker, so it
    // now emits one label row per real shelf position instead of guessing which single one to
    // print — a non-shared med (one real shelf spot) still gets exactly one label, unchanged.
    // An empty picker (nobody checked anything) means "print everything active", same as
    // before this picker existed — only narrows to the checked meds once at least one is
    // actually checked, so leaving the picker untouched can never silently print less than
    // the old unconditional full-formulary behavior did.
    const selectedIds = Object.keys(state.labelSelected).filter((id) => state.labelSelected[id]);
    const selectedSet = new Set(selectedIds);
    const meds = state.meds.filter((m) => m.active && (selectedSet.size === 0 || selectedSet.has(m.id)));
    let labels: PrintLabel[] = [];
    // One combined tag line (labels have room for exactly one) — a med can be high-alert AND
    // need refrigeration at once, so both show rather than one silently winning.
    const printTag = (m: Med) => [m.had ? 'HIGH ALERT' : '', m.fridge ? '🧊 ตู้เย็น' : ''].filter(Boolean).join(' · ') || undefined;
    let heading = 'ฉลากตัวยา';
    if (state.labelType === 'med') {
      if (state.labelWardScope !== 'all') heading = 'ฉลากตัวยา (' + (state.labelWardScope === 'ipd' ? 'IPD' : 'OPD') + ')';
      labels = meds.flatMap((m): PrintLabel[] => {
        const sides: Array<{ ward: Ward; bin: string }> = isSharedMed(m) && m.binIpd
          ? [{ ward: 'opd', bin: m.bin }, { ward: 'ipd', bin: m.binIpd }]
          : [{ ward: wardOf(m), bin: binFor(m, wardOf(m)) }];
        // Real need this scope exists for: someone restocking only the OPD shelf run shouldn't
        // have to sort a mixed OPD+IPD sticker sheet by hand first — see AppState.labelWardScope.
        // A shared med prints only its matching side; a med whose single ward doesn't match the
        // chosen scope contributes nothing at all (not an empty/blank label).
        const scoped = state.labelWardScope === 'all' ? sides : sides.filter((s) => s.ward === state.labelWardScope);
        return scoped.map((s) => ({
          payload: encodeQr('med', m.code), id: m.code, title: shortLabelName(m.name),
          sub: 'หน่วย ' + m.unit + ' · ชั้น ' + s.bin, tag: printTag(m), bin: s.bin, ward: s.ward,
        }));
      });
    } else if (state.labelType === 'lot') {
      heading = 'ฉลาก lot';
      // Bug fix: this used to iterate state.lots directly, ignoring both the active-only and
      // ward-scoped `meds` set the med-label branch already correctly used — printing "ฉลาก
      // lot" while the OPD tab was open would still include IPD (and inactive-med) lots on
      // the same sheet, silently ignoring the ward tab shown right above the print button.
      const medIds = new Set(meds.map((m) => m.id));
      labels = state.lots.filter((l) => medIds.has(l.medId)).map((l) => {
        const m = meds.find((x) => x.id === l.medId)!;
        // Bug fix (consistency): every other near-expiry check in this file (categoryStats,
        // riskValue at line 1944) uses `<=`, so a lot exactly `expiryWarnDays` days out counts
        // as at-risk in every KPI/report total — this one used `<`, silently excluding that
        // same lot from the printed "ใกล้หมดอายุ" label tag on its boundary day.
        // Bug fix (patient safety): this only ever showed the near-expiry tag, silently dropping
        // HIGH ALERT status entirely for a lot label — unlike the med-label branch above (see
        // printTag()), which always combines HAD with fridge. A lot label is what staff actually
        // see while physically picking stock off the shelf; a high-alert drug's lot label used
        // to look identical to any ordinary drug's, with the one visual safety cue this app
        // deliberately built for shelf labels simply missing on this specific print path.
        const lotTag = [m.had ? 'HIGH ALERT' : '', daysUntil(l.exp) <= state.expiryWarnDays ? 'ใกล้หมดอายุ' : ''].filter(Boolean).join(' · ') || undefined;
        return { payload: encodeQr('lot', l.code), id: l.code, title: m.name, sub: 'lot ' + l.lotNo + ' · exp ' + thDate(l.exp), tag: lotTag, ward: wardOf(m) };
      });
    } else if (state.locScope === 'sub') {
      // Bug fix: the first cut of this (v3.12.0) printed a generic, drug-less location sheet
      // here (one label per SUB_LOCS code, no med name on it at all) — but a real substock
      // shelf-edge label needs to say WHICH drug goes there at a glance, exactly like the
      // "ฉลากตัวยา" floor labels already do (QR + shelf code + name + strength), not just an
      // anonymous code. Substock has no OPD/IPD split on binSub (one code per med, unlike
      // bin/binIpd) so this is the med branch above minus the two-sides fan-out — one shelf
      // strip per med that actually has a substock rack assigned, using its real 'med' QR
      // (scanning it resolves the drug directly, same as the floor labels) with binSub as the
      // shown/printed shelf code instead of bin.
      heading = 'ฉลากชั้นวาง substock';
      labels = meds.filter((m) => !m.noSubstock && m.binSub).map((m) => ({
        payload: encodeQr('med', m.code), id: m.code, title: shortLabelName(m.name),
        sub: 'หน่วย ' + m.unit + ' · substock ' + m.binSub, tag: printTag(m), bin: m.binSub,
      }));
    } else if (state.locScope === 'fridge') {
      // Real-world request: the pharmacy's own cold-chain fridges (vaccine/cold-drug storage,
      // 2 shared OPD+IPD service fridges — see FRIDGE_LOCS' own doc comment) need their
      // positions labeled just like LOCS does for floor shelves, printed ahead of any med
      // actually being assigned there yet — a generic location sheet, not per-med.
      heading = 'ฉลากตู้เย็น';
      labels = FRIDGE_LOCS.map(([code, name]) => ({ payload: encodeQr('loc', 'LOC-' + code), id: 'LOC-' + code, title: '🧊 ' + name, sub: 'สแกนเพื่อเปิดรายการยาในตู้นี้' }));
    } else {
      heading = 'ฉลากชั้นวาง';
      labels = LOCS.map((b) => ({ payload: encodeQr('loc', 'LOC-' + b), id: 'LOC-' + b, title: 'ชั้นจ่ายยา ' + b, sub: 'หน้างาน OPD · สแกนเพื่อเปิดรายการในชั้นนี้' }));
    }
    if (!labels.length) { toast('ไม่มีรายการให้พิมพ์ฉลาก'); return; }
    const ok = printLabelSheet(labels, heading);
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว — เลือกกระดาษสติกเกอร์ A4 แล้วสั่งพิมพ์' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state.meds, state.lots, state.labelType, state.wardFilter, state.expiryWarnDays, state.labelSelected, state.locScope, state.labelWardScope, toast]);

  // ---------- settings / par ----------
  const applyOnePar = useCallback(async (medId: string, which: 'sub' | 'floor') => {
    if (!canEditMeds) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    const sug = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
    if (!sug) { toast(m.name + ' ยังไม่มีสถิติการใช้ ไม่สามารถแนะนำ par ได้'); return; }
    try {
      // Bug fix (data integrity): this wrote the new parFloor (Max) alone, with no check
      // against the med's existing hand-set floorMin (Min) — real usage dropping enough to
      // shrink Max below a Min set back when usage was higher leaves Min > Max sitting live in
      // Firestore (observed: "Min 400 / Max 110"), reading as permanently "ต่ำกว่า Min" no
      // matter how full the shelf is. Re-derive Min as 50% of the NEW Max (same default ratio
      // floorMinOf() itself falls back to) whenever applying this suggestion would otherwise
      // leave Min above it — the same math the "ตั้ง Min ทั้งหมดเป็น 50% ของ Max" bulk action
      // already uses.
      const newFloorMin = which === 'floor' && typeof m.floorMin === 'number' && m.floorMin > sug.floor
        ? halfOfMaxRounded(sug.floor) : undefined;
      await withTimeout(updateDoc(doc(db, 'meds', medId), { ...(which === 'sub' ? { parSub: sug.sub } : { parFloor: sug.floor }), ...(newFloorMin !== undefined ? { floorMin: newFloorMin } : {}) }));
      logAudit({ type: 'par_updated', note: 'ปรับ par' + (which === 'sub' ? 'substock' : 'หน้างาน') + ' ' + m.name + ' เป็น ' + nf(which === 'sub' ? sug.sub : sug.floor) + ' ตามค่าแนะนำจากสถิติ' + (newFloorMin !== undefined ? ' (ปรับ Min ลงเหลือ ' + nf(newFloorMin) + ' ตามไปด้วย เพราะ Min เดิมสูงกว่า Max ใหม่)' : '') });
      // Real-world request: "ติดตามผลหลังปรับ par ว่านิ่งจริงไหม" — see ParAdjustmentRecord's own
      // doc comment (types.ts) for why logAudit's free-text note above isn't enough for this.
      addDoc(collection(db, 'parAdjustments'), {
        medId, medName: m.name, category: categoryOf(m),
        beforeFloor: m.parFloor, beforeSub: m.parSub,
        afterFloor: which === 'floor' ? sug.floor : m.parFloor, afterSub: which === 'sub' ? sug.sub : m.parSub,
        used30AtAdjust: m.used30, usedPrev30AtAdjust: m.usedPrev30,
        adjustedAt: Date.now(), adjustedBy: userName(),
      } satisfies ParAdjustmentRecord).catch((e) => console.error(e)); // best-effort — never block the real par write on this
    } catch (e) { toastErr(e, 'ปรับ par ไม่สำเร็จ'); }
  }, [canEditMeds, state.meds, state.parFloorCoverDays, state.parSubCoverDays, logAudit, toast, toastErr, userName]);

  const applyAllSuggested = useCallback(guardOnce('applyAllSuggested', async () => {
    if (!canEditMeds) return;
    const targets = state.meds.filter((m) => {
      if (!m.active) return false;
      const s = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
      return !!s && (s.sub !== m.parSub || s.floor !== m.parFloor);
    });
    try {
      // Each target now writes TWO ops (the med update + a parAdjustments record below) — half
      // the old chunk size to stay safely under Firestore's 500-write batch limit, same reason
      // commitUsageImport's own batch halved its chunk size earlier.
      for (let i = 0; i < targets.length; i += 200) {
        const batch = writeBatch(db);
        targets.slice(i, i + 200).forEach((m) => {
          const sug = suggestPar(m, state.parFloorCoverDays, state.parSubCoverDays);
          if (!sug) return; // ไม่มีสถิติการใช้ ข้าม ห้ามเขียนทับ par เดิม
          // Bug fix (data integrity): same gap as applyOnePar above, applied per-row here too —
          // a bulk apply across the whole formulary is exactly where a Max shrinking below an
          // old hand-set Min is most likely to happen unnoticed (no per-med review step).
          const floorMinFix = typeof m.floorMin === 'number' && m.floorMin > sug.floor
            ? { floorMin: halfOfMaxRounded(sug.floor) } : {};
          batch.update(doc(db, 'meds', m.id), { parSub: sug.sub, parFloor: sug.floor, ...floorMinFix });
          // Real-world request: "ติดตามผลหลังปรับ par ว่านิ่งจริงไหม" — same durable record
          // applyOnePar writes for a single-med apply, here for every med this bulk action
          // actually changes.
          batch.set(doc(collection(db, 'parAdjustments')), {
            medId: m.id, medName: m.name, category: categoryOf(m),
            beforeFloor: m.parFloor, beforeSub: m.parSub, afterFloor: sug.floor, afterSub: sug.sub,
            used30AtAdjust: m.used30, usedPrev30AtAdjust: m.usedPrev30,
            adjustedAt: Date.now(), adjustedBy: userName(),
          } satisfies ParAdjustmentRecord);
        });
        await withTimeout(batch.commit());
      }
      logAudit({ type: 'par_updated', note: 'ใช้ค่า par แนะนำจากสถิติทั้งหมด (' + targets.length + ' รายการเปลี่ยนแปลง)' });
      toast('ปรับ par ตามค่าแนะนำแล้ว ' + targets.length + ' รายการ');
    } catch (e) { toastErr(e, 'ปรับ par ไม่สำเร็จ'); }
  }), [canEditMeds, state.meds, state.parFloorCoverDays, state.parSubCoverDays, logAudit, toast, toastErr, guardOnce, userName]);

  // Real-world request: "ปรับยาหน้างานทั้งหมดในแอพ min เป็น 50% ของ max" — a one-time bulk
  // normalization that writes floorMin EXPLICITLY onto every active med, not just the default-
  // fallback ratio floorMinOf() already uses for any med without a hand-set floorMin (see that
  // function and halfOfMaxRounded() above, both in selectors.ts). Unlike that fallback, this
  // OVERWRITES any custom Min a pharmacist may have hand-set for a specific drug — genuinely
  // different from "leave custom values alone, only fill in the unset ones", so it needs its
  // own explicit, confirmed action rather than happening silently as a side effect.
  const setAllMinHalfOfMax = useCallback(guardOnce('setAllMinHalfOfMax', async () => {
    if (!canEditMeds) return;
    const targets = state.meds.filter((m) => m.active && halfOfMaxRounded(m.parFloor) !== floorMinOf(m));
    if (!targets.length) { toast('ยาทุกตัวมี Min = 50% ของ Max อยู่แล้ว ไม่มีอะไรต้องเปลี่ยน'); return; }
    if (!(await confirmAsync(
      'ตั้งค่า Min ของยาทุกตัวเป็น 50% ของ Max?\n\n'
      + 'จะเขียนทับค่า Min ปัจจุบันของยา ' + nf(targets.length) + ' รายการ (รวมถึงตัวที่เคยตั้งเองไว้ไม่เท่ากับ 50%) '
      + 'ให้เป็น 50% ของ Max ทั้งหมด — ยาที่ Min เท่ากับ 50% ของ Max อยู่แล้วจะไม่ถูกแตะต้อง\n\n'
      + 'แก้กลับเป็นรายตัวได้ภายหลังที่หน้าจัดการรายการยา ยืนยันหรือไม่?',
    ))) return;
    try {
      for (let i = 0; i < targets.length; i += 400) {
        const batch = writeBatch(db);
        targets.slice(i, i + 400).forEach((m) => {
          batch.update(doc(db, 'meds', m.id), { floorMin: halfOfMaxRounded(m.parFloor) });
        });
        await withTimeout(batch.commit());
      }
      logAudit({ type: 'par_updated', note: 'ตั้งค่า Min ยาทุกตัวเป็น 50% ของ Max (' + nf(targets.length) + ' รายการเปลี่ยนแปลง)' });
      toast('ตั้งค่า Min เป็น 50% ของ Max แล้ว ' + nf(targets.length) + ' รายการ');
    } catch (e) { toastErr(e, 'ตั้งค่า Min ไม่สำเร็จ'); }
  }), [canEditMeds, state.meds, confirmAsync, logAudit, toast, toastErr, guardOnce]);

  const debouncedParWrite = useCallback((medId: string, field: 'parSub' | 'parFloor', val: number) => {
    const key = 'par:' + medId + field;
    window.clearTimeout(parDebounce.current[medId + field]);
    const fire = () => {
      delete pendingFlush.current[key];
      updateDoc(doc(db, 'meds', medId), { [field]: val }).catch(async () => {
        toast('บันทึกค่า par ไม่สำเร็จ — กำลังดึงค่าจริงกลับมาแสดง');
        // Bug fix: the optimistic local edit above (setParSub/setParFloor, applied immediately
        // on keystroke) used to stay on screen forever on a write failure — nothing rolled it
        // back, so the field could keep showing a number that was never actually saved, with
        // only a toast (easy to miss, especially mid-typing) ever having said so. Re-read the
        // real value and restore it so the screen never silently disagrees with Firestore.
        try {
          const snap = await getDoc(doc(db, 'meds', medId));
          const real = (snap.data() as Record<string, unknown> | undefined)?.[field];
          if (typeof real === 'number') {
            setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, [field]: real } : x)) }));
          }
        } catch { /* best-effort rollback; the live meds listener will eventually correct it too */ }
      });
    };
    pendingFlush.current[key] = fire;
    parDebounce.current[medId + field] = window.setTimeout(fire, 500);
  }, [toast]);

  const setParSub = useCallback((medId: string, v: string) => {
    if (!canEditMeds) return;
    const val = parseIntSafe(v);
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, parSub: val } : x)) }));
    debouncedParWrite(medId, 'parSub', val);
  }, [canEditMeds, debouncedParWrite]);

  const setParFloor = useCallback((medId: string, v: string) => {
    if (!canEditMeds) return;
    const val = parseIntSafe(v);
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, parFloor: val } : x)) }));
    debouncedParWrite(medId, 'parFloor', val);
  }, [canEditMeds, debouncedParWrite]);

  const setMedBin = useCallback((medId: string, v: string) => {
    if (!canEditMeds) return;
    // Same widened charset as normBin/sanitizeBin — see normBin's doc comment.
    const val = v.toUpperCase().replace(/[^A-Z0-9\u0E00-\u0E7F-]/g, '').slice(0, 10);
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, bin: val } : x)) }));
    const key = 'bin:' + medId;
    window.clearTimeout(binDebounce.current[medId]);
    const fire = () => {
      delete pendingFlush.current[key];
      updateDoc(doc(db, 'meds', medId), { bin: val }).catch(async () => {
        toast('บันทึกชั้นวางไม่สำเร็จ — กำลังดึงค่าจริงกลับมาแสดง');
        // Bug fix: same rollback gap as debouncedParWrite above — restore the real saved bin
        // code on a write failure instead of leaving the field showing an unsaved value.
        try {
          const snap = await getDoc(doc(db, 'meds', medId));
          const real = (snap.data() as { bin?: string } | undefined)?.bin;
          if (typeof real === 'string') {
            setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, bin: real } : x)) }));
          }
        } catch { /* best-effort rollback; the live meds listener will eventually correct it too */ }
      });
    };
    pendingFlush.current[key] = fire;
    binDebounce.current[medId] = window.setTimeout(fire, 500);
  }, [canEditMeds, toast]);

  // Real-world request: "ข้อมูลยังไม่ครบ" diagnostic filter (MedsScreen) needs a fast way to fill
  // in a missing substock shelf code right from that filtered list, without opening the full
  // edit form — same debounced-write-with-rollback shape as setMedBin above, just for binSub.
  const setMedBinSub = useCallback((medId: string, v: string) => {
    if (!canEditMeds) return;
    const val = normBin(v);
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, binSub: val || undefined } : x)) }));
    const key = 'binSub:' + medId;
    window.clearTimeout(binSubDebounce.current[medId]);
    const fire = () => {
      delete pendingFlush.current[key];
      updateDoc(doc(db, 'meds', medId), { binSub: val ? val : deleteField() }).catch(async () => {
        toast('บันทึกชั้นวาง substock ไม่สำเร็จ — กำลังดึงค่าจริงกลับมาแสดง');
        try {
          const snap = await getDoc(doc(db, 'meds', medId));
          const real = (snap.data() as { binSub?: string } | undefined)?.binSub;
          setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, binSub: real } : x)) }));
        } catch { /* best-effort rollback; the live meds listener will eventually correct it too */ }
      });
    };
    pendingFlush.current[key] = fire;
    binSubDebounce.current[medId] = window.setTimeout(fire, 500);
  }, [canEditMeds, toast]);

  // Same "ข้อมูลยังไม่ครบ" quick-fix need as setMedBinSub above, for category — a single select
  // choice rather than typed text, so written immediately (no debounce needed: there's no
  // keystroke-by-keystroke churn to coalesce for a dropdown pick).
  const setMedCategory = useCallback(async (medId: string, categoryId: string) => {
    if (!canEditMeds) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    const prevCategory = m.category;
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, category: categoryId || undefined } : x)) }));
    try {
      await withTimeout(updateDoc(doc(db, 'meds', medId), categoryId ? { category: categoryId } : { category: deleteField() }));
    } catch (e) {
      console.error(e);
      toast('บันทึกหมวดกลุ่มยาไม่สำเร็จ — กำลังดึงค่าจริงกลับมาแสดง');
      setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, category: prevCategory } : x)) }));
    }
  }, [canEditMeds, state.meds, toast]);

  // Real-world request: "ข้อมูลที่ยังไม่ครบ อยากให้แจ้งที่ตัวยาเลย...แล้วสามารถเติมตรงนั้นได้เลยอย่าง
  // รวดเร็ว" — same "ข้อมูลยังไม่ครบ" quick-fix need as setMedCategory above, now that route
  // (ยากิน/ยาฉีด/อื่นๆ) is also tracked as a field every active med should have explicitly set
  // (see missingFields() in MedsScreen.tsx). Same immediate-write-no-debounce shape as category —
  // a tap on one of 3 chips, not keystroke-by-keystroke text entry.
  const setMedRoute = useCallback(async (medId: string, route: '' | 'oral' | 'injection' | 'other') => {
    if (!canEditMeds) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    const prevRoute = m.route;
    setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, route: route || undefined } : x)) }));
    try {
      await withTimeout(updateDoc(doc(db, 'meds', medId), route ? { route } : { route: deleteField() }));
    } catch (e) {
      console.error(e);
      toast('บันทึกประเภทการให้ยาไม่สำเร็จ — กำลังดึงค่าจริงกลับมาแสดง');
      setState((st) => ({ ...st, meds: st.meds.map((x) => (x.id === medId ? { ...x, route: prevRoute } : x)) }));
    }
  }, [canEditMeds, state.meds, toast]);

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
    if (!canEditMeds) return;
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
  }), [canEditMeds, state.meds, logAudit, toast, toastErr, guardOnce]);

  // Persists to meta/settings (see the onSnapshot listener above) — a merge write so this
  // can be called with just the one field that changed without clobbering the other two.
  const updateGlobalSettings = useCallback(async (patchFields: Partial<{ expiryWarnDays: number; parFloorCoverDays: number; parSubCoverDays: number }>) => {
    if (!canEditMeds) return;
    // Bug fix (data integrity): parFloorCoverDays/parSubCoverDays feed suggestPar()'s
    // `roundStep(daily * coverDays * volatility)` for the WHOLE shared formulary (this is
    // meta/settings — one doc for the entire hospital, not per-device) — SettingsScreen's own
    // input only strips non-digit characters (digitsOnly), so "0" saves through untouched.
    // roundStep(0) always returns 1 regardless of a drug's real usage rate, so a 0 here
    // (an easy fat-finger while clearing the field to retype) would make "ใช้ค่าแนะนำทั้งหมด"
    // silently overwrite every substock-backed med's suggested par ceiling to 1 unit, with no
    // confirmation gating that specific save. expiryWarnDays has no equivalent failure mode —
    // 0 there just narrows "near expiry" to lots already expired, so it's left unclamped.
    if (patchFields.parFloorCoverDays !== undefined) patchFields = { ...patchFields, parFloorCoverDays: Math.max(1, patchFields.parFloorCoverDays) };
    if (patchFields.parSubCoverDays !== undefined) patchFields = { ...patchFields, parSubCoverDays: Math.max(1, patchFields.parSubCoverDays) };
    try {
      await withTimeout(setDoc(doc(db, 'meta', 'settings'), patchFields, { merge: true }));
      logAudit({ type: 'par_updated', note: 'แก้ไขการตั้งค่า: ' + Object.entries(patchFields).map(([k, v]) => k + '=' + v).join(', ') });
      toast('บันทึกการตั้งค่าแล้ว');
    } catch (e) { toastErr(e, 'บันทึกการตั้งค่าไม่สำเร็จ'); }
  }, [canEditMeds, logAudit, toast, toastErr]);

  // ---------- meds (formulary) management ----------
  const addMed = useCallback(guardOnce('addMed', async (input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; fridge?: boolean; bin: string; binSub?: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility?: number; shared?: boolean; binIpd?: string; category?: string; packSize?: number; route?: 'oral' | 'injection' | 'other' }): Promise<boolean> => {
    if (!canEditMeds) return false;
    const name = input.name.trim();
    if (!name) { toast('กรอกชื่อยาก่อน'); return false; }
    // Bug fix (data integrity risk): addMed never checked for an existing active med with the
    // same name — a pharmacist re-adding "Paracetamol 500mg" by mistake (fat-finger, forgot it
    // was already in the formulary) got no warning at all, silently creating a second,
    // disconnected stock record for the same real drug. Deliberately NOT a hard block: adding
    // the SAME name under a DIFFERENT ward on purpose (to later mergeWardMeds them into one
    // pooled record — see that function's own doc comment) is the app's own intended,
    // legitimate two-step workflow, so this only warns on the combinations mergeWardMeds could
    // never resolve anyway (same ward, or either side already shared/covering both wards) —
    // exactly the "genuinely accidental, no legitimate merge target" case.
    const nameConflict = state.meds.find((x) => x.active && x.name === name
      && (input.shared || isSharedMed(x) || wardOf(x) === input.ward));
    if (nameConflict && !(await confirmAsync(
      'มียา "' + name + '" ที่เปิดใช้งานอยู่แล้วในฝั่ง' + wardLabel(wardOf(nameConflict))
      + ' (' + nameConflict.code + ') — เพิ่มรายการใหม่จะเป็นคนละ record แยกจากของเดิม (รวมกันไม่ได้ทีหลัง '
      + 'เพราะไม่ใช่คู่ OPD/IPD คนละฝั่ง) ยืนยันว่าต้องการเพิ่มยาตัวใหม่จริงหรือไม่?'
    ))) return false;
    // Bug fix (patient-safety-adjacent data integrity): nothing ever checked whether a bin/
    // binIpd code being saved already belongs to a DIFFERENT active med — a shelf bin should
    // map to exactly one drug, but a fat-fingered/misread handwritten shelf list could give two
    // unrelated meds the same code with zero warning. A staffer picking "bin A12" during a
    // count/transfer, or the auto-generated pick list, would have no way to tell them apart. A
    // soft confirm (not a hard block) since a genuine intentional reuse — e.g. retiring one
    // drug's bin for a replacement on the same shelf slot before deactivating the old record —
    // is rare but not impossible.
    const normBinVal = normBin(input.bin);
    const binConflict = normBinVal && state.meds.find((x) => x.active && normBin(x.bin) === normBinVal);
    if (binConflict && !(await confirmAsync(
      'รหัสชั้นวาง "' + normBinVal + '" ถูกใช้กับยา "' + binConflict.name + '" (' + binConflict.code + ') อยู่แล้ว — '
      + 'ใช้ซ้ำเสี่ยงหยิบยาผิดตัวตอนนับ/เบิก ยืนยันว่าต้องการใช้รหัสนี้ซ้ำจริงหรือไม่?'
    ))) return false;
    const normBinIpdVal = input.binIpd ? normBin(input.binIpd) : '';
    const binIpdConflict = normBinIpdVal && state.meds.find((x) => x.active && normBin(x.binIpd || '') === normBinIpdVal);
    if (binIpdConflict && !(await confirmAsync(
      'รหัสชั้นวาง IPD "' + normBinIpdVal + '" ถูกใช้กับยา "' + binIpdConflict.name + '" (' + binIpdConflict.code + ') อยู่แล้ว — '
      + 'ใช้ซ้ำเสี่ยงหยิบยาผิดตัวตอนนับ/เบิก ยืนยันว่าต้องการใช้รหัสนี้ซ้ำจริงหรือไม่?'
    ))) return false;
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
        const binSub = input.binSub ? normBin(input.binSub) : '';
        const medRef = doc(collection(db, 'meds'));
        trx.set(medRef, {
          code: c, name, unit: input.unit.trim() || 'หน่วย', dosageForm: input.dosageForm.trim(),
          // Bug fix (data integrity): every other numeric field on this same write (parSub,
          // parFloor, floorMin) is clamped with Math.max(0, ...) — price wasn't, so a typo like
          // "-50" (parseFloat('-50') is truthy, so `|| 0` never catches it) saved a negative
          // price with zero warning, silently corrupting every price-dependent number downstream
          // (มูลค่า figures, printed labels, riskValue/cost totals, AdjustScreen's scrap value).
          price: Math.max(0, input.price || 0), had: input.had, active: true,
          ...(input.fridge ? { fridge: true } : {}),
          parSub: Math.max(0, input.parSub || 0), parFloor: Math.max(0, input.parFloor || 0), floor: 0,
          floorMin: Math.max(0, input.floorMin || 0),
          bin: normBin(input.bin),
          used30: 0, usedPrev30: 0, volatility: clampVolatility(input.volatility ?? 1.1), lastCountTs: Date.now(),
          ward: input.ward, noSubstock: input.noSubstock,
          ...(input.shared ? { shared: true } : {}),
          ...(binIpd ? { binIpd } : {}),
          ...(binSub ? { binSub } : {}),
          ...(input.category ? { category: input.category } : {}),
          ...(input.packSize && input.packSize > 1 ? { packSize: Math.round(input.packSize) } : {}),
          ...(input.route ? { route: input.route } : {}),
        });
        return { code: c, id: medRef.id };
      });
      logAudit({ type: 'med_added', note: 'เพิ่มยาใหม่ ' + name + ' (' + code.code + ')' });
      toast('เพิ่ม ' + name + ' แล้ว');
      // Bug fix (flow friction): a new med is essentially never useful on the shelf without
      // its label printed — the previous behavior left the person to separately navigate to
      // "ฉลาก QR", retype the same name they just typed here, and re-select it: 3 extra taps +
      // a full retype for something the app already has in hand. Pre-selecting it here means
      // whenever they do open the Labels screen next (the near-universal next step after adding
      // a med), it's already picked and ready to print — without forcing a navigation change
      // for anyone adding several meds in a row from this same screen.
      patch({ labelType: 'med', labelSelected: { [code.id]: true } });
      return true;
    } catch (e) { toastErr(e, 'เพิ่มยาไม่สำเร็จ'); return false; }
  }), [canEditMeds, state.meds, logAudit, toast, toastErr, guardOnce, patch, confirmAsync]);

  // One consolidated save for everything about a med someone would want to fix in one place
  // — name/strength (kept together in `name`, same as everywhere else), dosage form, unit,
  // price, high-alert flag, shelf/bin, and both par levels — instead of hunting across
  // separate screens. `code` (the QR/label identifier) is deliberately never touched here —
  // labels already printed with it must keep resolving to this med.
  // Thai labels for updateMedFull's own lost-update warning below — module-scope since it's a
  // pure constant, same convention EVENT_TYPE_LABEL already uses.
  const MED_FIELD_LABEL: Record<string, string> = {
    name: 'ชื่อยา', unit: 'หน่วย', dosageForm: 'รูปแบบยา', price: 'ราคา', had: 'HAD', fridge: 'เก็บตู้เย็น',
    bin: 'ชั้นวาง', binSub: 'ชั้นวาง substock', parSub: 'par substock', parFloor: 'par หน้างาน',
    floorMin: 'Min หน้างาน', ward: 'ward', noSubstock: 'ไม่มี substock', volatility: 'volatility',
    shared: 'ใช้ยอดร่วมกัน', binIpd: 'ชั้นวาง IPD', category: 'หมวดยา', packSize: 'ขนาดแพ็ค',
    route: 'ประเภทการให้ยา',
  };
  const updateMedFull = useCallback(guardOnce('updateMedFull', async (medId: string, input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; fridge?: boolean; bin: string; binSub?: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility: number; shared?: boolean; binIpd?: string; category?: string; packSize?: number; route?: 'oral' | 'injection' | 'other' }, baseline: Med | null): Promise<boolean> => {
    if (!canEditMeds) return false;
    const name = input.name.trim();
    if (!name) { toast('กรอกชื่อยาก่อน'); return false; }
    // Bug fix (lost-update race, audit finding): updateMedFull always wrote the form's FULL
    // snapshot — every master-data field, not a diff — straight over whatever the live doc
    // currently held, with no check at all for whether it had changed since this admin's form
    // was opened. Two admins editing the SAME med around the same time, each changing a
    // DIFFERENT field (one fixes a bin typo, another updates a quarterly price), meant whoever
    // saved second silently reverted the other's change back to its own form's stale snapshot —
    // a true lost update, with no warning and nothing in the audit log showing a value got
    // clobbered. `baseline` (frozen by the caller at form-open time — see MedsScreen.tsx's
    // editBaselineRef) is compared against a fresh live read right before writing: any
    // difference means someone else's change would otherwise be silently overwritten, so this
    // asks first, naming exactly what changed, same "warn, don't silently act" convention
    // guardOnce's own timeout-retry confirm and processHosxp's paste-mistake safety net already
    // use elsewhere in this file.
    if (baseline) {
      const liveSnap = await withTimeout(getDoc(doc(db, 'meds', medId)));
      if (!liveSnap.exists()) { toast('ยานี้ถูกลบออกจากระบบไปแล้ว — บันทึกไม่ได้'); return false; }
      const live = liveSnap.data() as Record<string, unknown>;
      const baselineRec = baseline as unknown as Record<string, unknown>;
      const changedFields = Object.keys(MED_FIELD_LABEL).filter((k) => (live[k] ?? null) !== (baselineRec[k] ?? null));
      if (changedFields.length && !(await confirmAsync(
        'มีคนอื่นแก้ไข ' + changedFields.map((k) => MED_FIELD_LABEL[k]).join(', ') + ' ของ "' + (typeof live.name === 'string' ? live.name : name)
        + '" ไปแล้วตั้งแต่เปิดฟอร์มนี้ — บันทึกต่อจะเขียนทับค่าที่คนอื่นแก้ไว้ด้วยค่าที่กรอกในฟอร์มนี้ทั้งหมด\n\n'
        + 'ยืนยันว่าต้องการบันทึกทับหรือไม่? (แนะนำ: ยกเลิก แล้วเปิดฟอร์มนี้ใหม่เพื่อดูค่าล่าสุดก่อน)'
      ))) return false;
    }
    const binIpd = input.binIpd ? normBin(input.binIpd) : '';
    const binSub = input.binSub ? normBin(input.binSub) : '';
    // Bug fix (patient-safety-adjacent data integrity): same gap as addMed's own fix — check
    // the new bin/binIpd against every OTHER active med before saving, so editing a med's
    // shelf code can't silently collide with a different, unrelated drug's bin. Excludes this
    // med's own current record (medId) since re-saving its own unchanged bin isn't a conflict.
    const normBinVal = normBin(input.bin);
    const binConflict = normBinVal && state.meds.find((x) => x.id !== medId && x.active && normBin(x.bin) === normBinVal);
    if (binConflict && !(await confirmAsync(
      'รหัสชั้นวาง "' + normBinVal + '" ถูกใช้กับยา "' + binConflict.name + '" (' + binConflict.code + ') อยู่แล้ว — '
      + 'ใช้ซ้ำเสี่ยงหยิบยาผิดตัวตอนนับ/เบิก ยืนยันว่าต้องการใช้รหัสนี้ซ้ำจริงหรือไม่?'
    ))) return false;
    const binIpdConflict = binIpd && state.meds.find((x) => x.id !== medId && x.active && normBin(x.binIpd || '') === binIpd);
    if (binIpdConflict && !(await confirmAsync(
      'รหัสชั้นวาง IPD "' + binIpd + '" ถูกใช้กับยา "' + binIpdConflict.name + '" (' + binIpdConflict.code + ') อยู่แล้ว — '
      + 'ใช้ซ้ำเสี่ยงหยิบยาผิดตัวตอนนับ/เบิก ยืนยันว่าต้องการใช้รหัสนี้ซ้ำจริงหรือไม่?'
    ))) return false;
    const patch = {
      name, unit: input.unit.trim() || 'หน่วย', dosageForm: input.dosageForm.trim(),
      // Bug fix (data integrity): same clamp gap as addMed — see its own comment above.
      price: Math.max(0, input.price || 0), had: input.had,
      fridge: input.fridge ? true : deleteField(),
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
      binSub: binSub ? binSub : deleteField(),
      category: input.category ? input.category : deleteField(),
      packSize: input.packSize && input.packSize > 1 ? Math.round(input.packSize) : deleteField(),
      route: input.route ? input.route : deleteField(),
    };
    try {
      await withTimeout(updateDoc(doc(db, 'meds', medId), patch));
      logAudit({ type: 'med_edited', note: 'แก้ไขข้อมูลยา ' + name });
      toast('บันทึกข้อมูล ' + name + ' แล้ว');
      return true;
    } catch (e) { toastErr(e, 'บันทึกไม่สำเร็จ'); return false; }
  }), [canEditMeds, state.meds, logAudit, toast, toastErr, guardOnce, confirmAsync]);

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
    if (!canEditMeds) return;
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
      // Bug fix (lost-update race): floor here used to come straight from state.meds (the
      // client's cached snapshot) and get written via a plain writeBatch — anything landing on
      // either side's floor between whenever that snapshot last synced and this commit (a
      // transfer/count/adjust from another device, easily minutes on a walk to confirm the
      // merge dialog) got silently overwritten/lost, not just "stale, go recount" as the old
      // comment framed it. Re-reading both med docs live inside a transaction, right before
      // writing, makes the merge use whatever floor actually exists at commit time.
      //
      // Bug fix (orphaned lot): the lots query used to run once, OUTSIDE and before this
      // transaction — a lot created for ipdMed in the gap between that query and commit (e.g. a
      // receive landing mid-merge) was missing from the result and never got reassigned to
      // opdMed.id, then became permanently invisible once ipdMed.active was set false. Moved
      // inside the transaction callback, same pattern commitTransfer/commitSubCount already use
      // for their own live lot lookups: the Firestore client SDK can't query inside a
      // transaction directly, but running the query fresh on every retry (and reading each
      // found lot doc via trx.get(), which Firestore's transaction retries on if it changes
      // before commit) closes the window down to just the final attempt instead of the whole
      // confirm-dialog-to-commit gap.
      const mergedFloor = await runTx(async (trx) => {
        const lotSnap = await getDocs(query(collection(db, 'lots'), where('medId', '==', ipdMed.id)));
        // Bug fix (flow latency): these reads don't depend on each other — firing them
        // concurrently instead of one lot at a time saves real time when a med has several open
        // lots, with no correctness change (each is still read via trx.get(), so Firestore still
        // retries this transaction if any of them changes before commit).
        await Promise.all(lotSnap.docs.map((d) => trx.get(d.ref)));
        const opdSnap = await trx.get(doc(db, 'meds', opdMed.id));
        const ipdSnap = await trx.get(doc(db, 'meds', ipdMed.id));
        const freshOpdFloor = (opdSnap.data() as { floor?: number } | undefined)?.floor ?? opdMed.floor;
        const freshIpdFloor = (ipdSnap.data() as { floor?: number } | undefined)?.floor ?? ipdMed.floor;
        const merged = freshOpdFloor + freshIpdFloor;
        lotSnap.docs.forEach((d) => trx.update(d.ref, { medId: opdMed.id }));
        trx.update(doc(db, 'meds', opdMed.id), {
          shared: true,
          binIpd: ipdMed.bin,
          floor: merged,
          used30: opdMed.used30 + ipdMed.used30,
          usedPrev30: opdMed.usedPrev30 + ipdMed.usedPrev30,
          ward: 'opd',
        });
        // Bug fix (ledger disambiguation — audit finding): records WHICH surviving med this
        // merge folded into — see Med.mergedInto's own doc comment in types.ts for why
        // fetchFloorLedger/fetchSubstockLedger/SubstockCardScreen's hasNameTwin need this to
        // tell a real ward-merge apart from an unrelated same-name med deactivated for any
        // other reason.
        trx.update(doc(db, 'meds', ipdMed.id), { active: false, floor: 0, mergedInto: opdMed.id });
        return merged;
      });
      logAudit({
        type: 'med_edited',
        note: 'รวมสต็อก OPD/IPD ของ ' + opdMed.name + ' เป็นยอดเดียวกัน (' + nf(mergedFloor) + ' ' + opdMed.unit + ') ชั้นวาง OPD ' + (opdMed.bin || '—') + ' / IPD ' + (ipdMed.bin || '—'),
      });
      toast('รวมสต็อก ' + opdMed.name + ' แล้ว — แนะนำให้นับสต็อกจริงเพื่อยืนยันยอด');
    } catch (e) { toastErr(e, 'รวมสต็อกไม่สำเร็จ'); }
  }), [canEditMeds, state.meds, logAudit, toast, toastErr, confirmAsync, guardOnce, runTx]);

  // "รวมกันเลย" — do mergeWardMeds() for every still-separate OPD/IPD pair across the whole
  // formulary in one go, instead of clicking through each pair one at a time in MedsScreen.
  // Same rule mergeWardMeds already enforces per-pair, applied to the whole list: only a name
  // with EXACTLY one 'opd' and one 'ipd' active record qualifies — a name with, say, two 'opd'
  // records (a real data-entry duplicate) is left alone rather than guessing which one to
  // pair, same caution matchHosxpMed() already takes with an ambiguous name.
  const mergeAllWardPairs = useCallback(guardOnce('mergeAllWardPairs', async () => {
    if (!canEditMeds) return;
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
    // Bug fix (lost-update race): this used to compute each pair's merged floor from
    // state.meds (the client's cached snapshot) once up front, then write everything via
    // plain chunked writeBatch calls — same class of bug as mergeWardMeds's single-pair
    // version (see its own fix note): anything landing on either side's floor between whenever
    // that snapshot last synced and this commit got silently overwritten/lost. Same fix here,
    // per pair: a small transaction that re-reads both med docs live right before writing.
    // Sequential (not parallel) same reasoning as commitAllCounts/commitAllSubCounts — a slow
    // connection degrades into "slower", not a burst of concurrent transactions contending on
    // the same docs, and one pair's failure doesn't need to abort every other pair's merge.
    const names: string[] = [];
    let ok = 0;
    let failed = 0;
    for (const p of pairs) {
      try {
        // Bug fix (orphaned lot) — same fix as mergeWardMeds's own note: the lots query moved
        // inside the transaction callback so it re-runs fresh on every retry, and each found lot
        // doc is read via trx.get() so Firestore's transaction retries if one changes before
        // commit, instead of running once outside the transaction and missing a lot created in
        // the gap before commit.
        await runTx(async (trx) => {
          const lotSnap = await getDocs(query(collection(db, 'lots'), where('medId', '==', p.ipdMed.id)));
          // Bug fix (flow latency) — same fix as mergeWardMeds's own note: these reads don't
          // depend on each other, so run them concurrently instead of one lot at a time.
          await Promise.all(lotSnap.docs.map((d) => trx.get(d.ref)));
          const opdSnap = await trx.get(doc(db, 'meds', p.opdMed.id));
          const ipdSnap = await trx.get(doc(db, 'meds', p.ipdMed.id));
          const freshOpdFloor = (opdSnap.data() as { floor?: number } | undefined)?.floor ?? p.opdMed.floor;
          const freshIpdFloor = (ipdSnap.data() as { floor?: number } | undefined)?.floor ?? p.ipdMed.floor;
          lotSnap.docs.forEach((d) => trx.update(d.ref, { medId: p.opdMed.id }));
          trx.update(doc(db, 'meds', p.opdMed.id), {
            shared: true,
            binIpd: p.ipdMed.bin,
            floor: freshOpdFloor + freshIpdFloor,
            used30: p.opdMed.used30 + p.ipdMed.used30,
            usedPrev30: p.opdMed.usedPrev30 + p.ipdMed.usedPrev30,
            ward: 'opd',
          });
          // Bug fix (ledger disambiguation) — same fix as mergeWardMeds's own note.
          trx.update(doc(db, 'meds', p.ipdMed.id), { active: false, floor: 0, mergedInto: p.opdMed.id });
        });
        names.push(p.opdMed.name);
        ok++;
      } catch (e) { console.error(e); failed++; }
    }
    if (ok > 0) {
      logAudit({
        type: 'med_edited',
        note: 'รวมสต็อก OPD/IPD ทั้งหมด ' + ok + ' คู่ เป็นยอดเดียวกัน: '
          + names.slice(0, 20).join(', ') + (names.length > 20 ? ' และอีก ' + (names.length - 20) + ' รายการ' : ''),
      });
    }
    toast(failed > 0
      ? 'รวมสต็อกแล้ว ' + ok + ' คู่ · ไม่สำเร็จ ' + failed + ' คู่ (ลองกดปุ่มนี้อีกครั้งสำหรับคู่ที่เหลือ)'
      : 'รวมสต็อกแล้ว ' + ok + ' คู่ — แนะนำให้นับสต็อกจริงทุกตัวเพื่อยืนยันยอด');
  }), [canEditMeds, state.meds, logAudit, toast, guardOnce, runTx, confirmAsync]);

  // The common real starting point: a formulary that has NO separate IPD records at all yet
  // (every med is a plain single 'opd'-ward record) — mergeAllWardPairs() finds nothing to
  // fold together there, because there's no second record's stock to combine. This is the
  // actual fix for that case: just flip every active, not-yet-shared med to `shared: true` in
  // one go, so it shows up under the IPD tab too and both wards draw on the one stock that
  // already exists — no lots to reassign, nothing to sum, because there was never a second
  // pile of stock to begin with. `binIpd` is left unset, so binFor() shows the same one `bin`
  // for both wards until/unless someone gives a drug a distinct IPD shelf code later.
  const shareAllMeds = useCallback(guardOnce('shareAllMeds', async () => {
    if (!canEditMeds) return;
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
  }), [canEditMeds, state.meds, logAudit, toast, toastErr, guardOnce]);

  // One-tap bulk fill for Med.category — see data/categorySuggest.ts for the keyword engine
  // behind it. Deliberately narrow in what it's allowed to touch: only meds with NO category
  // set yet (never overwrites a category a human already chose, including one this same
  // action set on a previous run), and only ones the keyword list actually recognizes (a med
  // it can't match keeps falling back to "ยังไม่ระบุหมวด" via categoryOf() same as before —
  // never forced into a guessed bucket just to make the uncategorized count hit zero).
  const autoCategorizeAll = useCallback(guardOnce('autoCategorizeAll', async () => {
    if (!canEditMeds) return;
    const candidates = state.meds
      .map((m) => ({ m, cat: m.category ? null : suggestCategoryId(m.name) }))
      .filter((x): x is { m: Med; cat: string } => !!x.cat);
    if (!candidates.length) { toast('ไม่มียาที่ระบบแนะนำหมวดให้ได้เพิ่มแล้ว — ที่เหลือต้องเลือกหมวดเอง'); return; }
    const uncategorizedTotal = state.meds.filter((m) => !m.category).length;
    if (!(await confirmAsync(
      'ให้ระบบจัดหมวดยาอัตโนมัติจากชื่อยา ' + candidates.length + ' รายการ (จากทั้งหมด ' + uncategorizedTotal + ' รายการที่ยังไม่มีหมวด)?\n\n'
      + 'จับคู่จากชื่อสามัญที่รู้จัก (เช่น Paracetamol → ยาแก้ปวด, Amoxicillin → ยาต้านจุลชีพ) — '
      + 'ยาที่ตั้งหมวดไว้แล้วจะไม่ถูกแก้ไข ส่วนยาที่ระบบไม่รู้จักชื่อจะยังคงเป็น "ยังไม่ระบุหมวด" ให้เลือกเองภายหลัง'
    ))) return;
    try {
      for (let i = 0; i < candidates.length; i += 400) {
        const batch = writeBatch(db);
        candidates.slice(i, i + 400).forEach(({ m, cat }) => batch.update(doc(db, 'meds', m.id), { category: cat }));
        await withTimeout(batch.commit());
      }
      const leftover = uncategorizedTotal - candidates.length;
      logAudit({ type: 'med_edited', note: 'จัดหมวดยาอัตโนมัติจากชื่อยา ' + candidates.length + ' รายการ' });
      toast('จัดหมวดให้แล้ว ' + candidates.length + ' รายการ' + (leftover > 0 ? ' — เหลืออีก ' + leftover + ' รายการที่ระบบไม่รู้จักชื่อ ต้องเลือกหมวดเอง' : ''));
    } catch (e) { toastErr(e, 'จัดหมวดอัตโนมัติไม่สำเร็จ'); }
  }), [canEditMeds, state.meds, logAudit, toast, toastErr, guardOnce]);

  // Bulk counterpart to the one-tap "แนะนำประเภทการให้ยา" chip in MedForm — mirrors
  // autoCategorizeAll() right above exactly: only ever suggests for a med with no `route` set
  // yet, never overwrites a human's existing choice, and anything suggestRoute() isn't
  // confident enough to guess stays unclassified (routeOf() in selectors.ts already treats
  // that the same as 'other' everywhere this is grouped/filtered, so nothing goes invisible).
  const autoRouteAll = useCallback(guardOnce('autoRouteAll', async () => {
    if (!canEditMeds) return;
    const candidates = state.meds
      .map((m) => ({ m, route: m.route ? null : suggestRoute(m) }))
      .filter((x): x is { m: Med; route: 'oral' | 'injection' } => !!x.route);
    if (!candidates.length) { toast('ไม่มียาที่ระบบแนะนำประเภทการให้ยาให้ได้เพิ่มแล้ว — ที่เหลือต้องเลือกเอง'); return; }
    const unclassifiedTotal = state.meds.filter((m) => !m.route).length;
    if (!(await confirmAsync(
      'ให้ระบบแยกยากิน/ยาฉีดอัตโนมัติจากหน่วย/รูปแบบยา ' + candidates.length + ' รายการ (จากทั้งหมด ' + unclassifiedTotal + ' รายการที่ยังไม่ระบุ)?\n\n'
      + 'จับคู่จากหน่วย (Vial/Amp → ยาฉีด, เม็ด/แคปซูล → ยากิน) และรูปแบบยา — '
      + 'ยาที่ระบุไว้แล้วจะไม่ถูกแก้ไข ส่วนยาที่ระบบไม่มั่นใจ (ครีม/ยาหยอดตา/สารน้ำ ฯลฯ) จะยังคงเป็น "อื่นๆ" ให้เลือกเองภายหลัง'
    ))) return;
    try {
      for (let i = 0; i < candidates.length; i += 400) {
        const batch = writeBatch(db);
        candidates.slice(i, i + 400).forEach(({ m, route }) => batch.update(doc(db, 'meds', m.id), { route }));
        await withTimeout(batch.commit());
      }
      const leftover = unclassifiedTotal - candidates.length;
      logAudit({ type: 'med_edited', note: 'แยกยากิน/ยาฉีดอัตโนมัติ ' + candidates.length + ' รายการ' });
      toast('แยกประเภทให้แล้ว ' + candidates.length + ' รายการ' + (leftover > 0 ? ' — เหลืออีก ' + leftover + ' รายการที่ระบบไม่มั่นใจ ต้องเลือกเอง' : ''));
    } catch (e) { toastErr(e, 'แยกประเภทอัตโนมัติไม่สำเร็จ'); }
  }), [canEditMeds, state.meds, logAudit, toast, toastErr, guardOnce, confirmAsync]);

  const toggleMedActive = useCallback(async (medId: string) => {
    if (!canEditMeds) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    const next = !m.active;
    try {
      await withTimeout(updateDoc(doc(db, 'meds', medId), { active: next }));
      logAudit({ type: 'med_status_changed', note: (next ? 'เปิดใช้งานยา ' : 'ปิดใช้งานยา (ตัดออกจากบัญชี) ') + m.name });
      toast((next ? 'เปิดใช้งาน ' : 'ปิดใช้งาน ') + m.name + ' แล้ว');
    } catch (e) { toastErr(e, 'เปลี่ยนสถานะไม่สำเร็จ'); }
  }, [canEditMeds, state.meds, logAudit, toast, toastErr]);

  // Real-world request: "บริษัทยาไม่มาส่งยา ล่าช้า หรือเลิกผลิต อยู่ระหว่างสั่งยาบริษัทอื่น คลังปิด
  // ช่วงปลาย/ต้นปีงบประมาณ" — flags a med's supply chain as temporarily broken (see
  // Med.outOfStockSince's own doc comment). Suppresses it from "ควรเบิกจากคลังใหญ่"
  // (needsWarehouseRequest) everywhere that's computed, since nothing a requisition does can
  // fix a supply problem — repeating the same unfulfillable ask every print run is noise, not
  // help. Reason is required (not just a bare toggle) since the whole point is staff elsewhere
  // being able to see WHY at a glance — see StockHoldBanner.tsx.
  const startStockHold = useCallback(async (medId: string, reason: string, expectedReturnAt?: number) => {
    if (!canEditMeds) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    const trimmed = reason.trim();
    if (!trimmed) { toast('กรุณาระบุเหตุผลที่ยาขาดชั่วคราว'); return; }
    try {
      await withTimeout(updateDoc(doc(db, 'meds', medId), {
        outOfStockSince: Date.now(),
        outOfStockReason: trimmed,
        ...(expectedReturnAt ? { outOfStockExpectedReturn: expectedReturnAt } : { outOfStockExpectedReturn: deleteField() }),
      }));
      logAudit({
        type: 'stock_hold_started',
        note: 'ทำเครื่องหมายยาขาดชั่วคราว: ' + m.name + ' — เหตุผล: ' + trimmed
          + (expectedReturnAt ? ' (คาดว่าจะมีของอีกครั้งวันที่ ' + isoDate(expectedReturnAt) + ')' : ''),
      });
      toast('ทำเครื่องหมาย ' + m.name + ' เป็นยาขาดชั่วคราวแล้ว');
    } catch (e) { toastErr(e, 'บันทึกไม่สำเร็จ'); }
  }, [canEditMeds, state.meds, logAudit, toast, toastErr]);

  // Ends an active hold started by startStockHold() above — logs how long it actually lasted
  // (not just that it ended) since "how long did we go without this drug" is exactly the kind
  // of question this whole feature exists to make answerable later via the audit log.
  const endStockHold = useCallback(async (medId: string, note?: string) => {
    if (!canEditMeds) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m || typeof m.outOfStockSince !== 'number') return;
    const days = Math.max(0, Math.round((Date.now() - m.outOfStockSince) / DAY));
    try {
      await withTimeout(updateDoc(doc(db, 'meds', medId), {
        outOfStockSince: deleteField(), outOfStockReason: deleteField(), outOfStockExpectedReturn: deleteField(),
      }));
      logAudit({
        type: 'stock_hold_ended',
        note: 'ยกเลิกสถานะยาขาดชั่วคราว: ' + m.name + ' (ขาดมา ' + nf(days) + ' วัน)' + (note?.trim() ? ' — ' + note.trim() : ''),
      });
      toast('ยกเลิกสถานะขาดชั่วคราวของ ' + m.name + ' แล้ว');
    } catch (e) { toastErr(e, 'บันทึกไม่สำเร็จ'); }
  }, [canEditMeds, state.meds, logAudit, toast, toastErr]);

  const deleteMed = useCallback(async (medId: string) => {
    if (!canEditMeds) return;
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return;
    if (m.floor > 0 || subQty(state, medId) > 0) { toast('ลบไม่ได้ — ยังมียอดคงเหลือที่หน้างานหรือ substock ต้องปรับยอด/ตัดออกให้เป็น 0 ก่อน'); return; }
    if (!(await confirmAsync('ลบ "' + m.name + '" ออกจากระบบถาวร? ย้อนกลับไม่ได้ — ถ้าแค่เลิกใช้ชั่วคราวแนะนำให้ "ปิดใช้งาน" แทน'))) return;
    try {
      // Bug fix (real stock deletion risk): the floor/subQty check above ran on the CACHED
      // state, before the confirm dialog — nothing stopped a receive from landing on this med
      // while the dialog sat open (or just in the round trip after "ยืนยัน"), which would mean
      // deleting real, just-arrived stock lots along with the med doc. Re-check live floor +
      // live lot quantities right before actually deleting, using the same lot docs about to
      // be deleted, so this can't silently discard stock that arrived after the check above.
      const [medSnap, lotSnap] = await withTimeout(Promise.all([
        getDoc(doc(db, 'meds', medId)),
        getDocs(query(collection(db, 'lots'), where('medId', '==', medId))),
      ]));
      const liveFloor = (medSnap.data() as { floor?: number } | undefined)?.floor ?? 0;
      const liveLotQty = lotSnap.docs.reduce((s, d) => s + ((d.data() as { qty?: number }).qty ?? 0), 0);
      if (liveFloor > 0 || liveLotQty > 0) { toast('ลบไม่ได้ — มียอดคงเหลือเข้ามาระหว่างนี้ (หน้างานหรือ substock) ต้องปรับยอด/ตัดออกให้เป็น 0 ก่อน'); return; }
      const batch = writeBatch(db);
      lotSnap.docs.forEach((d) => batch.delete(d.ref));
      batch.delete(doc(db, 'meds', medId));
      await withTimeout(batch.commit());
      logAudit({ type: 'med_deleted', note: 'ลบยา ' + m.name + ' (' + m.code + ') ออกจากระบบถาวร' });
      toast('ลบ ' + m.name + ' แล้ว');
    } catch (e) { toastErr(e, 'ลบไม่สำเร็จ'); }
  }, [canEditMeds, state, logAudit, toast, toastErr, confirmAsync]);

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
    if (!canEditMeds) return;
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
      const idChunks: string[][] = [];
      for (let i = 0; i < removable.length; i += 30) idChunks.push(removable.slice(i, i + 30).map((m) => m.id));
      const lotDocs: { ref: ReturnType<typeof doc>; medId: string; qty: number }[] = [];
      // Bug fix (real stock deletion risk): lots were fetched live (good — catches a lot that
      // arrived after `removable` was computed from cached state), but their quantities were
      // never actually checked before deleting them — any lot doc found for a removable med
      // got deleted unconditionally, live qty or not. Also nothing re-checked each med's live
      // FLOOR at all; the confirm dialog can sit open for a while, and a receive/adjustment
      // landing in that window on a med judged "empty" from stale state would have its real
      // stock silently deleted along with the med doc. Re-fetch both live right before
      // deciding what's actually safe to delete.
      const liveFloorById = new Map<string, number>();
      for (const chunkIds of idChunks) {
        const [lotSnap, medSnaps] = await withTimeout(Promise.all([
          getDocs(query(collection(db, 'lots'), where('medId', 'in', chunkIds))),
          Promise.all(chunkIds.map((id) => getDoc(doc(db, 'meds', id)))),
        ]));
        lotSnap.docs.forEach((d) => lotDocs.push({ ref: d.ref, medId: (d.data() as { medId?: string }).medId ?? '', qty: (d.data() as { qty?: number }).qty ?? 0 }));
        medSnaps.forEach((s) => liveFloorById.set(s.id, (s.data() as { floor?: number } | undefined)?.floor ?? 0));
      }
      const liveLotQtyByMed = new Map<string, number>();
      for (const l of lotDocs) liveLotQtyByMed.set(l.medId, (liveLotQtyByMed.get(l.medId) ?? 0) + l.qty);
      const stillEmpty = removable.filter((m) => (liveFloorById.get(m.id) ?? 0) === 0 && (liveLotQtyByMed.get(m.id) ?? 0) === 0);
      const gainedStock = removable.filter((m) => (liveFloorById.get(m.id) ?? 0) > 0 || (liveLotQtyByMed.get(m.id) ?? 0) > 0);
      if (!stillEmpty.length) { toast('ลบไม่ได้ — มียอดคงเหลือเข้ามาระหว่างนี้ในทุกรายการที่เลือก'); return; }
      const stillEmptyIds = new Set(stillEmpty.map((m) => m.id));
      // Combine into one flat list of refs before chunking — chunking meds and lots
      // separately at 400 each could put up to 800 deletes in one batch, over Firestore's
      // hard 500-per-commit limit.
      const allRefs = [...stillEmpty.map((m) => doc(db, 'meds', m.id)), ...lotDocs.filter((l) => stillEmptyIds.has(l.medId)).map((l) => l.ref)];
      for (let i = 0; i < allRefs.length; i += 450) {
        const batch = writeBatch(db);
        allRefs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
        await withTimeout(batch.commit());
      }
      logAudit({ type: 'med_deleted', note: 'ลบยาที่ปิดใช้งานทั้งหมด ' + stillEmpty.length + ' รายการ (ยอดเป็น 0) ออกจากระบบถาวร: ' + stillEmpty.map((m) => m.name).join(', ') });
      toast('ลบยาที่ปิดใช้งานแล้ว ' + stillEmpty.length + ' รายการ'
        + (blocked.length ? ' · ข้าม ' + blocked.length + ' รายการที่ยังมียอดคงเหลือ' : '')
        + (gainedStock.length ? ' · ข้ามอีก ' + gainedStock.length + ' รายการที่มียอดเข้ามาระหว่างนี้' : ''));
    } catch (e) { toastErr(e, 'ลบไม่สำเร็จ'); }
  }), [canEditMeds, state, logAudit, toast, toastErr, confirmAsync, guardOnce]);

  const setMedsFocusId = useCallback((id: string | null) => patch({ medsFocusId: id }), [patch]);

  // ---------- pre-delete safety snapshot ----------
  // Extra recovery layer specifically for the two go-live reset buttons below, on top of (not
  // instead of) the daily external GitHub Actions backup (scripts/backup-firestore.mjs) — that
  // backup can be up to ~24h stale, so an admin who reaches for one of these buttons an hour
  // before the next scheduled run would otherwise lose that hour's data even though everything
  // "worked as designed". This writes the exact documents about to be destroyed into a separate
  // `_preResetSnapshots` collection FIRST, chunked to stay well under Firestore's per-doc size
  // limit, so a mis-click can be undone by an admin (via scripts/restore-preresetsnapshot.mjs)
  // without waiting on — or even needing — that day's external backup.
  //
  // `_preResetSnapshots` is admin-only in firestore.rules (read AND write) — this collection
  // holds a full copy of whatever it's guarding, so it needs the same trust level as the data
  // itself. Deliberately fails CLOSED: if this write throws (most likely because the updated
  // firestore.rules exception for this collection hasn't been published to Firebase Console
  // yet), the caller must NOT proceed with the destructive delete — better to block the go-live
  // reset with a clear error than to silently perform an unrecoverable action with no safety
  // net at all.
  const snapshotBeforeDelete = useCallback(async (label: string, rows: { id: string; data: Record<string, unknown> }[]) => {
    const stamp = Date.now();
    const CHUNK = 300; // keeps each snapshot doc comfortably under Firestore's 1 MiB/doc limit
    const totalChunks = Math.max(1, Math.ceil(rows.length / CHUNK));
    const writes: Promise<void>[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      // Each chunk is its own document with no ordering dependency on the others, so fire them
      // all at once instead of awaiting one round trip at a time — with thousands of txs this
      // can be dozens of chunks, and the destructive delete right after this only starts once
      // ALL of them resolve, so doing this serially would multiply both the wait and the chance
      // any single chunk's withTimeout trips on a slow connection.
      writes.push(withTimeout(setDoc(doc(db, '_preResetSnapshots', `${label}-${stamp}-${i}`), {
        createdAt: serverTimestamp(),
        createdBy: userName(),
        label,
        chunkIndex: i / CHUNK,
        totalChunks,
        totalDocs: rows.length,
        docs: rows.slice(i, i + CHUNK),
      })));
    }
    await Promise.all(writes);
  }, [userName]);

  // ---------- reset all stock ledgers (go-live) ----------
  // Real-world request: a hospital going live for real (after a testing/pilot period) wants a
  // clean starting point — every drug's substock card currently shows a noisy, incomplete
  // history full of test data and negative "computed from incomplete history" balances (see
  // printSubstockCardSheet's own footnote for that exact problem). This wipes every tx
  // document — the sole source SubstockCardScreen, ReportScreen's turnover/aging/discrepancy
  // views, and recomputeUsageStats() all read — so every one of those goes back to empty and
  // starts counting fresh from today.
  //
  // Deliberately narrow in scope: only `txs` is touched. `meds`/`lots` (today's real floor and
  // substock quantities) are NEVER written here, so nothing on the shelf changes — this resets
  // the paper trail, not the stock itself. `auditLog` (logins, approvals, this very action) is
  // a different collection and is untouched too; the one entry this logs there is the only
  // durable record the reset ever happened.
  //
  // Two-step confirmation given the blast radius (every drug, no partial/per-med undo): the
  // usual confirmAsync, then a typed "RESET" via promptAsync — a single tap-through dialog
  // felt too easy to hit by accident for something this size, unlike every other confirmAsync
  // call in this file which undoes at most one med/user/pair.
  const resetAllStockLedgers = useCallback(guardOnce('resetAllStockLedgers', async () => {
    if (myProfile?.role !== 'admin') { toast('เฉพาะ Admin เท่านั้นที่รีเซ็ตบัตรสต็อกได้'); return; }
    if (!(await confirmAsync(
      'รีเซ็ตบัตรสต็อกยาทุกตัว?\n\n'
      + 'จะลบ "ประวัติธุรกรรมทั้งหมด" ของยาทุกตัวถาวร (รับเข้า เติมหน้างาน ปรับยอด คืนยา ยาเสีย ตัดหมดอายุ นำเข้า HOSxP นับสต็อก ย้ายชั้นวาง) '
      + 'ยอดคงเหลือปัจจุบัน (หน้างาน/substock) จะไม่เปลี่ยนแปลง แต่บัตรสต็อก, รายงาน turnover/aging/discrepancy, '
      + 'และสถิติการใช้ยาสำหรับแนะนำ par จะกลับไปว่างเปล่าทั้งหมด เริ่มนับใหม่จากวันนี้\n\n'
      + 'ย้อนกลับไม่ได้ กู้คืนไม่ได้ — ใช้เฉพาะตอนเริ่มต้นใช้งานระบบจริงครั้งแรกเท่านั้น ยืนยันหรือไม่?',
    ))) return;
    const typed = await promptAsync('พิมพ์ RESET (ตัวพิมพ์ใหญ่) เพื่อยืนยันการลบประวัติธุรกรรมทั้งหมดถาวร — พิมพ์อย่างอื่นหรือกดยกเลิกเพื่อไม่ทำอะไรเลย');
    if (typed !== 'RESET') { toast('ยกเลิก — ไม่ได้พิมพ์ยืนยันตรงตามที่กำหนด ไม่มีอะไรถูกลบ'); return; }
    try {
      const snap = await withTimeout(getDocs(collection(db, 'txs')));
      const rows = snap.docs.map((d) => ({ id: d.id, data: d.data() }));
      try {
        await snapshotBeforeDelete('txs', rows);
      } catch (e) {
        toastErr(e, 'ยกเลิก — สำรองข้อมูลก่อนลบไม่สำเร็จ (อาจยังไม่ได้ publish กฎ Firestore ล่าสุด) ยังไม่มีอะไรถูกลบ');
        return;
      }
      for (let i = 0; i < rows.length; i += 450) {
        const batch = writeBatch(db);
        rows.slice(i, i + 450).forEach((r) => batch.delete(doc(db, 'txs', r.id)));
        await withTimeout(batch.commit());
      }
      await logAudit({ type: 'stock_ledger_reset', note: 'รีเซ็ตบัตรสต็อกยาทุกตัว — ลบประวัติธุรกรรมทั้งหมด ' + nf(rows.length) + ' รายการ (สำรองไว้ล่วงหน้าใน _preResetSnapshots แล้ว) เพื่อเริ่มต้นใช้งานระบบจริง โดย ' + userName() });
      hapticSuccess();
      toast('รีเซ็ตบัตรสต็อกแล้ว — ลบประวัติธุรกรรม ' + nf(rows.length) + ' รายการ (สำรองไว้ก่อนลบแล้ว) ยอดคงเหลือปัจจุบันไม่เปลี่ยนแปลง');
    } catch (e) {
      toastErr(e, 'รีเซ็ตไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [myProfile, confirmAsync, promptAsync, toast, toastErr, logAudit, userName, guardOnce, snapshotBeforeDelete]);

  // Real-world request: the current deployment's floor/substock numbers are sample data (the
  // drug NAMES/codes/pars/bins are real — only the quantities aren't) left over from setting
  // the formulary up, and the hospital wants a clean zero before staff start counting for
  // real. Same shape and same reasoning as resetAllStockLedgers() just above (go-live reset,
  // scoped narrowly, double-confirmed) but touches the opposite half of the data: this zeroes
  // every med's `floor` and deletes every `lots` document (substock = sum of lot.qty — see
  // subQty() in selectors.ts, so deleting every lot IS zeroing every substock), while never
  // touching a single med's name/code/unit/par/bin/category/price/active flag or any other
  // setting. lastCountTs/lastSubCountTs are cleared too — leaving them would make CountScreen
  // claim these zeroed, never-actually-counted numbers were "recently verified".
  const resetAllQuantities = useCallback(guardOnce('resetAllQuantities', async () => {
    if (myProfile?.role !== 'admin') { toast('เฉพาะ Admin เท่านั้นที่รีเซ็ตจำนวนยาได้'); return; }
    if (!(await confirmAsync(
      'รีเซ็ตจำนวนยาทุกตัวเป็น 0?\n\n'
      + 'จะตั้งยอดหน้างานของยาทุกตัวเป็น 0 และลบ lot ทั้งหมดใน substock (ทำให้ยอด substock ของทุกตัวเป็น 0 ไปด้วย) '
      + 'ชื่อยา รหัส หน่วย ราคา par และชั้นวางของทุกตัวจะไม่เปลี่ยนแปลง — เหมาะสำหรับตอนที่ยอดจำนวนยังเป็นแค่ข้อมูลตัวอย่าง ยังไม่ใช่ของจริง\n\n'
      + 'หลังรีเซ็ตต้องนับสต็อกจริงแล้วกรอกเข้าระบบใหม่ทั้งหมดก่อนเริ่มใช้งานจริง — ย้อนกลับไม่ได้ ยืนยันหรือไม่?',
    ))) return;
    const typed = await promptAsync('พิมพ์ RESET (ตัวพิมพ์ใหญ่) เพื่อยืนยันการล้างจำนวนยาทุกตัวเป็น 0 ถาวร — พิมพ์อย่างอื่นหรือกดยกเลิกเพื่อไม่ทำอะไรเลย');
    if (typed !== 'RESET') { toast('ยกเลิก — ไม่ได้พิมพ์ยืนยันตรงตามที่กำหนด ไม่มีอะไรถูกเปลี่ยน'); return; }
    try {
      // Fresh reads, not the client's cached state.meds — that cache can be a moment stale
      // (another device's onSnapshot update not applied here yet), and the snapshot below must
      // record the actual value about to be overwritten in Firestore, not whatever this tab
      // last saw, or an undo via restore-preresetsnapshot.mjs would restore the wrong floor.
      const [medSnap, lotSnap] = await Promise.all([
        withTimeout(getDocs(collection(db, 'meds'))),
        withTimeout(getDocs(collection(db, 'lots'))),
      ]);
      const medCount = medSnap.docs.length;
      const lotCount = lotSnap.docs.length;
      try {
        // Snapshot the OLD floor value per med (not the whole med doc — name/code/par/bin etc.
        // never change here, only `floor`) plus every lot about to be deleted, before either
        // write happens.
        await snapshotBeforeDelete('meds-floor', medSnap.docs.map((d) => ({ id: d.id, data: { floor: d.data().floor ?? 0, lastCountTs: d.data().lastCountTs ?? null, lastSubCountTs: d.data().lastSubCountTs ?? null } })));
        await snapshotBeforeDelete('lots', lotSnap.docs.map((d) => ({ id: d.id, data: d.data() })));
      } catch (e) {
        toastErr(e, 'ยกเลิก — สำรองข้อมูลก่อนลบไม่สำเร็จ (อาจยังไม่ได้ publish กฎ Firestore ล่าสุด) ยังไม่มีอะไรถูกเปลี่ยน');
        return;
      }
      const ops: { ref: ReturnType<typeof doc>; kind: 'update' | 'delete' }[] = [
        ...medSnap.docs.map((d) => ({ ref: d.ref, kind: 'update' as const })),
        ...lotSnap.docs.map((d) => ({ ref: d.ref, kind: 'delete' as const })),
      ];
      for (let i = 0; i < ops.length; i += 450) {
        const batch = writeBatch(db);
        ops.slice(i, i + 450).forEach((op) => {
          if (op.kind === 'update') batch.update(op.ref, { floor: 0, lastCountTs: deleteField(), lastSubCountTs: deleteField() });
          else batch.delete(op.ref);
        });
        await withTimeout(batch.commit());
      }
      await logAudit({ type: 'quantity_reset', note: 'รีเซ็ตจำนวนยาทุกตัวเป็น 0 — ยอดหน้างาน ' + nf(medCount) + ' รายการ, ลบ lot substock ' + nf(lotCount) + ' รายการ (สำรองไว้ล่วงหน้าใน _preResetSnapshots แล้ว) เพื่อเริ่มต้นใช้งานระบบจริง โดย ' + userName() });
      hapticSuccess();
      toast('รีเซ็ตจำนวนยาแล้ว — ยอดหน้างานและ substock ของยาทุกตัวเป็น 0 แล้ว (สำรองไว้ก่อนลบแล้ว) ชื่อยา/par/ชั้นวางยังอยู่ครบ');
    } catch (e) {
      toastErr(e, 'รีเซ็ตไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [myProfile, confirmAsync, promptAsync, toast, toastErr, logAudit, userName, guardOnce, snapshotBeforeDelete]);

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
  // adjust/return/damaged/reconcile_hosxp/ward_move all only ever touch หน้างาน (see their
  // commit functions) — the only types that ever touch substock are: a receive from the
  // central warehouse (+), a FEFO transfer out to the shelf (-, though the tx itself stores a
  // positive "amount moved" — flipped here to read as an outflow), scrapping an expired lot
  // (already stored negative), and a substock cycle count (commitSubCount — either sign,
  // loc:'substock'; a *floor* count also logs type:'count' but tagged loc:'floor', so the
  // loc check below is what keeps the two from bleeding into each other's ledger). Fetched
  // fresh each time (not the capped live 300) so the running balance is correct back to this
  // med's very first substock transaction, however long ago that was.
  const SUBSTOCK_LEDGER_TYPES = new Set(['receive_from_central', 'transfer_to_floor', 'expired', 'count']);
  const fetchSubstockLedger = useCallback(async (medId: string) => {
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return [];
    // Bug fix: a noSubstock med (liquids/inhalers/sprays — see usesSubstock()) never has a
    // substock stage at all; commitReceive credits its floor directly (to:'floor', no lot ever
    // created) instead of creating a substock lot. Nothing gated this screen from being opened
    // for one anyway (SubstockCardScreen's search has no usesSubstock filter), so its real
    // receive_from_central history — which the comment below assumed was always a substock
    // credit — would get counted as substock "received" here, while subQty() (real lots, none
    // exist) correctly reads 0. That produced a permanent false "mismatch" warning on any
    // noSubstock med with receive history, and a running balance for a stock stage that was
    // never real. Nothing to show for a med with no substock stage — return empty up front.
    if (!usesSubstock(m)) return [];
    // A name query alone would merge two drugs' history the moment OPD and IPD versions of
    // the same drug share a name (see wardOf/Ward) — every tx write now also tags `medId`
    // (see the Tx type), so when this med has a same-name "twin" in the other ward, trust
    // only rows explicitly tagged for THIS med instead of everything with a matching name.
    // Older tx rows written before medId existed have none, so this narrows to nothing older
    // than that migration for a name-duplicated drug — showing an incomplete-but-correct
    // ledger beats a complete-but-wrong one that silently mixes in the other ward's stock.
    // Active twins always narrow. An INACTIVE same-name med only skips narrowing when it's
    // specifically the known, intentional loser of a merge INTO this exact med (Med.mergedInto
    // — see its own doc comment in types.ts) — the real "รวมสต็อก OPD+IPD" case, where pulling
    // its untagged old history in on purpose is correct, not a live ambiguity anymore. Any OTHER
    // inactive same-name med (an accidental duplicate deactivated for an unrelated reason, or
    // one merged into some OTHER med entirely) still narrows, same as an active twin would —
    // bug fix (audit finding): this used to treat EVERY inactive same-name med as "not a twin,
    // safe to blend in," which would have silently merged two genuinely distinct drugs' history
    // the moment either one was deactivated for any reason at all, not just a real merge.
    // mergedFromIds tracks WHICH same-name ids are trusted merge-losers (there could in
    // principle be more than one, or one alongside an unrelated duplicate) — narrowing, when it
    // happens, must still accept rows tagged with any of those, not just m.id itself, or a real
    // merged-in history would wrongly disappear the moment some OTHER unrelated duplicate also
    // shares the name. (SubstockCardScreen's own hasNameTwin applies the same mergedInto check
    // for its warning banner, though it only needs the boolean, not this id set.)
    const mergedFromIds = new Set(state.meds.filter((x) => x.id !== m.id && x.name === m.name && x.mergedInto === m.id).map((x) => x.id));
    const hasNameTwin = state.meds.some((x) => x.id !== m.id && x.name === m.name && !mergedFromIds.has(x.id));
    const snap = await withTimeout(getDocs(query(collection(db, 'txs'), where('name', '==', m.name))));
    const rows = snap.docs
      .map((d) => d.data() as { type: string; ts: number; qty: number; note?: string; by: string; loc?: string; medId?: string })
      // Bug-guard: 'count' is logged for BOTH floor counts (loc:'floor', commitCount) and
      // substock counts (loc:'substock', commitSubCount) — without this loc check, a floor
      // count would wrongly appear on this substock ledger the moment 'count' was added to
      // SUBSTOCK_LEDGER_TYPES above (same class of bug the pre-existing 'expired' guard here
      // was already written to prevent, generalized to the new type).
      .filter((x) => SUBSTOCK_LEDGER_TYPES.has(x.type) && (x.type !== 'expired' || x.loc === 'substock') && (x.type !== 'count' || x.loc === 'substock'))
      .filter((x) => !hasNameTwin || x.medId === m.id || (x.medId != null && mergedFromIds.has(x.medId)))
      .map((x) => ({ ts: x.ts, type: x.type, qty: x.type === 'transfer_to_floor' ? -Math.abs(x.qty) : x.qty, note: x.note || '', by: x.by }))
      .sort((a, b) => a.ts - b.ts);
    let bal = 0;
    return rows.map((r) => { bal += r.qty; return { ...r, balance: bal }; });
  }, [state.meds]);

  // Real-world request: a noSubstock med (liquid/inhaler/spray/injectable — see usesSubstock())
  // has no substock ledger to show (fetchSubstockLedger above returns empty for one), but staff
  // still need the SAME picture for it: how much came in from the central warehouse, how much
  // the daily HOSxP usage-cut took out, what's left — floor plays the role substock plays for
  // every other drug. Every type here already only ever touches floor (see the comment on
  // fetchSubstockLedger above) and every one is already stored with the correct sign for a
  // floor-inflow/outflow reading — unlike transfer_to_floor's flip in the substock ledger (an
  // outflow there), it's the same number read as an INFLOW here, so no sign massaging needed.
  const FLOOR_LEDGER_TYPES = new Set(['receive_from_central', 'transfer_to_floor', 'reconcile_hosxp', 'adjust', 'return', 'damaged', 'ward_move_in', 'ward_move_out', 'count']);
  const fetchFloorLedger = useCallback(async (medId: string) => {
    const m = state.meds.find((x) => x.id === medId);
    if (!m) return [];
    // Same OPD/IPD name-twin hazard, and same mergedInto refinement, as fetchSubstockLedger
    // above — see its own comment for the full reasoning.
    const mergedFromIds = new Set(state.meds.filter((x) => x.id !== m.id && x.name === m.name && x.mergedInto === m.id).map((x) => x.id));
    const hasNameTwin = state.meds.some((x) => x.id !== m.id && x.name === m.name && !mergedFromIds.has(x.id));
    const snap = await withTimeout(getDocs(query(collection(db, 'txs'), where('name', '==', m.name))));
    const rows = snap.docs
      .map((d) => d.data() as { type: string; ts: number; qty: number; note?: string; by: string; loc?: string; to?: string; medId?: string })
      // receive_from_central needs its own guard unlike the rest: a med WITH substock has this
      // type land at substock (to:'substock'), not floor — only the noSubstock case (to:'floor')
      // belongs here. Every other type in FLOOR_LEDGER_TYPES is only ever logged against floor
      // in the first place (see fetchSubstockLedger's comment), so no further guard needed.
      .filter((x) => FLOOR_LEDGER_TYPES.has(x.type) && (x.type !== 'receive_from_central' || x.to === 'floor') && (x.type !== 'count' || x.loc === 'floor'))
      .filter((x) => !hasNameTwin || x.medId === m.id || (x.medId != null && mergedFromIds.has(x.medId)))
      .map((x) => ({ ts: x.ts, type: x.type, qty: x.qty, note: x.note || '', by: x.by }))
      .sort((a, b) => a.ts - b.ts);
    let bal = 0;
    return rows.map((r) => { bal += r.qty; return { ...r, balance: bal }; });
  }, [state.meds]);

  // Real-world request: "ดูยอดคงคลังย้อนหลังได้เสมอ เหมือน HOSxP" — Firestore only ever holds
  // the CURRENT floor/lot quantities, no built-in history, so a point-in-time stock level has
  // to be RECONSTRUCTED. Walks the txs log backward from the known-correct LIVE value,
  // subtracting every logged delta that happened AFTER the target date, for every med in one
  // pass — anchoring to the live value (not to an assumed zero baseline at some arbitrary point
  // in the past, which is what fetchFloorLedger/fetchSubstockLedger above effectively do for
  // their own running-balance display) means the result for any reasonably recent date is as
  // accurate as the live number itself, with error only ever accumulating from the gap between
  // the target date and now — never from however far back this med's real stock history goes,
  // which this app simply has no record of pre-dating its own txs log. Deliberately NOT
  // clamped to ≥0: a negative result is itself a real, worth-surfacing signal that some
  // stock-affecting event in that window was never logged as a tx — matching this app's "never
  // silently correct, always show" convention elsewhere (parAnomalies, usageAnomalies, ...).
  const fetchStockAsOf = useCallback(async (dateMs: number): Promise<{ medId: string; medName: string; unit: string; category: string; floor: number; sub: number; value: number }[]> => {
    const snap = await withTimeout(getDocs(query(collection(db, 'txs'), where('ts', '>', dateMs))));
    const medById = new Map(state.meds.map((m) => [m.id, m]));
    const medsByName = new Map<string, Med[]>();
    for (const m of state.meds) {
      const arr = medsByName.get(m.name) || [];
      arr.push(m);
      medsByName.set(m.name, arr);
    }
    const floorDelta = new Map<string, number>();
    const subDelta = new Map<string, number>();
    for (const d of snap.docs) {
      const x = d.data() as { type: string; qty: number; name: string; loc?: string; to?: string; medId?: string };
      // Same name-twin disambiguation as fetchFloorLedger/fetchSubstockLedger above: trust an
      // explicit medId tag when present, otherwise only attribute an untagged old row by name
      // when that name is unambiguous (no live twin) — an ambiguous row is excluded rather than
      // risked, same "incomplete-but-correct beats complete-but-wrong" reasoning.
      let medId = x.medId && medById.has(x.medId) ? x.medId : undefined;
      if (!medId) {
        const candidates = medsByName.get(x.name);
        if (candidates && candidates.length === 1) medId = candidates[0].id;
      }
      if (!medId) continue;
      if (FLOOR_LEDGER_TYPES.has(x.type) && (x.type !== 'receive_from_central' || x.to === 'floor') && (x.type !== 'count' || x.loc === 'floor')) {
        floorDelta.set(medId, (floorDelta.get(medId) || 0) + x.qty);
      }
      if (SUBSTOCK_LEDGER_TYPES.has(x.type) && (x.type !== 'expired' || x.loc === 'substock') && (x.type !== 'count' || x.loc === 'substock')) {
        const delta = x.type === 'transfer_to_floor' ? -Math.abs(x.qty) : x.qty;
        subDelta.set(medId, (subDelta.get(medId) || 0) + delta);
      }
    }
    return state.meds.map((m) => {
      const floor = m.floor - (floorDelta.get(m.id) || 0);
      const sub = usesSubstock(m) ? subQty(state, m.id) - (subDelta.get(m.id) || 0) : 0;
      return { medId: m.id, medName: m.name, unit: m.unit, category: categoryOf(m), floor, sub, value: (floor + sub) * m.price };
    });
  }, [state]);

  const exportStockAsOfCsv = useCallback(async (rows: { medName: string; unit: string; category: string; floor: number; sub: number; value: number }[], dateIso: string) => {
    const header = ['ชื่อยา', 'หมวดยา', 'หน่วย', 'หน้างาน (คำนวณ)', 'substock (คำนวณ)', 'มูลค่า (บาท)'];
    const sorted = rows.slice().sort((a, b) => b.value - a.value);
    const body = sorted.map((r) => [r.medName, categoryLabel(r.category), r.unit, r.floor, r.sub, Math.round(r.value)]);
    await downloadCsv([header, ...body], 'stock_as_of_' + dateIso + '.csv');
  }, []);

  // The exec-summary "ธุรกรรมใน 30 วันล่าสุด" stat needs a true 30-day count, but state.txs is
  // the realtime cache capped to the 300 most-recent rows across ALL types — a busy month can
  // blow past that cap long before 30 days are covered, silently under-reporting. A server-side
  // count avoids downloading every row just to show one number.
  const fetchExecTxsThisMonth = useCallback(async (): Promise<number | null> => {
    try {
      const from = Date.now() - 30 * 86400000;
      const snap = await withTimeout(getCountFromServer(query(collection(db, 'txs'), where('ts', '>=', from))));
      return snap.data().count;
    } catch {
      return null;
    }
  }, []);

  // ---------- KPI / daily metrics report ----------
  // Reads scripts/collect-daily-metrics.mjs's daily output (see DailyMetrics in types.ts) for
  // any caller-chosen range — a plain one-shot fetch (like fetchSubstockLedger above), not a
  // live listener: a historical report doesn't need to re-render mid-view if today's row
  // happens to land while it's open, and the collection only ever gets one new doc/day.
  const fetchDailyMetrics = useCallback(async (fromDate: string, toDate: string): Promise<DailyMetrics[]> => {
    const snap = await withTimeout(getDocs(query(
      collection(db, 'dailyMetrics'),
      where('date', '>=', fromDate), where('date', '<=', toDate), orderBy('date', 'asc'),
    )));
    return snap.docs.map((d) => d.data() as DailyMetrics);
  }, []);

  const exportDailyMetricsCsv = useCallback(async (rows: DailyMetrics[]) => {
    const header = [
      'วันที่', 'ยาที่ใช้งาน', 'คงเหลือหน้างาน', 'คงเหลือ substock', 'มูลค่าคงคลัง (บาท)',
      'ต่ำกว่า Min', 'เร่งด่วน', 'มูลค่าใกล้หมดอายุ', 'มูลค่าหมดอายุ',
      'รับเข้า (จำนวน)', 'รับเข้า (ครั้ง)', 'เติมหน้างาน', 'จ่ายจริง (HOSxP)', 'ปรับยอด/คืน/หมดอายุ', 'ธุรกรรมรวม',
      'เวลารอเบิกยาเฉลี่ย (ชม.)', 'เบิกที่อนุมัติวันนี้', 'เบิกค้างอนุมัติ (ปัจจุบัน)',
      'par ผิดพลาด', 'par ควรทบทวน', 'นับสต็อกพบส่วนต่าง', 'จับคู่ HOSxP ไม่ได้', 'ตัดยอด HOSxP วันนี้หรือไม่',
      'ผู้ใช้งานที่ทำรายการ', 'ยาขาดสต็อกจริง', 'ยาที่มีการใช้จริง',
    ];
    const body = rows.map((r) => [
      r.date, r.activeMedCount, r.totalFloorQty, r.totalSubQty, r.totalStockValue,
      r.lowStockCount, r.urgentLowCount, r.nearExpiryValue, r.expiredValue,
      r.receivedQty, r.receivedCount, r.transferredQty, r.dispensedQty, r.adjustQty, r.txCount,
      r.receiveLeadTimeAvgHours != null ? Math.round(r.receiveLeadTimeAvgHours * 10) / 10 : '', r.receiveApprovedCount, r.receivePendingBacklog,
      r.parErrorCount, r.parReviewCount, r.countDiscrepancyCount, r.hosxpUnmatchedCount, r.reconciledToday ? 'ใช่' : 'ไม่ใช่',
      r.activeUserCount, r.stockoutCount, r.usedMedCount,
    ]);
    await downloadCsv([header, ...body], 'kpi_' + (rows[0]?.date || '') + '_ถึง_' + (rows[rows.length - 1]?.date || '') + '.csv');
  }, []);

  // ---------- usage history (per-drug qty/value by import period — see commitUsageImport) ----------
  // Same "plain one-shot fetch, not a live listener" reasoning as fetchDailyMetrics right above:
  // a historical report over a caller-chosen range doesn't need to re-render mid-view, and this
  // collection can grow into the thousands of docs (one per matched med per import) — nothing
  // this screen does should hold it all in a permanent onSnapshot.
  const fetchUsageHistory = useCallback(async (fromDate: string, toDate: string): Promise<UsageHistoryRecord[]> => {
    const snap = await withTimeout(getDocs(query(
      collection(db, 'usageHistory'),
      where('periodFrom', '>=', fromDate), where('periodFrom', '<=', toDate),
    )));
    return snap.docs.map((d) => d.data() as UsageHistoryRecord);
  }, []);

  const exportUsageHistoryCsv = useCallback(async (records: UsageHistoryRecord[]) => {
    const header = ['เดือน', 'ชื่อยา', 'หมวดยา', 'จำนวนที่ใช้', 'มูลค่า (บาท)', 'ช่วงที่นำเข้า'];
    const sorted = records.slice().sort((a, b) => a.periodFrom.localeCompare(b.periodFrom) || a.medName.localeCompare(b.medName));
    const body = sorted.map((r) => [r.monthKey, r.medName, categoryLabel(r.category), r.qty, Math.round(r.value), r.periodFrom + ' – ' + r.periodTo]);
    await downloadCsv([header, ...body], 'usage_history_' + (sorted[0]?.periodFrom || '') + '_ถึง_' + (sorted[sorted.length - 1]?.periodTo || '') + '.csv');
  }, []);

  // ---------- par-adjustment outcomes ("ติดตามผลหลังปรับ par ว่านิ่งจริงไหม" — see
  // ParAdjustmentRecord's own doc comment in types.ts) ----------
  // Same "plain one-shot fetch, not a live listener" shape as fetchUsageHistory right above —
  // this screen (ReportScreen.tsx's insights tab) only needs a snapshot the moment it opens.
  const fetchParAdjustments = useCallback(async (sinceMs: number): Promise<ParAdjustmentRecord[]> => {
    const snap = await withTimeout(getDocs(query(collection(db, 'parAdjustments'), where('adjustedAt', '>=', sinceMs))));
    return snap.docs.map((d) => d.data() as ParAdjustmentRecord);
  }, []);

  // ---------- count ----------
  const setCountInput = useCallback((medId: string, v: string) => patch((st) => ({ countInputs: { ...st.countInputs, [medId]: digitsOnly(v) } })), [patch]);

  const commitCount = useCallback(guardOnce('count', async (medId: string) => {
    const raw = state.countInputs[medId];
    const q = parseInt(raw, 10);
    if (isNaN(q)) return;
    const m = state.meds.find((x) => x.id === medId);
    // Bug fix (silent no-op): this used to just `return` here with no toast at all — a med
    // deleted by another device before this row got committed left the button tap do
    // absolutely nothing with zero explanation, worse than even a vague error message since
    // there's nothing to read. commitTransfer/commitReceive already toast a clear, specific
    // message for this exact same "deleted-med" gap; this one never got the equivalent.
    if (!m) { toast('รายการนี้ถูกลบออกจากระบบไปแล้ว — ลบแถวนี้ออกจากหน้านับสต็อกแล้วรีเฟรชหน้าจอ'); return; }
    // Bug fix (typo safety net): nothing here ever checked the typed count against anything —
    // digitsOnly() only guards against overflow/corruption (caps at 9 digits), not plausibility.
    // Typing several rows quickly on a shelf walk is exactly the situation an extra digit (e.g.
    // "990" instead of "90") slips in unnoticed, and the old flow committed it with the same
    // zero friction as a correct entry, logging a wildly wrong "discrepancy" tx with no warning
    // at all. Flags (not blocks) a count that implies a delta far outside anything this med's
    // own par level would ever plausibly produce — cheap for a legitimate large count (one
    // extra tap), but catches the real, common typo case.
    const implausible = Math.abs(q - m.floor) > Math.max(m.parFloor, 20) * 8;
    if (implausible && !(await confirmAsync(
      'นับได้ ' + nf(q) + ' ' + m.unit + ' — ต่างจากยอดระบบ (' + nf(m.floor) + ') มากผิดปกติเมื่อเทียบกับ par ('
      + nf(m.parFloor) + ') ของ ' + m.name + ' พิมพ์จำนวนถูกต้องแล้วใช่ไหม?'
    ))) return;
    try {
      let delta = 0;
      let note = '';
      // Bug fix (data integrity): tx-log write folded into the same transaction as the floor
      // write (was a separate logTx() call after commit) — see commitAdjust's note on this
      // exact class of gap.
      await runTx(async (trx) => {
        const ref = doc(db, 'meds', medId);
        const snap = await trx.get(ref);
        const curFloor = (snap.data() as { floor?: number } | undefined)?.floor ?? m.floor;
        delta = q - curFloor;
        note = delta < 0
          ? 'นับได้น้อยกว่าระบบ ' + nf(Math.abs(delta)) + ' ' + m.unit + ' — คาดว่าจ่ายผ่าน HOSxP แต่ยังไม่ reconcile'
          : delta > 0 ? 'นับได้มากกว่าระบบ ' + nf(delta) + ' ' + m.unit + ' — ควรตรวจสอบย้อนหลัง' : 'นับตรงกับระบบ ไม่มีส่วนต่าง';
        trx.update(ref, { floor: q, lastCountTs: Date.now() });
        trx.set(doc(collection(db, 'txs')), {
          type: 'count', name: m.name, medId: m.id, qty: delta, unit: m.unit,
          reason: 'นับสต็อกหน้างานประจำรอบ', note, loc: 'floor', by: userName(), ts: Date.now(),
        } satisfies Omit<import('../types').Tx, 'id'>);
      });
      patch((st) => { const ci = { ...st.countInputs }; delete ci[medId]; return { countInputs: ci }; });
      toast(m.name + ' — ' + note);
    } catch (e) { toastErr(e, 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }), [state.countInputs, state.meds, userName, toast, toastErr, patch, guardOnce, confirmAsync]);

  // Batch version of commitCount() for a real cycle count: someone walks the shelf typing
  // numbers into 20-40 rows, then commits the lot in one tap. Deliberately NOT one big
  // Firestore batch write — each med still goes through its own transaction that re-reads the
  // live floor before computing the delta (exactly as commitCount does), because the whole
  // point of the count is the difference against the CURRENT number, not against whatever this
  // device last synced. Sequential rather than parallel so a slow ward connection degrades
  // into "slower", not into a burst of concurrent transactions retrying against each other.
  // Each med also keeps its own discrepancy-log line — the log is the audit trail, and one
  // lumped "counted 30 things" entry would destroy its per-drug usefulness.
  const commitAllCounts = useCallback(guardOnce('countAll', async () => {
    const entries = Object.entries(state.countInputs)
      .map(([medId, raw]) => ({ medId, q: parseInt(raw, 10) }))
      .filter((e) => !isNaN(e.q));
    if (!entries.length) { toast('ยังไม่ได้กรอกจำนวนที่นับได้สักรายการ'); return; }
    // Bug fix (typo safety net — bulk gap): commitCount's own plausibility check (flags a count
    // implying a delta far outside anything the med's own par level would plausibly produce)
    // never applied here — a shelf walk that fills 20-40 rows then hits ONE "บันทึกทั้งหมด"
    // button, arguably the more common real path than committing row by row, had zero
    // protection against the exact fat-finger typo (an extra digit) that button was built to
    // catch. One summary confirm for the whole batch, not one popup per row, since asking N
    // separate times for a single bulk action would defeat the point of batching it.
    const implausibleRows = entries
      .map((e) => ({ ...e, m: state.meds.find((x) => x.id === e.medId) }))
      .filter((e): e is typeof e & { m: NonNullable<typeof e.m> } => !!e.m && Math.abs(e.q - e.m.floor) > Math.max(e.m.parFloor, 20) * 8);
    if (implausibleRows.length && !(await confirmAsync(
      implausibleRows.length + ' จาก ' + entries.length + ' รายการ มีจำนวนที่นับได้ต่างจากยอดระบบมากผิดปกติเทียบกับ par เช่น '
      + implausibleRows.slice(0, 3).map((e) => e.m.name + ' (นับได้ ' + nf(e.q) + ' ยอดระบบ ' + nf(e.m.floor) + ')').join(', ')
      + (implausibleRows.length > 3 ? ' และอีก ' + (implausibleRows.length - 3) + ' รายการ' : '')
      + ' — พิมพ์จำนวนถูกต้องแล้วใช่ไหม? ต้องการบันทึกทั้งหมดนี้ต่อหรือไม่?'
    ))) return;
    let ok = 0;
    let diffs = 0;
    let failed = 0;
    for (const { medId, q } of entries) {
      const m = state.meds.find((x) => x.id === medId);
      // Bug fix (silent no-op): this used to `continue` here with no record at all — a deleted
      // med's row was silently dropped from both the "ok" and "failed" counts, so the final
      // toast's tally undercounted with no indication that row even existed. Counting it as
      // failed at least surfaces it, instead of the total quietly not adding up to what was
      // actually typed on screen.
      // Bug fix (data integrity): this checked only `!m` (the med doc deleted outright) — a med
      // DEACTIVATED (not deleted) on another device/tab while this batch was being typed out
      // still passes that check, so a stock write for a drug the operator can no longer even see
      // on their own screen (CountScreen's `active`/`typedIds` already filter it out of the UI
      // the moment it goes inactive) still silently landed, with the "บันทึกทั้งหมด" button's own
      // displayed count having already dropped by one to reflect the disappearance — the write
      // that happens disagrees with what the UI just told the operator would happen.
      if (!m || !m.active) { failed++; continue; }
      try {
        let delta = 0;
        // Bug fix (data integrity): tx-log write folded into the same per-med transaction —
        // see commitCount's note on this exact class of gap.
        await runTx(async (trx) => {
          const ref = doc(db, 'meds', medId);
          const snap = await trx.get(ref);
          const curFloor = (snap.data() as { floor?: number } | undefined)?.floor ?? m.floor;
          delta = q - curFloor;
          const note = delta < 0
            ? 'นับได้น้อยกว่าระบบ ' + nf(Math.abs(delta)) + ' ' + m.unit + ' — คาดว่าจ่ายผ่าน HOSxP แต่ยังไม่ reconcile'
            : delta > 0 ? 'นับได้มากกว่าระบบ ' + nf(delta) + ' ' + m.unit + ' — ควรตรวจสอบย้อนหลัง' : 'นับตรงกับระบบ ไม่มีส่วนต่าง';
          trx.update(ref, { floor: q, lastCountTs: Date.now() });
          trx.set(doc(collection(db, 'txs')), {
            type: 'count', name: m.name, medId: m.id, qty: delta, unit: m.unit,
            reason: 'นับสต็อกหน้างานประจำรอบ (บันทึกทั้งชุด)', note, loc: 'floor', by: userName(), ts: Date.now(),
          } satisfies Omit<import('../types').Tx, 'id'>);
        });
        patch((st) => { const ci = { ...st.countInputs }; delete ci[medId]; return { countInputs: ci }; });
        ok++;
        if (delta !== 0) diffs++;
      } catch (e) { console.error(e); failed++; }
    }
    // A partial failure leaves the rows it couldn't save still filled in on screen (they're
    // only cleared per-med on success above), so retrying is just tapping the button again.
    toast(failed > 0
      ? 'บันทึกแล้ว ' + ok + ' รายการ · ไม่สำเร็จ ' + failed + ' รายการ (ยังค้างอยู่ในหน้าจอ ลองกดบันทึกอีกครั้ง)'
      : 'บันทึกครบ ' + ok + ' รายการ' + (diffs > 0 ? ' · มีส่วนต่าง ' + diffs + ' รายการ (ดูได้ใน Discrepancy log)' : ' · ตรงกับระบบทุกรายการ'));
  }), [state.countInputs, state.meds, toast, patch, guardOnce, confirmAsync]);

  // ---------- substock count ----------
  const setSubCountInput = useCallback((medId: string, v: string) => patch((st) => ({ subCountInputs: { ...st.subCountInputs, [medId]: digitsOnly(v) } })), [patch]);

  // Applies one counted substock total against the med's real lots. Unlike floor (a single
  // number on the med doc), substock is the SUM of however many lots this med has, each with
  // its own real lotNo/exp — a counted total alone can't say which lot a difference belongs
  // to, so the two directions are handled differently:
  //  - short (counted < system): real shrinkage, taken out of the real lots FEFO (soonest-
  //    expiring first) — the same order transfer_to_floor already consumes them in, so a
  //    shortfall reads the same way an unrecorded dispense against those lots would.
  //  - over (counted > system): stock the system has no lot for at all. There's no honest way
  //    to guess which lot/expiry it belongs to from a bulk count alone, so it lands in one
  //    generic adjustment lot per med with an explicit "unknown expiry" sentinel far enough out
  //    (100 years) that it can never trip a false near-expiry/expired warning — a wrong GUESS at
  //    a plausible-looking near date would be actively worse than admitting the date isn't
  //    known. Whoever finds the real lot/expiry later can scrap this placeholder and log a
  //    proper "รับเข้า" instead.
  const commitSubCount = useCallback(guardOnce('subCount', async (medId: string) => {
    const raw = state.subCountInputs[medId];
    const q = parseInt(raw, 10);
    if (isNaN(q)) return;
    const m = state.meds.find((x) => x.id === medId);
    // Bug fix (silent no-op): same class of gap as commitCount's own fix — this used to just
    // `return` here with no toast, leaving a tap on a deleted med's row do nothing at all.
    if (!m) { toast('รายการนี้ถูกลบออกจากระบบไปแล้ว — ลบแถวนี้ออกจากหน้านับสต็อกแล้วรีเฟรชหน้าจอ'); return; }
    // Bug fix (typo safety net): same gap as commitCount's own fix above — nothing here ever
    // checked the typed count against anything plausible before committing it.
    const curSub = subQty(state, medId);
    const implausible = Math.abs(q - curSub) > Math.max(m.parSub, 20) * 8;
    if (implausible && !(await confirmAsync(
      'นับได้ ' + nf(q) + ' ' + m.unit + ' — ต่างจากยอดระบบ (' + nf(curSub) + ') มากผิดปกติเมื่อเทียบกับ par ('
      + nf(m.parSub) + ') ของ ' + m.name + ' พิมพ์จำนวนถูกต้องแล้วใช่ไหม?'
    ))) return;
    try {
      let delta = 0;
      let note = '';
      // Bug fix (data integrity — fabricated stock): the LOT SET itself, not just each lot's
      // qty, must be fresh. state.lots is the onSnapshot cache — if a receive/approve lands a
      // brand-new lot for this med between opening the count screen and hitting "save" (a
      // multi-minute shelf walk is exactly the case this can happen in), that lot's id is
      // invisible to a list built from the stale cache, so curSub below undercounts it. The
      // "over" branch then fabricates a whole extra ปรับยอด lot for the gap — double-counting
      // stock that a real, just-received lot already accounts for. The Firestore client SDK
      // can't run a query inside a transaction (trx.get() only takes a doc ref), so the lot-id
      // list has to be refreshed via a plain query immediately before the transaction starts —
      // this can't close the window to zero, but it shrinks it from "however long the count
      // screen was open" down to a single round trip.
      const lotIds = (await getDocs(query(collection(db, 'lots'), where('medId', '==', medId)))).docs.map((d) => d.id);
      // Bug fix (data integrity): tx-log write folded into the same transaction as the lot
      // writes — see commitCount's note on this exact class of gap.
      await runTx(async (trx) => {
        const liveLots: { id: string; qty: number; exp: number }[] = [];
        for (const lotId of lotIds) {
          const snap = await trx.get(doc(db, 'lots', lotId));
          const data = snap.data() as { qty?: number; exp?: number } | undefined;
          liveLots.push({ id: lotId, qty: data?.qty ?? 0, exp: data?.exp ?? Infinity }); // FEFO fix: unknown exp sorts last, not first (see commitTransfer's own note on this bug)
        }
        const curSub = liveLots.reduce((s, l) => s + l.qty, 0);
        delta = q - curSub;
        if (delta < 0) {
          let need = -delta;
          for (const l of [...liveLots].filter((x) => x.qty > 0).sort((a, b) => a.exp - b.exp)) {
            if (need <= 0) break;
            const take = Math.min(need, l.qty);
            trx.update(doc(db, 'lots', l.id), { qty: l.qty - take });
            need -= take;
          }
        } else if (delta > 0) {
          const lotRef = doc(collection(db, 'lots'));
          trx.set(lotRef, {
            code: genLotCode(m.code, medId, lotRef.id), medId, lotNo: 'ปรับยอด (นับสต็อก)',
            exp: Date.now() + 100 * 365 * DAY, qty: delta, loc: 'ปรับยอด',
          });
        }
        trx.update(doc(db, 'meds', medId), { lastSubCountTs: Date.now() });
        note = delta < 0
          ? 'นับได้น้อยกว่าระบบ ' + nf(Math.abs(delta)) + ' ' + m.unit + ' — ตัดออกจาก lot ที่ใกล้หมดอายุที่สุดก่อน'
          : delta > 0 ? 'นับได้มากกว่าระบบ ' + nf(delta) + ' ' + m.unit + ' — ลงเป็น lot ปรับยอด ยังไม่ทราบวันหมดอายุจริง ควรแก้ไขเมื่อทราบ' : 'นับตรงกับระบบ ไม่มีส่วนต่าง';
        trx.set(doc(collection(db, 'txs')), {
          type: 'count', name: m.name, medId: m.id, qty: delta, unit: m.unit,
          reason: 'นับสต็อก substock ประจำรอบ', note, loc: 'substock', by: userName(), ts: Date.now(),
        } satisfies Omit<import('../types').Tx, 'id'>);
      });
      patch((st) => { const ci = { ...st.subCountInputs }; delete ci[medId]; return { subCountInputs: ci }; });
      toast(m.name + ' — ' + note);
    } catch (e) { toastErr(e, 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }), [state, userName, toast, toastErr, patch, guardOnce, confirmAsync]);

  /** Batch version of commitSubCount(), mirroring commitAllCounts() — sequential per-med
   * transactions (never one lumped write) for the same reason: each has to re-read its own
   * live lots before computing its delta, and a slow connection should degrade to "slower",
   * not a burst of concurrent transactions contending on the same docs. */
  const commitAllSubCounts = useCallback(guardOnce('subCountAll', async () => {
    const entries = Object.entries(state.subCountInputs)
      .map(([medId, raw]) => ({ medId, q: parseInt(raw, 10) }))
      .filter((e) => !isNaN(e.q));
    if (!entries.length) { toast('ยังไม่ได้กรอกจำนวนที่นับได้สักรายการ'); return; }
    // Bug fix (typo safety net — bulk gap): same gap as commitAllCounts's own fix — commitSubCount's
    // plausibility check never applied to the "บันทึกทั้งหมด" bulk path. One summary confirm for
    // the whole batch rather than one popup per row.
    const implausibleSubRows = entries
      .map((e) => ({ ...e, m: state.meds.find((x) => x.id === e.medId), curSub: subQty(state, e.medId) }))
      .filter((e): e is typeof e & { m: NonNullable<typeof e.m> } => !!e.m && Math.abs(e.q - e.curSub) > Math.max(e.m.parSub, 20) * 8);
    if (implausibleSubRows.length && !(await confirmAsync(
      implausibleSubRows.length + ' จาก ' + entries.length + ' รายการ มีจำนวนที่นับได้ต่างจากยอดระบบมากผิดปกติเทียบกับ par เช่น '
      + implausibleSubRows.slice(0, 3).map((e) => e.m.name + ' (นับได้ ' + nf(e.q) + ' ยอดระบบ ' + nf(e.curSub) + ')').join(', ')
      + (implausibleSubRows.length > 3 ? ' และอีก ' + (implausibleSubRows.length - 3) + ' รายการ' : '')
      + ' — พิมพ์จำนวนถูกต้องแล้วใช่ไหม? ต้องการบันทึกทั้งหมดนี้ต่อหรือไม่?'
    ))) return;
    let ok = 0;
    let diffs = 0;
    let failed = 0;
    for (const { medId, q } of entries) {
      const m = state.meds.find((x) => x.id === medId);
      // Bug fix (silent no-op): same fix as commitAllCounts's own sibling gap — a deleted med's
      // row used to silently drop out of both the "ok" and "failed" tallies here too.
      // Bug fix (data integrity): same sibling gap as commitAllCounts's own fix above — a med
      // DEACTIVATED (not deleted) mid-batch still passed the old `!m` check alone and got a real
      // lot write for a drug no longer visible on the operator's own screen.
      if (!m || !m.active) { failed++; continue; }
      try {
        let delta = 0;
        // Bug fix (data integrity — fabricated stock): see commitSubCount's matching note
        // right above — the lot-id set itself must be re-queried live, not read off the
        // onSnapshot cache, or a lot created concurrently (e.g. a receive landing mid-batch)
        // is invisible here and gets double-counted as a fabricated ปรับยอด lot.
        const lotIds = (await getDocs(query(collection(db, 'lots'), where('medId', '==', medId)))).docs.map((d) => d.id);
        // Bug fix (data integrity): tx-log write folded into the same transaction — see
        // commitCount's note on this exact class of gap.
        await runTx(async (trx) => {
          const liveLots: { id: string; qty: number; exp: number }[] = [];
          for (const lotId of lotIds) {
            const snap = await trx.get(doc(db, 'lots', lotId));
            const data = snap.data() as { qty?: number; exp?: number } | undefined;
            liveLots.push({ id: lotId, qty: data?.qty ?? 0, exp: data?.exp ?? Infinity }); // FEFO fix: unknown exp sorts last, not first (see commitTransfer's own note on this bug)
          }
          const curSub = liveLots.reduce((s, l) => s + l.qty, 0);
          delta = q - curSub;
          if (delta < 0) {
            let need = -delta;
            for (const l of [...liveLots].filter((x) => x.qty > 0).sort((a, b) => a.exp - b.exp)) {
              if (need <= 0) break;
              const take = Math.min(need, l.qty);
              trx.update(doc(db, 'lots', l.id), { qty: l.qty - take });
              need -= take;
            }
          } else if (delta > 0) {
            const lotRef = doc(collection(db, 'lots'));
            trx.set(lotRef, {
              code: genLotCode(m.code, medId, lotRef.id), medId, lotNo: 'ปรับยอด (นับสต็อก)',
              exp: Date.now() + 100 * 365 * DAY, qty: delta, loc: 'ปรับยอด',
            });
          }
          trx.update(doc(db, 'meds', medId), { lastSubCountTs: Date.now() });
          const note = delta < 0
            ? 'นับได้น้อยกว่าระบบ ' + nf(Math.abs(delta)) + ' ' + m.unit + ' — ตัดออกจาก lot ที่ใกล้หมดอายุที่สุดก่อน'
            : delta > 0 ? 'นับได้มากกว่าระบบ ' + nf(delta) + ' ' + m.unit + ' — ลงเป็น lot ปรับยอด ยังไม่ทราบวันหมดอายุจริง ควรแก้ไขเมื่อทราบ' : 'นับตรงกับระบบ ไม่มีส่วนต่าง';
          trx.set(doc(collection(db, 'txs')), {
            type: 'count', name: m.name, medId: m.id, qty: delta, unit: m.unit,
            reason: 'นับสต็อก substock ประจำรอบ (บันทึกทั้งชุด)', note, loc: 'substock', by: userName(), ts: Date.now(),
          } satisfies Omit<import('../types').Tx, 'id'>);
        });
        patch((st) => { const ci = { ...st.subCountInputs }; delete ci[medId]; return { subCountInputs: ci }; });
        ok++;
        if (delta !== 0) diffs++;
      } catch (e) { console.error(e); failed++; }
    }
    toast(failed > 0
      ? 'บันทึกแล้ว ' + ok + ' รายการ · ไม่สำเร็จ ' + failed + ' รายการ (ยังค้างอยู่ในหน้าจอ ลองกดบันทึกอีกครั้ง)'
      : 'บันทึกครบ ' + ok + ' รายการ' + (diffs > 0 ? ' · มีส่วนต่าง ' + diffs + ' รายการ (ดูได้ใน Discrepancy log)' : ' · ตรงกับระบบทุกรายการ'));
  }), [state, userName, toast, patch, guardOnce, confirmAsync]);

  // ---------- hosxp reconcile ----------
  const setHosxpText = useCallback((v: string) => patch({ hosxpText: v }), [patch]);

  const processHosxp = useCallback(async () => {
    const lines = state.hosxpText.split('\n').map((l) => l.trim()).filter(Boolean);
    // Bug fix (data integrity): see splitNameQty's own doc comment (usageImport.ts) — a plain
    // lastIndexOf(',') split here broke the moment a day's dispensed qty itself had a Thai-
    // locale thousand-separator comma (e.g. "Paracetamol 500 mg,1,234"), silently truncating
    // the quantity and corrupting the drug name with the leftover digits instead of matching
    // and floor-deducting the real 1,234 units.
    const rows = lines.map((l) => {
      const split = splitNameQty(l);
      if (!split) return null;
      const qty = parseIntSafe(split.qtyStr);
      return { name: split.name, qty, match: matchHosxpMed(state.meds, split.name) };
    }).filter((x): x is { name: string; qty: number; match: ReturnType<typeof matchHosxpMed> } => !!x);
    if (!rows.length) { toast('วางข้อมูล CSV รูปแบบ "ชื่อยา,จำนวน" ก่อนประมวลผล'); return; }
    // Bug fix (paste-mistake safety net): nothing here ever checked the pasted block itself for
    // two real, common mistakes — accidentally pasting the same content twice (a doubled
    // clipboard paste), or pasting an entire multi-sheet/multi-day report instead of just one
    // day's usage rows. Every resulting row is still gated by matchHosxpMed on commit, but that
    // only catches "this drug doesn't exist," not "this whole paste looks wrong." Flags (not
    // blocks) both: an exact repeat of the first half in the second half (the specific,
    // unambiguous signature of a doubled paste — vanishingly unlikely to occur from real,
    // once-only usage data), and a row count well beyond this formulary's own size (~580 meds)
    // for what's supposed to be a single day's dispense list.
    const half = Math.floor(lines.length / 2);
    const isDoublePaste = lines.length >= 4 && lines.length % 2 === 0 && lines.slice(0, half).join('\n') === lines.slice(half).join('\n');
    const tooManyRows = rows.length > 300;
    if ((isDoublePaste || tooManyRows) && !(await confirmAsync(
      isDoublePaste
        ? 'ข้อมูลที่วางดูเหมือนถูกวางซ้ำ 2 รอบ (' + nf(rows.length) + ' แถว) — วางซ้ำโดยไม่ตั้งใจหรือไม่? กด "ตกลง" เพื่อประมวลผลต่อตามที่วางไว้จริง'
        : 'ข้อมูลที่วางมี ' + nf(rows.length) + ' แถว มากกว่าปกติมาก (ยาทั้งฟอร์มูลารีมีประมาณ 580 รายการ) — ตรวจสอบว่าวางถูกไฟล์/ถูกช่วงวันที่ (ควรเป็นวันเดียว) แล้วใช่ไหม?'
    ))) return;
    patch({ hosxpRows: rows, hosxpConfirmFuzzy: false, hosxpConfirmSingleDay: false });
  }, [state.hosxpText, state.meds, patch, toast, confirmAsync]);

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
      let skipped = 0;
      try {
        if (isSpreadsheet) {
          const parsed = await parseHosxpUsageWorkbook(reader.result as ArrayBuffer);
          raw = parsed.rows;
          skipped = parsed.skipped;
        } else {
          const parsed = parseUsageCsvTextWithSkipped(String(reader.result || ''));
          raw = parsed.rows;
          skipped = parsed.skipped;
        }
      } catch (e) {
        console.error('hosxp reconcile file parse failed:', e);
        toast('อ่านไฟล์นี้ไม่สำเร็จ — ตรวจสอบว่าเป็นไฟล์ Excel (.xls/.xlsx) จาก HOSxP หรือ CSV ที่ไม่เสียหาย');
        return;
      }
      if (!raw.length) { toast('ไม่พบข้อมูลที่อ่านได้ในไฟล์นี้'); return; }
      const rows = raw.map((r) => ({ name: r.name, qty: Math.round(r.qty), match: matchHosxpMed(state.meds, r.name) }));
      patch({ hosxpRows: rows, hosxpConfirmFuzzy: false, hosxpConfirmSingleDay: false, hosxpText: '' });
      // Bug fix (silent data loss): a malformed line (no comma, empty/unparseable qty cell) used
      // to be dropped with zero trace — nothing here distinguished "this file had exactly N
      // rows" from "this file had more, and some were silently unreadable". Only worth
      // mentioning when it actually happened.
      toast('อ่านไฟล์ ' + file.name + ' แล้ว ' + rows.length + ' รายการ'
        + (skipped > 0 ? ' (ข้าม ' + skipped + ' แถวที่อ่านไม่ได้)' : '')
        + ' — ตรวจสอบรายการด้านล่างก่อนตัดยอด');
    };
    if (isSpreadsheet) reader.readAsArrayBuffer(file);
    else reader.readAsText(file);
  }, [state.meds, patch, toast]);

  const setHosxpConfirmFuzzy = useCallback((v: boolean) => patch({ hosxpConfirmFuzzy: v }), [patch]);
  const setHosxpConfirmSingleDay = useCallback((v: boolean) => patch({ hosxpConfirmSingleDay: v }), [patch]);

  const commitReconcile = useCallback(guardOnce('reconcile', async () => {
    const rows = state.hosxpRows || [];
    const meds = state.meds;
    const hasFuzzy = rows.some((r) => r.match.kind === 'fuzzy');
    if (hasFuzzy && !state.hosxpConfirmFuzzy) { toast('กรุณายืนยันว่าตรวจสอบรายการที่จับคู่แบบไม่ตรงชื่อเป๊ะแล้ว ก่อนตัดยอด'); return; }
    // Bug fix (real risk): this screen exists specifically for a file covering ONE day — the
    // on-screen instructions already say so, but nothing actually stopped someone from feeding
    // it a multi-day export (e.g. catching up after a missed day) and silently over-deducting
    // the floor by however many extra days it covered. A required, explicit confirmation
    // (same shape as the fuzzy-match one above) is the only real backstop possible here —
    // there's no date column in the parsed data to check automatically.
    if (!state.hosxpConfirmSingleDay) { toast('กรุณายืนยันว่าไฟล์/ข้อมูลนี้ครอบคลุมแค่ 1 วันก่อนตัดยอด'); return; }
    // Bug fix (double-run risk): `reconciledToday` (lastReconcileDateIso, selectors.ts) already
    // existed, but was only ever surfaced passively — a HomeScreen tile someone has to go look
    // at separately, never an active warning at the one moment it actually matters: right
    // before this commit deducts stock a second time. Re-pasting the same (or yesterday's)
    // file twice in one day — a real, easy slip on a shared tablet — used to silently
    // double-deduct the floor with no error at all. Warn, don't block (same "routine but
    // risky" convention as guardOnce's own timeout-retry confirm above) — a deliberate re-run
    // (correcting a botched first import) is also a real, legitimate case this must not stop.
    if (lastReconcileDateIso(state.txs) === isoDate(Date.now()) && !(await confirmAsync(
      'วันนี้ตัดยอด HOSxP ไปแล้ว 1 ครั้ง — ถ้าตัดซ้ำอีกครั้งจะหักสต็อกหน้างานซ้ำสอง (เกินจริง) ถ้ากำลังแก้ไฟล์ที่นำเข้าผิดไปก่อนหน้านี้ ทำต่อได้เลย แต่ถ้าไม่แน่ใจ ให้ยกเลิกแล้วตรวจสอบก่อน — ต้องการตัดยอดซ้ำต่อหรือไม่?'
    ))) return;
    let applied = 0, skipped = 0, zeroQty = 0;
    const skippedNames: string[] = [];
    try {
      // Bug fix (flow latency): this used to run one `runTx` per row, one at a time, in a plain
      // for-loop — a routine daily HOSxP file (commonly 50-150+ line items, nearly always
      // distinct meds with no real write contention between them) meant 50-150+ sequential
      // transaction round trips, tens of seconds a pharmacist had to sit and watch every single
      // day for the single largest aggregate wait in the app. Unlike commitAllCounts/
      // commitAllSubCounts/mergeAllWardPairs (which stay sequential on purpose — see their own
      // comments), there's no such reason here: each row targets its own med. Running rows in
      // concurrent chunks cuts this to a few seconds; the chunk size caps how many transactions
      // are ever in flight at once rather than firing all of them simultaneously. On the rare
      // case two rows in the same chunk resolve to the SAME med (a duplicate name in the source
      // file), Firestore's own transaction retry (it already handles two admins racing the same
      // doc, same guarantee here) makes the second one re-read the fresh floor and reapply
      // correctly — concurrency here costs nothing in correctness, only removes dead waiting.
      const CHUNK_SIZE = 15;
      for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
        await Promise.all(rows.slice(i, i + CHUNK_SIZE).map(async (r) => {
          if (r.qty <= 0) { zeroQty++; return; }
          // Only 'exact' and 'fuzzy' (human-confirmed above) resolve to a single med —
          // 'ambiguous' and 'none' never touch stock, so a bad name in the source file can't
          // silently deduct from the wrong drug or get dropped without anyone noticing.
          const medId = r.match.kind === 'exact' || r.match.kind === 'fuzzy' ? r.match.medId : null;
          const m = medId ? meds.find((x) => x.id === medId) : null;
          if (!m) { skipped++; skippedNames.push(r.name); return; }
          // Bug fix (data integrity): tx-log write folded into the same transaction as the floor
          // deduction — was a separate logTx() call after runTx() resolved, the exact "stock
          // changed but no matching history row if the second call drops" gap commitTransfer's
          // own fix comment describes. This is the daily real-dispense deduction path — the one
          // number this whole app exists to keep trustworthy — so it gets the same atomic
          // treatment every other stock-mutating flow already has.
          await runTx(async (trx) => {
            const ref = doc(db, 'meds', m.id);
            const snap = await trx.get(ref);
            const before = (snap.data() as { floor?: number } | undefined)?.floor ?? m.floor;
            const after = Math.max(0, before - r.qty);
            trx.update(ref, { floor: after });
            trx.set(doc(collection(db, 'txs')), {
              type: 'reconcile_hosxp', name: m.name, medId: m.id, qty: -(before - after), unit: m.unit,
              reason: 'นำเข้าจากไฟล์ HOSxP',
              note: 'จ่ายจริง ' + nf(r.qty) + ' ' + m.unit + ' ตามไฟล์ HOSxP' + (r.match.kind === 'fuzzy' ? ' (จับคู่ชื่อแบบไม่ตรงเป๊ะ — ยืนยันโดยผู้ใช้แล้ว)' : ''),
              loc: 'floor', by: userName(), ts: Date.now(),
            } satisfies Omit<import('../types').Tx, 'id'>);
          });
          applied++;
        }));
      }
      // Bug fix (efficiency): a name that fails to match keeps failing every single day until
      // someone notices and fixes it — but the only trace before this was a one-line toast that
      // vanished in a few seconds, with no record to come back to later. One audit entry per
      // run, listing every skipped raw name, lets ReconcileScreen's "ยาที่หลุดบ่อย" panel
      // aggregate across recent runs and surface the ones worth actually fixing, instead of the
      // same skip being a fresh surprise every morning. Format: a human-readable count line,
      // then the raw names on their own line joined by " | " (not ",", since a real drug name
      // can itself contain a comma — see labelName.ts's own notes on this exact formulary) so
      // the aggregator can split it back out reliably.
      if (skippedNames.length) {
        await logAudit({ type: 'hosxp_unmatched', note: 'จับคู่ไม่ได้ ' + skippedNames.length + ' รายการจากไฟล์ HOSxP\n' + skippedNames.join(' | ') });
      }
      patch({ hosxpRows: null, hosxpText: '', hosxpConfirmFuzzy: false, hosxpConfirmSingleDay: false });
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
  }), [state.hosxpRows, state.hosxpConfirmFuzzy, state.hosxpConfirmSingleDay, state.meds, state.txs, userName, logAudit, toast, toastErr, patch, guardOnce, confirmAsync]);

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
      let skipped = 0;
      try {
        if (isSpreadsheet) {
          const parsed = await parseHosxpUsageWorkbook(reader.result as ArrayBuffer);
          raw = parsed.rows;
          skipped = parsed.skipped;
        } else {
          const parsed = parseUsageCsvTextWithSkipped(String(reader.result || ''));
          raw = parsed.rows;
          skipped = parsed.skipped;
        }
      } catch (e) {
        console.error('usage file parse failed:', e);
        toast('อ่านไฟล์นี้ไม่สำเร็จ — ตรวจสอบว่าเป็นไฟล์ Excel (.xls/.xlsx) จาก HOSxP หรือ CSV ที่ไม่เสียหาย');
        return;
      }
      if (!raw.length) { toast('ไม่พบข้อมูลที่อ่านได้ในไฟล์นี้'); return; }
      const rows = raw.map((r) => ({ ...r, match: matchHosxpMed(state.meds, r.name) }));
      patch({ usageRows: rows, usageFileName: file.name, usageConfirmFuzzy: false });
      // Bug fix (silent data loss): same fix as processHosxpFile above — a malformed line used
      // to be dropped with zero trace. Only worth a toast when it actually happened, since this
      // screen has no other success toast to fold it into.
      if (skipped > 0) toast('อ่านไฟล์แล้ว — ข้าม ' + skipped + ' แถวที่อ่านไม่ได้');
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
    const monthKey = state.usageDateFrom.slice(0, 7);
    try {
      // Each target now writes TWO ops (the used30 update + a usageHistory record below) —
      // half the old chunk size to stay safely under Firestore's 500-write batch limit.
      for (let i = 0; i < targets.length; i += 200) {
        const batch = writeBatch(db);
        targets.slice(i, i + 200).forEach(({ r, m }) => {
          const used30 = Math.round((r.qty / periodDays) * 30);
          batch.update(doc(db, 'meds', m.id), { used30 });
          // Real-world request: "เก็บสถิติการใช้ยาแต่ละวัน...รายงานประจำไตรมาส/เดือน/ปีงบประมาณ" —
          // used30 above is a ROLLING rate that every later import overwrites, with no memory of
          // any period before the most recent one. This record is that memory: the REAL total
          // qty/value for THIS declared period, written once and never overwritten, so Top 100 /
          // category / monthly-trend reporting (see usage tab, ReportScreen.tsx) can look back
          // across every import ever committed. See UsageHistoryRecord's own doc comment
          // (types.ts) for why monthKey is NOT prorated across a period spanning >1 month.
          batch.set(doc(collection(db, 'usageHistory')), {
            medId: m.id, medName: m.name, unit: m.unit, category: categoryOf(m),
            qty: r.qty, value: r.qty * m.price,
            periodFrom: state.usageDateFrom, periodTo: state.usageDateTo, periodDays,
            importedAt: Date.now(), monthKey,
          } satisfies UsageHistoryRecord);
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

  // ---------- one-scan-at-a-time transfer confirm (ScanConfirmSheet.tsx) ----------
  // The cart quantity itself is already live via setCartQty while this sheet is open — these
  // two just decide what happens to it, and whether the camera reopens for the next item.
  const confirmScanAndNext = useCallback(() => {
    patch({ scanConfirmMedId: null, qrOpen: true, qrCode: '', qrManualOpen: false, qrManualReason: '', qrPurpose: 'transfer' });
  }, [patch]);
  const confirmScanAndStop = useCallback(() => {
    patch({ scanConfirmMedId: null });
  }, [patch]);
  const cancelScanConfirm = useCallback((medId: string) => {
    // Restore the cart quantity to what it was right before THIS scan, not always 0 — see
    // lastScanConfirm's doc comment. Falls back to 0 only if the ref doesn't match (shouldn't
    // happen in practice — cancelScanConfirm only ever fires for the med the sheet is currently
    // showing, which is always the med lastScanConfirm was just set for).
    const prev = lastScanConfirm.current;
    setCartQty(medId, String(prev && prev.medId === medId ? prev.prevQty : 0));
    patch({ scanConfirmMedId: null });
  }, [patch, setCartQty]);

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
        // just the OPD one it happens to be stored under. A receive scan also needs to match
        // binSub: the new "ฉลากตู้เย็น" location labels (printLabels' locScope 'fridge'
        // branch) print bare location QRs for the pharmacy's own cold-storage fridges ahead of
        // any med being assigned yet — same pre-print-the-position idea as the floor LOCS
        // sheet — and a vaccine/cold-drug's storage position lives in binSub, not bin/binIpd
        // (their รับเข้า credits substock/storage, same as any other drug's binSub rack).
        // Transfer purpose stays bin/binIpd-only: it's always resolving a FLOOR position.
        const pool = state.meds.filter((m) => m.active && (m.bin === bin || m.binIpd === bin || (purpose === 'receive' && m.binSub === bin)));
        // Bug fix: the "which one's actually running low" tie-breaker for a shared bin code
        // used subQty<parSub unconditionally for a receive scan — always false for a noSubstock
        // med (no lots, subQty always 0), so two noSubstock meds sharing one fridge binSub code
        // (e.g. two vaccines both stored in FR-VAC1) could never be told apart by need; it fell
        // through to pool[0], an arbitrary first match that might not be the drug actually being
        // received. A noSubstock med's real "running low" signal is its floor level, same check
        // transfer purpose already uses.
        med = pool.find((m) => {
          if (purpose !== 'receive') return m.floor < floorMinOf(m);
          return usesSubstock(m) ? subQty(state, m.id) < m.parSub : m.floor < floorMinOf(m);
        }) || pool[0] || null;
        if (!med) { toast('ไม่พบยาที่ผูกกับชั้น ' + bin + ' ในระบบ'); return; }
      } else {
        // A substock shelf-strip label (bin set to binSub — see printLabels' locScope 'sub'
        // branch) encodes a real 'med' QR just like a floor label does, so it resolves here
        // too without any special-casing: no separate location-scan path is needed since each
        // substock rack position already belongs to exactly one known drug.
        med = resolveMed(payload);
        if (!med) { toast('ไม่พบรายการนี้ในระบบ — QR อาจมาจากฉลากรุ่นเก่า ลองพิมพ์ฉลากใหม่'); return; }
      }
      if (manual && purpose) logAudit({ type: 'qr_manual', note: 'กรอกรหัส QR ด้วยมือแทนการสแกน (' + med.name + ') — เหตุผล: ' + (state.qrManualReason.trim() || 'ไม่ระบุ') });
      if (purpose === 'receive') {
        // Receiving still needs a lot no./expiry/qty typed in by hand per item (nothing on a
        // shelf label can supply those), so there's no way around closing the scanner and
        // switching to that form — same as before.
        pickRecvMed(med.id);
        hapticSuccess();
        toast('สแกนพบ ' + med.name + ' ที่ substock — กรอก lot วันหมดอายุ และจำนวนที่รับ');
        patch({ qrOpen: false, qrManualOpen: false, qrCode: '', qrManualReason: '' });
      } else {
        // Real-world request: reverted from "camera stays open, silently keeps bumping every
        // scan" (this branch's own prior speed-focused fix) back to one-scan-at-a-time with an
        // explicit confirm step — see ScanConfirmSheet.tsx. Scanning a whole shelf run with no
        // per-item confirmation left genuine doubt about whether an item had actually been
        // added yet, and what quantity landed on it. Closing the camera and showing exactly
        // what's about to go in the cart, with an editable quantity and an explicit "ยืนยัน",
        // removes that ambiguity — slower per item, but that's the actual trade-off asked for.
        // Debounce window shortened from the old 4s to 3s: still needs to absorb a stray
        // duplicate decode right as the camera closes and reopens for "สแกนตัวต่อไป" (a slower
        // device's camera can take a couple seconds to reinitialize and get its first decode
        // while still pointed at the same label), just not the full 4s "still holding the phone
        // on this label" window from when the camera stayed open continuously.
        const now = Date.now();
        const isRepeat = lastScanBump.current?.medId === med.id && now - lastScanBump.current.ts < 3000;
        lastScanBump.current = { medId: med.id, ts: now };
        // Snapshot the cart quantity as it stood right before this scan — see lastScanConfirm's
        // doc comment — so cancelScanConfirm() can undo exactly this scan's effect (nothing, if
        // debounced) instead of always zeroing the whole med.
        lastScanConfirm.current = { medId: med.id, prevQty: state.cart[med.id] || 0 };
        if (!isRepeat) bump(med.id, 1);
        hapticSuccess();
        // Real-world request: "เติมยา HAD ไม่ต้องสแกน QR ซ้ำก่อนครับ" — TConfirmScreen's own
        // high-alert re-scan step (hadPending/startHadScan above) exists to prove "the physical
        // drug actually in hand right now really is this high-alert med" before it gets
        // dispensed — but scanning THIS med's own QR code to add it to the cart just now already
        // proved exactly that (the scanner only accepted it because the decoded code matched
        // this med). Asking for a second scan of the same physical item is a pure duplicate, not
        // an extra safety check — set hadOk here too so a HAD med added by scanning never hits
        // that redundant prompt. A HAD med added by SEARCH/TAP instead (no physical scan ever
        // happened) still has to go through it on TConfirmScreen, same as before — only the
        // already-scanned case skips it.
        setState((st) => ({ ...st, hadOk: med.had ? { ...st.hadOk, [med.id]: true } : st.hadOk }));
        patch({ qrOpen: false, qrCode: '', qrManualOpen: false, qrManualReason: '', scanConfirmMedId: med.id });
      }
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

  // Bug fix (race — could zero out all admins): the last-active-admin guard used to count
  // from state.users (the onSnapshot cache). Two admins each demoting/disabling the OTHER at
  // nearly the same moment both read "2 active admins" from their own stale cache, both pass
  // the <=1 check, and both writes succeed independently — 0 active admins left, recoverable
  // only via the Firebase console. Firestore transactions retry automatically when a document
  // they READ changes before they commit — so re-reading every admin's live active state
  // (including the one under a concurrent write) inside the same transaction as this write
  // closes the race: whichever of the two transactions commits second gets forced to retry
  // against the first one's already-written result, and its recount then correctly blocks it.
  const lastAdminGuardedWrite = useCallback(async (targetId: string, apply: (trx: Transaction, live: { role: Role; active: boolean }) => boolean | void) => {
    const adminIds = (await getDocs(query(collection(db, 'users'), where('role', '==', 'admin')))).docs.map((d) => d.id);
    await runTx(async (trx) => {
      const targetSnap = await trx.get(doc(db, 'users', targetId));
      const targetData = targetSnap.data() as { role?: Role; active?: boolean } | undefined;
      if (!targetData) throw new Error('not-found');
      const live = { role: (targetData.role ?? 'tech') as Role, active: !!targetData.active };
      const reducesAdmins = apply(trx, live);
      if (reducesAdmins) {
        // Bug fix: `adminIds` (the list of WHO to re-check) is still a plain getDocs query run
        // outside this transaction, so it can be stale by commit time — but the fix isn't
        // re-querying that list live too (Firestore transactions can't run a live query against
        // a moving result set the way they can re-GET a specific doc). It's that this loop used
        // to only re-check `active` on each of those ids, not `role` — so an admin who got
        // demoted (role changed away from 'admin') in the gap between the query above and this
        // transaction, but is still active:true, was still counted as one of the ≥2 admins
        // needed to allow THIS demotion. Re-checking role here closes that half of the race the
        // same way the active re-check closes the other half; the id-list staleness itself only
        // ever causes under-counting (an admin promoted in that same gap gets missed), which
        // fails safe by blocking a demotion rather than allowing one it shouldn't.
        let activeAdmins = 0;
        for (const aid of adminIds) {
          if (aid === targetId) { if (live.active && live.role === 'admin') activeAdmins++; continue; }
          const s = await trx.get(doc(db, 'users', aid));
          const sd = s.data() as { role?: Role; active?: boolean } | undefined;
          if (sd?.active && sd?.role === 'admin') activeAdmins++;
        }
        if (activeAdmins <= 1) throw new Error('last-admin');
      }
    });
  }, [runTx]);

  const setUserRole = useCallback(async (id: string, role: Role) => {
    // Bug fix: every other privileged mutation in this file (addMed, updateMedFull,
    // mergeWardMeds, applyAllSuggested, ...) checks a role gate before doing anything — this
    // one and toggleUserActive below didn't, relying only on AdminScreen hiding their buttons
    // and firestore.rules blocking the write server-side. Both still hold, but a client-side
    // guard here matches the app's own defense-in-depth pattern and fails with a clear message
    // instead of a round-trip to Firestore that firestore.rules then silently rejects.
    if (state.role !== 'admin') return;
    const u = state.users.find((x) => x.id === id);
    if (!u || u.role === role) return;
    if (id === state.myUid && !(await confirmAsync('คุณกำลังจะเปลี่ยนบทบาทของตัวเอง จาก ' + roleLabelFor(u.role) + ' เป็น ' + roleLabelFor(role) + ' — ยืนยันหรือไม่?'))) return;
    try {
      let fromRole = u.role;
      await lastAdminGuardedWrite(id, (trx, live) => {
        fromRole = live.role;
        trx.update(doc(db, 'users', id), { role });
        // Demoting the last active admin would lock the hospital out of admin functions
        // entirely (nobody left to approve accounts or promote anyone back) — the only
        // recovery would be hand-editing Firestore in the Firebase console again, same as
        // first bootstrap. Only a demotion AWAY from admin needs the live headcount below.
        return live.role === 'admin' && role !== 'admin' && live.active;
      });
      logAudit({ type: 'user_role_changed', note: 'เปลี่ยนบทบาท ' + u.name + ' จาก ' + roleLabelFor(fromRole) + ' เป็น ' + roleLabelFor(role) });
    } catch (e) {
      if ((e as Error)?.message === 'last-admin') { toast('เปลี่ยนไม่ได้ — นี่คือ Admin ที่ใช้งานอยู่คนสุดท้าย ต้องมี Admin อย่างน้อย 1 คนเสมอ'); return; }
      toastErr(e, 'เปลี่ยนบทบาทไม่สำเร็จ');
    }
  }, [state.role, state.users, state.myUid, lastAdminGuardedWrite, logAudit, toast, toastErr, confirmAsync]);

  const toggleUserActive = useCallback(async (id: string) => {
    // Bug fix: see the same guard in setUserRole above — this had no client-side role check
    // either, relying only on the UI hiding the button and firestore.rules to block it.
    if (state.role !== 'admin') return;
    const u = state.users.find((x) => x.id === id);
    if (!u) return;
    const next = !u.active;
    if (id === state.myUid && !next && !(await confirmAsync('คุณกำลังจะปิดใช้งานบัญชีของตัวเอง — จะออกจากระบบทันที และต้องให้ Admin คนอื่นเปิดให้ใหม่ ยืนยันหรือไม่?'))) return;
    try {
      let wasFirstApproval = false;
      await lastAdminGuardedWrite(id, (trx, live) => {
        // Bug fix: this used to decide "first-time approval" vs "re-enable after being
        // disabled" with `u.active === false && u.createdAt` — but `u.active` here is always
        // false in this branch already (next=true means it was false), and every user has a
        // createdAt, so that check was tautologically always true. A previously-active account
        // that got disabled and is now being turned back on always logged/toasted as
        // "อนุมัติบัญชี" (approved), which is misleading for someone who was never a pending
        // new registration. `lastLogin` actually distinguishes the two cases: a never-logged-in
        // account is a genuine first approval; one that has logged in before is being
        // reinstated, not approved for the first time.
        wasFirstApproval = next && !u.lastLogin;
        trx.update(doc(db, 'users', id), { active: next });
        return !next && live.role === 'admin' && live.active;
      });
      logAudit({ type: wasFirstApproval ? 'user_approved' : 'user_status_changed', note: (next ? (wasFirstApproval ? 'อนุมัติบัญชี ' : 'เปิดใช้งานบัญชี ') : 'ปิดใช้งานบัญชี ') + u.name });
      toast((next ? 'เปิดใช้งาน' : 'ปิดใช้งาน') + 'บัญชี ' + u.name + ' แล้ว');
    } catch (e) {
      if ((e as Error)?.message === 'last-admin') { toast('ปิดใช้งานไม่ได้ — นี่คือ Admin ที่ใช้งานอยู่คนสุดท้าย ต้องมี Admin อย่างน้อย 1 คนเสมอ'); return; }
      toastErr(e, 'เปลี่ยนสถานะไม่สำเร็จ');
    }
  }, [state.role, state.users, state.myUid, lastAdminGuardedWrite, logAudit, toast, toastErr, confirmAsync]);

  const exportAudit = useCallback(async () => {
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
    const outcome = await downloadCsv([['date_time', 'event', 'by', 'detail'], ...all.sort((a, b) => b.ts - a.ts).map((e) => [new Date(e.ts).toISOString(), EVENT_TYPE_LABEL[e.type] || e.type, e.by, e.note])], 'audit_log.csv');
    if (outcome === 'saved') toast('ดาวน์โหลด audit_log.csv แล้ว');
  }, [toast, toastErr]);

  // ---------- audit/tx history search (browse any date range, not just the live 300-cap) ----------
  const setHistoryFrom = useCallback((v: string) => patch({ historyFrom: v }), [patch]);
  const setHistoryTo = useCallback((v: string) => patch({ historyTo: v }), [patch]);
  const clearHistorySearch = useCallback(() => patch({ historyResults: null, historyTruncated: false }), [patch]);

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
          .map((d) => d.data() as { type: string; by: string; ts: number; name?: string; note?: string; qty?: number; unit?: string; loc?: string })
          .map((x) => ({ type: x.type, by: x.by, ts: x.ts, loc: x.loc, note: (x.name ? x.name + ' — ' : '') + (x.note || '') + (x.qty != null ? ' (' + (x.qty > 0 ? '+' : '') + x.qty + ' ' + (x.unit || '') + ')' : '') })),
      ].sort((a, b) => b.ts - a.ts);
      patch({ historyResults: all.slice(0, CAP), historyLoading: false, historyTruncated: all.length > CAP });
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
    state, myProfile, theme, toggleTheme, sub, fefo, userName, roleLabel, roleLabelOf, warn, toast, respondConfirm, promptAsync, respondPrompt, applyUpdate, dismissUpdate,
    notifyEnabled, notifyPermission, enableExpiryNotify, disableExpiryNotify,
    lowStockNotifyEnabled, enableLowStockNotify, disableLowStockNotify, go, back, setFormDirty, confirmLeaveIfDirty,
    setAuthMode, setAuthUsername, setAuthPassword, setAuthName, setAuthDept, setAuthRemember, signIn, signUp, logout, setDevice, seedDatabase,
    setSearch, setFilter, setWardFilter, bump, setCartQty, fillAll, fillUrgent, printPickList, printTodayReplenishList, removeFromCart, clearCart, commitTransfer,
    setRecvNo, setRecvSearch, pickRecvMed, setRecvLot, setRecvExp, setRecvQty, addRecv, cancelReceivePick, removeRecvItem, commitReceive, printWarehouseRequestList,
    approvePendingReceive, rejectPendingReceive, goReceiveFor,
    setWmFromSearch, pickWmFromMed, setWmToSearch, pickWmToMed, setWmQty, setWmReason, commitWardMove,
    pickAdjType, setAdjSearch, pickAdjMed, setAdjQty, setAdjReason, setAdjNote, commitAdjust, scrapLot,
    setReportTab, exportReportCsv, exportAllReports, printExecutiveSummary,
    setLabelType, setLocScope, setLabelWardScope, toggleLabelSelected, selectAllLabels, clearLabelSelected, printLabels,
    applyOnePar, applyAllSuggested, setAllMinHalfOfMax, setParSub, setParFloor, setMedBin, setMedBinSub, setMedCategory, setMedRoute, recomputeUsageStats, updateGlobalSettings,
    addMed, updateMedFull, mergeWardMeds, mergeAllWardPairs, shareAllMeds, autoCategorizeAll, autoRouteAll, toggleMedActive, startStockHold, endStockHold, deleteMed, deleteAllInactiveMeds, resetAllStockLedgers, resetAllQuantities, setMedsFocusId,
    goSubstockCardFor, setSubstockFocusId,
    fetchSubstockLedger, fetchFloorLedger, fetchStockAsOf, exportStockAsOfCsv, fetchDailyMetrics, exportDailyMetricsCsv, fetchUsageHistory, exportUsageHistoryCsv, fetchParAdjustments, setCountInput, commitCount, commitAllCounts, setSubCountInput, commitSubCount, commitAllSubCounts,
    setHosxpText, processHosxp, processHosxpFile, setHosxpConfirmFuzzy, setHosxpConfirmSingleDay, commitReconcile,
    setUsageDateFrom, setUsageDateTo, importUsageFile, setUsageConfirmFuzzy, clearUsageImport, commitUsageImport,
    openScanSearch, closeQr, qrDecoded, qrManual, setQrCode, setQrManualReason, startHadScan,
    confirmScanAndNext, confirmScanAndStop, cancelScanConfirm,
    doneAgain,
    setAdminTab, setAuditFilter, setUserRole, toggleUserActive, exportAudit,
    setHistoryFrom, setHistoryTo, searchHistory, clearHistorySearch, fetchExecTxsThisMonth,
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [state, myProfile, theme, toggleTheme]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useApp(): AppCtx {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used within AppProvider');
  return ctx;
}
