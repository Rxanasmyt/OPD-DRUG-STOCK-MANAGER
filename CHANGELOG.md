# Changelog

รูปแบบอิงตาม [Keep a Changelog](https://keepachangelog.com/) และเวอร์ชันตาม [Semantic Versioning](https://semver.org/)

> **หมายเหตุเรื่อง git tag:** session ที่ดูแล repo นี้ไม่มีสิทธิ์ push `refs/tags/*` ขึ้น GitHub
> (branch push ปกติทำได้ แต่ tag push โดน 403 เสมอ — น่าจะเป็น guardrail ของแพลตฟอร์ม ไม่ใช่ปัญหา scope)
> และไม่มีเครื่องมือสำหรับสร้าง GitHub Release ในชุดเครื่องมือที่ใช้งานได้ จึงใช้ไฟล์นี้ + `VERSION`
> เป็นแหล่งความจริงของเลขเวอร์ชันแทน จนกว่าจะแก้ข้อจำกัดนั้นได้

## [2.8.2] - 2026-08-25

### Changed
- **feat:** larger drug name/strength text on the shelf-tag label — bumped from 12pt to
  15.5pt (up in the on-screen preview too), by shrinking the bin-code chip and QR modestly
  (still 13mm, comfortably scannable at arm's length) to give the name more width. Verified
  with a headless render that the larger text still fits its two-line limit cleanly at the
  label's real 20×100mm print size

## [2.8.1] - 2026-08-25

### Added
- **feat:** version number shown at the bottom of the More menu — useful for support: when
  reporting an issue, whoever's helping can confirm at a glance whether the device is actually
  running the latest deploy or a stale cached PWA build

## [2.8.0] - 2026-08-25

### Added
- **feat:** date-range history search in Admin → Audit log — the live feed only ever shows
  the most recent ~300 events (kept small on purpose, for real-time speed), so anything older
  was previously reachable only via CSV export, not browsable in the app. Pick a "จากวันที่" /
  "ถึงวันที่" and hit ค้นหา to query Firestore directly for that range — any point in history is
  now always reachable in-app, not just the last ~300 events. Combined with the existing
  unrestricted CSV export (2.5.0) and the append-only, undeletable `txs`/`auditLog` collections
  (security rules already block update/delete on both), this is the traceability guarantee
  asked for: what happened, when, by whom, is never truncated and never edited out

### Changed
- **perf:** code-split the screens outside the hot day-to-day path (settings, admin, reports,
  labels/QR, reconcile, count, adjust) and the QR camera scanner (`jsqr`, the single heaviest
  dependency at ~50KB gzipped) into separate chunks loaded on first visit instead of the
  initial bundle — cuts what a phone has to download and parse before the login/home screen is
  interactive by about 60KB gzipped. The PWA still precaches every chunk for full offline
  support; this only changes what blocks first paint

## [2.7.1] - 2026-08-25

### Fixed
- **fix:** on iOS installed-to-home-screen (standalone PWA), the app's own header was rendering
  *underneath* the iOS status bar instead of below it — `apple-mobile-web-app-status-bar-style:
  black-translucent` (already set, for a native look) makes iOS draw content edge-to-edge under
  the status bar, but nothing was padding for it, so the header's title/subtitle sat hidden
  behind the clock/battery icons. Added `env(safe-area-inset-top)` padding to the header and the
  three full-screen login states, and `env(safe-area-inset-bottom)` to the bottom nav for the
  home-indicator area on notched iPhones

## [2.7.0] - 2026-08-25

Go-live cleanup pass: bug fixes found by re-reading every remaining screen, removal of the
last leftover trial/demo scaffolding, and a visual refresh of the shared shell.

### Fixed
- **fix:** the "ธุรกรรมวันนี้" (transactions today) stat tile on the home screen was silently
  stuck at 0 forever — it used `daysUntil()`, which computes days remaining *until* a future
  timestamp (correct for expiry dates), against `tx.ts`, which is always in the past, so the
  check was never true. Now compares calendar dates directly
  - the transfer-confirm screen's "สแกน QR ยา high alert (N รายการ)" button stayed visible
    (showing "0 รายการ") and clickable even after every high-alert item in the cart was
    already confirmed — tapping it would scan against nothing. Now hides once nothing's left
    to confirm

### Removed
- **fix!:** removed "รีเซ็ตข้อมูลยา/lot กลับเป็นชุดตั้งต้น" from the More menu — a leftover
  setup/testing tool that deleted every med and lot doc and reseeded the random starter data,
  sitting behind nothing but a browser `confirm()` dialog. With real stock data in the system
  now, an accidental tap would have been a real incident; a genuine full reset is rare enough
  to do by hand in the Firebase console instead. (The one-time "โหลดข้อมูลตั้งต้น" bootstrap
  action stays — it only ever runs once, when the med collection is still empty.)
- removed "จำลองไฟล์ตัวอย่าง" (load a fake sample file) from the HOSxP reconcile screen and the
  sample data it loaded — the CSV format is still shown via the textarea's placeholder text
- removed the "ระบบจริง: Cloud Function ดึงยอดจ่าย..." disclaimer on the same screen — it read
  as if the manual-paste workflow wasn't the real one, when pasting the HOSxP export has always
  been the intended day-to-day method (see README)

### Added
- **feat:** search box on "นับสต็อกหน้างาน" (floor count) — it was a flat list capped at the
  first 150 of up to 585 meds with no way to reach anything past that

### Changed
- **feat:** visual refresh — gradient header and login background instead of a flat fill,
  frosted-glass blur on sticky sub-headers (tab bars, the transfer search bar) and the bottom
  nav instead of a flat opaque fill, subtle shadow lift on the login logo mark

## [2.6.0] - 2026-08-25

### Added
- **feat:** "คำนวณสถิติการใช้ใหม่จากประวัติ HOSxP" button (ตั้งค่า → par อัตโนมัติ) — `used30`/
  `usedPrev30` (the daily-usage stats behind "แนะนำ par" and the turnover report's `used_30d`
  column) came only from the seed data and were never touched again — there's no server to
  run a nightly rollup, so they'd drift further from reality forever as real dispensing
  diverged from the randomized seed. This recomputes both from real `reconcile_hosxp` history
  (the only place patient dispensing is actually recorded), on demand
- **feat:** HOSxP name matching now distinguishes exact / fuzzy (substring) / ambiguous (matches
  more than one drug) / not-found instead of silently taking whatever `Array.find()` hit first
  — a file listing "Amoxicillin 250" when both "...250 mg" and "...500 mg" exist previously
  risked deducting stock from the wrong one with nothing to notice. Ambiguous and not-found
  rows are now excluded from the commit entirely (shown with why); fuzzy rows are shown with
  the exact match and require an explicit "ตรวจสอบแล้ว" checkbox before the commit button
  enables. Same matcher (`matchHosxpMed`) now backs both the preview table and the actual
  commit, instead of two separately-maintained copies of the matching logic

## [2.5.0] - 2026-08-25

### Fixed
- **fix:** the "รายงานและ Export CSV" discrepancy log and "Export CSV — audit_log.csv" were
  silently truncated to the most recent 300 transactions/audit entries — the on-screen live
  feeds are intentionally capped there, but the exports were reading from that same capped
  state instead of the full collection. In a hospital pharmacy 300 transactions passes fast, so
  a PTC/CQI report pulled after go-live would quietly be missing everything before that with no
  indication. Both exports now do a fresh, uncapped fetch of the full history at export time
- **fix:** an uncaught render error (e.g. from a malformed doc after a manual Firestore console
  edit) white-screened the whole app with no way back short of knowing to hard-refresh — added
  a top-level error boundary with a plain "โหลดหน้าใหม่" recovery screen instead
- **fix:** a failed write to `txs`/`auditLog` (e.g. connection drops right after a stock update
  already committed) failed completely silently — the stock number would be correct but the
  transaction/audit trail entry explaining it would just be missing, with no indication to the
  person who did it. Now surfaces a toast so staff know to note it manually

### Added
- **feat:** Firestore now uses a persistent (IndexedDB), multi-tab offline cache instead of the
  default in-memory-only one — meaningful for a stockroom tablet on hospital wifi that drops:
  already-synced data keeps working offline, and writes made while offline queue and flush
  automatically on reconnect instead of being silently lost on a refresh. Falls back to the
  plain in-memory client if IndexedDB isn't available (e.g. some private-browsing modes)

## [2.4.1] - 2026-08-25

### Changed
- **feat:** ฉลากตัวยา (shelf-tag strips) now print at a fixed real-world size — 20mm × 100mm
  per label — instead of stretching to fill an N-up grid. 2 columns × 14 rows fills an A4 sheet
  exactly (28 labels/page, verified: 585 meds → 21 pages, each page identically laid out), so
  every printed label is the same known size regardless of how many are in the run — needed so
  they cut cleanly and line up on the shelf edge
  - bumped the bin-code chip and drug-name text size for legibility at that size (name now
    wraps to 2 lines instead of truncating, for longer drug names)
  - raised the QR's internal render resolution (still the same physical ~16mm size) so it stays
    crisp at print DPI, not just screen DPI
  - verified end-to-end with a headless render: 28 labels lay out on exactly 1 A4 page,
    confirmed via the generated PDF's page count

## [2.4.0] - 2026-08-25

### Added
- **feat:** full formulary CRUD — เมนู "จัดการรายการยา" (More → จัดการรายการยา, pharm/admin only)
  - เพิ่มยาใหม่ (name, dosage form, unit, price, high-alert flag, bin, initial par) — auto-assigns
    the next `MED-####` code
  - ปิดใช้งาน / เปิดใช้งาน (soft delete) — drops it from transfer/receive/par lists and printed
    labels immediately, keeps every past transaction and audit entry intact; this was already
    possible from the seed data (the "ไม่มียาในรพ." rows) but had no in-app control until now
  - ลบถาวร (hard delete) — only enabled once both substock and floor are 0, to avoid orphaning
    stock history; deletes the med doc and any of its lot docs in one batch
  - all three log to the audit trail (`med_added` / `med_status_changed` / `med_deleted`)

### Security
- **fix:** `firestore.rules` tightened — writing to `meds` beyond `floor`/`lastCountTs` (the two
  fields day-to-day stock movement touches) now requires pharm/admin, matching what the UI
  already enforced client-side but the rules hadn't. Previously any approved account could write
  anything to a med doc directly via the API. **Needs republishing** — Firebase Console → Firestore
  Database → Rules → paste `firestore.rules` → Publish.

## [2.3.0] - 2026-08-25

### Fixed
- **fix:** the QR camera scanner could fail completely silently — `navigator.mediaDevices` is
  only exposed in a secure context, and `navigator.mediaDevices?.getUserMedia(...)` short-
  circuits the *entire* optional-chained call when it's undefined, so nothing ever ran and
  nothing was ever shown: no video, no error, just an animated "กำลังค้นหา QR ในกรอบ" scan box
  that never actually did anything. Now checked explicitly and reported with a clear message
  (insecure origin / unsupported browser / camera permission denied / no camera found) so a
  scan that can't work says so instead of silently pretending to try
- camera decode now tries both normal and inverted contrast (`attemptBoth`) — more forgiving
  of glare and lighting on a printed label than the previous normal-only attempt
- verified end-to-end offline: the `qrcode`-encoded module matrix decodes correctly back to
  the exact original payload through `jsqr` (was never actually the broken part)

### Added
- **feat:** ชั้นวาง (bin/shelf location) per medication is now editable in the app — เมนู "ตั้งค่า
  par level และชั้นวาง" now has a ค้นหา box (585 items is too many to scroll blind) and a third
  "ชั้นวาง" field next to the par inputs, saved the same debounced way. Until now the shelf code
  printed on every med label came only from the randomized seed data with no way to correct it
  to match the hospital's real layout (e.g. `J4`) — this was the point of the shelf-tag print
  redesign in 2.2.1, so it needed to actually be assignable

## [2.2.1] - 2026-08-25

### Changed
- **feat:** ฉลากตัวยา (med labels) now print as a real shelf-tag strip matching the hospital's
  existing paper labels — bin code (e.g. `J4`) in a yellow chip, followed by a QR code, followed
  by the drug name + strength, one strip per shelf slot — instead of the generic QR-card layout
  still used for lot/location sheets. Matches what's already taped to the shelves, just with a
  scannable QR added in, so the printed sheet can replace the old labels directly
  - on-screen preview updated to match (single-column strip list instead of a 2-up card grid)
  - print sheet lays strips out 2-up on A4 (vs. 4-up for the card layout) to fit the wider strip

## [2.2.0] - 2026-08-25

### Changed
- **feat:** QR labels and scanning are now real, not a demo pattern — this closes out the last
  simulated flow left in the app (everything else was already live against Firestore)
  - `<QrCode>` encodes a real payload (`{"t":"med"|"lot"|"loc","id":"..."}`) with the `qrcode`
    library and renders it as a real, scannable QR (previously: a deterministic-noise SVG glyph
    that only looked like one)
  - the scan sheet (รับเข้า substock / เติมหน้างาน / ยืนยันยา high alert) now opens the device
    camera and decodes frames live with `jsqr`, matching the scanned code against the actual
    med/lot in Firestore — previously the "สแกน" button just picked a random low-stock item, and
    the high-alert forcing function accepted any tap as a pass
    - a location (`loc`) label resolves to the neediest med stocked in that bin
    - an unrecognized code (e.g. from an old data re-seed) now says so instead of silently
      "succeeding"
  - "กรอกรหัสด้วยมือ" (manual entry, for a damaged label) is now wired to something — previously
    the input box didn't do anything at all — and requires a reason, logged to the audit trail
    (`qr_manual` entries)
  - "พิมพ์ฉลากทั้งชุด" opens a real, print-ready A4 sticker sheet (`window.print()`) for every
    active med / lot / floor-stock location instead of showing a toast that pretended to
  - `src/data/locations.ts` — the floor-stock bin list (`A1`..`D2`) is now shared between the
    labels screen and the QR-resolution logic instead of being duplicated

## [2.1.0] - 2026-08-25

### Changed
- **feat:** login/registration now use a **username** instead of an email address — easier for staff
  to remember and type. Under the hood this maps to a synthetic, never-emailed address on a fake
  domain, entirely client-side (no Cloud Functions / Blaze plan needed); usernames are lowercase
  `a-z0-9_.`, 3–20 characters, and are reserved atomically at signup via a public `usernames/{name}`
  Firestore collection (`firestore.rules` updated — republish it)
- Account management stays exactly as in 2.0.0 (self-register → admin approves + assigns role,
  fully inside the app) — this was confirmed as the intended meaning of "admin จัดการในแอปเลย" rather
  than switching to admin-created accounts, which would require enabling Firebase's paid Blaze plan
- Forgotten passwords now need an admin to reset them by hand in the Firebase console (documented in
  README) since there's no real inbox behind a username to send a reset link to

## [2.0.0] - 2026-08-25

### Changed (breaking)
- **feat!:** replaced the local-only, tap-to-demo-login prototype with a real Firebase backend —
  Authentication (email/password) and Firestore, synced live across every device
- Login is now a real form (sign in / register). New accounts self-register and land in a
  "pending approval" state (`role: 'tech'`, `active: false`) until an admin approves them and
  assigns a role, from the existing Admin → ผู้ใช้งาน screen (now shows pending signups separately
  from approved staff, since accounts can no longer be created manually from the client)
- All app data — meds, lots, transactions, audit log, user accounts — now lives in Firestore
  instead of `localStorage`; stock-affecting actions (transfer, receive, adjust, count,
  HOSxP reconcile, scrap) use Firestore transactions to stay correct under concurrent edits from
  multiple devices
- `firestore.rules` added (must be published manually in the Firebase console — see README) —
  blocks all reads/writes for unapproved/unauthenticated users; only an approved admin can change
  roles or approve accounts
- Removed the prototype's simulated online/offline toggle and "pending sync" counter (Firestore's
  own offline queue makes it moot); the online/offline pill in the header now reflects real
  `navigator.onLine` status
- Removed demo seed data (fake users, fake transaction history) — a fresh Firestore project starts
  with an admin-triggered "load starter data" action (585-item formulary + starter lots) instead

### Setup required
- See the new "ตั้งค่า Firebase" section in README.md — publishing `firestore.rules` and
  bootstrapping the first admin account are one-time manual steps in the Firebase console.

## [1.2.0] - 2026-08-25

### Added
- **feat:** installable PWA — `vite-plugin-pwa` generates a web app manifest and an
  auto-updating service worker so the GitHub Pages build can be added to the home screen /
  installed like a native app on Android, iOS, and desktop Chrome/Edge
- new brand icon (green gradient badge with the "ยา" mark) rendered at every required size:
  `icon-192.png` / `icon-512.png` (purpose "any"), `icon-maskable-192.png` /
  `icon-maskable-512.png` (Android adaptive-icon safe zone), and `apple-touch-icon.png` for iOS
- favicon, `apple-mobile-web-app-*` meta tags, and an SEO `<meta name="description">` added to
  `index.html`

## [1.1.0] - 2026-08-25

### Added
- **feat:** UI/UX polish — global micro-interactions (button hover/press feedback, animated focus
  rings, smooth color/border transitions on state changes), animated progress bars (par level,
  aging buckets), list-row hover highlighting, stat-tile hover lift
- **feat:** QR scan modal restyled with backdrop blur, spring bottom-sheet entrance, and a
  four-corner scan-frame look; smoother toast entrance; checkmark pop + staggered row reveal on
  the "done" screen; staggered fade-in on the login screen with animated arrow-on-hover
- **feat:** header/bottom-nav depth (subtle shadows) and an animated active-tab indicator
- respects `prefers-reduced-motion` — all animation/transition durations collapse to ~0 for users
  who've asked for reduced motion

## [1.0.0] - 2026-08-25

### Added
- **feat:** implement OPD drug stock manager from Claude Design prototype — เว็บแอป React + TypeScript
  + Vite ตาม flow เต็มรูปแบบของดีไซน์ `ระบบสต็อกยา OPD.dc.html` (login 3 บทบาท, เติมหน้างานแบบ FEFO,
  รับเข้า substock พร้อมอนุมัติ, ปรับยอด/คืนยา/ยาหมดอายุ, นำเข้า HOSxP, นับสต็อก, รายงาน, ฉลาก QR,
  จัดการผู้ใช้ + audit log) พร้อม master data ยา 585 รายการจาก `med_list_utf8.csv`
- **feat:** ใช้ Claude Artifact `downloads` capability สำหรับ export CSV พร้อม fallback เป็นการดาวน์โหลด
  แบบปกติเมื่อรันนอก Artifact viewer

### Infrastructure
- **ci:** เพิ่ม GitHub Actions workflow deploy อัตโนมัติขึ้น GitHub Pages (branch `gh-pages`) ทุกครั้งที่
  push เข้า `main`
