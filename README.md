# ระบบจัดการสต็อกยา OPD · รพ.กรงปินัง

Implementation ของดีไซน์ `ระบบสต็อกยา OPD.dc.html` (Claude Design) — เว็บแอปจัดการสต็อกยาสำหรับห้องยาผู้ป่วยนอก
ครอบคลุม flow ตั้งแต่คลังย่อย (substock) → หน้างานจ่ายยา (floor) พร้อมติดตาม lot และวันหมดอายุแบบ FEFO

## Stack

- React 18 + TypeScript + Vite
- ไม่มี backend จริง — state ทั้งหมดอยู่ใน React Context และ persist ผ่าน `localStorage`
  (จุดเชื่อมต่อกับ Firebase Auth/Firestore และ HOSxP ตามที่ระบุในดีไซน์ต้นฉบับยังเป็น mock/placeholder)
- Master data ยา 585 รายการ นำเข้าจาก `src/data/med_list.csv` (บัญชีเวชภัณฑ์ยา รพ.กรงปินัง) —
  par/stock/lot/high-alert ถูกสุ่มสร้างแบบ deterministic (seed ตาม index) เพื่อให้เดโมมีข้อมูลสมจริง
  รายการที่มีหมายเหตุ "ไม่มียาในรพ.กรงปินัง" ในชื่อจะถูกทำเครื่องหมายเป็น inactive (par/stock = 0)

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

- `src/data/` — CSV ต้นฉบับ + ตัวสร้างข้อมูลตั้งต้น (seed)
- `src/store/AppContext.tsx` — state ทั้งแอปและ action ทั้งหมด (login, เติมหน้างาน/FEFO, รับเข้า substock,
  ปรับยอด/คืนยา/ยาหมดอายุ, นำเข้า HOSxP, นับสต็อก, รายงาน, ฉลาก QR, จัดการผู้ใช้ + audit log)
- `src/screens/` — หน้าจอแต่ละหน้าตาม flow ในดีไซน์
- `src/components/` — ชิ้นส่วนที่ใช้ร่วมกัน (QR modal, toast, QR code generator)

## ข้อสมมติที่ใช้ออกแบบ (ตามดีไซน์ต้นฉบับ)

การจ่ายยาให้ผู้ป่วยบันทึกใน HOSxP อยู่แล้ว แอปนี้จึงไม่มีหน้าบันทึกจ่ายยาซ้ำ ยอดหน้างานตัดจริงผ่าน
"นำเข้าจาก HOSxP" เป็นวิธีหลัก ส่วน "นับสต็อกหน้างาน" เป็นฟังก์ชันเสริมไว้ใช้เมื่อสงสัยยอดคลาดเคลื่อน
หน้างานไม่ track lot (lot จบที่ substock) จึงตัดยอด FEFO ตอนเติมหน้างานและบันทึก lot ลง transaction เพื่อ trace ย้อนได้
ผู้ช่วยเภสัชกรบันทึกใบรับได้แต่ยอดเข้าสต็อกเมื่อเภสัชกรอนุมัติ ยา high alert บังคับสแกน QR ก่อนเติมหน้างาน
ทุกรายการปรับยอดต้องมีเหตุผล
