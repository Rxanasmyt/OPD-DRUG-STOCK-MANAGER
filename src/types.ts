export type Role = 'pharm' | 'tech' | 'admin';

export type Ward = 'opd' | 'ipd';

export interface Med {
  id: string;
  code: string;
  name: string;
  unit: string;
  dosageForm: string;
  price: number;
  had: boolean;
  active: boolean; // false = not carried by this hospital (from CSV "ไม่มียาในรพ.กรงปินัง" notes)
  parSub: number;
  parFloor: number; // shelf capacity target — "Max": เติมขึ้นไปถึงจุดนี้
  floor: number;
  // Optional — missing on every med added before Min-Max existed; falls back to a fraction
  // of parFloor via floorMinOf() in selectors.ts. "Min": ต่ำกว่าจุดนี้ถือว่าต้องเติมด่วน
  // (separate from parFloor/"Max" since ต่ำกว่า par หน้างาน ≠ ถึงเวลาต้องเติมจริง ๆ — real
  // min-max par has the two as different numbers, not one target doing both jobs).
  floorMin?: number;
  bin: string;
  used30: number;
  usedPrev30: number;
  volatility: number;
  lastCountTs: number;
  // Optional — missing on every med seeded before wards existed. Never read `.ward`/
  // `.noSubstock` directly; always go through `wardOf()`/`usesSubstock()` in selectors.ts so
  // old docs default correctly (opd / has substock) without a one-time migration write.
  ward?: Ward;
  // ยาน้ำ/ยาพ่นบางตัวไม่มีขั้น substock เลย — เบิกจากคลังใหญ่มาลงชั้นวางหน้างานตรง ๆ. Toggled
  // per med (see MedsScreen), not a whole drug-class rule, since it varies item by item.
  noSubstock?: boolean;
  // `shared: true` = OPD and IPD draw on the SAME physical pool for this drug (the real
  // workflow for most one-day-dose meds: IPD pulls straight off the OPD shelf) — one
  // floor/par/lots/used30 serves both, and it shows up under both ward tabs. Set either by
  // mergeWardMeds()/mergeAllWardPairs() (folding a still-separate OPD+IPD pair into one
  // record) or in bulk by shareAllMeds() — for a formulary that never had separate IPD
  // records to begin with, there's nothing to fold in, just this flag to flip. `binIpd`, if
  // set, is a distinct IPD-side shelf code; left unset, `binFor()` in selectors.ts shows the
  // same one `bin` for both wards, which is exactly right when there's only ever been one
  // shelf. A med WITHOUT `shared` (kept on genuinely separate locked/ward-specific stock,
  // e.g. IPD's injectable cabinet — see WardMoveScreen) is unaffected: still one `ward`, one
  // `bin`, business as usual. Always go through isSharedMed()/matchesWard()/binFor() in
  // selectors.ts rather than reading `shared`/`binIpd` directly.
  shared?: boolean;
  binIpd?: string;
}

export interface Lot {
  id: string;
  code: string;
  medId: string;
  lotNo: string;
  exp: number;
  qty: number;
  loc: string;
}

export type TxType =
  | 'adjust' | 'return' | 'damaged' | 'expired' | 'count' | 'reconcile_hosxp'
  | 'transfer_to_floor' | 'receive_from_central' | 'receive_pending'
  | 'ward_move_out' | 'ward_move_in';

export interface Tx {
  id: string;
  type: TxType;
  name: string;
  // Optional because every tx logged before this field existed has none — always fall back
  // to matching by `name` for those. Added because `name` alone stopped being a unique
  // pointer back to one Med the moment the OPD/IPD ward split let two Med records share a
  // name (see wardOf/Ward) — anything that needs "which exact drug record was this?" (the
  // substock card ledger, a future audit drill-down) should prefer medId when present.
  medId?: string;
  qty: number;
  unit: string;
  by: string;
  ts: number;
  reason?: string;
  note?: string;
  loc?: 'floor' | 'substock';
  from?: string;
  to?: string;
}

export interface User {
  id: string; // Firebase Auth uid
  username: string; // lowercase, unique — login identifier (mapped to a synthetic email under the hood)
  name: string;
  role: Role;
  dept: string;
  active: boolean; // false = pending admin approval, or deactivated
  createdAt: number;
  lastLogin: number | null;
}

export type AuthStatus = 'loading' | 'signedOut' | 'pendingApproval' | 'signedIn';
export type AuthMode = 'login' | 'register';

export type AuditType =
  | 'login' | 'user_registered' | 'user_approved' | 'user_role_changed' | 'user_status_changed' | 'par_updated'
  | 'receive_rejected'
  // Formulary management (see MedsScreen/AppContext.tsx addMed/updateMedFull/toggleMedActive/
  // deleteMed) and the manual-QR-entry fallback (qrDecodedImpl) — both log via the same
  // logAudit() as everything else above, but were missing from this union even though
  // AdminScreen's TYPE_LABEL already had display labels for all of them.
  | 'med_added' | 'med_edited' | 'med_status_changed' | 'med_deleted' | 'qr_manual'
  | TxType;

export interface AuditEntry {
  id: string;
  type: AuditType;
  by: string;
  ts: number;
  note: string;
}

export interface RecvItem {
  medId: string;
  name: string;
  unit: string;
  lotNo: string;
  exp: number;
  qty: number;
}

/** A receive submitted by a ผู้ช่วยเภสัชกร (tech) — doesn't touch stock until a pharmacist/
 * admin approves it. Lives in its own collection (not just an audit-log line) so there's
 * something structured enough to actually approve: the real medId/lot/exp/qty needed to
 * create the lot once approved, not just a human-readable note. */
export interface PendingReceive {
  id: string;
  recvNo: string;
  medId: string;
  name: string;
  unit: string;
  lotNo: string;
  exp: number;
  qty: number;
  requestedBy: string;
  requestedByUid: string;
  ts: number;
  status: 'pending' | 'approved' | 'rejected';
  resolvedBy?: string;
  resolvedTs?: number;
  rejectReason?: string;
}

export type Screen =
  | 'login' | 'home' | 'transfer' | 'tconfirm' | 'done' | 'receive' | 'adjust'
  | 'report' | 'labels' | 'settings' | 'more' | 'count' | 'reconcile' | 'admin' | 'meds' | 'wardmove' | 'substockcard';

export type AdjType = 'adjust' | 'return' | 'damaged' | 'expired';
export type ReportTab = 'aging' | 'turn' | 'disc';
export type LabelType = 'med' | 'lot' | 'loc';

/** How a HOSxP file's drug name resolved against the formulary — see matchHosxpMed().
 * 'exact' commits freely; 'fuzzy' (substring match) needs an explicit human confirmation
 * before it's allowed to touch stock, since e.g. "Amoxicillin 250" can substring-match
 * "Amoxicillin 500"; 'ambiguous' (matched more than one drug) and 'none' never auto-commit. */
export type HosxpMatch =
  | { kind: 'exact'; medId: string }
  | { kind: 'fuzzy'; medId: string }
  | { kind: 'ambiguous'; candidateIds: string[] }
  | { kind: 'none' };

export type AdminTab = 'users' | 'audit';
export type AuditFilter = 'all' | 'users' | 'stock';
export type TransferFilter = 'low' | 'all' | 'had';

export interface AppState {
  meds: Med[];
  lots: Lot[];
  txs: Tx[];
  users: User[];
  authLog: AuditEntry[];
  dbReady: boolean; // false until the first Firestore snapshot for meds arrives

  authStatus: AuthStatus;
  authMode: AuthMode;
  myUid: string | null;
  authUsername: string;
  authPassword: string;
  authName: string;
  authDept: string;
  authError: string | null;
  authBusy: boolean;
  authRemember: boolean;

  screen: Screen;
  // Real back-navigation history, not just a single "came from" pointer — see go()/back() in
  // AppContext.tsx. A single prevScreen field (the old design) only ever remembers one level,
  // so a two-deep chain (More → ตั้งค่า → จัดการรายการยา) had no correct "back" target once you
  // left the immediately-previous screen: pressing back from จัดการรายการยา landed back on
  // ตั้งค่า correctly, but pressing back again from there had already lost where *it* came
  // from and fell back to a hardcoded 'more', which happened to be right only by coincidence
  // for screens that are always opened from the More menu, and wrong for anything opened from
  // elsewhere (Home's "ตัดออก" button into ปรับยอด, Done's "ดูบัตรสต็อก" into บัตรสต็อก substock).
  navStack: Screen[];
  role: Role | null;
  online: boolean;
  device: 'phone' | 'tablet';
  pending: number;

  cart: Record<string, number>;
  search: string;
  filter: TransferFilter;
  wardFilter: 'all' | Ward;

  wmFromSearch: string;
  wmFromMed: string | null;
  wmToSearch: string;
  wmToMed: string | null;
  wmQty: string;
  wmReason: string;

  recvNo: string;
  recvSearch: string;
  recvMed: string | null;
  recvLot: string;
  recvExp: string;
  recvQty: string;
  recvItems: RecvItem[];
  pendingReceives: PendingReceive[];

  adjType: AdjType | null;
  adjSearch: string;
  adjMed: string | null;
  adjQty: string;
  adjReason: string;
  adjNote: string;

  reportTab: ReportTab;
  labelType: LabelType;

  qrOpen: boolean;
  qrManualOpen: boolean;
  qrCode: string;
  qrManualReason: string;
  qrPurpose: string | null;
  hadOk: Record<string, boolean>;

  doneKind: 'transfer' | 'receive' | 'recvPending' | null;
  // medId is optional — a done row always has one going forward, but keeping it optional
  // avoids a false sense that every historical code path is guaranteed to set it.
  doneRows: { name: string; sub: string; qty: string; medId?: string }[];
  toast: string | null;

  countInputs: Record<string, string>;
  hosxpText: string;
  hosxpRows: { name: string; qty: number; match: HosxpMatch }[] | null;
  hosxpConfirmFuzzy: boolean;

  // Import usage totals from a file (a real HOSxP "รายงานการใช้ยา" export, .xls/.xlsx, or a
  // plain "ชื่อยา,จำนวน" CSV) to seed used30 — see suggestPar()/importUsageFile() in
  // AppContext.tsx. Deliberately its own state, separate from the hosxp* fields above: this
  // only ever touches used30 (a par-suggestion input), never floor/substock quantities, so it
  // can't accidentally deduct real stock the way a half-finished HOSxP reconcile could.
  // Date range instead of a fixed month/quarter/year preset — a real fiscal-year-to-date
  // export (e.g. 1 ต.ค.–31 ส.ค., 11 months into a fiscal year that isn't over yet) never lines
  // up with a clean 30/90/365-day bucket, so the person names the actual dates the file
  // covers and the day count is computed from those (see USAGE_PERIOD_DAYS's replacement).
  usageDateFrom: string;
  usageDateTo: string;
  usageFileName: string | null;
  usageRows: { name: string; qty: number; match: HosxpMatch }[] | null;
  usageConfirmFuzzy: boolean;

  medsFocusId: string | null;
  substockFocusId: string | null;

  adminTab: AdminTab;
  auditFilter: AuditFilter;
  historyFrom: string;
  historyTo: string;
  historyResults: { type: string; by: string; ts: number; note: string }[] | null;
  historyLoading: boolean;

  expiryWarnDays: number;
  parFloorCoverDays: number;
  parSubCoverDays: number;
}
