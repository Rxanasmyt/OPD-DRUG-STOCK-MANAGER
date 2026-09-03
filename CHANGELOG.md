# Changelog

รูปแบบอิงตาม [Keep a Changelog](https://keepachangelog.com/) และเวอร์ชันตาม [Semantic Versioning](https://semver.org/)

> **หมายเหตุเรื่อง git tag:** session ที่ดูแล repo นี้ไม่มีสิทธิ์ push `refs/tags/*` ขึ้น GitHub
> (branch push ปกติทำได้ แต่ tag push โดน 403 เสมอ — น่าจะเป็น guardrail ของแพลตฟอร์ม ไม่ใช่ปัญหา scope)
> และไม่มีเครื่องมือสำหรับสร้าง GitHub Release ในชุดเครื่องมือที่ใช้งานได้ จึงใช้ไฟล์นี้ + `VERSION`
> เป็นแหล่งความจริงของเลขเวอร์ชันแทน จนกว่าจะแก้ข้อจำกัดนั้นได้

## [2.33.0] - 2026-09-03

### Added
- **feat:** import a usage-total file (CSV, "ชื่อยา,จำนวนที่ใช้" ต่อบรรทัด) to seed the
  daily-usage rate behind "แนะนำ par" — for a formulary too new to have 60 days of in-app
  HOSxP reconcile history (recomputeUsageStats' only prior source). Pick the period the file
  actually covers — รายเดือน (30 วัน) / รายไตรมาส (90 วัน) / รายปีงบประมาณ (365 วัน) — and the
  system divides the imported total by that many days to get a daily rate. New card in หน้า
  ตั้งค่า, right below the existing par-automation tools; reuses the same name-matching
  (exact/fuzzy-confirm/ambiguous-skip, OPD/IPD name-twin-safe) already proven on the HOSxP
  reconcile screen. Deliberately touches only `used30` via a plain field update — never floor,
  substock, or lot quantities — so a bad file can skew a *suggested* par number at worst,
  never move real stock, and even that only lands once "ใช้ค่าแนะนำทั้งหมด" is clicked after

## [2.32.0] - 2026-09-03

### Fixed
- **fix:** "คำนวณสถิติการใช้ยาใหม่" (recomputeUsageStats, used to feed "แนะนำ par") aggregated
  60-day HOSxP dispensing history by drug **name only** — the same OPD/IPD name-twin hazard
  fixed elsewhere this project (matchHosxpMed, substock ledger, ward-filtered reports), just
  not caught here yet. A twin pair's dispensing got silently summed together and the same
  (wrong) `used30`/`usedPrev30` written onto *both* the OPD and IPD copy, quietly skewing par
  suggestions for both wards. Now keys by `medId` (present on every reconcile_hosxp tx since
  v2.20.0) whenever a med has a same-name twin, falling back to the simple name aggregation
  only for drugs that don't — an old, medId-less tx row for a duplicated name is skipped
  rather than guessed at

### Changed
- **feat:** extended the double-submit reentrancy guard (see 2.29.0) to the five remaining
  Firestore-writing actions that hadn't gotten it yet: applyAllSuggested, recomputeUsageStats,
  addMed, updateMedFull, deleteAllInactiveMeds — same rationale, a fast double-tap before
  React disables the button no longer fires the same write twice

## [2.31.0] - 2026-09-03

### Added
- **feat:** a persistent "where am I" context bar pinned right under the header on every
  screen — always says, in plain sight, whether the current screen is working against
  **คลังย่อย Substock** (amber, 📦 — รับยาเข้า substock, บัตรสต็อก, ตัดยาหมดอายุใน "ปรับยอด")
  or **หน้างาน** (green, 🏥 — เติมหน้างาน, ตรวจสอบก่อนยืนยัน, ปรับยอด/คืนยา/ยาเสีย, ย้ายยาระหว่าง
  ชั้นวาง, นับสต็อกหน้างาน), plus a live OPD (green) / IPD (purple) / ทุกหอผู้ป่วย pill on the
  three screens actually scoped by the ward filter (รับเข้า, เติมหน้างาน, ปรับยอด) — replaces
  having to read a screen's title or scroll to its filter tabs to work out which stock a
  scan or a number on screen actually belongs to
- **fix:** the home screen's header title was hardcoded to "ห้องยา OPD" regardless of the
  ward filter actually selected — a stale claim once the app grew IPD support. Now follows
  the ward tabs live: "ห้องยา OPD" / "ห้องยา IPD" / "ห้องยา OPD/IPD"

### Changed
- **feat:** extracted the OPD/IPD/ทุกหอผู้ป่วย filter tabs — six near-identical inline copies
  across Home/Receive/Transfer/Adjust/Labels/Report — into one shared `WardTabs` component
  with a sliding highlight pill (same motion language as the login screen's เข้าสู่ระบบ/
  สมัครสมาชิก toggle) instead of the active tab's background just snapping on/off

## [2.30.0] - 2026-09-03

### Changed
- **feat:** renamed the app to **KPNHOS-DRUG SUBSTOCK-OPD-IPD-MANAGEMENT** — updated the
  browser tab title, PWA install name/short name/home-screen label, the app name shown on the
  login screen, `package.json`, and `README.md`. Purely a display/identity change — no
  behavior, data, or Firestore schema affected

## [2.29.0] - 2026-09-02

### Fixed
- **fix:** none of the 9 commit-style buttons in the app (ยืนยันการเติมหน้างาน, ยืนยันรับเข้า,
  อนุมัติ/ปฏิเสธรับเข้าที่รอ, ย้ายยาข้ามหอผู้ป่วย, บันทึกปรับยอด, ตัดจำหน่าย lot, บันทึกนับสต็อก,
  ตัดยอดตามไฟล์ HOSxP) disabled themselves while their Firestore transaction was in flight — a
  fast double-tap (very plausible on a touchscreen at a busy counter, more so with any network
  latency before the screen navigates away) could fire the same commit function twice before
  React ever re-rendered the button, running two independent transactions against the same
  cart/lot/floor and silently double-deducting or double-adding real stock. Each of these 9
  actions is now wrapped in a reentrancy guard keyed by action + target id, so a repeat
  invocation while the first is still running is silently ignored instead of running twice —
  unrelated items (e.g. approving two different pending receives at once) are unaffected

## [2.28.0] - 2026-09-02

### Fixed
- **fix:** printing "ฉลาก lot" ignored the OPD/IPD ward tab shown right above the print
  button — it read from the full unfiltered lots collection instead of the same ward-scoped
  active-meds list the "ฉลากตัวยา" tab already correctly used, so a sheet printed with "OPD"
  selected could silently include IPD (and inactive-med) lots on the same page

### Added
- **feat:** every printed label (ฉลากตัวยา shelf strip, ฉลาก lot) now shows the drug's code
  (e.g. MED-0123) and a colored OPD/IPD badge — previously a printed strip carried only the
  QR and the drug name, so two labels reading the identical name (OPD and IPD versions of the
  same drug deliberately share a name — own bin/QR/par each) were indistinguishable once cut
  apart from the app, and if a QR ever got damaged/faded there was no human-readable code to
  fall back to. On-screen label previews updated to match exactly what prints

## [2.27.0] - 2026-09-02

### Added
- **feat:** the QR scanner camera view is now visually unmistakable about which mode it's in
  — รับเข้า (คลังใหญ่ → substock) is amber with sharp-cornered brackets, เติมหน้างาน (substock
  → ชั้นจ่ายยา) is green with rounded brackets, each with a colored icon+flow-direction badge
  ("⬓ คลังใหญ่ → substock" / "⇄ substock → ชั้นจ่ายยา") right at the top of frame, plus a
  colored border around the whole screen. Previously both modes looked identical (same black
  background, same green frame) and only differed by title text, which is easy to miss
  mid-scan — reported: "จพ.เภสัชสแกนแล้วไม่มึนว่าอยู่หน้าไหน". The ▣ scan buttons on รับเข้า
  and เติมหน้างาน are now colored to match too, so the mode is visible before the camera even
  opens

## [2.26.0] - 2026-09-02

### Added
- **feat:** เสร็จสิ้น (after รับเข้า substock / เติมหน้างาน) now shows each drug's live
  substock balance right there — real-time, no navigation needed — plus a "ดูบัตรสต็อก →"
  link straight into its full บัตรคุมสต็อกยา (already scrolled/loaded, no re-searching for
  the drug). Tagged with the current ปีงบประมาณ, since the substock card is always kept per
  fiscal year on the paper original. A drug received with no substock stage (see noSubstock)
  correctly skips this line instead of showing a misleading "0"
- new shared `fiscalYear()` util (previously computed inline only inside the print sheet) —
  used by both the print sheet and this new on-screen badge so they can never drift apart

## [2.25.0] - 2026-09-02

### Added
- **feat:** every screen that lets someone search for and pick a drug (รับเข้า, ปรับยอด,
  บัตรสต็อก substock, ย้ายยาระหว่างชั้นวาง) now shows a colored OPD/IPD badge on every result
  row and on the selected-med chip — the point of the OPD/IPD split is that the same drug can
  exist as two separate shelf records sharing a name (own bin/QR/par each), and a plain
  name-only list genuinely can't tell those two apart. รับเข้า and ปรับยอด also gained a
  ward filter tab (ทุกหอผู้ป่วย/OPD/IPD, same shared filter หน้าหลัก/เติมหน้างาน/จัดการ
  รายการยา already use) so the picker can be scoped to one zone at a time by default —
  directly answers "แยกโซนของ substock OPD และ IPD ให้ชัดเจน เพื่อป้องกันความสับสน"
- confirmed the underlying model already supports "ยา 1 ตัวมีชั้นวางได้ 2 จุด" — OPD and IPD
  versions of the same drug are separate records from the start (see the OPD/IPD workflow
  work earlier this session), each with exactly one bin/QR of its own; this release is about
  making that already-correct separation visible everywhere it was previously invisible

## [2.24.0] - 2026-09-02

### Added
- **feat:** the color-coded stock number treatment from 2.23.0 now also applies to ปรับยอด,
  รับเข้า, ย้ายยาระหว่างชั้นวาง, and จัดการรายการยา — every screen that shows a หน้างาน/
  substock figure next to a drug name colors it the same way now, not just หน้าหลัก/
  เติมหน้างาน
- **feat:** จัดการรายการยา's list now shows each active drug's current หน้างาน/substock right
  in the row, color-coded — previously you had to open every item's edit form just to see its
  numbers
- **feat:** หน้าหลัก's stat tiles ("ต่ำกว่าจุดต้องเติม (Min)", "ใกล้หมดอายุ", "ต่ำกว่า par
  substock") are now tappable when there's something to act on — jump straight to เติมหน้างาน/
  รับเข้า, or scroll straight to the ใกล้หมดอายุ list on the same screen, instead of the
  number being a dead end you then have to go find yourself

## [2.23.0] - 2026-09-02

### Added
- **feat:** stock numbers on หน้าหลัก and เติมหน้างาน now color-code by severity (แดง = ต่ำ
  กว่า Min ครึ่งหนึ่ง, ส้ม = ต่ำกว่า Min, เขียว = ปกติ) and print bold/larger so "เหลือยาเท่าไร"
  reads at a glance instead of blending into the surrounding gray text
- **feat:** every low-stock row now shows a colored "▲ ต้องเติม N หน่วย" pill naming exactly
  how much is needed to reach full (Max/par) — answers "ต้องเพิ่มเท่าไร" directly on the row
  instead of making someone do the subtraction themselves. Only appears when there's an
  actual deficit, so a fully-stocked row stays clean
- new shared `<Qty>`/`<DeficitBadge>` components so this stays visually consistent everywhere
  it's used instead of each screen inlining its own styling

## [2.22.1] - 2026-09-02

### Fixed
- **fix:** "ปรับยอด / คืนยา / ยาเสีย" — once a med was picked, there was no way to search for
  or pick a different one from that screen at all; the search box stayed on screen and
  editable, but nothing ever reopened the results dropdown. The only workaround was switching
  the adjustment type away and back, resetting the whole form in the process. A wrong
  selection is now fixable by just typing a new search, same as every other search-then-pick
  screen in the app already works
- **fix:** the low-stock progress bar color (หน้าหลัก, เติมหน้างาน) and an unused expiry-color
  helper returned literal hex colors instead of theme tokens — a leftover from before dark
  mode existed, so that one bar stayed light-mode-colored even in dark mode while everything
  around it correctly switched
- **fix:** ย้ายยาระหว่างชั้นวาง's search-box state had a `v ? null : null` — a tautology that
  always evaluates the same regardless of `v`, a hallmark of a copy-paste mistake. Currently
  harmless given how it happened to be called, but written the way it was actually meant:
  unconditionally clear the selection when the search box changes
- **fix:** "นำเข้า HOSxP"'s result summary could undercount — a row with quantity 0 or less
  was skipped from the running total silently, so applied + ข้าม didn't always add up to the
  number of rows processed. Now named separately in the summary ("N รายการจำนวน 0") since
  it's a different reason than a name-matching failure

## [2.22.0] - 2026-09-02

### Added
- **feat:** "จัดการรายการยา" → tab "ปิดใช้งาน" now has a bulk-delete button — permanently
  removes every currently-shown deactivated drug from the system in one go, for cleaning up
  formulary entries the hospital doesn't actually carry (e.g. leftovers from the initial
  585-item seed) without deactivating and deleting one at a time. Same safety rule as
  deleting one med: only ever removes a drug that's both ปิดใช้งาน AND genuinely at 0 (shelf
  and substock both empty) — anything with leftover stock is named and skipped rather than
  silently discarded along with real inventory value, and the count on the button always
  matches what's currently filtered on screen (ward tab + search), never a hidden
  system-wide scope

## [2.21.0] - 2026-09-02

### Changed
- **feat:** บัตรสต็อก substock (both on screen and the printed A4 sheet) redesigned to
  actually look like the real hand-written yellow "บัตรคุมสต็อกยา" ledger card — a boxed
  header band naming the card, a ruled field grid for ชื่อยา/รหัสยา/หน่วยนับ/par substock
  (same as the paper card's boxed fields), and a real grid-ruled table (vertical AND
  horizontal cell borders, not just underlines) with a running ลำดับ number column. The
  previous version was a plain flat list that worked but didn't read as "the same card" once
  printed. Nothing about the data changed — still generated live from real transaction
  history (fetchSubstockLedger) and the live substock balance, same as before; this is purely
  the skin over the same real-time plumbing

## [2.20.0] - 2026-09-02

### Audit — QR scanning + same-drug-two-bin-codes (OPD/IPD)
Verified both explicitly:

- **QR:** re-ran the full encode → print-size render → simulated camera capture (blur +
  distance downscale) → jsQR decode → parse round-trip that originally caught the too-small
  print bug this session. Still passes cleanly at the shipped 16.6mm strip size; a
  deliberately harsher blur than any realistic phone-focus case is where it finally stops
  decoding, which is the expected physical limit, not a regression. Every med/lot/loc record
  gets its own unique printed code and QR (see `code`, minted from an atomic counter) — so a
  drug existing as separate OPD and IPD shelf records always gets two genuinely distinct bin
  codes and two genuinely distinct scannable QR labels, never a collision, by construction
- **Two bin codes for one drug (OPD + IPD):** the shelf/QR side of this was already correct —
  found instead that several places elsewhere still assumed a drug's *name* was a unique
  pointer back to one record, which stopped being true the moment OPD and IPD versions of the
  same drug (deliberately, same name, separate records) were allowed to exist. Three real
  spots fixed:

### Fixed
- **fix:** the daily HOSxP reconcile matcher (`matchHosxpMed`) picked the *first* exact
  name match with `.find()` instead of checking for more than one — a drug named identically
  on both OPD and IPD shelves would always silently deduct from the same one of the two,
  regardless of which ward actually dispensed it. Now detects this and reports it 'ambiguous'
  (same as its own fuzzy-match branch already did), which the existing UI already presents as
  "skip, resolve by hand" rather than ever guessing. The reconcile screen also now names this
  specific case directly ("ยานี้มีทั้งชั้น OPD และ IPD ชื่อเดียวกัน...") instead of a generic
  "found several similarly-named drugs" message
- **fix:** every transaction record now also carries the specific `medId` it belongs to (it
  previously stored only the drug's name at the time) — the substock card ledger and the
  ward-filtered discrepancy report/export both used to match transaction history purely by
  name, which would silently merge OPD's and IPD's history together for any drug that exists
  on both shelves. Both now trust `medId` when present; a transaction logged before this
  field existed falls back to name-matching only when that name is unambiguous for the ward
  in question. Substock card also now explains this specific case when the running balance
  doesn't match live stock, instead of pointing at a generic "check the audit log"

## [2.19.1] - 2026-09-02

### Audit — realtime sync & data-loss review
Went through every live Firestore listener, every write path, and `firestore.rules` field by
field to check the realtime connection is sound and nothing can silently lose data:

- **fix:** two settings edits (par level, shelf bin — currently only reachable through an old
  code path with no screen wired to it since "จัดการรายการยา" replaced the standalone par
  editor) were debounced 500ms before writing to Firestore, with no protection if the tab
  closed or the phone backgrounded the page inside that window — some mobile browsers suspend
  pending timers immediately on backgrounding, which would drop the edit entirely. Hardened
  with a page-hide/visibility flush that fires any pending debounced write immediately the
  moment the page is about to disappear, so this can't bite if that code path is ever wired
  back up
- **fix:** the initial 585-med database seed had the same unbounded-hang risk as every other
  Firestore write fixed last release — now timeout-guarded too
- verified every field written by every commit action against `firestore.rules` line by line —
  no mismatches found (a mismatch would silently permission-deny a write, which is exactly the
  "looks fine, data didn't save" failure mode this audit was checking for)
- confirmed the initial-seed writes use fixed, deterministic doc IDs (not auto-generated) — so
  seeding twice (e.g. two admins both seeing an empty formulary at once) overwrites the same
  585 docs with identical data rather than creating duplicates
- confirmed every live listener (added last release) and every transaction/fetch (timeout-
  guarded last release) are still in place and correctly wired

## [2.19.0] - 2026-09-02

### Fixed
- **fix:** every Firestore transaction and multi-doc fetch in the app (เติมหน้างาน, รับเข้า,
  อนุมัติ/ปฏิเสธคำขอรับเข้า, ย้ายยาระหว่างชั้นวาง, ปรับยอด, นับสต็อกหน้างาน, นำเข้า HOSxP,
  เพิ่ม/ลบยา, ใช้ค่า par แนะนำทั้งหมด, คำนวณสถิติการใช้ใหม่, export CSV/audit log, ค้นหา
  ประวัติ) could previously hang indefinitely on a connection that's "online" per the browser
  but can't actually reach Firestore — a captive portal on hospital wifi, a flaky access
  point, a dead DNS lookup. Firestore's own SDK has no ceiling on this and just keeps
  retrying silently, which left a "กำลังบันทึก" action spinning forever with zero feedback:
  the person at the counter had no way to know whether it worked, whether to keep waiting, or
  whether to try again. Every one of these calls now races against a 15-second clock — if it
  fires, the action fails fast with a clear "ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่" message instead of
  hanging; a real Firestore error still surfaces as itself
- verified the timing/cleanup logic of the new safety net with a standalone test (fast success
  still resolves normally, a genuinely slow call times out and rejects distinctly from a real
  error, no leaked timer afterward) — this class of failure isn't safely reproducible against
  the live Firestore project from here, so this is a logic-level verification, not an
  end-to-end one

## [2.18.0] - 2026-09-02

### Fixed
- **fix:** every live Firestore listener (meds, lots, ธุรกรรม, audit log, คำขอรับเข้ารออนุมัติ,
  ผู้ใช้) previously had no error handler — a permission error or a corrupted local cache
  would fail the subscription completely silently, with the screen just quietly stopping to
  update and nothing explaining why. Worst case: the "meds" listener is what flips the app
  past "กำลังโหลดข้อมูล…" — a silent failure there could leave someone stuck on that loading
  screen forever with no way out. Every listener now logs the failure and surfaces one
  shared toast instead of several, and a meds-listener failure now still lets the app reach a
  real screen instead of hanging indefinitely
- **fix:** "บัตรสต็อก substock" silently showed nothing and left the loading state with no
  explanation if the fetch failed (e.g. no internet) — now shows a toast and lets the person
  retry
- **fix:** the app is redeployed often, and each deploy renames every screen's JS chunk — a
  device that's had the app open since before a deploy would hit an unexplained crash screen
  the moment someone opened a screen loaded after that point (จัดการรายการยา, รายงาน, ตั้งค่า,
  etc.), needing a manual reload to notice why. The app now recognizes this specific failure
  and reloads itself once automatically to pick up the new build; a real, still-broken deploy
  (the same failure right after that automatic reload) still falls back to the visible error
  screen instead of reload-looping forever
- **chore:** `.nojekyll` now lives in `public/` so every future GitHub Pages deploy carries
  it automatically, instead of needing to be restored by hand after each deploy

## [2.17.1] - 2026-09-02

### Changed
- **fix:** removed the "เช่น nurhayati" example placeholder on the login username field
  (reported: "ไม่สวยเลยยย") — a real-looking sample username sitting in a field labeled with
  a name field's icon read as someone's actual account, not a hint

## [2.17.0] - 2026-09-02

### Added
- **feat:** full-app UI/UX/animation pass — every screen, not just the shared chrome from the
  previous release. List cards across เติมหน้างาน, รับเข้า, ปรับยอด, นำเข้า HOSxP, นับสต็อก,
  รายงาน, บัตรสต็อก, จัดการรายการยา, จัดการผู้ใช้/audit log, and เพิ่มเติม now ripple in with a
  quick staggered fade instead of appearing all at once
- **feat:** every button in the app now presses with a snappier spring easing (was a flat
  scale-down) — a small, app-wide tactile upgrade rather than a one-screen tweak
- **feat:** login screen's เข้าสู่ระบบ/สมัครสมาชิก tab switch now has a sliding pill background
  instead of an instant color swap, feature list items fade in one after another instead of as
  one block, and the logo badge has a slow breathing glow
- **feat:** "เพิ่มเติม" menu rows and the settings → "จัดการรายการยา" link row now have a hover/
  press lift with the arrow nudging forward, matching the tactile feel used elsewhere

## [2.16.0] - 2026-09-02

### Added
- **feat:** real light/dark mode — a moon/sun toggle in the header and on the login screen
  switches the whole app instantly (persisted per-device, defaults to the phone's system
  theme on first visit). Every screen was swept for hardcoded white/grey backgrounds and
  moved onto the shared color-token system so dark mode is correct everywhere, not just on
  a couple of screens — including a second pass to catch and fix places where the sweep had
  wrongly converted button text that must stay white in both themes
- **feat:** premium visual pass on the shared chrome — an animated soft-gradient mesh behind
  the header and login screen, a floating glass bottom nav bar with a sliding pill that glides
  to the active tab, a gentle pulse on the "ออนไลน์" status dot, and spring-based press
  feedback on buttons

### Changed
- **fix:** IPD's ward color/badge (used on ป้ายชื่อ, จัดการรายการยา, รายงาน, เติมหน้างาน) was
  a fixed purple hex that didn't adapt to dark mode — moved onto its own theme token so it
  stays legible in both modes

## [2.15.0] - 2026-08-26

### Added
- **feat:** per-drug color coding — every med now gets its own stable color (a small dot
  next to the name + a colored left border on the card), derived deterministically from its
  code so the same drug shows the same color everywhere it appears: เติมหน้างาน, ตรวจสอบก่อน
  ยืนยัน, รับเข้า, ปรับยอด, จัดการรายการยา, ย้ายยาระหว่างชั้นวาง, บัตรสต็อก, and the หน้าหลัก
  lists. Meant as a fast visual "this is a different item" cue in lists full of similar or
  look-alike/sound-alike drug names — real medication-error risk when two rows blur together.
  Colors come from a proper hash (FNV-1a + a bit-mixing finalizer) rather than a naive one —
  a naive `h*31+c` hash was tried first and failed exactly the case that mattered most:
  sequential codes (MED-0001, MED-0002 — precisely the kind of pair that ends up sorted next
  to each other) hashed to nearly-identical colors, defeating the point
- **feat:** entrance animation on เติมหน้างาน's list and the ตรวจสอบก่อนยืนยัน confirmation
  screen — cards fade/slide in with a slight stagger instead of appearing all at once

## [2.14.2] - 2026-08-26

### Changed
- **fix:** "เพิ่มเติม" menu reorganized — every feature added this session landed as one more
  row in a flat list (reported: "ฟังก์ชั่นเยอะแต่หายาก" — too many functions, hard to find).
  It had grown to 8 undifferentiated rows mixing daily-use screens (ปรับยอด, นับสต็อก) with
  once-a-fortnight admin tools (ย้ายยาระหว่างชั้นวาง, บัตรสต็อก, par อัตโนมัติ) with no
  grouping. Regrouped into 4 labeled sections by how often/who actually opens each one
  (งานประจำวัน / จัดการยาและชั้นวาง / รายงานและเอกสาร / ผู้ดูแลระบบ) and gave every row an
  icon so scanning the list doesn't require reading each line of text. No feature removed —
  same destinations, organized instead of dumped in one pile

## [2.14.1] - 2026-08-26

### Changed
- **feat:** บัตรสต็อก substock reshaped to match the actual paper stock card it replaces —
  shown a photo of the real hand-written card (รหัสยา/ชื่อยา header, วันที่/รับ/จ่าย/คงเหลือ
  columns, chronological oldest-to-newest). On-screen ledger now uses the same column split
  (separate รับ/จ่าย columns instead of one +/- number) in that same reading order, and a new
  🖨 print button generates an A4 sheet in the same layout for anyone who still wants a
  physical printout on file — auto-filled from real transaction history instead of hand-copied
  onto the card line by line

## [2.14.0] - 2026-08-26

### Added — Smart Restock (Min-Max) + bigger scanner + virtual substock card
No manual Firebase Console step needed for this release — everything here reads/writes
collections already covered by the published firestore.rules.

- **feat:** real Min-Max par per shelf — `floorMin` (reorder point) is now separate from
  `parFloor` (shelf capacity / fill target). "ต่ำกว่า par หน้างาน" everywhere (dashboard,
  เติมหน้างาน, "เติมตาม par ทั้งหมด", the loc-QR fallback match) now means "at/below Min",
  not "a hair under Max" — the actual min-max method, not one number doing both jobs.
  Existing meds default Min to 30% of their current Max (no migration needed); editable
  per med in จัดการรายการยา. Since OPD and IPD copies of a drug are already separate med
  records, Min-Max is already "per shelf location" by construction
- **feat:** Auto Pick-List — "🖨" button next to เติมหน้างาน's cart prints an A4 checklist of
  exactly what's queued, sorted by shelf/bin position, with a checkbox column — meant to be
  carried while walking the substock room instead of re-reading a phone screen mid-walk
- **feat:** ใบขอเบิกจากคลังใหญ่ (หน้ารับเข้า) — one button prints every item currently below
  its substock par as a requisition checklist, ready whenever the 2-week warehouse pickup
  cycle comes around. (No backend here to fire a scheduled reminder on a specific day — this
  is the standing list to work from instead of a push notification)
- **feat:** Virtual Substock Card (เพิ่มเติม → บัตรสต็อก substock) — replaces the paper
  รับ-จ่าย-คงเหลือ ledger. Pick a med, see every substock receive/transfer-out/expiry-scrap
  with a running balance, computed fresh from full tx history (not the capped live 300) so
  the balance is right back to that med's very first transaction. Flags a mismatch against
  the live substock total rather than silently showing two different numbers

### Changed
- **fix:** camera QR scanner was a ~172px box inside a bottom sheet — reported as too small
  to use reliably ("กล้องตอนนี้ขนาดเล็กมากถ้าเทียบกับหน้าจอโทรศัพท์"). Rebuilt as a
  near-fullscreen view: the camera fills the whole modal, with title/hint/manual-entry as
  thin overlays instead of squeezing the camera into a small box. The scan target itself
  scales to most of the screen width instead of a fixed 120×120 square

### Clarifying what's already covered (asked about, not new this release)
- **"ทำใบเบิกออนไลน์ในแอพ ดูสถานะได้เลย realtime ข้อมูลไม่สูญหาย"** — already true since
  v2.11.0: หน้ารับเข้า is fully digital (no paper), a tech's submission shows live status
  (รอ/อนุมัติ/ปฏิเสธ) to everyone who can see it, and it's Firestore-backed so nothing is
  lost on refresh or between devices
- **OPD/IPD deduction logic, injectable transfer, direct-to-shelf flag** — all already built
  in v2.13.0 (ward-tagged meds, ย้ายยาระหว่างชั้นวาง, noSubstock). IPD D/C take-home dispensing
  drawing from the OPD shelf doesn't need separate app logic — it's the same OPD med record
  any other OPD dispensing already uses, since this app doesn't process patient dispensing
  itself (HOSxP does — see "นำเข้า HOSxP")
- **Different OPD/IPD bin codes for the same drug** — already resolved by having OPD/IPD be
  separate med records (per the earlier decision): each carries its own free-text `bin`
  field independently, so there's no shared code scheme to conflict

## [2.13.1] - 2026-08-26

### Added
- **feat:** ward tabs (ทุกหอผู้ป่วย / OPD / IPD) on รายงาน (Stock aging / Turnover /
  Discrepancy log) — the one screen left out of the previous ward pass. CSV export now
  matches whatever ward tab is open on screen instead of always exporting everything
  regardless of the visible filter, which would have been a silently misleading report.
  Discrepancy log ward-filters by matching each transaction's recorded drug name against
  the current ward's meds (txs don't carry a medId, only the name at the time) — exact
  whenever OPD/IPD copies of a drug are named distinctly, as pharmacy's own convention
  already does; only ambiguous in the unlikely case both wards have an identically-named med

## [2.13.0] - 2026-08-26

### Added — OPD/IPD ward workflow
Modeled the real ward split described by pharmacy staff: OPD and IPD shelves use different
bin codes, stock at different rates, and OPD carries far more line items than IPD. The same
drug stocked on both shelves is deliberately two separate med records (own QR/bin/par each,
per pharmacy's own call) — `ward` (`opd`/`ipd`) is a new optional field on every med,
defaulting to `opd` for the ~585 pre-existing meds (this whole formulary was OPD-only before
IPD support existed) with no migration needed.

- **feat:** ward tabs (ทุกหอผู้ป่วย / OPD / IPD) on หน้าหลัก, เติมหน้างาน, ระบบฉลาก QR, and
  จัดการรายการยา — a shared filter so switching ward context in one place carries through
  print batches, the fill-suggestion cart, and the low-stock dashboard together
- **feat:** "เติมตาม par ทั้งหมด" (the auto-fill-suggestion that replaces eyeballing shelf
  levels every morning) is now ward-scoped — filling the OPD tab only ever queues OPD items,
  never quietly pulls in IPD's cart too, and vice versa. This is the actual fix for "ยาไม่พอ
  ใช้หน้างานจริงเพราะกะสายตา" — the suggested-quantity math already existed, it just wasn't
  ward-aware, so a real morning fill session couldn't use it cleanly
- **feat:** per-med "ไม่มี substock" flag (จัดการรายการยา) for liquids/inhalers/sprays that go
  straight from the central warehouse to the shelf — receiving one now credits หน้างาน
  directly instead of landing in a substock stage nobody would ever transfer out of, and
  these meds no longer clutter เติมหน้างาน with a permanently-stuck "0" fill button
- **feat:** "ย้ายยาระหว่างชั้นวาง" (เพิ่มเติม menu) — for the locked injectable drawer in IPD
  with a subset kept in an OPD stat drawer: moves floor stock from one med record to another
  (decrement source / increment destination, atomic, reason required, logged as a linked tx
  pair) — not a receive (nothing new entered the hospital) and not a substock transfer

## [2.12.0] - 2026-08-26

### Added
- **feat:** redesigned login screen — icon-prefixed inputs, a real password show/hide
  toggle, and a "จดจำการเข้าใช้ในเครื่องนี้" checkbox that's an actual working setting (not
  decoration): checked keeps the session across app restarts (Firebase local persistence,
  the previous unconditional default), unchecked signs out the moment the tab/browser closes
  — useful on a shared/kiosk device where staying logged in would hand the next person
  someone else's session. Added a short "what this app actually protects" strip (role-based
  access, audit log, expiry alerts) below the form — all three are real, already-shipped
  features, not marketing copy. Replaced with an honest note in place of a "ลืมรหัสผ่าน?" link:
  this app's usernames map to synthetic addresses with no real inbox behind them, so an
  email-based reset link would silently go nowhere — it now says to contact the pharmacist/
  admin directly instead of implying a self-service flow that doesn't exist
- **feat:** redesigned "จัดการผู้ใช้งาน" (admin users tab) — stat tiles at the top (count per
  role + total active accounts), and each user row now shows a colored avatar (role-tinted,
  initials from their name) instead of a bare list, with the role picker recolored to match
  so the currently-assigned role is visually obvious at a glance instead of just bold/green

## [2.11.2] - 2026-08-26

### Fixed
- **fix:** logging in flashed "รอ Admin อนุมัติบัญชี" (waiting for approval) for a moment
  even on an already-approved account (confirmed by screenshot — the account name/username
  rendered blank during the flash, then the app opened normally right after). Root cause:
  the Firestore client here runs on a persistent (IndexedDB) local cache, and the very first
  snapshot for the profile listener can legitimately be a stale or incomplete cached copy of
  that doc — e.g. cached from before this exact account was approved, on a device that had
  its site data cleared recently — corrected moments later by the real server snapshot. The
  profile listener applied every snapshot immediately, including that stale first one, so it
  visibly (if briefly) downgraded the screen before self-correcting. Now a snapshot that
  upgrades to signed-in applies immediately, but one that downgrades to pending/signed-out is
  debounced ~0.6s — only committed if a better snapshot doesn't arrive in that window to
  cancel it. A genuinely pending or deactivated account still lands on that screen correctly,
  just very slightly later; nothing here can mask a real, lasting deactivation

## [2.11.1] - 2026-08-26

### Fixed
- **fix:** new-med code assignment (`MED-####`, the identifier printed on every QR label) was
  computed client-side as "current max + 1" — two people adding a new med at close to the
  same moment could both read the same max before either write landed, and both mint the
  *same* code, meaning two different drugs' labels would both resolve to whichever med
  happened to come first in a lookup. Rare, but a real gap given "the QR must always point to
  the right, and only the right, drug" is the whole point of the label system. Now assigns the
  code atomically via a Firestore transaction against a counter doc (`meta/medSeq`) — Firestore
  itself retries the transaction if two clients race, so no two adds can ever land on the same
  next number, however close together they happen

## [2.11.0] - 2026-08-26

### ⚠️ Requires a manual step — Firestore rules
This release adds a new `pendingReceives` collection. **`firestore.rules` must be
re-published to the Firebase Console** (Firestore Database → Rules tab → paste the whole
file → Publish) or the new approval feature below will fail with permission-denied for
everyone. Same manual step as always — this session can't push Firestore rules itself.

### Fixed
- **fix (real bug, not cosmetic):** "รับยาเข้า substock" submitted by a ผู้ช่วยเภสัชกร (tech)
  said "ส่งให้เภสัชกรอนุมัติแล้ว" (sent to a pharmacist for approval), but no approval screen,
  button, or workflow existed anywhere in the app — the submission wrote a loose note into
  the tx log and then went nowhere. The stock those items represented was never actually
  added to substock, ever, for any tech-submitted receive since the app existed — a silent,
  permanent stock-tracking gap with zero error or indication anything was wrong. Built the
  real workflow: a submission now creates a structured `pendingReceives` record with the
  actual medId/lot/exp/qty; a "รออนุมัติ" list on the same "รับเข้า" screen shows pharm/admin
  every open request with อนุมัติ/ปฏิเสธ buttons (approve creates the real lot + tx, exactly
  what the direct-approve path already did; reject asks for a reason and logs it to audit).
  A tech sees their own pending requests and status on the same screen. Added a live count
  badge on the "รับเข้า" bottom-nav tab for pharm/admin so an open request doesn't go
  unnoticed. Both approve and reject run inside a Firestore transaction so two people acting
  on the same request at once can't double-approve it
- **fix:** Turnover report (รายงาน → Turnover) sorted by a cross-referenced ratio —
  `b.used30 / a.parFloor` instead of each drug's own `used30 / parFloor` — so the "highest
  turnover first" ordering was essentially random, not actually sorted by turnover. This was
  a display-only bug (the CSV export was unaffected, and no stock numbers were wrong), but a
  real one: a pharmacist scanning that screen top-to-bottom to prioritize stock reviews was
  looking at the wrong order the whole time

### Verified working (no change needed)
- Self-audited the rest of the app's screens/actions against this same standard —
  home dashboard tiles, transfer (FEFO + cart + high-alert QR gate), receive (direct path),
  adjust/return/damaged/expired, count reconciliation, HOSxP reconcile + fuzzy-match
  confirmation, CSV exports (aging/turnover/discrepancy/audit), labels/QR print+scan, par
  suggestions, user approval + role/last-admin guards, audit history search — all wired to
  real Firestore reads/writes with no dead-end buttons or silent no-ops found

## [2.10.3] - 2026-08-26

### Fixed
- **fix:** camera QR scanner requested no resolution constraints from `getUserMedia`, so on
  some phone browsers (iOS Safari in particular) the actual camera stream defaults to a low
  capture resolution — fine for a video call, not enough to resolve a QR that only fills a
  small part of the frame. Now requests `{ width: 1920, height: 1080 } ideal`, and asks for
  continuous autofocus on cameras that support it (some devices otherwise focus once on
  whatever was in frame when the camera opened and never refocus on a label held up after)
- **fix:** scan sheet now says explicitly to get close enough that only one QR fills the
  green frame — a user pointing the camera at an entire printed sheet from a normal
  distance was capturing 5-6 labels in one frame, each too small to decode even with a
  correctly-sized QR on the label itself

### Note
- The QR-too-small-to-print fix from 2.10.2 still requires reprinting shelf labels — that
  part doesn't change here. This release targets the camera side separately, since a
  correctly-sized QR still won't scan if the camera stream itself is low-resolution or the
  phone is held too far back to capture a single label

## [2.10.2] - 2026-08-26

### Fixed
- **fix:** shelf-label QR stopped scanning reliably — the "larger drug name text" change
  shrank the QR from 16mm down to 13mm to make room for bigger name text on the strip.
  Root-caused with a synthetic decode test (render at 300dpi print resolution → simulate a
  phone camera photographing it at typical capture resolution/blur): 13mm survives a sharp
  close-up shot but fails as soon as any blur/distance is simulated, while ~16.6mm keeps
  decoding under the same conditions. QR is back to ~16.6mm — bigger than the original
  working size, not just restored — with the strip layout rebalanced (bin chip narrowed
  slightly) so the name still prints at full size on one line. Also widened the QR's
  built-in quiet zone (2→3 modules) for better lock-on under real-world lighting/creases.
  **Any shelf labels already printed since that change should be reprinted** — the QR on
  those sheets is physically too small and that can't be fixed after printing
- **fix:** cleaned up the shelf-strip visual design (both the print sheet and the on-screen
  preview in ระบบฉลาก QR) — thin dividers between the bin chip / QR / name sections, rounded
  strip corners, consistent ink color, tighter tag spacing — was reported as looking rough

## [2.10.1] - 2026-08-26

### Changed
- **refactor:** removed the now-duplicated per-item par/ชั้นวาง editing list from "ตั้งค่า
  par level และชั้นวาง" — since v2.10.0 added full per-med editing (ชื่อ/ขนาด/หน่วย/ราคา/par/
  ชั้นวาง) to จัดการรายการยา, having the same par+bin fields editable in two separate screens
  was confusing and risked the two forms drifting apart. Settings screen now keeps only what
  จัดการรายการยา doesn't cover — the global "par อัตโนมัติจากสถิติการใช้" bulk actions and the
  expiry-warning-days display — plus a link into จัดการรายการยา for per-item edits. Renamed the
  More-screen menu entry to "par อัตโนมัติ & เกณฑ์แจ้งเตือน" so it no longer reads as a duplicate
  of "จัดการรายการยา"

### Verified (no code change)
- **QR-to-data real-time:** confirmed printed QR labels always resolve against live data —
  the QR only encodes the med's stable `code` (e.g. `MED-0035`), never a snapshot of its
  name/price/par, and scanning always looks it up in `state.meds`, which is kept live by an
  always-on Firestore `onSnapshot` listener. So editing a med in จัดการรายการยา and then
  re-scanning its already-printed label shows the update immediately, with no re-print needed —
  this was already true by construction, not a new fix

## [2.10.0] - 2026-08-25

### Added
- **feat:** full medication editing, all in one place — จัดการรายการยา now has "แก้ไขข้อมูล" per
  row, opening the same form used to add a new med (pre-filled): ชื่อยา+ขนาด, รูปแบบยา, หน่วย,
  ราคา/หน่วย, high-alert flag, ชั้นวาง, and both par levels, saved together in one write.
  Previously name/dosage form/unit/price could only be set once at creation — there was no way
  to fix a typo, a price change, or a wrong unit on an existing med short of deleting and
  re-adding it (which itself only works at zero stock). `code` (the identifier already printed
  on QR labels) is never touched by an edit, so existing labels keep resolving correctly
- **feat:** "สแกนดูข้อมูลยา" (▣ button, จัดการรายการยา) — scan a med or lot label's real QR and
  jump straight to that med's edit panel, scrolled into view, instead of hunting through the
  list. Connects the QR labels actually to something: print → stick on the shelf → scan →
  see/edit that exact drug's full record

## [2.9.3] - 2026-08-25

### Fixed
- **fix:** blank white home screen on every login, until manually tapping "หน้าหลัก" — `screen`
  stays at its initial/post-logout value of `'login'` in state; nothing ever moved it to
  `'home'` once `authStatus` flips to `'signedIn'`. The `Screens()` switch in App.tsx has no
  case for `'login'` (the login screen renders separately, gated directly on `authStatus`), so
  it fell through to `default: return null` — a blank `<main>` — until something else (tapping
  a nav button) changed `screen` to a real value. Now lands on `'home'` specifically when
  coming from that `'login'` state, without stomping on wherever else you might already be

## [2.9.2] - 2026-08-25

### Fixed
- **fix:** an admin could demote or deactivate their own account (or the last remaining admin
  account) with one tap and no confirmation — no warning, and nothing stopping it from being
  the *only* admin, which would lock the hospital out of admin functions entirely (nobody left
  to approve accounts or promote anyone back) short of hand-editing Firestore in the Firebase
  console again, same as the very first bootstrap step. Now:
  - changing your own role, or deactivating your own account, asks for confirmation first
  - demoting or deactivating the last active admin is blocked outright, with an explanation
  - your own row in Admin → ผู้ใช้งาน is now marked "(คุณ)" so it's obvious at a glance which
    one is you before tapping a role button

## [2.9.1] - 2026-08-25

### Fixed
- **fix:** the bottom nav could scroll off-screen entirely on any content-heavy screen (the
  home dashboard with its stat tiles + several lists, in particular) — `.app-shell` used
  `min-height: 100vh`, which let the flex column grow *taller* than the viewport whenever a
  screen's content was long, pushing the whole page into normal document-level scroll instead
  of confining scrolling to `<main>`. The header and bottom nav are supposed to stay pinned;
  instead they'd scroll away with the content, so reaching the nav meant scrolling all the way
  down. Changed to a fixed `100dvh` (with a `100vh` fallback) height with `overflow: hidden`
  on the shell, so only `<main>` scrolls — verified with a headless render that the document
  itself no longer scrolls at all, only the content pane between header and nav
  - the three login-screen states got `overflow-y: auto` added explicitly, so this doesn't
    newly clip a tall register form (long content + an on-screen keyboard) instead of
    scrolling it, now that the shell itself is a fixed height

## [2.9.0] - 2026-08-25

### Changed
- **feat:** shelf-tag label name shortened to "generic name + strength" and kept to one line
  — `shortLabelName()` trims trailing packaging detail (e.g. "Vial", "Amphule (2 mL.)", "ซอง")
  that's still on the underlying master data (search/HOSxP-matching still see the full name;
  this only affects what's printed/previewed on the label) since it doesn't help identify the
  drug at a glance and was pushing names onto a second line
  - name text now sizes per-label (17pt down to 9pt) based on length instead of one fixed
    size, so a short name reads large and a long one shrinks to fit *one line* rather than
    truncating mid-strength — losing "500 mg" off the end would defeat the label's purpose.
    ALL-CAPS names (common in this formulary) are weighted as wider, since they render
    noticeably wider per character than mixed case
  - bug fix along the way: the Thai packaging-word trim (ซอง/ขวด/หลอด/...) was silently never
    matching — `\b` word-boundaries in JS regex are ASCII-only and never match next to Thai
    script, so only the English half of the original combined pattern actually worked
  - verified the sizing with a headless render across a spread of real formulary name lengths
    (short/medium/long, mixed-case and all-caps) — every one fits its single line

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
