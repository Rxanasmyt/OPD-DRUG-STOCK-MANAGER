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
import { subQty, fefoLot, roleLabelFor, suggestPar, suggestTransferQty, daysUntil, matchHosxpMed, DAY, wardOf, usesSubstock, floorMinOf, isUrgentLow, needsWarehouseRequest, lastReconcileDateIso, isSharedMed, matchesWard, binFor, binDisplayAll, usageAnomalies, daysOfStockLeft, categoryStats, dailyUsageRate } from './selectors';
import { nf, thDate, isoDate, parseIntSafe, digitsOnly } from '../utils/format';
import { downloadCsv } from '../utils/csv';
import { encodeQr, parseQr } from '../utils/qr';
import { shortLabelName } from '../utils/labelName';
import { printLabelSheet, printPickListSheet, type PrintLabel } from '../utils/print';
import { parseHosxpUsageWorkbook, parseUsageCsvText, type RawUsageRow } from '../utils/usageImport';
import { LOCS } from '../data/locations';
import { suggestCategoryId } from '../data/categorySuggest';
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
};

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

    reportTab: 'aging', labelType: 'med', labelSelected: {}, locScope: 'floor', labelWardScope: 'all',

    qrOpen: false, qrManualOpen: false, qrCode: '', qrManualReason: '', qrPurpose: null, hadOk: {},

    doneKind: null, doneRows: [], toast: null,

    countInputs: {}, subCountInputs: {}, hosxpText: '', hosxpRows: null, hosxpConfirmFuzzy: false, hosxpConfirmSingleDay: false,

    usageDateFrom: '', usageDateTo: '', usageFileName: null, usageRows: null, usageConfirmFuzzy: false,

    medsFocusId: null,
    substockFocusId: null,

    adminTab: 'users', auditFilter: 'all',
    historyFrom: '', historyTo: '', historyResults: null, historyLoading: false,

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
  printUrgentReplenishList: () => void;
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
  exportAllReports: () => void;

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
  setParSub: (medId: string, v: string) => void;
  setParFloor: (medId: string, v: string) => void;
  setMedBin: (medId: string, v: string) => void;
  recomputeUsageStats: () => void;
  updateGlobalSettings: (patch: Partial<{ expiryWarnDays: number; parFloorCoverDays: number; parSubCoverDays: number }>) => void;

  // meds (formulary) management
  addMed: (input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; bin: string; binSub?: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility?: number; shared?: boolean; binIpd?: string; category?: string }) => void;
  updateMedFull: (medId: string, input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; bin: string; binSub?: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility: number; shared?: boolean; binIpd?: string; category?: string }) => void;
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
  toggleMedActive: (medId: string) => void;
  deleteMed: (medId: string) => void;
  deleteAllInactiveMeds: (medIds?: string[]) => void;
  /** Admin-only, permanently deletes every tx document (substock card ledger, report stats,
   * usage-rate history) without touching current floor/lot quantities — see its doc comment
   * in AppContext.tsx for the full "why" and scope. Double-confirmed (confirmAsync + a typed
   * "RESET" via promptAsync) since it's the widest-blast-radius destructive action in the app. */
  resetAllStockLedgers: () => void;
  setMedsFocusId: (id: string | null) => void;
  goSubstockCardFor: (medId: string) => void;
  setSubstockFocusId: (id: string | null) => void;

  // count
  fetchSubstockLedger: (medId: string) => Promise<{ ts: number; type: string; qty: number; note: string; by: string; balance: number }[]>;
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
  processHosxp: () => void;
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
  const guardOnce = useCallback(<A extends unknown[]>(key: string, fn: (...args: A) => Promise<void>) => {
    return async (...args: A) => {
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
      busyKeys.current.add(k);
      // Bug fix: guardOnce already prevented a double-tap from running the same commit twice
      // (see the comment above) — but nothing about that busy state was ever REACTIVE, so a
      // commit button gave zero visual feedback while its real Firestore round trip was in
      // flight on a slow connection. Mirroring the same key into state.busy lets any screen
      // show "กำลังบันทึก…"/disable the button for exactly as long as guardOnce is actually
      // blocking a repeat — same lifetime, just made visible.
      patch((st) => ({ busy: { ...st.busy, [k]: true } }));
      try { await fn(...args); } finally {
        busyKeys.current.delete(k);
        patch((st) => { const b = { ...st.busy }; delete b[k]; return { busy: b }; });
      }
    };
  }, [patch]);

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
  useEffect(() => {
    let cancelled = false;
    // Loaded lazily and only in the actual built PWA — this virtual module doesn't exist in
    // plain `vite dev`, so importing it eagerly at module scope would break local dev.
    import('virtual:pwa-register')
      .then(({ registerSW }) => {
        if (cancelled) return;
        updateSWRef.current = registerSW({
          onNeedRefresh() { patch({ updateAvailable: true }); },
        });
      })
      .catch(() => { /* not running as an installed/built PWA (e.g. plain dev server) — no-op */ });
    return () => { cancelled = true; };
  }, [patch]);
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
    const expiredCount = activeLots.filter((l) => daysUntil(l.exp) < 0).length;
    const nearCount = activeLots.filter((l) => { const d = daysUntil(l.exp); return d >= 0 && d < state.expiryWarnDays; }).length;
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
    hapticError();
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
      // ยอดหน้างาน/substock ทุกตัวเริ่มที่ 0 โดยตั้งใจ (ดู seed.ts) — ระบบนี้ไม่มีทางรู้ว่าจริงๆ
      // มีของอยู่บนชั้น/ในคลังย่อยเท่าไรจนกว่าจะมีคนนับจริง บอกไว้ตรงนี้กันคนเข้าใจผิดว่า "โหลด
      // ข้อมูลตั้งต้นแล้วทำไมยอดเป็น 0 หมด" คิดว่าเป็นบัค ทั้งที่เป็นพฤติกรรมที่ถูกต้อง
      toast(`โหลดข้อมูลตั้งต้นแล้ว: ยา ${r.meds} รายการ — ยอดหน้างาน/substock เริ่มที่ 0 ทุกตัว ต้องนับจริงแล้วกรอกเข้าระบบก่อนเริ่มใช้งาน`);
      logAudit({ type: 'par_updated', note: 'เริ่มต้นฐานข้อมูลยา (' + r.meds + ' รายการ) — ยอดหน้างาน/substock เริ่มที่ 0 ทุกตัว รอการนับจริง' });
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
    const ok = printPickListSheet(rows, 'ใบจัดยาเติมชั้น', 'ตามรายการที่เลือกในตะกร้าเติมหน้างาน', undefined, { printedBy: userName() });
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
    const items = state.meds.filter((m) => m.active && usesSubstock(m) && m.floor < floorMinOf(m));
    if (!items.length) { toast('วันนี้ไม่มีรายการที่ต่ำกว่าจุดต้องเติม (Min) — ยังไม่ต้องเติมหน้างาน'); return; }
    const rows = items
      .map((m) => {
        const need = Math.max(0, m.parFloor - m.floor);
        const qty = suggestTransferQty(state, m);
        // suggestTransferQty caps at what's actually in substock — flag it on the sheet
        // itself when that cap bit, so picking every row here still won't quietly leave the
        // shelf under par; the person carrying this sheet should know to also flag it for
        // the next "เบิกจากคลังใหญ่" run instead of assuming the job's done.
        const note = qty < need ? 'substock เหลือไม่พอเติมเต็ม par (ขาดอีก ' + nf(need - qty) + ' ' + m.unit + ')' : undefined;
        return { bin: binDisplayAll(m), name: m.name, qty, unit: m.unit, note };
      })
      .filter((r) => r.qty > 0);
    if (!rows.length) { toast('รายการที่ต่ำกว่า Min ไม่มีของเหลือใน substock ให้เติมเลยสักรายการ — ต้องเบิกจากคลังใหญ่ก่อน'); return; }
    const ok = printPickListSheet(rows, 'ใบเติมหน้างานประจำวัน', 'รายการที่ต่ำกว่าจุดต้องเติม (Min) ประจำวันนี้', undefined, { printedBy: userName() });
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state, toast, userName]);

  // Same sheet as printTodayReplenishList above, scoped to just isUrgentLow() items — the
  // paper counterpart of TransferScreen's "🔴 เร่งด่วนวันนี้" filter/fillUrgent(), for handing
  // to someone else to walk the shelf with when there's no time (or no second phone) for the
  // full below-Min list today. A short, separate function rather than a parameter on
  // printTodayReplenishList — that one's wired straight to a plain onClick, and a boolean
  // parameter there would collide with the MouseEvent React passes as the first argument.
  const printUrgentReplenishList = useCallback(() => {
    const items = state.meds.filter((m) => m.active && usesSubstock(m) && isUrgentLow(m));
    if (!items.length) { toast('วันนี้ไม่มีรายการเร่งด่วน (ต่ำกว่าครึ่งหนึ่งของ Min)'); return; }
    const rows = items
      .map((m) => {
        const need = Math.max(0, m.parFloor - m.floor);
        const qty = suggestTransferQty(state, m);
        const note = qty < need ? 'substock เหลือไม่พอเติมเต็ม par (ขาดอีก ' + nf(need - qty) + ' ' + m.unit + ')' : undefined;
        return { bin: binDisplayAll(m), name: m.name, qty, unit: m.unit, note };
      })
      .filter((r) => r.qty > 0);
    if (!rows.length) { toast('รายการเร่งด่วนไม่มีของเหลือใน substock ให้เติมเลยสักรายการ — ต้องเบิกจากคลังใหญ่ก่อน'); return; }
    const ok = printPickListSheet(rows, 'ใบเติมหน้างานเร่งด่วนวันนี้', 'รายการต่ำกว่าครึ่งหนึ่งของ Min — เร่งด่วนที่สุดของวันนี้', undefined, { printedBy: userName() });
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
    if (!items.length) { toast('ทุกรายการยังสูงกว่า par — ยังไม่ต้องเบิกเพิ่ม'); return; }
    const rows = items.map((m) => {
      const short = usesSubstock(m);
      const qty = Math.max(0, (short ? m.parSub - subQty(state, m.id) : m.parFloor - m.floor));
      return { bin: m.code, name: m.name + (short ? '' : ' (ไม่มี substock)'), qty, unit: m.unit };
    });
    const ok = printPickListSheet(rows, 'ใบขอเบิกจากคลังใหญ่', 'รายการที่ต่ำกว่า par ทั้งระบบ (รวมยาที่ไม่มี substock)', { bin: 'รหัสยา', qty: 'จำนวนที่ควรเบิก' }, { printedBy: userName() });
    toast(ok ? 'เปิดหน้าต่างพิมพ์แล้ว' : 'เปิดหน้าต่างพิมพ์ไม่ได้ — เบราว์เซอร์บล็อกป็อปอัป ลองอนุญาตป็อปอัปสำหรับเว็บนี้แล้วลองใหม่');
  }, [state, toast, userName]);

  const commitTransfer = useCallback(guardOnce('transfer', async () => {
    const cart = { ...state.cart };
    const ids = Object.keys(cart);
    if (!ids.length) return;
    const meds = state.meds, lotsCache = state.lots;
    let resultRows: AppState['doneRows'] = [];
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
          trx.set(doc(collection(db, 'txs')), {
            type: 'transfer_to_floor', name: m.name, medId, qty: cart[medId], unit: m.unit, from: 'substock', to: 'floor',
            note: 'FEFO lot ' + used.join(', '), by: userName(), ts,
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
        hapticSuccess();
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
      hapticSuccess();
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
      await runTx(async (trx) => {
        const ref = doc(db, 'meds', m.id);
        const snap = await trx.get(ref);
        before = (snap.data() as { floor?: number } | undefined)?.floor ?? m.floor;
        after = Math.max(0, before + sign * q);
        trx.update(ref, { floor: after });
      });
      const appliedQty = after - before;
      await logTx({ type: t, name: m.name, medId: m.id, qty: appliedQty, unit: m.unit, reason: state.adjReason, note: state.adjNote || '—', loc: 'floor' });
      patch({ adjQty: '', adjReason: '', adjNote: '', adjMed: null, adjSearch: '' });
      hapticSuccess();
      toast('บันทึกแล้ว · ' + m.name + ' ' + (appliedQty > 0 ? '+' : appliedQty < 0 ? '−' : '') + nf(Math.abs(appliedQty)) + ' ' + m.unit);
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
      hapticSuccess();
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
    const names = { aging: 'stock_aging.csv', category: 'stock_by_category.csv', turn: 'turnover.csv', disc: 'discrepancy_log.csv', insights: 'usage_insights.csv' };
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
    } else if (st.reportTab === 'category') {
      // Same categoryStats() the on-screen table renders from — one source of truth, so an
      // exported spreadsheet can never quietly disagree with what the pharmacist just read.
      const rows = categoryStats(st, wardMeds.filter((m) => m.active), st.expiryWarnDays)
        .map((r) => [r.label, r.meds, r.low, Math.round(r.value), Math.round(r.atRisk), r.used30]);
      outcome = await downloadCsv([['category', 'medications', 'below_min', 'stock_value_thb', 'expiry_risk_value_thb', 'used_30d'], ...rows], names.category);
    } else if (st.reportTab === 'turn') {
      const rows = wardMeds.filter((m) => m.active).map((m) => {
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
      const anomalies = usageAnomalies(wardMeds);
      const rows = anomalies.map((a) => [
        a.med.name, a.med.used30, a.med.usedPrev30, Math.round(a.changePct * 100),
        daysOfStockLeft(st, a.med) ?? '',
      ]);
      outcome = await downloadCsv([['medication', 'used_30d', 'used_prev_30d', 'change_pct', 'days_of_stock_left'], ...rows], names.insights);
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
      const bDef: [string, number, number][] = [['หมดอายุแล้ว', -99999, 0], ['เหลือ ≤ 30 วัน', 0, 30], ['31–90 วัน', 30, 90], ['91–180 วัน', 90, 180], ['มากกว่า 180 วัน', 180, 99999]];
      addSheet('stock_aging', [['bucket', 'lots', 'value_thb'], ...bDef.map(([label, lo, hi]) => {
        const ls = st.lots.filter((l) => l.qty > 0 && daysUntil(l.exp) > lo && daysUntil(l.exp) <= hi);
        const val = ls.reduce((s, l) => s + l.qty * (st.meds.find((m) => m.id === l.medId)?.price || 0), 0);
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
          sub: 'หน่วย ' + m.unit + ' · ชั้น ' + s.bin, tag: m.had ? 'HIGH ALERT' : undefined, bin: s.bin, ward: s.ward,
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
        return { payload: encodeQr('lot', l.code), id: l.code, title: m.name, sub: 'lot ' + l.lotNo + ' · exp ' + thDate(l.exp), tag: daysUntil(l.exp) < state.expiryWarnDays ? 'ใกล้หมดอายุ' : undefined, ward: wardOf(m) };
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
        sub: 'หน่วย ' + m.unit + ' · substock ' + m.binSub, tag: m.had ? 'HIGH ALERT' : undefined, bin: m.binSub,
      }));
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
    // Same widened charset as normBin/sanitizeBin — see normBin's doc comment.
    const val = v.toUpperCase().replace(/[^A-Z0-9\u0E00-\u0E7F-]/g, '').slice(0, 10);
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
  const addMed = useCallback(guardOnce('addMed', async (input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; bin: string; binSub?: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility?: number; shared?: boolean; binIpd?: string; category?: string }) => {
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
        const binSub = input.binSub ? normBin(input.binSub) : '';
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
          ...(binSub ? { binSub } : {}),
          ...(input.category ? { category: input.category } : {}),
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
  const updateMedFull = useCallback(guardOnce('updateMedFull', async (medId: string, input: { name: string; unit: string; dosageForm: string; price: number; had: boolean; bin: string; binSub?: string; parSub: number; parFloor: number; floorMin: number; ward: Ward; noSubstock: boolean; volatility: number; shared?: boolean; binIpd?: string; category?: string }) => {
    if (!canEditPar) return;
    const name = input.name.trim();
    if (!name) { toast('กรอกชื่อยาก่อน'); return; }
    const binIpd = input.binIpd ? normBin(input.binIpd) : '';
    const binSub = input.binSub ? normBin(input.binSub) : '';
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
      binSub: binSub ? binSub : deleteField(),
      category: input.category ? input.category : deleteField(),
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

  // One-tap bulk fill for Med.category — see data/categorySuggest.ts for the keyword engine
  // behind it. Deliberately narrow in what it's allowed to touch: only meds with NO category
  // set yet (never overwrites a category a human already chose, including one this same
  // action set on a previous run), and only ones the keyword list actually recognizes (a med
  // it can't match keeps falling back to "ยังไม่ระบุหมวด" via categoryOf() same as before —
  // never forced into a guessed bucket just to make the uncategorized count hit zero).
  const autoCategorizeAll = useCallback(guardOnce('autoCategorizeAll', async () => {
    if (!canEditPar) return;
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
      const refs = snap.docs.map((d) => d.ref);
      for (let i = 0; i < refs.length; i += 450) {
        const batch = writeBatch(db);
        refs.slice(i, i + 450).forEach((ref) => batch.delete(ref));
        await withTimeout(batch.commit());
      }
      await logAudit({ type: 'stock_ledger_reset', note: 'รีเซ็ตบัตรสต็อกยาทุกตัว — ลบประวัติธุรกรรมทั้งหมด ' + nf(refs.length) + ' รายการ เพื่อเริ่มต้นใช้งานระบบจริง โดย ' + userName() });
      hapticSuccess();
      toast('รีเซ็ตบัตรสต็อกแล้ว — ลบประวัติธุรกรรม ' + nf(refs.length) + ' รายการ ยอดคงเหลือปัจจุบันไม่เปลี่ยนแปลง');
    } catch (e) {
      toastErr(e, 'รีเซ็ตไม่สำเร็จ ลองใหม่อีกครั้ง');
    }
  }), [myProfile, confirmAsync, promptAsync, toast, toastErr, logAudit, userName, guardOnce]);

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
      // Bug-guard: 'count' is logged for BOTH floor counts (loc:'floor', commitCount) and
      // substock counts (loc:'substock', commitSubCount) — without this loc check, a floor
      // count would wrongly appear on this substock ledger the moment 'count' was added to
      // SUBSTOCK_LEDGER_TYPES above (same class of bug the pre-existing 'expired' guard here
      // was already written to prevent, generalized to the new type).
      .filter((x) => SUBSTOCK_LEDGER_TYPES.has(x.type) && (x.type !== 'expired' || x.loc === 'substock') && (x.type !== 'count' || x.loc === 'substock'))
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
    let ok = 0;
    let diffs = 0;
    let failed = 0;
    for (const { medId, q } of entries) {
      const m = state.meds.find((x) => x.id === medId);
      if (!m) continue;
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
        await logTx({ type: 'count', name: m.name, medId: m.id, qty: delta, unit: m.unit, reason: 'นับสต็อกหน้างานประจำรอบ (บันทึกทั้งชุด)', note, loc: 'floor' });
        ok++;
        if (delta !== 0) diffs++;
      } catch (e) { console.error(e); failed++; }
    }
    // A partial failure leaves the rows it couldn't save still filled in on screen (they're
    // only cleared per-med on success above), so retrying is just tapping the button again.
    toast(failed > 0
      ? 'บันทึกแล้ว ' + ok + ' รายการ · ไม่สำเร็จ ' + failed + ' รายการ (ยังค้างอยู่ในหน้าจอ ลองกดบันทึกอีกครั้ง)'
      : 'บันทึกครบ ' + ok + ' รายการ' + (diffs > 0 ? ' · มีส่วนต่าง ' + diffs + ' รายการ (ดูได้ใน Discrepancy log)' : ' · ตรงกับระบบทุกรายการ'));
  }), [state.countInputs, state.meds, logTx, toast, patch, guardOnce]);

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
    if (!m) return;
    try {
      let delta = 0;
      const lotIds = state.lots.filter((l) => l.medId === medId).map((l) => l.id);
      await runTx(async (trx) => {
        const liveLots: { id: string; qty: number; exp: number }[] = [];
        for (const lotId of lotIds) {
          const snap = await trx.get(doc(db, 'lots', lotId));
          const data = snap.data() as { qty?: number; exp?: number } | undefined;
          liveLots.push({ id: lotId, qty: data?.qty ?? 0, exp: data?.exp ?? 0 });
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
      });
      patch((st) => { const ci = { ...st.subCountInputs }; delete ci[medId]; return { subCountInputs: ci }; });
      const note = delta < 0
        ? 'นับได้น้อยกว่าระบบ ' + nf(Math.abs(delta)) + ' ' + m.unit + ' — ตัดออกจาก lot ที่ใกล้หมดอายุที่สุดก่อน'
        : delta > 0 ? 'นับได้มากกว่าระบบ ' + nf(delta) + ' ' + m.unit + ' — ลงเป็น lot ปรับยอด ยังไม่ทราบวันหมดอายุจริง ควรแก้ไขเมื่อทราบ' : 'นับตรงกับระบบ ไม่มีส่วนต่าง';
      await logTx({ type: 'count', name: m.name, medId: m.id, qty: delta, unit: m.unit, reason: 'นับสต็อก substock ประจำรอบ', note, loc: 'substock' });
      toast(m.name + ' — ' + note);
    } catch (e) { toastErr(e, 'บันทึกไม่สำเร็จ ลองใหม่อีกครั้ง'); }
  }), [state.subCountInputs, state.meds, state.lots, logTx, toast, toastErr, patch, guardOnce]);

  /** Batch version of commitSubCount(), mirroring commitAllCounts() — sequential per-med
   * transactions (never one lumped write) for the same reason: each has to re-read its own
   * live lots before computing its delta, and a slow connection should degrade to "slower",
   * not a burst of concurrent transactions contending on the same docs. */
  const commitAllSubCounts = useCallback(guardOnce('subCountAll', async () => {
    const entries = Object.entries(state.subCountInputs)
      .map(([medId, raw]) => ({ medId, q: parseInt(raw, 10) }))
      .filter((e) => !isNaN(e.q));
    if (!entries.length) { toast('ยังไม่ได้กรอกจำนวนที่นับได้สักรายการ'); return; }
    let ok = 0;
    let diffs = 0;
    let failed = 0;
    for (const { medId, q } of entries) {
      const m = state.meds.find((x) => x.id === medId);
      if (!m) continue;
      try {
        let delta = 0;
        const lotIds = state.lots.filter((l) => l.medId === medId).map((l) => l.id);
        await runTx(async (trx) => {
          const liveLots: { id: string; qty: number; exp: number }[] = [];
          for (const lotId of lotIds) {
            const snap = await trx.get(doc(db, 'lots', lotId));
            const data = snap.data() as { qty?: number; exp?: number } | undefined;
            liveLots.push({ id: lotId, qty: data?.qty ?? 0, exp: data?.exp ?? 0 });
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
        });
        patch((st) => { const ci = { ...st.subCountInputs }; delete ci[medId]; return { subCountInputs: ci }; });
        const note = delta < 0
          ? 'นับได้น้อยกว่าระบบ ' + nf(Math.abs(delta)) + ' ' + m.unit + ' — ตัดออกจาก lot ที่ใกล้หมดอายุที่สุดก่อน'
          : delta > 0 ? 'นับได้มากกว่าระบบ ' + nf(delta) + ' ' + m.unit + ' — ลงเป็น lot ปรับยอด ยังไม่ทราบวันหมดอายุจริง ควรแก้ไขเมื่อทราบ' : 'นับตรงกับระบบ ไม่มีส่วนต่าง';
        await logTx({ type: 'count', name: m.name, medId: m.id, qty: delta, unit: m.unit, reason: 'นับสต็อก substock ประจำรอบ (บันทึกทั้งชุด)', note, loc: 'substock' });
        ok++;
        if (delta !== 0) diffs++;
      } catch (e) { console.error(e); failed++; }
    }
    toast(failed > 0
      ? 'บันทึกแล้ว ' + ok + ' รายการ · ไม่สำเร็จ ' + failed + ' รายการ (ยังค้างอยู่ในหน้าจอ ลองกดบันทึกอีกครั้ง)'
      : 'บันทึกครบ ' + ok + ' รายการ' + (diffs > 0 ? ' · มีส่วนต่าง ' + diffs + ' รายการ (ดูได้ใน Discrepancy log)' : ' · ตรงกับระบบทุกรายการ'));
  }), [state.subCountInputs, state.meds, state.lots, logTx, toast, patch, guardOnce]);

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
    patch({ hosxpRows: rows, hosxpConfirmFuzzy: false, hosxpConfirmSingleDay: false });
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
      patch({ hosxpRows: rows, hosxpConfirmFuzzy: false, hosxpConfirmSingleDay: false, hosxpText: '' });
      toast('อ่านไฟล์ ' + file.name + ' แล้ว ' + rows.length + ' รายการ — ตรวจสอบรายการด้านล่างก่อนตัดยอด');
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
    let applied = 0, skipped = 0, zeroQty = 0;
    const skippedNames: string[] = [];
    try {
      for (const r of rows) {
        if (r.qty <= 0) { zeroQty++; continue; }
        // Only 'exact' and 'fuzzy' (human-confirmed above) resolve to a single med — 'ambiguous'
        // and 'none' never touch stock, so a bad name in the source file can't silently
        // deduct from the wrong drug or get dropped without anyone noticing.
        const medId = r.match.kind === 'exact' || r.match.kind === 'fuzzy' ? r.match.medId : null;
        const m = medId ? meds.find((x) => x.id === medId) : null;
        if (!m) { skipped++; skippedNames.push(r.name); continue; }
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
  }), [state.hosxpRows, state.hosxpConfirmFuzzy, state.hosxpConfirmSingleDay, state.meds, logTx, logAudit, toast, toastErr, patch, guardOnce]);

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
        // Bug fix (speed): เติมหน้างาน needs no form per item — bump() already adds the full
        // suggested quantity in one shot — so closing the scanner after every single scan was
        // pure friction: walk the shelf, scan low drug, camera closes, tap ▣ again, scan next,
        // repeat. Now it stays open so a whole round of restocking scans in one continuous
        // pass; ✕ (or tapping the backdrop) exits to review the cart when done.
        // Bug fix: guard against the same label lingering in frame re-triggering bump() and
        // silently stacking another step on top of the cart entry it just set — see
        // lastScanBump's doc comment above. 4s comfortably covers "still holding the phone on
        // this label", short enough that a genuine rescan later (moved on, came back) is
        // never blocked.
        const now = Date.now();
        const isRepeat = lastScanBump.current?.medId === med.id && now - lastScanBump.current.ts < 4000;
        lastScanBump.current = { medId: med.id, ts: now };
        if (!isRepeat) { bump(med.id, 1); hapticSuccess(); }
        toast(isRepeat ? med.name + ' — เพิ่มไปแล้ว ขยับกล้องไปยาตัวต่อไปได้เลย' : 'สแกนพบ ' + med.name + ' — เพิ่มเข้าตะกร้าแล้ว · สแกนตัวต่อไปได้เลย');
        patch({ qrCode: '', qrManualOpen: false, qrManualReason: '' });
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
    // Bug fix: this used to decide "first-time approval" vs "re-enable after being disabled"
    // with `u.active === false && u.createdAt` — but `u.active` here is always false in this
    // branch already (next=true means it was false), and every user has a createdAt, so that
    // check was tautologically always true. A previously-active account that got disabled and
    // is now being turned back on always logged/toasted as "อนุมัติบัญชี" (approved), which is
    // misleading for someone who was never a pending new registration. `lastLogin` actually
    // distinguishes the two cases: a never-logged-in account is a genuine first approval; one
    // that has logged in before is being reinstated, not approved for the first time.
    const isFirstApproval = next && !u.lastLogin;
    try {
      await updateDoc(doc(db, 'users', id), { active: next });
      logAudit({ type: isFirstApproval ? 'user_approved' : 'user_status_changed', note: (next ? (isFirstApproval ? 'อนุมัติบัญชี ' : 'เปิดใช้งานบัญชี ') : 'ปิดใช้งานบัญชี ') + u.name });
      toast((next ? 'เปิดใช้งาน' : 'ปิดใช้งาน') + 'บัญชี ' + u.name + ' แล้ว');
    } catch (e) { console.error(e); toast('เปลี่ยนสถานะไม่สำเร็จ'); }
  }, [state.users, state.myUid, logAudit, toast, confirmAsync]);

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
          .map((d) => d.data() as { type: string; by: string; ts: number; name?: string; note?: string; qty?: number; unit?: string; loc?: string })
          .map((x) => ({ type: x.type, by: x.by, ts: x.ts, loc: x.loc, note: (x.name ? x.name + ' — ' : '') + (x.note || '') + (x.qty != null ? ' (' + (x.qty > 0 ? '+' : '') + x.qty + ' ' + (x.unit || '') + ')' : '') })),
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
    state, myProfile, theme, toggleTheme, sub, fefo, userName, roleLabel, roleLabelOf, warn, toast, respondConfirm, promptAsync, respondPrompt, applyUpdate, dismissUpdate,
    notifyEnabled, notifyPermission, enableExpiryNotify, disableExpiryNotify,
    lowStockNotifyEnabled, enableLowStockNotify, disableLowStockNotify, go, back,
    setAuthMode, setAuthUsername, setAuthPassword, setAuthName, setAuthDept, setAuthRemember, signIn, signUp, logout, setDevice, seedDatabase,
    setSearch, setFilter, setWardFilter, bump, setCartQty, fillAll, fillUrgent, printPickList, printTodayReplenishList, printUrgentReplenishList, removeFromCart, clearCart, commitTransfer,
    setRecvNo, setRecvSearch, pickRecvMed, setRecvLot, setRecvExp, setRecvQty, addRecv, removeRecvItem, commitReceive, printWarehouseRequestList,
    approvePendingReceive, rejectPendingReceive, goReceiveFor,
    setWmFromSearch, pickWmFromMed, setWmToSearch, pickWmToMed, setWmQty, setWmReason, commitWardMove,
    pickAdjType, setAdjSearch, pickAdjMed, setAdjQty, setAdjReason, setAdjNote, commitAdjust, scrapLot,
    setReportTab, exportReportCsv, exportAllReports,
    setLabelType, setLocScope, setLabelWardScope, toggleLabelSelected, selectAllLabels, clearLabelSelected, printLabels,
    applyOnePar, applyAllSuggested, setParSub, setParFloor, setMedBin, recomputeUsageStats, updateGlobalSettings,
    addMed, updateMedFull, mergeWardMeds, mergeAllWardPairs, shareAllMeds, autoCategorizeAll, toggleMedActive, deleteMed, deleteAllInactiveMeds, resetAllStockLedgers, setMedsFocusId,
    goSubstockCardFor, setSubstockFocusId,
    fetchSubstockLedger, setCountInput, commitCount, commitAllCounts, setSubCountInput, commitSubCount, commitAllSubCounts,
    setHosxpText, processHosxp, processHosxpFile, setHosxpConfirmFuzzy, setHosxpConfirmSingleDay, commitReconcile,
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
