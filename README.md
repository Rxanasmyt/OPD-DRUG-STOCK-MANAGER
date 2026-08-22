# 💊 จัดการสต็อกยา OPD

PWA (Progressive Web App) สำหรับบริหารสต็อกยาห้องยาผู้ป่วยนอก (OPD) ของโรงพยาบาลชุมชน
ครอบคลุม 2 จุดเก็บยาหลัก:

- **Stock ย่อยห้องยา (Substock)** — พื้นที่เก็บยา bulk หลังร้าน รับยาเข้าเป็นรอบจากคลังยาใหญ่
- **หน้างานจ่ายยา (Floor stock)** — ชั้น/ตู้ที่เภสัชกรหยิบจ่ายจริง เติมจาก substock บ่อยครั้ง

เป้าหมาย: ลดความคลาดเคลื่อนของสต็อก, ควบคุมยาใกล้หมดอายุแบบ **FEFO**, แจ้งเตือน reorder
อัตโนมัติ, และเก็บ audit trail ครบทุกธุรกรรมสำหรับทำรายงาน PTC/CQI

## ฟีเจอร์หลัก

- 📥 รับยาเข้า substock พร้อมระบุ lot/วันหมดอายุ อ้างอิงใบเบิกจากคลังใหญ่
- 🔁 โอนยา substock → หน้างาน แบบ FEFO auto-suggest (แนะนำ lot ใกล้หมดอายุสุดให้อัตโนมัติ)
- 💊 บันทึกจ่ายยาให้ผู้ป่วยจากหน้างาน
- ↩️ คืนยา / ปรับยอด / ยาหมดอายุ-เสียหาย — บังคับกรอกเหตุผลทุกรายการ
- 🔔 แจ้งเตือน reorder point และยาใกล้หมดอายุ (<90 วัน) แบบ real-time + คำนวณซ้ำฝั่ง server
  ทุก 6 ชม. ด้วย Cloud Function เพื่อเก็บประวัติ/ต่อยอดแจ้งเตือนภายนอกได้
- 📊 Dashboard สรุปยอดคงเหลือ, รายการใกล้หมดอายุ, ยาต่ำกว่า par level
- ⚠️ ยา High-alert บังคับสแกน QR ยืนยันก่อน transfer/dispense (forcing function)
- 📤 Export CSV: ธุรกรรมทั้งหมด, Stock Aging, Turnover Rate, Discrepancy Log
- 📶 PWA ติดตั้งได้ + ทำงานออฟไลน์เบื้องต้น (บันทึกธุรกรรมค้างไว้ sync อัตโนมัติเมื่อมีเน็ต)
- 👥 3 บทบาท: เภสัชกร / ผู้ช่วยเภสัชกร / Admin — สิทธิ์ควบคุมด้วย Firestore Security Rules

## Tech Stack

- **Frontend:** React 18 + Vite, mobile-first, ภาษาไทยทั้งหมด, PWA ผ่าน `vite-plugin-pwa`
- **Backend:** Firebase (Firestore, Firebase Auth, Cloud Functions gen2)
- **QR:** `html5-qrcode` (สแกน) + `qrcode` (สร้าง label พิมพ์)
- **Offline:** Firestore persistent local cache (IndexedDB) ของ SDK เอง — ไม่ได้เขียน queue
  เองซ้ำซ้อน (รายละเอียดใน `src/firebase.js`)

## เริ่มต้นใช้งาน (Quick start)

```bash
npm install
cp .env.example .env      # ใส่ค่า Firebase config ของโปรเจกต์ตัวเอง
npm run dev
```

ดูขั้นตอนสร้างโปรเจกต์ Firebase และ deploy ขึ้น production แบบละเอียดใน **[DEPLOY.md](./DEPLOY.md)**

## โครงสร้างโปรเจกต์

```
src/
  components/     UI components ที่ใช้ซ้ำ (QRScanner, MedicationPicker, LotPicker, ...)
  contexts/        AuthContext (login state + role)
  hooks/           useOnlineStatus, usePendingWrites, useCollection, useStockAlerts, ...
  lib/             constants.js (role/tx-type ต้นแบบ), api.js (เขียน Firestore ทั้งหมด),
                   queries.js, fefo.js, csv.js, qr.js, reports.js, dates.js
  pages/           Login, Dashboard, ReceiveStock, TransferToFloor, Dispense, AdjustReturn,
                   Reports, admin/{UsersManagement,MedicationMaster,QRLabels}
functions/         Cloud Functions: onTransactionCreate (ปรับยอด inventory),
                   checkReorderAndExpiry (แจ้งเตือน, scheduled ทุก 6 ชม.)
firestore.rules    Security rules ตาม role (ดูละเอียดใน docs/schema.md)
docs/              schema.md (โครงสร้างข้อมูลละเอียด), qr-workflow.md
scripts/           seed.mjs (ใส่ยาตัวอย่าง), generate-icons.mjs (สร้างไอคอน PWA)
```

## สถาปัตยกรรมที่ควรรู้ก่อนแก้โค้ด

- **`transactions` คือแหล่งความจริงเดียว** — client ห้ามเขียน `substock_inventory` /
  `floor_inventory` / `alerts` ตรง ๆ (บล็อกด้วย `firestore.rules`) ยอดคงเหลือทุกจุดคำนวณโดย
  Cloud Function `onTransactionCreate` เท่านั้น กันยอดเพี้ยนจากการเขียนแข่งกันของหลายอุปกรณ์
  ตอน sync พร้อมกัน — ดูเหตุผลเต็ม ๆ ใน `docs/schema.md`
- **Substock ติดตามราย lot, หน้างานไม่ติดตามราย lot** (ตัดสินใจไว้ตาม trade-off ความเร็ว
  หน้าจ่ายยา — อธิบายละเอียดใน `docs/schema.md`)
- **role/transaction-type ต้นแบบอยู่ที่ `src/lib/constants.js`** — ถ้าจะเพิ่ม/แก้ ต้องแก้
  `firestore.rules` (ฟังก์ชัน `allowedTxTypesForRole`) ให้ตรงกันด้วยเสมอ

## Roadmap ที่ยังไม่รวมในเฟสนี้ (ตั้งใจเว้นไว้ให้ต่อยอด)

- เชื่อมต่อระบบคลังยาใหญ่จริง (schema เผื่อไว้แล้วผ่าน `central_requisitions` + field
  `requisition_no`)
- ส่งแจ้งเตือนออกช่องทางภายนอก (LINE Notify/อีเมล) จาก collection `alerts` ที่มีอยู่แล้ว
- เชื่อม HIS สำหรับดึงรายการจ่ายยาอัตโนมัติแทนกรอกจำนวนเอง
