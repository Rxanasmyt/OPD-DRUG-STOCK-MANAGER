# KPNHOS-DRUG SUBSTOCK-OPD-IPD-MANAGEMENT

ระบบจัดการสต็อกยา OPD/IPD · รพ.กรงปินัง

Implementation ของดีไซน์ `ระบบสต็อกยา OPD.dc.html` (Claude Design) — เว็บแอปจัดการสต็อกยาสำหรับห้องยาผู้ป่วยนอก/ผู้ป่วยใน
ครอบคลุม flow ตั้งแต่คลังย่อย (substock) → หน้างานจ่ายยา (floor) พร้อมติดตาม lot และวันหมดอายุแบบ FEFO

## Stack

- React 18 + TypeScript + Vite
- **Firebase** — Authentication (Email/Password) + Firestore (ข้อมูลยา/lot/ธุรกรรม/ผู้ใช้/audit log แบบ
  real-time sync ทุกอุปกรณ์) ดู `src/firebase.ts` — ค่า config เป็น public config ของ Firebase Web SDK
  (ไม่ใช่รหัสลับ) ความปลอดภัยจริงอยู่ที่ `firestore.rules`
- Master data ยา 585 รายการ นำเข้าจาก `src/data/med_list.csv` (บัญชีเวชภัณฑ์ยา รพ.กรงปินัง) — par
  targets/high-alert/ชั้นวางเริ่มต้น ถูกสุ่มสร้างแบบ deterministic (seed ตาม index) ให้มีค่าตั้งต้น
  ที่สมเหตุสมผล แต่**ยอดหน้างานและ substock ทุกตัวเริ่มที่ 0 เสมอ ไม่มี lot ใดๆ ถูกสร้างขึ้นมาลอยๆ**
  — นี่คือการตั้งค่าระบบจริงครั้งแรก ไม่ใช่ demo data จึงต้องบังคับให้มีการนับสต็อกจริงก่อนใช้งาน
  (ผ่านหน้า "รับยาเข้า"/"นับสต็อกหน้างาน") แทนที่จะปล่อยให้ตัวเลขที่สุ่มมาถูกเข้าใจผิดว่าเป็นของจริง
  รายการที่มีหมายเหตุ "ไม่มียาในรพ.กรงปินัง" ในชื่อจะถูกทำเครื่องหมายเป็น inactive (par/stock = 0)
- **QR label จริง** — `qrcode` เข้ารหัส payload ของยา/lot/ชั้นวางเป็น QR ที่สแกนได้จริง, พิมพ์ลงกระดาษ
  สติกเกอร์ A4 ได้จริง (`window.print()`), และสแกนกลับด้วยกล้องเครื่อง (`jsqr`) ในหน้ารับเข้า/เติมหน้างาน/
  ยืนยันยา high alert — ดู `src/utils/qr.ts`, `src/components/QrScanner.tsx`, `src/utils/print.ts`

## ตั้งค่า Firebase (ต้องทำก่อนแอปจะใช้งานได้)

1. **Publish security rules** — ไปที่ [Firebase Console](https://console.firebase.google.com) → เลือก
   project → Firestore Database → แท็บ **Rules** → copy เนื้อหาทั้งหมดใน `firestore.rules` ไปวางแทนของเดิม →
   **Publish** (ถ้าไม่ทำขั้นตอนนี้ แอปจะใช้งานไม่ได้เลย เพราะ Firestore เริ่มต้นปฏิเสธ read/write ทั้งหมด)
2. **สมัครบัญชีแรกผ่านแอป** — เปิดแอป → แท็บ "สมัครสมาชิก" → ตั้งชื่อผู้ใช้ (username) ของตัวเอง (จะเข้าสถานะ
   "รออนุมัติ" อัตโนมัติ) — ระบบนี้ล็อกอินด้วย username ไม่ใช่อีเมล (ข้างในแปลงเป็นอีเมลปลอมให้ Firebase Auth
   เองอัตโนมัติ ผู้ใช้ไม่ต้องรู้/ไม่เห็นอีเมลนี้เลย)
3. **ตั้งบัญชีแรกให้เป็น Admin (ทำครั้งเดียว)** — เพราะยังไม่มีใครอนุมัติได้ ต้องทำเองผ่าน Console:
   Firebase Console → Firestore Database → แท็บ **Data** → collection `users` → เปิด document ของบัญชีที่เพิ่งสมัคร
   (ดูจาก field `username`) → แก้ `active` เป็น `true` และ `role` เป็น `"admin"` → Save
4. **ล็อกอินใหม่อีกครั้ง** ในแอป — ตอนนี้จะเข้าเป็น Admin ได้แล้ว
5. หน้าหลักจะแสดง "ยังไม่มีข้อมูลยาในระบบ" — กด **"โหลดข้อมูลตั้งต้น"** เพื่อนำเข้ายา 585 รายการ + lot ตัวอย่าง
6. จากนี้พนักงานคนอื่นสมัครเองผ่านแอปได้เลย แล้ว Admin ไปกด "อนุมัติ" ในหน้า Admin → ผู้ใช้งาน

## รัน dev server

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
npm run preview
```

## Test

```bash
npm test        # unit tests (vitest) — src/**/*.test.ts, covers the pure stock-math functions
npm run lint     # type-check only (tsc --noEmit), no build output
```

`.github/workflows/ci.yml` runs both automatically on every push/PR to any branch — a pure gate,
never deploys anything. `.github/workflows/deploy-pages.yml` is the separate workflow that
actually builds + publishes to GitHub Pages, and only runs on pushes to `main`.

## โครงสร้าง

- `src/firebase.ts` — เริ่มต้น Firebase app/Auth/Firestore
- `firestore.rules` — security rules (ต้อง publish เข้า Firebase Console เอง ดูด้านบน)
- `src/data/` — CSV ต้นฉบับ + ตัวสร้างข้อมูลตั้งต้น (seed), `seedFirestore.ts` เขียนข้อมูลตั้งต้นลง Firestore
- `src/store/AppContext.tsx` — auth state + live Firestore sync + action ทั้งหมด (เติมหน้างาน/FEFO,
  รับเข้า substock, ปรับยอด/คืนยา/ยาหมดอายุ, นำเข้า HOSxP, นับสต็อก, รายงาน, ฉลาก QR, จัดการผู้ใช้ + audit log)
- `src/screens/` — หน้าจอแต่ละหน้าตาม flow ในดีไซน์
- `src/components/` — ชิ้นส่วนที่ใช้ร่วมกัน (QR modal, toast, QR code generator)

## สิทธิ์ผู้ใช้งาน

บัญชีใหม่ทุกบัญชีสมัครเองผ่านหน้า login (ชื่อผู้ใช้ + รหัสผ่าน) แล้วอยู่ในสถานะรออนุมัติ (`active: false`,
`role: 'tech'`) — เข้าใช้งานไม่ได้จนกว่า Admin จะกด "อนุมัติ" ในหน้า Admin → ผู้ใช้งาน (ซึ่งกำหนดบทบาทได้ 3 แบบ:
เภสัชกร / ผู้ช่วยเภสัชกร / Admin) ทุกการเปลี่ยนบทบาท/สถานะบัญชีถูกบันทึกลง audit log

**ลืมรหัสผ่าน?** เพราะ username ไม่ใช่อีเมลจริง จึงส่งลิงก์รีเซ็ตรหัสผ่านทางอีเมลแบบมาตรฐานของ Firebase ไม่ได้
— Admin ต้องช่วยตั้งรหัสผ่านใหม่ให้เองผ่าน Firebase Console → Authentication → หา user (ค้นด้วย
`username@opd-drug-stock.local`) → เมนู ⋮ → Reset password

## ข้อสมมติที่ใช้ออกแบบ (ตามดีไซน์ต้นฉบับ)

การจ่ายยาให้ผู้ป่วยบันทึกใน HOSxP อยู่แล้ว แอปนี้จึงไม่มีหน้าบันทึกจ่ายยาซ้ำ ยอดหน้างานตัดจริงผ่าน
"นำเข้าจาก HOSxP" เป็นวิธีหลัก ส่วน "นับสต็อกหน้างาน" เป็นฟังก์ชันเสริมไว้ใช้เมื่อสงสัยยอดคลาดเคลื่อน
หน้างานไม่ track lot (lot จบที่ substock) จึงตัดยอด FEFO ตอนเติมหน้างานและบันทึก lot ลง transaction เพื่อ trace ย้อนได้
ทุกบทบาทรับยาเข้า substock ได้ทันทีโดยไม่ต้องรออนุมัติ (ตั้งแต่ v3.69.0 — เดิมผู้ช่วยเภสัชกรต้องรอเภสัชกร/Admin
อนุมัติก่อน ปรับตามคำขอจริงช่วงคนทำงานน้อย) ยา high alert บังคับสแกน QR ก่อนเติมหน้างาน
ทุกรายการปรับยอดต้องมีเหตุผล

## สำรองข้อมูลและกู้คืน (Backup & Restore)

- `.github/workflows/firestore-backup.yml` รันทุกคืนเวลา 02:00 (เวลาไทย) — `scripts/backup-firestore.mjs`
  export ทุก collection หลัก (meds, lots, txs, auditLog, users, usernames, pendingReceives, meta) แล้ว
  `scripts/verify-backup.mjs` ตรวจความครบถ้วนทันทีในรันเดียวกัน ผลลัพธ์เก็บเป็น **GitHub Actions
  artifact** ชื่อ `firestore-backup-<run_id>` — **เก็บไว้แค่ 14 วันแล้วหายอัตโนมัติ** ถ้าต้องการเก็บนานกว่านั้น
  ต้องดาวน์โหลดออกมาเก็บที่อื่นเอง (ไปที่ repo → แท็บ Actions → เลือกรันที่ต้องการ → ส่วน Artifacts)
- **กู้คืนข้อมูล**: ใช้ `scripts/restore-firestore.mjs` (รันจากเครื่อง dev เอง ต้องมี
  `FIREBASE_SERVICE_ACCOUNT_KEY` — ขอจาก Firebase Console → Project settings → Service accounts) —
  ค่าเริ่มต้นเป็น **dry-run** (ดูว่าจะเขียนอะไรบ้าง ไม่เขียนจริง) ต้องใส่ `--confirm` ถึงจะเขียนจริง และใช้
  `--only=meds,lots` (เป็นต้น) กู้เฉพาะบาง collection ได้ถ้าไม่อยากทับข้อมูลทั้งหมด — อ่าน comment ต้นไฟล์
  ก่อนใช้ทุกครั้ง เพราะเป็นคำสั่งที่เขียนทับข้อมูลจริงถ้าใส่ `--confirm` ผิดจังหวะ

## หากแอปพัง/มีบัคหลังจากเพิ่งอัปเดต (Rollback)

Deploy ทุกครั้งที่ push เข้า `main` จะขึ้นเว็บจริงทันที ไม่มีขั้นตอนทดสอบคั่นกลาง ถ้าเจอปัญหาหลังอัปเดต:

1. เปิด `CHANGELOG.md` หาเวอร์ชันล่าสุดที่ "รู้ว่าใช้งานได้ปกติ" (repo นี้ push git tag ไม่ได้ — โดน 403 จาก
   แพลตฟอร์ม — CHANGELOG.md + `VERSION` จึงเป็นแหล่งอ้างอิงเวอร์ชันแทน tag)
2. หา commit ของเวอร์ชันนั้นด้วย `git log --oneline | grep <เลขเวอร์ชัน>` แล้ว `git revert` commit ที่ทำให้พัง
   (หรือ revert ย้อนไปหลาย commit ถ้าจำเป็น) แล้ว push เข้า `main` ตามปกติ — ระบบจะ deploy เวอร์ชันที่แก้แล้ว
   ให้อัตโนมัติ
3. ทางเลือกเร็วกว่าถ้าต้องการแค่ "กลับไปเวอร์ชันเดิมก่อน" ชั่วคราวระหว่างรอแก้จริง: ไปที่ repo → Actions →
   เลือกรัน `deploy-pages.yml` ที่สำเร็จของเวอร์ชันก่อนหน้า → กด **Re-run all jobs** — จะ build+deploy commit
   เดิมนั้นทับเว็บที่ใช้งานอยู่ (ไม่กระทบ Firestore/ข้อมูล กระทบแค่หน้าเว็บ)

## ถ้า cron script (backup/แจ้งเตือน/KPI) เงียบหายไปเฉยๆ

3 workflow ที่รันตามตาราง (`firestore-backup.yml`, `low-stock-notify.yml`, `daily-metrics.yml`) ทั้งหมด
ใช้ secret เดียวกันคือ `FIREBASE_SERVICE_ACCOUNT_KEY` — ถ้า key นี้หมดอายุ/ถูกลบ ทั้ง 3 workflow จะ fail
พร้อมกันทุกวันโดยไม่มีใครรู้ ยกเว้นอีเมลแจ้งเตือนอัตโนมัติของ GitHub เอง (ส่งไปหาเจ้าของ/คนแก้ workflow ล่าสุด
เท่านั้น จุดเดียว ตกหล่นง่าย) — **แนะนำ**: เข้าไปดู repo → แท็บ Actions เป็นระยะ (เช่น สัปดาห์ละครั้ง) ว่าไม่มี
รันที่เป็นสีแดง (failed) ค้างอยู่ ถ้าต้องการสร้าง service account key ใหม่: Firebase Console → Project
settings → Service accounts → Generate new private key → เอาไปตั้งใน repo → Settings → Secrets and
variables → Actions → แก้ค่า `FIREBASE_SERVICE_ACCOUNT_KEY`

## ปัญหาที่พบบ่อย (สำหรับเจ้าหน้าที่ที่ไม่ใช่สายโปรแกรม)

- **แอปโหลดไม่ขึ้น/ค้างที่หน้าขาว** — ลองปิดแล้วเปิดแอปใหม่ก่อน ถ้ายังไม่ได้ให้เช็คสัญญาณอินเทอร์เน็ต (แอปนี้ต้อง
  เชื่อมต่อ Firebase อย่างน้อยครั้งแรก) ถ้ายังไม่หาย ลองอีกเครื่อง/อีกเบราว์เซอร์ก่อนแจ้ง Admin
- **เข้าสู่ระบบไม่ได้ ("ไม่พบบัญชี"/รหัสผ่านผิด)** — เช็คว่าพิมพ์ username (ไม่ใช่อีเมล) ถูกหรือไม่ ถ้าลืมรหัสผ่าน
  ดูหัวข้อ "ลืมรหัสผ่าน?" ด้านบน ต้องให้ Admin ช่วยตั้งใหม่ผ่าน Firebase Console เท่านั้น แอปไม่มีปุ่ม
  "ลืมรหัสผ่าน" ที่ทำเองได้เพราะ username ไม่ใช่อีเมลจริง
- **เข้าระบบได้แต่หน้าจอค้างที่ "รออนุมัติ"** — ให้ Admin เข้าไปกด "อนุมัติ" ในหน้า Admin → ผู้ใช้งาน (บัญชีใหม่
  ทุกบัญชีต้องรออนุมัติก่อนเสมอ ไม่ใช่บัค)
- **แก้ไขยา/ตั้งค่าระบบไม่ได้ ปุ่มหาย** — ตั้งแต่ v3.69.0 การแก้ข้อมูลยาและค่าตั้งค่าระบบสงวนไว้สำหรับ Admin
  เท่านั้น (ไม่ใช่บัค) ถ้าจำเป็นต้องแก้ให้ติดต่อ Admin
