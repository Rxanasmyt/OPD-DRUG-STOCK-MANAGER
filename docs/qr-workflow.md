# QR Code Workflow

## รูปแบบ payload

แอปนี้เข้ารหัส QR ของตัวเองด้วย prefix ง่าย ๆ (ดู `src/lib/qr.js`):

| ประเภท | payload |
|---|---|
| ยา | `OPDRX:MED:<medicationId>` |
| ล็อต | `OPDRX:LOT:<lotId>` |
| ยืนยัน High-alert | `OPDRX:HA:<medicationId>` (จริง ๆ ใช้รหัสยาเดิมซ้ำ — ดูด้านล่าง) |

## พิมพ์ QR label

หน้า **จัดการ > พิมพ์ QR label ยา** (`/admin/qr-labels`, สิทธิ์เภสัชกร/admin) สร้าง QR ของยา
ทุกตัวในระบบเป็น `OPDRX:MED:<id>` ให้เลือกพิมพ์เป็นแผ่นเพื่อไปติดหน้ากล่อง/ช่องเก็บยาที่ substock
และหน้างานจ่ายยา — ใช้ `window.print()` กับ CSS `@media print` ที่ซ่อน UI อื่นเหลือแค่ grid ของ label

## จุดที่ใช้สแกน

1. **รับยาเข้า / โอนไปหน้างาน / จ่ายยา** — ปุ่มสแกนใน `MedicationPicker` ใช้แทนการพิมพ์ค้นหาชื่อยา
   (เร็วกว่าและกันเลือกยาผิดชื่อคล้ายกัน)
2. **ยา High-alert (forcing function)** — ก่อนยืนยัน "โอนไปหน้างาน" หรือ "จ่ายยา" สำหรับยาที่ตั้ง
   `is_high_alert: true` ระบบจะบล็อกปุ่มยืนยันไว้จนกว่าจะสแกน QR ของยาตัวนั้นซ้ำอีกครั้งใน
   `HighAlertConfirm` component — ถ้าสแกนได้รหัสยาไม่ตรงกับยาที่เลือกไว้ ระบบจะแจ้งเตือนและไม่ปลดล็อก
   แนวคิดเดียวกับ forcing function แบบ "Emergency Box Notify" ที่ต้องยืนยันซ้ำก่อนเปิดใช้ของสำคัญ
   ป้องกันการหยิบผิดกล่อง/สลับชื่อยาหน้าตาคล้ายกัน (look-alike/sound-alike)

## เพิ่มประเภท QR ใหม่ในอนาคต

ถ้าต้องการสแกนล็อตโดยตรง (เช่น พิมพ์ QR แยกต่อ lot ไม่ใช่แค่ต่อยา) ให้ใช้
`encodeLotQR(lotId)` ที่มีอยู่แล้วใน `src/lib/qr.js` และเพิ่ม branch จัดการ `kind === 'lot'`
ใน component ที่ต้องใช้ (เช่น preselect lot ใน `LotPicker` จากผลสแกน)
