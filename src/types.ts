export type Role = 'pharm' | 'tech' | 'admin';

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
  parFloor: number;
  floor: number;
  bin: string;
  used30: number;
  usedPrev30: number;
  volatility: number;
  lastCountTs: number;
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
  | 'transfer_to_floor' | 'receive_from_central' | 'receive_pending';

export interface Tx {
  id: string;
  type: TxType;
  name: string;
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

export type Screen =
  | 'login' | 'home' | 'transfer' | 'tconfirm' | 'done' | 'receive' | 'adjust'
  | 'report' | 'labels' | 'settings' | 'more' | 'count' | 'reconcile' | 'admin' | 'meds';

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

  screen: Screen;
  prevScreen: Screen;
  role: Role | null;
  online: boolean;
  device: 'phone' | 'tablet';
  pending: number;

  cart: Record<string, number>;
  search: string;
  filter: TransferFilter;

  recvNo: string;
  recvSearch: string;
  recvMed: string | null;
  recvLot: string;
  recvExp: string;
  recvQty: string;
  recvItems: RecvItem[];

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
  doneRows: { name: string; sub: string; qty: string }[];
  toast: string | null;

  countInputs: Record<string, string>;
  hosxpText: string;
  hosxpRows: { name: string; qty: number; match: HosxpMatch }[] | null;
  hosxpConfirmFuzzy: boolean;

  adminTab: AdminTab;
  auditFilter: AuditFilter;

  expiryWarnDays: number;
  parFloorCoverDays: number;
  parSubCoverDays: number;
}
