// ค่าคงที่กลางของระบบ — ใช้ร่วมกันทั้งฝั่ง client และเป็นต้นแบบของ firestore.rules / functions
// *** ถ้าแก้ไขรายการ role หรือ transaction type ที่นี่ ต้องไปแก้ firestore.rules ให้ตรงกันด้วย ***

export const ROLES = {
  PHARMACIST: 'pharmacist', // เภสัชกร
  TECH: 'tech', // ผู้ช่วยเภสัชกร/เจ้าหน้าที่
  ADMIN: 'admin' // ผู้ดูแลระบบ
}

export const ROLE_LABELS = {
  [ROLES.PHARMACIST]: 'เภสัชกร',
  [ROLES.TECH]: 'ผู้ช่วยเภสัชกร',
  [ROLES.ADMIN]: 'ผู้ดูแลระบบ'
}

export const LOCATIONS = {
  CENTRAL: 'central', // คลังยาใหญ่
  SUBSTOCK: 'substock', // stock ย่อยห้องยา
  FLOOR: 'floor', // หน้างานจ่ายยา
  PATIENT: 'patient', // จ่ายให้ผู้ป่วยแล้ว (จุดสิ้นสุด)
  DISPOSAL: 'disposal' // ยาเสีย/หมดอายุ ทำลายทิ้ง
}

export const LOCATION_LABELS = {
  [LOCATIONS.CENTRAL]: 'คลังยาใหญ่',
  [LOCATIONS.SUBSTOCK]: 'Stock ย่อยห้องยา',
  [LOCATIONS.FLOOR]: 'หน้างานจ่ายยา',
  [LOCATIONS.PATIENT]: 'ผู้ป่วย',
  [LOCATIONS.DISPOSAL]: 'ทำลาย/หมดอายุ'
}

// ประเภทธุรกรรม — collection `transactions` เป็น append-only audit log (สร้างได้อย่างเดียว ห้ามแก้/ลบ)
export const TX_TYPES = {
  RECEIVE_FROM_CENTRAL: 'receive_from_central', // รับยาเข้า substock จากคลังใหญ่
  TRANSFER_TO_FLOOR: 'transfer_to_floor', // substock -> floor
  DISPENSE: 'dispense', // floor -> ผู้ป่วย
  RETURN_TO_SUBSTOCK: 'return_to_substock', // floor -> substock (คืนของเกิน/หยิบผิด)
  RETURN_TO_CENTRAL: 'return_to_central', // substock -> คลังใหญ่
  ADJUST: 'adjust', // ปรับยอด (นับสต็อกจริงไม่ตรง)
  EXPIRED: 'expired', // ยาหมดอายุ ตัดออกจากสต็อก
  WASTE: 'waste' // ยาเสีย/แตกหัก ตัดออกจากสต็อก
}

export const TX_TYPE_LABELS = {
  [TX_TYPES.RECEIVE_FROM_CENTRAL]: 'รับยาเข้า Substock',
  [TX_TYPES.TRANSFER_TO_FLOOR]: 'โอนไปหน้างานจ่ายยา',
  [TX_TYPES.DISPENSE]: 'จ่ายยาให้ผู้ป่วย',
  [TX_TYPES.RETURN_TO_SUBSTOCK]: 'คืนยาเข้า Substock',
  [TX_TYPES.RETURN_TO_CENTRAL]: 'คืนยาไปคลังใหญ่',
  [TX_TYPES.ADJUST]: 'ปรับยอด',
  [TX_TYPES.EXPIRED]: 'ยาหมดอายุ',
  [TX_TYPES.WASTE]: 'ยาเสีย/แตกหัก'
}

// ธุรกรรมประเภทใดต้องกรอกเหตุผลบังคับ (requires_reason)
export const TX_TYPES_REQUIRE_REASON = new Set([
  TX_TYPES.RETURN_TO_SUBSTOCK,
  TX_TYPES.RETURN_TO_CENTRAL,
  TX_TYPES.ADJUST,
  TX_TYPES.EXPIRED,
  TX_TYPES.WASTE
])

// role ใดสร้างธุรกรรมประเภทใดได้บ้าง — ใช้ทั้งซ่อน/แสดงปุ่มฝั่ง UI และเป็นต้นแบบของ firestore.rules
export const TX_TYPES_ALLOWED_BY_ROLE = {
  [ROLES.PHARMACIST]: Object.values(TX_TYPES),
  [ROLES.ADMIN]: Object.values(TX_TYPES),
  [ROLES.TECH]: [
    TX_TYPES.TRANSFER_TO_FLOOR,
    TX_TYPES.DISPENSE,
    TX_TYPES.RETURN_TO_SUBSTOCK
  ]
}

export function canCreateTxType(role, type) {
  return (TX_TYPES_ALLOWED_BY_ROLE[role] || []).includes(type)
}

// เกณฑ์ยาใกล้หมดอายุ (วัน) — ใช้ทั้งฝั่ง client (แสดงผล) และ Cloud Function (แจ้งเตือน)
export const EXPIRY_WARNING_DAYS = 90
export const EXPIRY_CRITICAL_DAYS = 30

export const ALERT_TYPES = {
  REORDER_SUBSTOCK: 'reorder_substock',
  REORDER_FLOOR: 'reorder_floor',
  EXPIRING_SOON: 'expiring_soon',
  EXPIRED_LOT: 'expired_lot'
}

export const ALERT_TYPE_LABELS = {
  [ALERT_TYPES.REORDER_SUBSTOCK]: 'Substock ต่ำกว่าจุดสั่งซื้อ',
  [ALERT_TYPES.REORDER_FLOOR]: 'หน้างานจ่ายยาต่ำกว่า par level',
  [ALERT_TYPES.EXPIRING_SOON]: 'ยาใกล้หมดอายุ',
  [ALERT_TYPES.EXPIRED_LOT]: 'ยาหมดอายุแล้ว'
}

// หน่วยเริ่มต้นที่ใช้บ่อยในห้องยา (เลือกได้ในฟอร์ม master data)
export const COMMON_UNITS = ['เม็ด', 'แคปซูล', 'ขวด', 'หลอด', 'ซอง', 'กล่อง', 'แผง', 'มล.', 'vial', 'amp']

export const QR_PREFIX = {
  MEDICATION: 'OPDRX:MED:', // ตามด้วย medicationId
  LOT: 'OPDRX:LOT:', // ตามด้วย lotId
  HA_CONFIRM: 'OPDRX:HA:' // ยืนยันยา high-alert ตามด้วย medicationId (สแกนซ้ำเป็น forcing function)
}
