# Changelog

รูปแบบอิงตาม [Keep a Changelog](https://keepachangelog.com/) และเวอร์ชันตาม [Semantic Versioning](https://semver.org/)

> **หมายเหตุเรื่อง git tag:** session ที่ดูแล repo นี้ไม่มีสิทธิ์ push `refs/tags/*` ขึ้น GitHub
> (branch push ปกติทำได้ แต่ tag push โดน 403 เสมอ — น่าจะเป็น guardrail ของแพลตฟอร์ม ไม่ใช่ปัญหา scope)
> และไม่มีเครื่องมือสำหรับสร้าง GitHub Release ในชุดเครื่องมือที่ใช้งานได้ จึงใช้ไฟล์นี้ + `VERSION`
> เป็นแหล่งความจริงของเลขเวอร์ชันแทน จนกว่าจะแก้ข้อจำกัดนั้นได้

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
