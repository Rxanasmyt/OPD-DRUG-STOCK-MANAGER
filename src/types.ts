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
  // Real-world request: "เพิ่มประเภทยาตู้เย็น" — needs refrigerated storage. Deliberately its own
  // boolean flag, NOT another entry in DRUG_CATEGORIES (data/categories.ts) — cold-chain storage
  // is a cross-cutting handling requirement any drug can carry regardless of its therapeutic
  // group (insulin under "เบาหวาน", a vaccine under "ฉุกเฉิน", an injectable antibiotic under
  // "ต้านจุลชีพ" can all need a fridge at once), same reasoning as `had` (high-alert) being its
  // own flag rather than a category. Optional — every med added before this feature existed has
  // none, defaults falsy everywhere (never carried a fridge requirement) rather than needing a
  // migration write.
  fridge?: boolean;
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
  // Optional in truth even though every current write path (addMed, seed.ts) sets it — a
  // hand-edited Firestore doc or a future import path could still omit it, and CountScreen
  // used to divide against it unconditionally (Date.now() - undefined = NaN, rendered
  // literally as "นับล่าสุด NaN วันก่อน"). Marked optional so that gap can't silently reopen.
  lastCountTs?: number;
  // Same idea as lastCountTs but for a substock cycle count (see commitSubCount in
  // AppContext.tsx) — kept as its own field rather than reusing lastCountTs because floor and
  // substock are counted independently (different screens, different staleness clocks); folding
  // them into one timestamp would make a fresh floor count wrongly read as "substock just
  // verified" too, or vice versa.
  lastSubCountTs?: number;
  // Optional — missing on every med seeded before wards existed. Never read `.ward`/
  // `.noSubstock` directly; always go through `wardOf()`/`usesSubstock()` in selectors.ts so
  // old docs default correctly (opd / has substock) without a one-time migration write.
  ward?: Ward;
  // ยาน้ำ/ยาพ่นบางตัวไม่มีขั้น substock เลย — เบิกจากคลังใหญ่มาลงชั้นวางหน้างานตรง ๆ. Toggled
  // per med (see MedsScreen), not a whole drug-class rule, since it varies item by item.
  noSubstock?: boolean;
  // จำนวนหน่วยต่อกล่อง/แพ็ค สำหรับยาที่ต้องเบิกเป็นกล่องเท่านั้น (เบิกเข้า substock จากคลังใหญ่,
  // หรือเติมยาหน้างานจาก substock) — เมื่อตั้งค่านี้ไว้ จำนวนที่ระบบแนะนำ/บวกลบทีละขั้นจะปัดขึ้นให้
  // ลงตัวเป็นกล่องเสมอ (ดู packStep()/suggestTransferQty() ใน selectors.ts) แทนขั้นทั่วไปแบบ
  // 1/10/100 ตามขนาดตัวเลข. Optional — ยาส่วนใหญ่เบิกเป็นเม็ด/ชิ้นเดี่ยว ไม่มีขนาดกล่องบังคับ.
  packSize?: number;
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
  // Substock's own shelf/rack code — the back-room counterpart to bin/binIpd (which are both
  // FLOOR codes). Its own field rather than reusing bin: floor and substock are two separate
  // physical rooms with their own independent code grid (see SUB_LOCS in data/locations.ts),
  // and a med's substock rack position has no reason to match, or even exist alongside, its
  // floor shelf spot. Optional — unset for every med until someone assigns a real substock
  // location via MedsScreen, and meaningless for a noSubstock med (no back-room stock at all).
  binSub?: string;
  // Therapeutic group id — see src/data/categories.ts for the fixed list this must be one of
  // (or absent). Optional because every med added before this feature existed has none; always
  // read via categoryOf() in selectors.ts so those fall back to the same "ยังไม่ระบุหมวด" bucket
  // instead of being invisible in a category-grouped/filtered view.
  category?: string;
  // Real-world request: "บริษัทยาไม่มาส่งยา ล่าช้า หรือเลิกผลิต อยู่ระหว่างสั่งยาบริษัทอื่น คลังปิด
  // ช่วงปลาย/ต้นปีงบประมาณ" — a med's supply chain can break temporarily for reasons that have
  // nothing to do with this pharmacy's own stock-management, where nothing substock/floor can
  // do (no requisition, no transfer) will actually get it back on the shelf until supply itself
  // resumes. Presence of `outOfStockSince` IS the live "is this held right now" state — never
  // read it directly, go through isOnStockHold() in selectors.ts. Kept as plain fields on Med
  // (not a separate collection) for the same reason lastCountTs/lastSubCountTs are: one more
  // flag colocated with everything else about the drug, no second listener/join needed to know
  // a med's current hold state anywhere it's checked. The actual incident HISTORY (who started
  // it, why, when it ended, how long it lasted) lives in the existing auditLog collection via
  // 'stock_hold_started'/'stock_hold_ended' entries — already a full, searchable, permanent
  // record (see AdminScreen's ประวัติ tab), so no second history mechanism was built just for
  // this.
  outOfStockSince?: number;
  outOfStockReason?: string;
  // Optional — when known (e.g. "บริษัทแจ้งว่าจะส่งได้สัปดาห์หน้า"), shown alongside the reason
  // so staff know whether to expect this soon or to actively go find a substitute now.
  outOfStockExpectedReturn?: number;
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
  // Logged once per commitReconcile() run that skipped ambiguous/unmatched HOSxP rows — see
  // its doc comment in AppContext.tsx and ReconcileScreen's "ยาที่หลุดบ่อย" panel, which
  // aggregates these across recent runs so a name that keeps failing to match stays visible
  // instead of being a fresh, easy-to-miss surprise every single day.
  | 'hosxp_unmatched'
  // Logged once by resetAllStockLedgers() (AppContext.tsx) — the admin-only, typed-confirmation
  // "start the system over" action that permanently deletes every tx document (the substock
  // card ledger, report/turnover stats, usage-rate history for par suggestions) without
  // touching current floor/lot quantities. Its own audit entry survives that deletion (it's
  // logged to the separate auditLog collection, not txs) — the one durable record that this
  // ever happened, and by whom.
  | 'stock_ledger_reset'
  // Logged once by resetAllQuantities() (AppContext.tsx) — same go-live-reset shape as
  // stock_ledger_reset above, but the opposite half of the data: zeroes every med's `floor`
  // and deletes every `lots` document (so substock, which is only ever the sum of lot.qty,
  // goes to 0 too), without touching a med's name/code/par/bin/price/etc. Used when the
  // deployed quantities are still sample data and the drug list itself is already real.
  | 'quantity_reset'
  // Logged by startStockHold()/endStockHold() (AppContext.tsx, MedsScreen's "ยาขาดชั่วคราว"
  // toggle) — the full permanent history of every temporary-stockout incident (who flagged it,
  // why, when it ended, how long it lasted), since the live state on Med.outOfStockSince only
  // ever holds the CURRENT incident, if any. See Med.outOfStockSince's own doc comment.
  | 'stock_hold_started' | 'stock_hold_ended'
  // Logged by scripts/check-stock-drift.mjs — the automated daily GitHub Actions job that
  // compares every active med's live floor/substock against what the tx log actually accounts
  // for since its last run (see that script's own header comment). Never written by the app
  // itself (no in-app action produces this), so it never needs an entry in the FLOOR_LEDGER_
  // TYPES/SUBSTOCK_LEDGER_TYPES tx classification — it's a report ABOUT the ledger, not a
  // transaction against it.
  | 'stock_drift_detected'
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
export type ReportTab = 'aging' | 'turn' | 'disc' | 'insights' | 'category' | 'exec' | 'kpi' | 'usage' | 'stockasof';

/**
 * One durable, append-only record of a drug's REAL total qty/value for one usage-import
 * period — written alongside Med.used30 every time commitUsageImport (AppContext.tsx) commits
 * a HOSxP usage file, but never overwritten by a later import the way used30 is. Real-world
 * request: "เก็บสถิติการใช้ยาแต่ละวัน...รายงานประจำไตรมาส/เดือน/ปีงบประมาณ...Top 100" — used30 alone
 * has no memory of any period before the most recent import, so there was no way to look back
 * at what a drug actually used last quarter/month/fiscal-year once a newer import ran. This
 * collection is that memory: one doc per (med, import period), queryable by date range.
 *
 * Important limitation: the source HOSxP file has no per-dispense date column at all — just one
 * qty total for the whole period the pharmacist declares (see usageDateFrom/usageDateTo). So
 * `monthKey` below tags a record by its period's START month only; a period spanning more than
 * one calendar month (e.g. a whole quarter imported in one file) is NOT prorated across the
 * months it covers — it's counted wholly under its start month. Monthly-trend charts should be
 * read with that in mind. True day-of-week usage patterns are not derivable from this import
 * flow at all (no per-dispense date exists in the source file to begin with).
 */
export interface UsageHistoryRecord {
  medId: string;
  medName: string; // snapshot at import time — survives a later rename/deactivation of the med
  unit: string; // m.unit snapshot — a bare qty number means nothing without it (เม็ด vs ขวด vs ml)
  category: string; // categoryOf(m) snapshot at import time — a DRUG_CATEGORIES id (see data/categories.ts)
  qty: number; // the REAL total dispensed during periodFrom–periodTo (NOT used30's 30-day-normalized rate)
  value: number; // qty * m.price, snapshot at import time
  periodFrom: string; // ISO YYYY-MM-DD, inclusive
  periodTo: string; // ISO YYYY-MM-DD, inclusive
  periodDays: number;
  importedAt: number; // ms epoch, when this record was committed
  monthKey: string; // periodFrom's 'YYYY-MM' — see the limitation note above
}

/**
 * One durable record of a par change applied from suggestPar (applyOnePar/applyAllSuggested,
 * AppContext.tsx) — "ติดตามผลหลังปรับ par ว่านิ่งจริงไหม". `logAudit`'s 'par_updated' entries
 * already existed but are free-text notes, not structured per-med before/after numbers, so
 * there was no way to later ask "did THIS specific change actually calm down, or is this drug
 * still swinging?". Written once per med per apply — never updated/deleted, same append-only
 * shape as usageHistory/txs. See parAdjustmentOutcomes() (selectors.ts) for how this gets
 * turned into a "ยังผันผวนอยู่ / นิ่งดีแล้ว" verdict.
 */
export interface ParAdjustmentRecord {
  medId: string;
  medName: string; // snapshot at adjust time
  category: string; // categoryOf(m) snapshot at adjust time
  beforeFloor: number;
  beforeSub: number;
  afterFloor: number;
  afterSub: number;
  // The usage numbers suggestPar's recommendation was BASED ON — kept so a later reviewer can
  // see exactly what data justified this change, not just the before/after par numbers alone.
  used30AtAdjust: number;
  usedPrev30AtAdjust: number;
  adjustedAt: number; // ms epoch
  adjustedBy: string; // userName() at adjust time
}

/**
 * One day's automated KPI snapshot — written once/day by scripts/collect-daily-metrics.mjs
 * (a GitHub Actions cron job, same free-tier "GitHub Actions IS the server" pattern already
 * used by backup-firestore.mjs/notify-low-stock.mjs, see those files' own doc comments for
 * why this static site has no server of its own to run a schedule on). Doc id is the date
 * itself (YYYY-MM-DD, Asia/Bangkok) so a range query is just `where(documentId(), '>=', from)`.
 * Real-world request: track stock value/qty, dispensing rate, data accuracy, and staff
 * activity over any custom date range, not just "right now" — Firestore only ever holds
 * CURRENT meds/lots state, so a real trend needs each day's numbers captured as they were,
 * not re-derived from today's data. Never written by the client (firestore.rules denies client
 * writes to this collection outright) — only ever by the cron script's service-account
 * credentials, which bypass rules entirely.
 */
export interface DailyMetrics {
  date: string; // YYYY-MM-DD, also the doc id
  generatedAt: number;
  // ---- คงคลัง (end-of-day snapshot) ----
  activeMedCount: number;
  totalFloorQty: number;
  totalSubQty: number;
  totalStockValue: number;
  lowStockCount: number;
  urgentLowCount: number;
  nearExpiryValue: number;
  expiredValue: number;
  // ---- อัตราการจ่าย/เบิก (that day's transaction activity) ----
  receivedQty: number;
  receivedCount: number;
  transferredQty: number;
  dispensedQty: number;
  adjustQty: number;
  txCount: number;
  // Real-world request: how long a เบิก (tech-submitted, needs pharm/admin approval — see
  // commitReceive's `!approve` branch) actually sat waiting before the stock it asked for was
  // created. Only ever real for that specific flow — a pharm/admin's own receive is approved
  // instantly (approve === true), so it never enters pendingReceives at all and has no wait to
  // measure. `receiveApprovedCount` is the sample size behind the average — 0 approvals that
  // day means `receiveLeadTimeAvgHours` is null (nothing to average), not a misleading 0.
  receiveLeadTimeAvgHours: number | null;
  receiveApprovedCount: number;
  // Current backlog (as of script run time, not "that day") — how many เบิก requests are still
  // sitting unapproved right now. Same "as of run time" caveat as the คงคลัง section above.
  receivePendingBacklog: number;
  // ---- ความแม่นยำข้อมูล ----
  parErrorCount: number;
  parReviewCount: number;
  countDiscrepancyCount: number;
  hosxpUnmatchedCount: number;
  reconciledToday: boolean;
  // ---- กิจกรรมผู้ใช้งาน ----
  activeUserCount: number;
  txByUser: Record<string, number>;
  // Real-world request: "อัตราขาดสต็อกจริง" — distinct from lowStockCount/urgentLowCount above
  // (which flag "below its own reorder point", a warning) — this counts a med that is
  // GENUINELY OUT (floor === 0) while it's actually in real use (used30 > 0), the case that
  // means a patient could show up needing it and find none. `usedMedCount` is the denominator
  // (active meds with any real usage) so any date-range aggregation can recompute the true rate
  // (stockoutCount / usedMedCount) instead of averaging a stored percentage, which would be
  // wrong the moment the denominator itself changes day to day.
  stockoutCount: number;
  usedMedCount: number;
  // Real-world request: "เตือนเมื่อขาดสต็อกจริงซ้ำๆ" — stockoutCount above is just a same-day
  // headcount with no memory of WHICH drug or whether it keeps happening to the same one.
  // Added alongside it (collect-daily-metrics.mjs) so a client-side report can count how many
  // of the last N days a given medId shows up here — a drug appearing on several different
  // days' lists is a real recurring-shortage signal, not one unlucky day. Optional: any
  // dailyMetrics doc written before this field existed simply has none (treated as `[]`, never
  // backfilled — same "forward-only" rollout as every other field added to this interface after
  // go-live).
  stockoutMedIds?: string[];
}
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
export type TransferFilter = 'low' | 'all' | 'had' | 'urgent' | 'fridge';

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
  /** True for a beat right after coming back online, while queued offline writes are still
   * being flushed to Firestore — see AppContext.tsx's network-status effect. Lets the offline
   * banner say "กำลังซิงค์..." instead of just flipping silently back to "ออนไลน์" with no
   * signal that it's actually safe to close the app now. */
  syncing: boolean;
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
  // Which shelf-code namespace the "ฉลากชั้นวาง" tab is printing/previewing — floor (LOCS,
  // the original), substock (SUB_LOCS, its own separate room/grid — see Med.binSub), or
  // fridge (FRIDGE_LOCS — the pharmacy's own cold-chain storage, see data/locations.ts). Kept
  // as state (not a local component var) because printLabels() in AppContext.tsx needs it
  // too, same reason labelType itself is state and not local to LabelsScreen.
  locScope: 'floor' | 'sub' | 'fridge';
  // Which physical shelf side the "ฉลากตัวยา" tab prints — 'all' (the original: a shared med
  // prints BOTH its OPD and IPD shelf-strip labels in the same batch) or scoped to just one
  // ward's labels. Real need: someone restocking only the OPD shelf run shouldn't have to sort
  // a mixed OPD+IPD sticker sheet by hand first. Kept as state for the same reason locScope is
  // — printLabels() in AppContext.tsx needs it too.
  labelWardScope: 'all' | Ward;
  // Which meds are checked in the label picker (see LabelsScreen.tsx) — a Record, not a Set,
  // to match every other multi-select flag map in this state (hadOk, countInputs, ...), all
  // chosen for the same reason: it patches/spreads cleanly through the plain-object state
  // updates this app uses everywhere, where a Set would need its own clone-on-write handling.
  // EMPTY means "nothing hand-picked" — printLabels()/the on-screen preview both read that as
  // "print/preview everything active", not "print nothing", so leaving this alone never
  // silently narrows what a fresh visit to the screen prints.
  labelSelected: Record<string, boolean>;

  qrOpen: boolean;
  qrManualOpen: boolean;
  qrCode: string;
  qrManualReason: string;
  qrPurpose: string | null;
  /** Set right after a successful เติมหน้างาน (transfer) scan — the camera closes and
   * ScanConfirmSheet shows this one med's cart quantity for explicit review/confirm before
   * either scanning the next item or returning to the list. Real-world request: the previous
   * "camera stays open, silently keeps adding" flow left genuine doubt about whether an item
   * had actually been added, and what quantity landed — see qrDecodedImpl's transfer branch. */
  scanConfirmMedId: string | null;
  hadOk: Record<string, boolean>;

  doneKind: 'transfer' | 'receive' | 'recvPending' | null;
  // medId is optional — a done row always has one going forward, but keeping it optional
  // avoids a false sense that every historical code path is guaranteed to set it.
  doneRows: { name: string; sub: string; qty: string; medId?: string }[];
  toast: string | null;

  countInputs: Record<string, string>;
  // Substock's counterpart to countInputs — kept as a separate map (not a `loc` flag reusing
  // the same one) so switching the count screen's location toggle back and forth never loses
  // whichever set of numbers someone already typed for the other location.
  subCountInputs: Record<string, string>;
  hosxpText: string;
  hosxpRows: { name: string; qty: number; match: HosxpMatch }[] | null;
  hosxpConfirmFuzzy: boolean;
  // Required confirmation gate before committing a daily reconcile — same shape as
  // hosxpConfirmFuzzy above, for a different risk: this screen assumes the file/pasted text
  // covers exactly one day (see its own on-screen warning), but nothing actually stops someone
  // from feeding it a multi-day export by mistake, which would silently over-deduct the floor.
  // See commitReconcile()/ReconcileScreen.tsx.
  hosxpConfirmSingleDay: boolean;

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
  // loc is optional (absent on every audit-log-only row, which never had one) — present only
  // on tx rows, and only there to tell a floor count apart from a substock count (both log
  // type:'count' — see commitCount vs commitSubCount in AppContext.tsx) since they'd otherwise
  // render under the identical audit-log label despite being two different screens/meanings.
  historyResults: { type: string; by: string; ts: number; note: string; loc?: string }[] | null;
  historyLoading: boolean;
  // Bug fix: AdminScreen's persistent "showing only 300" note used to infer truncation purely
  // from `filtered.length === 300` — but that's the count AFTER auditFilter narrows the type,
  // while searchHistory's own 1500-record cap (see AppContext.tsx) applies BEFORE that filter.
  // A search that hit the 1500 cap could easily filter down to under 300 of one type, silently
  // showing no truncation warning at all even though up to 500 more of that exact type might be
  // sitting past the cutoff. Tracked here, set once per search, independent of any filter.
  historyTruncated: boolean;

  expiryWarnDays: number;
  parFloorCoverDays: number;
  parSubCoverDays: number;

  // In-app replacement for window.confirm() — see confirmAsync()/ConfirmDialog.tsx. The
  // browser's native confirm() is unreliable inside some Android WebView/PWA/in-app-browser
  // contexts (it can silently return false, or never show anything, without the person ever
  // seeing a dialog) — which reads as "I tapped the button and nothing happened" exactly like
  // reported for "ใช้ยาทั้งหมดร่วมกันทั้ง OPD/IPD เลย". A real rendered dialog can't silently
  // no-op that way.
  confirmDialog: { message: string } | null;
  // Same reasoning, for window.prompt() — see promptAsync()/PromptDialog.tsx. Used where a
  // short free-text reason is required alongside a yes/no (e.g. "เหตุผลที่ปฏิเสธ" ใบเบิก).
  promptDialog: { message: string } | null;

  // True once a new deployed version's service worker is downloaded and waiting — see
  // UpdateBanner.tsx/applyUpdate() in AppContext.tsx. registerType is 'prompt' (not
  // 'autoUpdate') specifically so this never reloads the page on its own mid-task; it just
  // shows a dismissible banner and updates only when someone taps it.
  updateAvailable: boolean;

  // Reactive mirror of guardOnce()'s internal busy-key tracking (AppContext.tsx) — guardOnce
  // itself already prevents a double-tap from running the same commit action twice, but
  // nothing made that busy state visible on screen, so a real Firestore round trip (a slow
  // ward wifi connection, not hypothetical) left a commit button looking completely inert
  // with no spinner/disabled state — exactly the "did my tap even register?" confusion this
  // was built to remove. Keyed the same as guardOnce's key (plus ':<firstArg>' for per-item
  // actions like scrapLot/commitCount, one busy flag per lot/med rather than one for the
  // whole screen).
  busy: Record<string, boolean>;
}
