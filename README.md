# KPNHOS-DRUG SUBSTOCK-OPD-IPD-MANAGEMENT

ระบบจัดการสต็อกยา OPD/IPD · รพ.กรงปินัง

Implementation ของดีไซน์ `ระบบสต็อกยา OPD.dc.html` (Claude Design) — เว็บแอปจัดการสต็อกยาสำหรับห้องยาผู้ป่วยนอก/ผู้ป่วยใน
ครอบคลุม flow ตั้งแต่คลังย่อย (substock) → หน้างานจ่ายยา (floor) พร้อมติดตาม lot และวันหมดอายุแบบ FEFO

## Stack

- React 18 + TypeScript + Vite
- **Firebase** — Authentication (Email/Password) + Firestore (ข้อมูลยา/lot/ธุรกรรม/ผู้ใช้/audit log แบบ
  real-time sync ทุกอุปกรณ์) ดู `src/firebase.ts` — ค่า config เป็น public config ของ Firebase Web SDK
  (ไม่ใช่รหัสลับ) ความปลอดภัยจริงอยู่ที่ `firestore.rules`
- Master data ยา 585 รายการ นำเข้าจาก `src/data/med_list.csv` (บัญชีเวชภัณฑ์ยา รพ.กรงปินัง) —
  par/stock/lot/high-alert ถูกสุ่มสร้างแบบ deterministic (seed ตาม index) เพื่อให้มีข้อมูลตั้งต้นสมจริง
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
ผู้ช่วยเภสัชกรบันทึกใบรับได้แต่ยอดเข้าสต็อกเมื่อเภสัชกรอนุมัติ ยา high alert บังคับสแกน QR ก่อนเติมหน้างาน
ทุกรายการปรับยอดต้องมีเหตุผล
