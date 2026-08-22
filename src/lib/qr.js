import { QR_PREFIX } from './constants'

// รูปแบบ payload ของ QR ที่แอปนี้สร้าง/อ่าน (ดู docs/qr-workflow.md สำหรับตัวอย่างเต็ม)
//   ยา:            OPDRX:MED:<medicationId>
//   ล็อต:          OPDRX:LOT:<lotId>
//   ยืนยัน high-alert: OPDRX:HA:<medicationId>
export function encodeMedicationQR(medicationId) {
  return `${QR_PREFIX.MEDICATION}${medicationId}`
}
export function encodeLotQR(lotId) {
  return `${QR_PREFIX.LOT}${lotId}`
}
export function encodeHighAlertConfirmQR(medicationId) {
  return `${QR_PREFIX.HA_CONFIRM}${medicationId}`
}

/** อ่าน payload ที่สแกนได้ คืนค่า {kind:'medication'|'lot'|'ha_confirm'|'unknown', id} */
export function decodeQR(text) {
  if (typeof text !== 'string') return { kind: 'unknown', id: null }
  if (text.startsWith(QR_PREFIX.MEDICATION)) {
    return { kind: 'medication', id: text.slice(QR_PREFIX.MEDICATION.length) }
  }
  if (text.startsWith(QR_PREFIX.LOT)) {
    return { kind: 'lot', id: text.slice(QR_PREFIX.LOT.length) }
  }
  if (text.startsWith(QR_PREFIX.HA_CONFIRM)) {
    return { kind: 'ha_confirm', id: text.slice(QR_PREFIX.HA_CONFIRM.length) }
  }
  return { kind: 'unknown', id: text }
}
