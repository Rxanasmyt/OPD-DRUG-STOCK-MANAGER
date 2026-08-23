# คู่มือ Deploy เป็น PWA (Firebase Hosting)

## 0) เตรียมของ
- Node.js 18+ และ npm
- บัญชี Google + สิทธิ์สร้างโปรเจกต์ใน [Firebase Console](https://console.firebase.google.com)
- ติดตั้ง Firebase CLI: `npm install -g firebase-tools`

## 1) สร้างโปรเจกต์ Firebase
1. ไปที่ Firebase Console > Add project > ตั้งชื่อ (เช่น `opd-pharmacy-stock`)
2. เปิดใช้ **Authentication** > Sign-in method > เปิด "Email/Password"
3. เปิดใช้ **Firestore Database** > สร้างฐานข้อมูล (เลือก region ใกล้ไทย เช่น `asia-southeast1`)
4. (สำหรับแจ้งเตือนอัตโนมัติ) เปิดใช้ **Cloud Functions** — ต้อง upgrade เป็นแผน Blaze
   (pay-as-you-go) ก่อน ถึงจะ deploy Functions ได้ (ยังมี free tier ให้ใช้อยู่)
5. ไปที่ Project settings > General > Your apps > เพิ่มแอปเว็บ (</> icon) เพื่อได้ค่า
   `firebaseConfig`

## 2) ตั้งค่าโปรเจกต์ในเครื่อง
```bash
git clone <repo-url>
cd OPD-
npm install
cp .env.example .env        # ใส่ค่า VITE_FIREBASE_* จากขั้นตอนที่ 1.5
cp .firebaserc.example .firebaserc   # แก้ project id ให้ตรงกับที่สร้างไว้
firebase login
```

## 3) รันทดสอบด้วย Firebase Emulator (แนะนำก่อน deploy จริง)
ตั้ง `VITE_USE_EMULATOR=true` ใน `.env` ก่อน (ดู `.env.example`) แล้วรัน 2 terminal:
```bash
npm run emulators     # เปิด Auth + Firestore + Functions emulator (ต้อง firebase login แล้ว)
# อีก terminal หนึ่ง
npm run dev            # เปิดเว็บ dev server ที่ localhost:5173 — จะต่อ emulator อัตโนมัติ
```
`src/firebase.js` เช็ค `VITE_USE_EMULATOR` ให้อัตโนมัติ — ตอนนี้ค่า `VITE_FIREBASE_*` ใส่เป็นค่า
อะไรก็ได้เพราะไม่ได้ต่อ production จริง (แค่ `projectId` ควรตรงกับใน `.firebaserc` เพื่อกันสับสน)
Emulator UI (ดู/แก้ข้อมูลตรงๆ) เปิดที่ `http://localhost:4000`

## 4) ใส่ข้อมูลตั้งต้น
1. เปิดเว็บแอป (หลัง deploy หรือ `npm run dev`) แล้ว **สมัครใช้งาน** บัญชีแรกของตัวเอง
2. ไปที่ Firestore Console > collection `users` > หาเอกสารของ uid ตัวเอง > แก้ไข
   `role: "admin"` และ `active: true` ด้วยมือ (ครั้งแรกเท่านั้น — หลังจากนี้ใช้หน้า
   "จัดการผู้ใช้" ในแอปอนุมัติบัญชีอื่น ๆ ต่อได้เลย)
3. (ไม่บังคับ) รัน `npm run seed` เพื่อใส่ยาตัวอย่าง — ต้องตั้ง
   `GOOGLE_APPLICATION_CREDENTIALS` ชี้ไปที่ service account key JSON ก่อน (ดาวน์โหลดได้จาก
   Project settings > Service accounts)

## 5) Deploy
```bash
npm run build                                             # build React app -> dist/
firebase deploy --only firestore:rules,firestore:indexes  # deploy security rules + indexes
firebase deploy --only functions                          # deploy Cloud Functions (ต้องแผน Blaze)
firebase deploy --only hosting                             # deploy เว็บ (dist/) ขึ้น Firebase Hosting
# หรือรันทั้งหมดทีเดียว
npm run deploy
```
Deploy สำเร็จแล้วจะได้ URL แบบ `https://<project-id>.web.app`

## 6) ทดสอบ PWA
- เปิด URL ด้านบนบน Chrome/Edge (มือถือหรือเดสก์ท็อป) แล้วกด "Install app" /
  "เพิ่มลงหน้าจอโฮม" — ควรมีไอคอนแอปสีเขียวติดตั้งเหมือนแอปทั่วไป
- ทดสอบออฟไลน์: เปิด DevTools > Network > Offline แล้วลองบันทึกธุรกรรม → ควรบันทึกได้ทันที
  และ badge ที่ header เปลี่ยนเป็น "ออฟไลน์" พร้อมนับจำนวนรายการที่รอ sync — พอกลับมาออนไลน์
  ธุรกรรมจะ sync อัตโนมัติภายในไม่กี่วินาที (ดูรายละเอียดกลไกใน `src/firebase.js`)

## 7) อัปเดตแอปหลัง deploy ครั้งแรก
```bash
npm run build && firebase deploy --only hosting
```
`vite-plugin-pwa` ตั้งเป็น `registerType: 'autoUpdate'` — ผู้ใช้จะได้เวอร์ชันใหม่อัตโนมัติ
เมื่อรีเฟรชแอป (อาจต้องปิด-เปิดแอปใหม่ 1 ครั้งถ้า service worker เดิมยัง cache หน้าเก่าอยู่)

## Troubleshooting ที่เจอบ่อย
| ปัญหา | สาเหตุที่พบบ่อย |
|---|---|
| หน้าเว็บฟ้อง "ไม่พบค่า VITE_FIREBASE_*" ใน console | ลืมสร้าง `.env` หรือใส่ค่าไม่ครบ |
| Login ไม่ได้ | ยังไม่เปิด Email/Password sign-in method ใน Firebase Auth |
| สมัครแล้วเข้าแอปไม่ได้ ค้างหน้า "รอการอนุมัติ" | ปกติ — ต้องให้ admin อนุมัติ role ก่อน (ดูขั้นตอน 4.2) |
| Transfer/Dispense แล้วยอดไม่ขยับ | ตรวจว่า deploy Cloud Functions แล้วหรือยัง (`onTransactionCreate`) — ดู log ด้วย `firebase functions:log` |
| deploy functions ไม่ได้ | โปรเจกต์ยังอยู่แผน Spark (ฟรี) ต้อง upgrade เป็น Blaze ก่อน |
