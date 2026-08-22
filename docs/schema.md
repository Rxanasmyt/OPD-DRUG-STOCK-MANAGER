# โครงสร้างข้อมูล Firestore

หลักการออกแบบสำคัญ 3 ข้อที่ยึดตลอดทั้งระบบ:

1. **`transactions` คือแหล่งความจริงเดียว (single source of truth)** — เป็น append-only audit
   log ที่ client สร้างได้อย่างเดียว ห้ามแก้/ลบ (บังคับด้วย `firestore.rules`) ยอดคงเหลือทุกจุด
   ไม่ได้มาจากการที่ client เขียนตรง ๆ แต่คำนวณโดย Cloud Function `onTransactionCreate`
   (`functions/inventory.js`) ที่ปรับ `substock_inventory` / `floor_inventory` แบบ atomic
   ผ่าน `db.runTransaction` ทุกครั้งที่มีธุรกรรมใหม่ — ป้องกันยอดเพี้ยนจากการเขียนแข่งกันของ
   หลายอุปกรณ์พร้อมกัน (สำคัญมากเพราะแอปเป็น offline-first)
2. **Substock ติดตามตาม lot, หน้างานไม่ติดตามตาม lot** — ตัดสินใจไว้ตามที่ระบุใน prompt
   ต้นทาง: `substock_inventory` เก็บยอดแยกราย lot (จำเป็นสำหรับ FEFO และวันหมดอายุ)
   ส่วน `floor_inventory` เก็บยอดรวมต่อยา 1 เอกสารเท่านั้น (เร็วต่อการจ่ายยาหน้างานซึ่งต้องทำ
   ได้ในไม่กี่ tap) FEFO ถูกบังคับใช้ที่ขั้นตอน "โอนจาก substock ไปหน้างาน" แทน — เพราะฉะนั้น
   ของที่ไหลเข้าหน้างานจะเรียงตามวันหมดอายุอยู่แล้วโดยธรรมชาติ ส่วนความเสี่ยงด้าน visibility
   วันหมดอายุที่หน้างาน แก้ด้วยฟิลด์ `earliest_exp_date` ที่ denormalize ไว้ใน `floor_inventory`
   (อัปเดตทุกครั้งที่มีการโอนเข้า) ให้เห็นคร่าว ๆ โดยไม่ต้องแลก performance ทั้งระบบ
3. **Schema เผื่อต่อยอดเชื่อมคลังยาใหญ่ในอนาคต** — `lots.central_requisition_no` (ผ่านฟิลด์
   `requisition_no` บนธุรกรรม `receive_from_central`) และ collection `central_requisitions`
   (stub ยังไม่ใช้งานจริงในเฟสนี้) เตรียมไว้ให้ผูกกับระบบคลังใหญ่ภายหลังได้โดยไม่ต้อง
   ปรับโครงสร้างใหม่

## Collections

### `medications` — master data ยา
| field | type | หมายเหตุ |
|---|---|---|
| generic_name | string | ชื่อสามัญ (ใช้ค้นหา/แสดงหลัก) |
| trade_name | string | ชื่อการค้า |
| code | string | รหัสยาภายใน (ถ้ามี) |
| strength, category | string | |
| unit_issue | string | หน่วยเบิกที่ substock เช่น "กล่อง" |
| unit_dispense | string | หน่วยจ่ายที่หน้างาน เช่น "เม็ด" |
| conversion_factor | number | 1 unit_issue = กี่ unit_dispense |
| is_high_alert | boolean | บังคับสแกน QR ยืนยันก่อน transfer/dispense |
| reorder_point_substock | number | จุดสั่งซื้อที่ substock |
| reorder_point_floor | number | จุดสั่งซื้อที่หน้างาน |
| par_level_floor | number | ระดับเป้าหมายที่ควรเติมหน้างานให้ถึง |
| active | boolean | false = ปิดใช้งาน (ไม่ลบจริง) |

### `lots` — ล็อตยาที่เคยรับเข้า
`medication_id, lot_no, exp_date, received_date, created_by, created_at`

### `substock_inventory` — ยอดคงเหลือ substock **แยกราย lot**
document id = `${medication_id}_${lot_id}` (deterministic เพื่อ upsert ได้โดย Cloud Function)
มี `lot_no`, `exp_date`, `received_date` denormalize มาจาก `lots` ตอนรับยาเข้า เพื่อให้หน้า
"โอนไปหน้างาน" อ่านค่าที่ต้องใช้ทำ FEFO ได้จาก query เดียว ไม่ต้อง join

### `floor_inventory` — ยอดคงเหลือหน้างาน **รวมต่อยา ไม่แยก lot**
document id = `medication_id` โดยตรง — field: `qty`, `earliest_exp_date` (informational)

### `transactions` — audit log (ห้ามแก้/ลบ)
`type, medication_id, lot_id, qty, unit, from_location, to_location, performed_by,
performed_by_name, role, reason, requires_reason, note, high_alert_confirmed, timestamp
(server), created_at_client (ใช้เรียงลำดับตอน offline ก่อน sync)`

ดูรายการ `type` ทั้งหมดและ role ที่สร้างได้ใน `src/lib/constants.js`
(`TX_TYPES`, `TX_TYPES_ALLOWED_BY_ROLE`, `TX_TYPES_REQUIRE_REASON`)

### `users`
`name, email, role (pharmacist|tech|admin|null), department, active, created_at`
บัญชีใหม่เริ่มที่ `role: null, active: false` เสมอ ต้องรอ admin อนุมัติ (ดู `firestore.rules`)

### `alerts` — สร้าง/อัปเดตโดย Cloud Function เท่านั้น (client อ่านอย่างเดียว)
`type (reorder_substock|reorder_floor|expiring_soon|expired_lot), level (warning|critical),
medication_id, lot_id?, message, resolved, updated_at`
ใช้ deterministic id ต่อสาเหตุ (เช่น `reorder_substock_{medId}`) เพื่อ upsert/auto-resolve ได้

### `central_requisitions` (stub, ยังไม่ใช้งานจริง)
เผื่อไว้สำหรับเชื่อมระบบคลังยาใหญ่ในเฟสถัดไป
